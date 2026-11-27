"""Version-selected portfolio advice; orders remain entirely user controlled."""
import copy
import math

from .allocation_engine import allocate

LEGACY_VER1_HASH = 'f975b97fcfef2b127c857b5225db0b8df5f8755e6182f9382797f5299ba38811'
ASSETS = ('QQQ', 'BTC', 'GOLD')


def score_model_version(result):
    return result.get('model_version') or ('instagram-adaptive-v0.1' if result.get('config_hash') == LEGACY_VER1_HASH else None)


def select_policy(result, registry):
    version = score_model_version(result)
    return next((copy.deepcopy(p) for p in registry.get('policies', [])
                 if p.get('scoreModelVersion') == version), None)


def policy_rules(base_rules, policy):
    rules = copy.deepcopy(base_rules)
    if policy:
        rules['portfolio_guardrails']['cash_floor'] = policy['cashFloor']
        for asset, cap in policy['stopBuyWeight'].items():
            rules['portfolio_guardrails']['stop_buy_weight'][asset] = cap
            rules['max'][asset] = cap
    return rules


def _state_counts(inputs, policy):
    state = inputs.get('policy_state') or {}
    counts = state.get('defensive_sales_completed') or {}
    if state.get('policy_version') != policy['id']:
        return {asset: None for asset in ASSETS}
    if not isinstance(counts, dict):
        raise ValueError('분할매도 실행 횟수 형식을 확인하세요.')
    for count in counts.values():
        if count is not None and (type(count) is not int or count < 0 or count > policy['maxDefensiveSalesPerCycle']):
            raise ValueError('분할매도 실행 횟수는 0~3이어야 합니다.')
    return {asset: counts.get(asset) for asset in ASSETS}


