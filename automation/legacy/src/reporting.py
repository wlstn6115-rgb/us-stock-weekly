def recommendation(score, momentum, usable):
    if not usable:
        return '데이터 부족: 기본배분 적용'
    if score < 25 and momentum is not None and momentum <= -10:
        return '비중축소 검토 (매도 지시 아님)'
    if score < 40:
        return '신규매수 축소'
    if score >= 75 and momentum is not None and momentum >= 0:
        return '비중확대 추천'
    if score >= 60 and (momentum is None or momentum > -10):
        return '분할매수 추천'
    return 'Hold'

def markdown(result):
    lines = ['# 인스타 데이터 기반 자산배분', '',
             f"시장 기준일: {result['market_date']} / 상태: {result['status']}", '',
             'Score는 환경 우호도이며 상승 확률이 아닙니다. 가중치는 관측 환경에 따라 제한적으로 조정됩니다.', '',
             '| 자산 | Score | 데이터 충족률 | 추천 | 이번 달 남은 금액 배분 |',
             '|---|---:|---:|---|---:|']
    for a, s in result['scores'].items():
        allocation = result.get('allocation')
        amount = f"{allocation['assets'][a]['amount_krw']:,}원" if allocation else '입력 필요'
        lines.append(f"| {a} | {s['current_score']:.2f} | {s['data_coverage']:.0%} | {s['recommendation']} | {amount} |")
    lines += ['', '## 데이터와 모델 제한', ''] + [f'- {w}' for w in result['warnings']]
    for a, s in result['scores'].items():
        lines += ['', f'## {a} 기여요인·가중치', '',
                  '| 요인 | 기준 가중치 | 현재 가중치 | 전일 대비 | Score 기여 | 데이터 |',
                  '|---|---:|---:|---:|---:|---|']
        for c in s['contributions']:
            lines.append(f"| {c['factor']} | {c['base_weight']:.1%} | {c['weight']:.1%} | {c['weight_change']*100:+.2f}%p | {c['points']:+.2f} | {c['data_status']} |")
    return '\n'.join(lines) + '\n'
