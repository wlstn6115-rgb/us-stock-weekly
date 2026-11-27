"""Fill delayed BTC observations from dated Yahoo chart data, never intraday."""
import copy
import math
from datetime import datetime, timezone

from .data_loader import series_rows


def supplement(payload, chart_data):
    result = copy.deepcopy(payload)
    rows = series_rows(payload)
    existing = dict(rows.get('Bitcoin (USD)', []))
    last = max(existing, default='')
    cutoff = payload['market_date']
    today = datetime.now(timezone.utc).date().isoformat()
    # Keep the engine's US market observation calendar; no weekend lag changes.
    calendar = {d for d, _ in rows.get('Nasdaq 100', [])}
    added = []
    for series in chart_data.get('series', []):
        if series.get('id') != 'bitcoin' or series.get('ticker') != 'BTC-USD':
            continue
        for point in series.get('observations', []):
            d, value = point.get('date', ''), point.get('value')
            if d in calendar and last < d <= cutoff and d < today and isinstance(value, (int, float)) and math.isfinite(value) and value > 0:
                added.append((d, float(value)))
    if added:
        collected = datetime.fromisoformat(chart_data['updatedAt'])
        captured = datetime.fromisoformat(payload['generated_at'])
        if collected.tzinfo is None or collected > datetime.now(timezone.utc):
            return result
        result['generated_at'] = max(collected, captured).isoformat()
        target = result['series']['Bitcoin (USD)']
        values = dict(zip(target['dates'], target['values']))
        values.update(added)
        target['dates'] = sorted(values)
        target['values'] = [values[d] for d in target['dates']]
        target['provisionalDates'] = [d for d in target.get('provisionalDates', []) if d not in dict(added)]
        result['score_supplement'] = {'source': 'Yahoo Finance BTC-USD daily Close (UTC)', 'dates': sorted(dict(added)), 'collected_at': chart_data.get('updatedAt')}
    return result
