"""Allowlisted score observations only; never expose holdings or source snapshots."""
import math
from datetime import date, datetime

from .asset_scoring import calculate
from .data_loader import series_rows

def score_history(records):
    observations = {}
    for row in records:
        model = row.get('config_hash')
        day = row.get('market_date')
        available = row.get('available_at') or row.get('generated_at')
        try:
            date.fromisoformat(day)
            datetime.fromisoformat(available)
        except (ValueError, TypeError):
            continue
        if not model:
            continue
        scores = {}
        for key in ('QQQ','BTC','GOLD','CASH'):
            value = row.get('scores', {}).get(key, {})
            score = value.get('current_score')
            scores[key] = score if isinstance(score, (int,float)) and math.isfinite(score) and 0 <= score <= 100 and value.get('usable') else None
        observations[(model, day)] = {'date': day, 'availableAt': available, 'modelVersion': model, 'scores': scores}
    return {'schemaVersion': 1, 'observations': sorted(observations.values(), key=lambda r:(r['date'],r['modelVersion']))}

def score_history_with_gaps(records, snapshots, configs):
    """Add display-only retrospective points between real same-model records.

    A later snapshot is only a source of observations dated on/before the gap;
    its capture timestamp remains the public availability time. These points
    must never be written to the engine's history or used as live signals.
    """
    public = score_history(records)
    actual = {(r.get('config_hash'), r.get('market_date')): r for r in records}
    dates_by_model = {}
    for model, day in actual:
        if model and day:
            dates_by_model.setdefault(model, set()).add(day)
    sources = []
    for payload in snapshots:
        try:
            captured = datetime.fromisoformat(payload['generated_at'].replace('Z', '+00:00'))
            day = date.fromisoformat(payload['market_date'])
            calendar = {d for d, _ in series_rows(payload).get('Nasdaq 100', [])}
        except (KeyError, TypeError, ValueError):
            continue
        if captured.tzinfo is not None:
            sources.append((captured, day, calendar, payload))
    sources.sort(key=lambda item: item[0])
    for model, recorded_dates in dates_by_model.items():
        if len(recorded_dates) < 2 or model not in configs:
            continue
        first, last = min(recorded_dates), max(recorded_dates)
        calendar = sorted({d for _, _, days, _ in sources for d in days if first < d < last})
        previous = None
        for day in sorted(set(calendar) | recorded_dates):
            if (model, day) in actual:
                previous = actual[(model, day)]
                continue
            source = next((p for _, source_day, days, p in sources
                           if source_day.isoformat() >= day and day in days), None)
            if source is None or previous is None:
                continue
            try:
                rows = series_rows({**source, 'market_date': day})
                estimate = calculate(rows, configs[model], day, previous)
            except (KeyError, TypeError, ValueError, ZeroDivisionError):
                continue
            scores = {asset: value['current_score'] if value['usable'] else None
                      for asset, value in estimate['scores'].items()}
            if not any(value is not None for value in scores.values()):
                continue
            public['observations'].append({'date': day, 'availableAt': source['generated_at'],
                                           'modelVersion': model, 'scores': scores,
                                           'source': 'retrospective', 'pointInTimeVerified': False})
            previous = estimate
    public['observations'].sort(key=lambda r: (r['date'], r['modelVersion']))
    return public
