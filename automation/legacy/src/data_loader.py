"""Read the exact numeric payload used by the Instagram producer, never images."""
import json
import math
from datetime import date
from pathlib import Path

LABELS = {'S&P500': 'S&P 500', '나스닥100': 'Nasdaq 100',
          '미 10년물': 'US 10Y Treasury', '달러인덱스': 'Dollar Index',
          '골드': 'Gold', '비트코인': 'Bitcoin (USD)', '원달러': 'USD/KRW'}

def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))

def series_rows(payload):
    cutoff = payload['market_date']
    date.fromisoformat(cutoff)
    output = {}
    for name, series in payload['series'].items():
        dates, values = series.get('dates', []), series.get('values', [])
        if len(dates) != len(values):
            raise ValueError(f'Mismatched dates/values: {name}')
        excluded = set(series.get('provisionalDates', []))
        rows = {}
        for d, v in zip(dates, values):
            if d > cutoff or d in excluded or v is None:
                continue
            date.fromisoformat(d)
            if not isinstance(v, (float, int)) or not math.isfinite(v):
                raise ValueError(f'Invalid observation: {name}/{d}')
            rows[d] = float(v)
        output[name] = rows
    # The final producer values take precedence over its older report history.
    for item in payload.get('market_items', []):
        name = LABELS.get(item.get('label'))
        if not name:
            continue
        rows = output.setdefault(name, {})
        dates, values = item.get('dates', []), item.get('values', [])
        missing = item.get('missing', [False] * len(dates))
        if not (len(dates) == len(values) == len(missing)):
            raise ValueError(f'Invalid market item: {name}')
        for d, v, absent in zip(dates, values, missing):
            if not absent and d <= cutoff and v is not None and math.isfinite(v):
                rows[d] = float(v)
        # Do not ingest current quotes: they may be intraday. Closed dated slots only.
    return {name: sorted(rows.items()) for name, rows in output.items()}
