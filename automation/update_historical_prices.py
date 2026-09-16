"""Yahoo daily observations -> validated completed monthly prices. No score fabrication."""
import argparse
import calendar
import hashlib
import json
import math
import os
from pathlib import Path
import sys
import tempfile
from datetime import date, datetime, timedelta, timezone

ROOT = Path(__file__).resolve().parents[1]
IDS = {'equity', 'gold', 'bitcoin', 'cash', 'benchmark'}


def month_end(d):
    return date(d.year, d.month, calendar.monthrange(d.year, d.month)[1])


def next_month(d):
    return (month_end(d) + timedelta(days=1)).replace(day=1)


def positive(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and v > 0


def monthly(series, today, stale):
    """Reject broken observations rather than forward-fill across missing months."""
    result = {}
    previous = None
    for day, value in series:
        if previous is not None and day <= previous:
            raise ValueError('Duplicate or unordered daily observation')
        if not positive(value):
            raise ValueError(f'Invalid daily price: {day}')
        previous = day
        if day >= today.replace(day=1):
            continue
        result[month_end(day)] = (day, value)
    for end, (day, _) in result.items():
        if (end - day).days > stale:
            raise ValueError(f'Stale monthly observation: {day}')
    return result


def build(config, series, today, updated_at, versions):
    if set(config['assets']) != IDS:
        raise ValueError('Exactly five canonical assets are required')
    grouped = {k: monthly(series[k], today, config['maxStalenessDays']) for k in [*config['assets'], 'fx']}
    if any(not rows for rows in grouped.values()):
        raise ValueError('A required asset or FX history is empty')
    start = max(min(rows) for rows in grouped.values())
    finish = today.replace(day=1) - timedelta(days=1)
    rows = []
    cursor = start
    while cursor <= finish:
        if any(cursor not in values for values in grouped.values()):
            raise ValueError(f'Missing required month or asset: {cursor}')
        fx_day, fx = grouped['fx'][cursor]
        assets = {}
        for key, spec in config['assets'].items():
            source_day, usd = grouped[key][cursor]
            assets[key] = {'value': usd * fx, 'usdValue': usd, 'currency': 'KRW',
                           'priceType': spec['priceType'], 'ticker': spec['ticker'],
                           'sourceDate': source_day.isoformat()}
        # Calendar daily bars have no reliable publication timestamp. Conservative next-day cutoff.
        rows.append({'date': cursor.isoformat(), 'availableAt': (cursor + timedelta(days=1)).isoformat() + 'T00:00:00Z',
                     'assets': assets, 'fx': {'value': fx, 'sourceDate': fx_day.isoformat(), 'unit': 'KRW per USD'}})
        cursor = month_end(next_month(cursor))
    if not rows:
        raise ValueError('No common completed months')
    payload = {'schemaVersion': 2, 'metadata': {'source': 'Yahoo Finance via yfinance', 'updatedAt': updated_at,
        'frequency': 'monthly', 'currency': 'KRW', 'priceType': 'mixed_adjusted_close_and_close_fx_converted',
        'tickers': {k: v['ticker'] for k, v in config['assets'].items()}, 'fxTicker': config['fx']['ticker'],
        'fields': {k: v['field'] for k, v in config['assets'].items()}, 'versions': versions,
        'startDate': rows[0]['date'], 'endDate': rows[-1]['date'], 'scoreAvailable': False,
        'cashModel': 'BIL_USD_converted_to_KRW', 'pointInTimeVerified': False,
        'availabilityRule': 'next calendar day 00:00 UTC; assumed, not observed publication time',
        'fxRule': 'last available asset and FX bars in the same completed month; not synchronous closes',
        'priceWindows': {str(y): max(0, len(rows)-12*y) for y in [1, 3, 5, 10]},
        'seriesCoverage': {k: {'start': min(v).isoformat(), 'end': max(v).isoformat()} for k,v in grouped.items()}},
        'snapshots': rows}
    payload['metadata']['dataVersion'] = hashlib.sha256(json.dumps(rows, sort_keys=True).encode()).hexdigest()
    validate(payload)
    return payload


def validate(payload):
    rows = payload['snapshots']
    if payload['schemaVersion'] != 2 or not rows:
        raise ValueError('Invalid historical payload')
    previous = None
    for row in rows:
        day = date.fromisoformat(row['date'])
        if day != month_end(day) or (previous and day != month_end(next_month(previous))):
            raise ValueError('Non-contiguous monthly index')
        if set(row['assets']) != IDS:
            raise ValueError('Missing asset')
        for a in row['assets'].values():
            if not positive(a['value']) or not positive(a['usdValue']):
                raise ValueError('Non-finite or non-positive price')
        previous = day


def atomic_write(path, payload, validator=validate):
    validator(payload)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent, delete=False) as handle:
            temporary = Path(handle.name)
            json.dump(payload, handle, ensure_ascii=False, allow_nan=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        validator(json.loads(temporary.read_text(encoding='utf-8')))
        os.replace(temporary, path)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()


def download(config, today):
    import yfinance as yf
    import pandas as pd
    frames = {}
    series = {}
    for key, spec in [*config['assets'].items(), ('fx', config['fx'])]:
        ticker = spec['ticker']
        if ticker not in frames:
            frame = yf.download(ticker, start=config['startDate'], end=today.replace(day=1).isoformat(),
                                interval='1d', auto_adjust=False, back_adjust=False, repair=False,
                                actions=False, keepna=True, threads=False, progress=False, multi_level_index=False)
            if frame is None or frame.empty:
                raise ValueError(f'Yahoo returned no data: {ticker}')
            frames[ticker] = frame
            print(f'{ticker}: actual columns={list(frame.columns)} rows={len(frame)}', flush=True)
        frame = frames[ticker]
        if spec['field'] not in frame.columns:
            raise ValueError(f'Missing requested price field: {ticker} {spec["field"]}')
        values = frame[spec['field']]
        print(f'{ticker}: missing daily {spec["field"]} observations excluded={int(values.isna().sum())}', flush=True)
        series[key] = [(stamp.date(), float(v)) for stamp, v in values.dropna().items()]
    return series, {'yfinance': yf.__version__, 'pandas': pd.__version__}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', type=Path, default=ROOT/'config/historical_prices.json')
    parser.add_argument('--output', type=Path, default=ROOT/'web/dist/simulation-history.json')
    parser.add_argument('--fx-output', type=Path, default=ROOT/'web/dist/fx.json')
    args = parser.parse_args()
    try:
        config = json.loads(args.config.read_text(encoding='utf-8'))
        today = datetime.now(timezone.utc).date()
        series, versions = download(config, today)
        payload = build(config, series, today, datetime.now(timezone.utc).isoformat(), versions)
        import yfinance as yf
        fx_frame = yf.download(config['fx']['ticker'], start=(today-timedelta(days=14)).isoformat(),
                               end=today.isoformat(), auto_adjust=False, multi_level_index=False, progress=False)
        fx_values = fx_frame['Close'].dropna()
        if fx_values.empty:
            raise ValueError('Recent FX data missing')
        fx_date, fx_value = fx_values.index[-1].date(), float(fx_values.iloc[-1])
        if not positive(fx_value) or (today-fx_date).days>7:
            raise ValueError('Recent FX data invalid or stale')
        fx_payload={'schemaVersion':1,'date':fx_date.isoformat(),'value':fx_value,'unit':'KRW per USD','source':'Yahoo Finance KRW=X','updatedAt':datetime.now(timezone.utc).isoformat()}
        atomic_write(args.output, payload)
        atomic_write(args.fx_output, fx_payload, lambda p: positive(p['value']) or (_ for _ in ()).throw(ValueError('Invalid FX')))
        print(json.dumps({'status': 'ok', 'months': len(payload['snapshots']), 'range': [payload['metadata']['startDate'], payload['metadata']['endDate']], 'priceWindows': payload['metadata']['priceWindows']}))
    except Exception as exc:
        print(f'FAILED; previous output preserved: {exc}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