def recommend(scores, inputs, base_rules, policy, score_version=None):
    if policy is None:
        result = allocate(scores, inputs, base_rules)
        result['policy_context'] = {'id': None, 'score_model_version': score_version,
                                    'status': 'unregistered', 'label': '등록되지 않은 Score 버전 · 기존 신규자금 배분'}
        result['policy_actions'] = {'sells': {}, 'reentry_buys': {}, 'statuses': {}, 'reset_counts': []}
        return result
    rules = policy_rules(base_rules, policy)
    result = allocate(scores, inputs, rules)
    completed = _state_counts(inputs, policy)
    holdings = inputs['portfolio']
    amount = inputs['remaining_monthly_investment_krw']
    total = sum(holdings.values())
    current = {a: holdings[a]/total if total else 0 for a in ASSETS}
    stressed = set()
    sells, statuses, reentry = {}, {}, {}
    reset_counts = []
    for a in ASSETS:
        score = scores[a]
        momentum = score.get('score_1m_change')
        accumulation = a in policy.get('accumulationAssets', ())
        if not score.get('usable'):
            statuses[a] = 'score_or_1m_unavailable'
        elif accumulation and score['current_score'] < policy['accumulationScoreBelow']:
            statuses[a] = 'accumulation_candidate'
        elif score['current_score'] >= policy['resetScoreAtLeast']:
            statuses[a] = 'cycle_reset'
            reset_counts.append(a)
        elif not isinstance(momentum, (int, float)) or not math.isfinite(momentum):
            statuses[a] = 'score_or_1m_unavailable'
        elif not accumulation and score['current_score'] < policy['sellBelow'] and momentum <= policy['sellMomentumAtMost']:
            stressed.add(a)
            count = completed[a]
            if count is None:
                statuses[a] = 'sale_history_required'
            elif count >= policy['maxDefensiveSalesPerCycle']:
                statuses[a] = 'sale_limit_reached'
            else:
                value = math.floor(holdings[a]*policy['defensiveSaleFraction'])
                if value > 0:
                    sells[a] = {'amount_krw': value, 'kind': 'defensive',
                                'completed_in_cycle': count}
                statuses[a] = 'defensive_review'
        if a not in stressed and total and current[a] > policy['stopBuyWeight'][a]:
            excess = min(holdings[a]-policy['stopBuyWeight'][a]*total,
                         policy['concentrationSalePortfolioFraction']*total)
            value = math.floor(max(0, excess))
            if value > 0:
                sells[a] = {'amount_krw': value, 'kind': 'concentration'}
                statuses[a] = 'concentration_review'
    # A stressed asset cannot be bought with this month's contribution.
    for a in stressed:
        moved = result['assets'][a]['amount_krw']
        if not moved:
            continue
        result['assets'][a]['amount_krw'] = 0
        result['assets']['CASH']['amount_krw'] += moved
        result['assets'][a]['reasons'].append('Score 악화: 이번 달 신규매수 0원, 현금으로 이동')
    if amount:
        for a, row in result['assets'].items():
            row['suggested_weight'] = row['amount_krw']/amount
            row['projected_weight'] = (holdings[a]+row['amount_krw'])/(total+amount)
    result['cash_shortfall_after_krw'] = max(0, math.ceil(
        rules['portfolio_guardrails']['cash_floor']*(total+amount)-holdings['CASH']-result['assets']['CASH']['amount_krw']-1e-8))
    # Both types of optional purchase share a single cash pool. The new cash
    # allocation may protect the floor, but cannot itself fund optional buys.
    projected = total+amount
    surplus = max(0, min(holdings['CASH']-policy['cashFloor']*total,
                        holdings['CASH']+result['assets']['CASH']['amount_krw']-policy['cashFloor']*projected))
    cash_weight = holdings['CASH']/total if total else 0
    tiers = policy.get('accumulationCashTiers', [])
    tier = next((t for t in reversed(tiers) if cash_weight >= t['cashWeightAtLeast']), None)
    accumulation_buys = {}
    if tier:
        rooms = {}
        for a in policy.get('accumulationAssets', []):
            score = scores[a]
            if not score.get('usable') or not math.isfinite(score['current_score']) or score['current_score'] >= policy['accumulationScoreBelow'] or a in sells:
                continue
            planned = holdings[a]+result['assets'][a]['amount_krw']
            rooms[a] = max(0, min(rules['base'][a]*projected-planned,
                                  rules['max'][a]*projected-planned,
                                  tier['maxAssetPortfolioFraction']*projected))
        total_room = sum(rooms.values())
        budget = min(surplus*tier['surplusCashFraction'], total_room)
        for a, room in rooms.items():
            spend = math.floor(budget*room/total_room) if total_room else 0
            if spend > 0:
                accumulation_buys[a] = spend
                reentry[a] = spend
                statuses[a] = 'accumulation_review'
    remaining_surplus = surplus-sum(accumulation_buys.values())
    budget = min(surplus*policy['recoveryCashFraction'], remaining_surplus)
    ranked = sorted((a for a in ASSETS if a not in stressed and a not in sells and scores[a].get('usable')
                     and isinstance(scores[a].get('score_1m_change'), (int, float))
                     and math.isfinite(scores[a]['score_1m_change'])
                     and scores[a]['current_score'] >= policy['recoveryScoreAtLeast']
                     and scores[a]['score_1m_change'] >= policy['recoveryMomentumAtLeast']),
                    key=lambda a: (-scores[a]['current_score'], a))
    for a in ranked:
        projected = total+amount
        planned = holdings[a]+result['assets'][a]['amount_krw']
        room = min(max(0, rules['base'][a]*projected-planned),
                   max(0, rules['max'][a]*projected-planned),
                   policy['recoveryMaxPortfolioFraction']*projected)
        spend = math.floor(min(budget, room))
        if spend > 0:
            reentry[a] = spend
            budget -= spend
    result['policy_context'] = {'id': policy['id'], 'label': policy['label'],
                                'score_model_version': score_version, 'status': 'active',
                                'research_status': policy['researchStatus'],
                                'cash_floor': policy['cashFloor'],
                                'stop_buy_weight': policy['stopBuyWeight'],
                                'max_defensive_sales': policy['maxDefensiveSalesPerCycle']}
    result['policy_actions'] = {'sells': sells, 'reentry_buys': reentry,
                                'statuses': statuses, 'reset_counts': reset_counts,
                                'accumulation_buys': accumulation_buys,
                                'accumulation_context': {'score_below': policy.get('accumulationScoreBelow'),
                                    'assets': policy.get('accumulationAssets', []),
                                    'cash_weight': cash_weight, 'surplus_cash_krw': math.floor(surplus),
                                    'tier': tier}}
    return result
