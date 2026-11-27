import argparse
import hashlib
import json
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from src.data_loader import read_json, series_rows
from src.asset_scoring import calculate
from src.allocation_engine import allocate
from src.allocation_policy import recommend as policy_recommend, select_policy
from src.reporting import markdown, recommendation
from src.score_supplement import supplement

ROOT = Path(__file__).resolve().parent

def write_atomic(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False)
    fd, temp = tempfile.mkstemp(dir=path.parent, suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            f.write(text)
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)

def bootstrap(workspace):
    manifest = read_json(workspace / '03_instagram/daily/manifest.json')
    metadata = manifest['metadata']
    report = Path(metadata['reportPath'])
    # This is the exact report selected by the most recent daily producer.
    text = report.read_text(encoding='utf-8-sig')
    match = re.search(r'const series = (.*?);\s*const marketOverlay', text, re.S)
    if not match:
        raise ValueError('Daily source report has no series payload')
    return {'schema_version': 1, 'market_date': metadata['usMarketDate'],
            'generated_at': datetime.now(timezone.utc).isoformat(), 'series': json.loads(match[1]),
            'market_items': [], 'validation_status': metadata['validation']['status'],
            'source_report': str(report), 'bootstrap': True}

def run(payload, config, out, portfolio=None):
    isolated_calendar_failure = False
    calendar_fail_count = 0
    if payload['validation_status'] != 'PASS':
        report = payload.get('validation_report') or {}
        issues = report.get('issues') or []
        calendar_fail_count = sum(i.get('severity') == 'FAIL' for i in issues)
        isolated_calendar_failure = (payload['validation_status'] == 'FAIL'
            and report.get('summary', {}).get('marketDate') == payload['market_date']
            and report.get('status') == 'FAIL'
            and report.get('failCount') == calendar_fail_count
            and calendar_fail_count > 0
            and all(i.get('scope') == 'calendar' for i in issues if i.get('severity') == 'FAIL'))
        if not isolated_calendar_failure:
            raise ValueError('Instagram market validation did not pass; score calculation stopped')
    captured = datetime.fromisoformat(payload['generated_at'])
    if captured.tzinfo is None:
        raise ValueError('generated_at must include timezone')
    now = datetime.now(timezone.utc)
    if captured > now:
        raise ValueError('Future capture timestamp')
    if (now.date() - datetime.fromisoformat(payload['market_date']).date()).days > 5:
        raise ValueError('Market snapshot is more than five calendar days old')
    if (now - captured).total_seconds() > 5 * 86400:
        raise ValueError('Source capture is stale')
    rows = series_rows(payload)
    for name in ('Nasdaq 100', 'S&P 500', 'US 10Y Treasury', 'Dollar Index', 'Gold'):
        values = rows.get(name, [])
        if not values or (datetime.fromisoformat(payload['market_date']).date() - datetime.fromisoformat(values[-1][0]).date()).days > 5:
            raise ValueError(f'Missing or stale score input: {name}')
    config_hash = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()
    snapshot_id = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    history_dir = out / 'history' / config_hash
    # Previous DAY only: reruns cannot compound adaptive-weight updates.
    history = [read_json(p) for p in sorted(history_dir.glob('*.json')) if p.stem < payload['market_date']]
    previous = history[-1] if history else None
    result = calculate(rows, config, payload['market_date'], previous)
    result.update(market_date=payload['market_date'], generated_at=now.isoformat(),
                  available_at=payload['generated_at'], config_hash=config_hash, snapshot_id=snapshot_id,
                  model_version=config.get('version'),
                  status='scores_only', allocation=None,
                  warnings=['QQQ 입력은 Nasdaq 100 지수, 상대강도는 Nasdaq 100/S&P 500 대용입니다.',
                            '실질금리·VIX·HY spread·SOX·단기금리 입력은 아직 연결되지 않았습니다.',
                            'Cash는 원화 대기자금의 방어적 매력도이며 이자 수익률을 모델링하지 않습니다.',
                            '기존 과거 시계열은 공개 버전 미검증: 엄격한 과거 백테스트에 사용할 수 없습니다.',
                            '가중치 변화는 stress 기반 규칙이며 수익률 학습이나 최적화 결과가 아닙니다.'])
    if isolated_calendar_failure:
        result['warnings'].append(f'인스타 경제일정 발표값 {calendar_fail_count}건 누락으로 전체 검증은 FAIL이지만, Score 입력 시계열과 기준일을 별도로 검증하여 계산했습니다. 일정 값은 Score 요인이 아닙니다.')
    delayed = [f"{name} ({factor['latest_observation'] or '없음'})" for name, factor in result['factors'].items()
               if factor['latest_observation'] != payload['market_date']]
    if delayed:
        result['warnings'].append('기준일과 마지막 관측일이 다른 요인: ' + ', '.join(delayed) + '. 미확정 가격은 소급 사용하지 않습니다.')
    if payload.get('bootstrap'):
        result['warnings'].append('초기 연결은 인스타가 사용한 보고서 시계열입니다. 다음 데일리 실행부터 최종 시장 수치도 전달됩니다.')
    if payload.get('score_supplement'):
        result['warnings'].append('비트코인 지연 구간은 Yahoo Finance BTC-USD의 확정된 UTC 일봉으로 보완했습니다. 원본 TradingView 미국장 종가 시점과 다를 수 있습니다. 보완 자료는 수집 이후 판단에만 사용합니다.')
    calendar = sorted({d for d, _ in rows.get('Nasdaq 100', [])} | {payload['market_date']})
    archived = {h['market_date']: h for h in history}
    for asset, score in result['scores'].items():
        for label, n in [('1d', 1), ('1w', 5), ('1m', 21)]:
            # Archived daily observations only; never fabricate historical scores from revised data.
            reference = calendar[-n-1] if len(calendar) > n else None
            old = archived.get(reference)
            score[f'score_{label}_change'] = score['current_score'] - old['scores'][asset]['current_score'] if old else None
            score[f'score_{label}_reference_date'] = old['market_date'] if old else None
        score['recommendation'] = recommendation(score['current_score'], score['score_1m_change'], score['usable'])
        if score['score_1d_change'] is not None and score['score_1d_change'] <= -10:
            result['warnings'].append(f'{asset}: 급격한 Score 하락')
    if portfolio is not None:
        registry = read_json(ROOT / 'config/allocation_policies.json')
        result['allocation'] = policy_recommend(result['scores'], portfolio, config['rules'],
                                                  select_policy(result, registry), result['model_version'])
        result['status'] = 'example_allocation' if portfolio.get('example_only') else 'allocation_ready'
        for asset, detail in result['allocation']['assets'].items():
            if detail['constraint_active']:
                result['warnings'].append(f'{asset}: 월 배분 한도 적용')
            if detail['current_weight'] > config['rules']['reference'][asset] and result['scores'][asset]['recommendation'] == '비중확대 추천':
                result['scores'][asset]['recommendation'] = '분할매수 추천 (과대비중으로 강화 제한)'
        if result['allocation']['fallback_due_to_data']:
            result['warnings'].append('데이터 부족으로 모든 자산의 Score tilt를 중지하고 기본배분·보유비중만 반영했습니다.')
    else:
        result['warnings'].append('실제 포트폴리오와 이번 달 남은 투자금 미입력: 금액 추천을 생성하지 않았습니다.')
    write_atomic(out / 'snapshots' / f'{snapshot_id}.json', payload)
    write_atomic(out / 'configs' / f'{config_hash}.json', config)
    write_atomic(history_dir / f"{payload['market_date']}.json", result)
    write_atomic(out / 'latest.json', result)
    write_atomic(out / 'latest.md', markdown(result))
    return result

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', type=Path)
    parser.add_argument('--bootstrap', action='store_true')
    parser.add_argument('--portfolio', type=Path)
    parser.add_argument('--config', type=Path, default=ROOT / 'config/model.json')
    parser.add_argument('--output', type=Path, default=ROOT / 'output')
    args = parser.parse_args()
    out = args.output
    out.mkdir(parents=True, exist_ok=True)
    lock = out / '.run.lock'
    try:
        fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        raise RuntimeError('Another allocation run is active; inspect lock if previous process crashed')
    os.close(fd)
    try:
        input_path = args.input or ROOT.parent / '03_instagram/daily/allocation_input.json'
        payload = bootstrap(ROOT.parent) if args.bootstrap else read_json(input_path)
        report_path = input_path.with_name('validation.json')
        if not args.bootstrap and input_path.name == 'allocation_input.json' and report_path.exists():
            report = read_json(report_path)
            if report.get('summary', {}).get('marketDate') == payload.get('market_date'):
                payload['validation_report'] = report
        chart_path = ROOT / 'web/dist/market-charts.json'
        if chart_path.exists():
            payload = supplement(payload, read_json(chart_path))
        portfolio_path = args.portfolio or ROOT / 'config/portfolio.local.json'
        portfolio = read_json(portfolio_path) if portfolio_path.exists() else None
        result = run(payload, read_json(args.config), out, portfolio)
        write_atomic(out / 'status.json', {'status': result['status'], 'market_date': result['market_date']})
        print(json.dumps({'status': result['status'], 'market_date': result['market_date'], 'report': str(out / 'latest.md')}, ensure_ascii=True))
    except Exception as error:
        # Never leave a previous valid recommendation looking current after a failed refresh.
        write_atomic(out / 'status.json', {'status': 'error', 'message': str(error)})
        write_atomic(out / 'latest.json', {'status': 'error', 'message': str(error), 'allocation': None})
        write_atomic(out / 'latest.md', '# 자산배분 갱신 실패\n\n' + str(error) + '\n')
        raise
    finally:
        lock.unlink()

if __name__ == '__main__':
    main()
