"""Bounded, regime-conditioned daily factor weights. No return-probability claim."""
import math
import statistics
from datetime import date

def clip(x, lo=-1.0, hi=1.0):
    return max(lo, min(hi, x))

def feature(rows, spec, cutoff, window, minimum):
    rows = list(rows)
    if not rows:
        return None, 'missing'
    if (date.fromisoformat(cutoff) - date.fromisoformat(rows[-1][0])).days > spec['max_age_days']:
        return None, 'stale'
    xs = [v for _, v in rows]
    lag = spec.get('lag', 1)
    mode = spec['transform']
    if mode == 'level':
        values = xs
    elif mode == 'difference':
        values = [xs[i] - xs[i-lag] for i in range(lag, len(xs))]
    elif mode == 'log_return':
        if any(x <= 0 for x in xs):
            return None, 'nonpositive_price'
        values = [math.log(xs[i] / xs[i-lag]) for i in range(lag, len(xs))]
    else:
        raise ValueError(f'Unsupported transform: {mode}')
    if len(values) < minimum + 1:
        return None, 'warmup'
    past = values[-window-1:-1]
    sd = statistics.pstdev(past)
    if sd < 1e-12:
        return None, 'zero_variance'
    return clip((values[-1] - statistics.mean(past)) / sd / 3), 'ok'

def calculate(rows, config, cutoff, previous=None):
    factors = {}
    for name, spec in config['factors'].items():
        source = rows.get(spec['series'], [])
        if spec.get('denominator'):
            other = dict(rows.get(spec['denominator'], []))
            source = [(d, v / other[d]) for d, v in source if d in other and other[d] > 0]
        value, status = feature(source, spec, cutoff, config['window'], config['minimum'])
        factors[name] = {'value': value, 'status': status, 'group': spec['group'],
                         'series': spec['series'], 'latest_observation': source[-1][0] if source else None}
    # Stress is independently observed from equity weakness and dollar/nominal-rate pressure.
    drivers = config['regime_drivers']
    terms = [sign * factors[f]['value'] for f, sign in drivers.items() if factors[f]['value'] is not None]
    stress = clip(sum(terms) / len(terms), 0, 1) if terms else 0
    scores, weight_log = {}, {}
    for asset, specs in config['assets'].items():
        base = {f: entry['weight'] for f, entry in specs.items()}
        if abs(sum(base.values()) - 1) > 1e-9 or any(w <= 0 for w in base.values()):
            raise ValueError(f'Weights must be positive and sum to 1: {asset}')
        target = {f: w * (1 + stress * config['stress_group_boost'].get(factors[f]['group'], 0))
                  for f, w in base.items()}
        total = sum(target.values())
        target = {f: w / total for f, w in target.items()}
        # Uniform interpolation preserves sum=1 and caps EVERY deviation from base.
        delta = max(abs(target[f] - base[f]) for f in base)
        k = min(1, config['max_weight_deviation'] / delta) if delta else 1
        target = {f: base[f] + k * (target[f] - base[f]) for f in base}
        old = previous['weights'][asset] if previous else base
        delta = max(abs(target[f] - old[f]) for f in base)
        step = min(config['weight_smoothing'], config['max_daily_weight_change'] / delta) if delta else 0
        weights = {f: old[f] + step * (target[f] - old[f]) for f in base}
        weight_log[asset] = weights
        contributions = []
        coverage = 0
        for f, entry in specs.items():
            observed = factors[f]['value']
            if observed is not None:
                coverage += weights[f]
            contribution = 50 * weights[f] * entry['direction'] * (observed or 0)
            contributions.append({'factor': f, 'weight': weights[f], 'base_weight': base[f],
                                  'weight_change': weights[f] - old[f], 'points': contribution,
                                  'data_status': factors[f]['status']})
        score = 50 + sum(c['points'] for c in contributions)
        # Separates market change at today's weights from the effect of changing weights.
        previous_at_today_weights = None
        if previous:
            previous_at_today_weights = 50 + sum(50 * weights[f] * entry['direction'] *
                (previous['factors'].get(f, {}).get('value') or 0) for f, entry in specs.items())
        scores[asset] = {'current_score': score, 'data_coverage': coverage,
                         'usable': coverage >= config['minimum_coverage'],
                         'contributions': sorted(contributions, key=lambda c: c['points'], reverse=True),
                         'market_change_at_current_weights': None if previous is None else score - previous_at_today_weights,
                         'weight_change_effect': None if previous is None else previous_at_today_weights - previous['scores'][asset]['current_score']}
    return {'stress': stress, 'regime': 'risk_off' if stress >= config['risk_off_threshold'] else 'normal',
            'factors': factors, 'weights': weight_log, 'scores': scores}
