import math

def project(candidate, lower, upper):
    if any(lower[a] > upper[a] for a in candidate) or sum(lower.values()) > 1 + 1e-10 or sum(upper.values()) < 1 - 1e-10:
        raise ValueError('Infeasible allocation bounds')
    lo, hi = -10.0, 10.0
    for _ in range(100):
        mid = (lo + hi) / 2
        total = sum(max(lower[a], min(upper[a], q - mid)) for a, q in candidate.items())
        if total > 1:
            lo = mid
        else:
            hi = mid
    return {a: max(lower[a], min(upper[a], q - (lo + hi)/2)) for a, q in candidate.items()}

def allocate(scores, inputs, rules):
    base = rules['base']
    holdings = inputs['portfolio']
    amount = inputs['remaining_monthly_investment_krw']
    if set(holdings) != set(base) or any(not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0 for v in holdings.values()):
        raise ValueError('Portfolio requires nonnegative finite QQQ/BTC/GOLD/CASH KRW values')
    if type(amount) is not int or amount < 0:
        raise ValueError('Remaining monthly investment must be a nonnegative integer')
    if abs(sum(base.values()) - 1) > 1e-9:
        raise ValueError('Base allocation must sum to 1')
    total = sum(holdings.values())
    current = {a: holdings[a] / total if total else rules['reference'][a] for a in base}
    lower = {a: max(rules['min'][a], base[a] - rules['max_tilt'][a]) for a in base}
    upper = {a: min(rules['max'][a], base[a] + rules['max_tilt'][a]) for a in base}
    candidate = {}
    fallback = not all(s['usable'] for s in scores.values())
    for a in base:
        s = scores[a]
        momentum = s.get('score_1m_change') or 0
        tilt = 0 if fallback else rules['score_strength'] * (s['current_score']-50)/50 + rules['momentum_strength'] * max(-1, min(1, momentum/20))
        candidate[a] = base[a] + tilt + rules['portfolio_strength'] * (rules['reference'][a] - current[a])
    reasons = {a: [] for a in base}
    guard = rules.get('portfolio_guardrails')
    cash_need = 0
    if guard:
        floor = guard['cash_floor']
        caps = guard['stop_buy_weight']
        if not 0 <= floor <= 1 or any(not rules['reference'][a] < cap <= 1 for a, cap in caps.items()):
            raise ValueError('Invalid portfolio guardrails')
        cash_need = max(0, floor * (total + amount) - holdings['CASH'])
        safety = cash_need > 0 or any(total and current[a] > rules['reference'][a] for a in caps)
        if safety:
            # Portfolio safety takes precedence over ordinary monthly minimum/tilt.
            lower = {a: 0 for a in base}
            upper['CASH'] = 1
            if amount:
                lower['CASH'] = min(1, math.ceil(cash_need - 1e-8) / amount)
                if cash_need:
                    reasons['CASH'].append(f'현금 {floor:.0%} 확보 우선: 부족액 {math.ceil(cash_need):,}원')
            for a, cap in caps.items():
                reference = rules['reference'][a]
                if total and current[a] >= cap:
                    upper[a] = 0
                    reasons[a].append(f'현재 비중 {current[a]:.1%} ≥ 매수중단 기준 {cap:.0%}: 신규매수 0원')
                elif total and current[a] > reference:
                    upper[a] *= (cap - current[a]) / (cap - reference)
                    reasons[a].append(f'기준 비중 {reference:.0%} 초과: 추가매수 단계적 축소')
                if amount:
                    room = max(0, math.floor(cap * (total + amount) - holdings[a] + 1e-8)) / amount
                    upper[a] = min(upper[a], room)
            for a in base:
                if a != 'CASH' and lower['CASH'] > 0:
                    upper[a] = min(upper[a], 1 - lower['CASH'])
                    reasons[a].append('현금 확보를 위해 일반 월 최소배분·Max Tilt 하한 해제')
    weights = project(candidate, lower, upper)
    buys = {a: 0 for a in base}
    if amount:
        # Integer feasible bounds avoid re-breaking constraints after rounding.
        mins = {a: math.ceil(amount * lower[a] - 1e-8) for a in base}
        maxs = {a: math.floor(amount * upper[a] + 1e-8) for a in base}
        if sum(mins.values()) > amount or sum(maxs.values()) < amount:
            raise ValueError('Investment is too small for integer KRW allocation bounds')
        buys = {a: max(mins[a], min(maxs[a], math.floor(amount*weights[a]))) for a in base}
        while sum(buys.values()) != amount:
            direction = 1 if sum(buys.values()) < amount else -1
            eligible = [a for a in base if (buys[a] < maxs[a] if direction > 0 else buys[a] > mins[a])]
            a = max(eligible, key=lambda a: direction * (amount * weights[a] - buys[a]))
            buys[a] += direction
    return {'remaining_monthly_investment_krw': amount, 'fallback_due_to_data': fallback,
            'cash_shortfall_after_krw': max(0, math.ceil(cash_need - buys['CASH'] - 1e-8)),
            'assets': {a: {'current_weight': current[a], 'suggested_weight': weights[a],
                 'amount_krw': buys[a], 'projected_weight': (holdings[a]+buys[a])/(total+amount) if total+amount else 0,
                 'lower_bound': lower[a], 'upper_bound': upper[a], 'reasons': reasons[a],
                 'constraint_active': abs(weights[a]-lower[a]) < 1e-8 or abs(weights[a]-upper[a]) < 1e-8}
                 for a in base}}
