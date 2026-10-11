(function(root){
 'use strict';
 const allocator=root.AllocationModel||(typeof require!=='undefined'?require('./allocation-model.js'):null);
 const assets=['QQQ','BTC','GOLD'];
 function recommend(scores,input,baseRules,policy,scoreVersion){
  if(!policy){const result=allocator.allocate(scores,input,baseRules);result.policy_context={id:null,score_model_version:scoreVersion,status:'unregistered',label:'등록되지 않은 Score 버전 · 기존 신규자금 배분'};result.policy_actions={sells:{},reentry_buys:{},statuses:{},reset_counts:[]};return result;}
  const rules=JSON.parse(JSON.stringify(baseRules));
  rules.portfolio_guardrails.cash_floor=policy.cashFloor;
  for(const [a,cap]of Object.entries(policy.stopBuyWeight)){rules.portfolio_guardrails.stop_buy_weight[a]=cap;rules.max[a]=cap;}
  const result=allocator.allocate(scores,input,rules),holdings=input.portfolio,amount=input.remaining_monthly_investment_krw;
  const total=Object.values(holdings).reduce((a,b)=>a+b,0),sells={},statuses={},reentry={},stressed=new Set(),resetCounts=[];
  const state=input.policy_state||{},counts=state.defensive_sales_completed||{};
  if(state.policy_version===policy.id){if(typeof counts!=='object'||Array.isArray(counts)||Object.values(counts).some(n=>n!==null&&(!Number.isInteger(n)||n<0||n>policy.maxDefensiveSalesPerCycle)))throw Error('분할매도 실행 횟수는 0~3이어야 합니다.');}
  for(const a of assets){
   const score=scores[a],momentum=score.score_1m_change,weight=total?holdings[a]/total:0;
   if(!score.usable)statuses[a]='score_or_1m_unavailable';
   else if(score.current_score>=policy.resetScoreAtLeast){statuses[a]='cycle_reset';resetCounts.push(a);}
   else if(!Number.isFinite(momentum))statuses[a]='score_or_1m_unavailable';
   else if(score.current_score<policy.sellBelow&&momentum<=policy.sellMomentumAtMost){
    stressed.add(a);const count=state.policy_version===policy.id?counts[a]??null:null;
    if(count===null)statuses[a]='sale_history_required';
    else if(count>=policy.maxDefensiveSalesPerCycle)statuses[a]='sale_limit_reached';
    else{const value=Math.floor(holdings[a]*policy.defensiveSaleFraction);if(value>0)sells[a]={amount_krw:value,kind:'defensive',completed_in_cycle:count};statuses[a]='defensive_review';}
   }
   if(!stressed.has(a)&&total&&weight>policy.stopBuyWeight[a]){
    const value=Math.floor(Math.max(0,Math.min(holdings[a]-policy.stopBuyWeight[a]*total,policy.concentrationSalePortfolioFraction*total)));
    if(value>0){sells[a]={amount_krw:value,kind:'concentration'};statuses[a]='concentration_review';}
   }
  }
  for(const a of stressed){const moved=result.assets[a].amount_krw;if(!moved)continue;result.assets[a].amount_krw=0;result.assets.CASH.amount_krw+=moved;result.assets[a].reasons.push('Score 악화: 이번 달 신규매수 0원, 현금으로 이동');}
  if(amount)for(const a of Object.keys(result.assets)){const row=result.assets[a];row.suggested_weight=row.amount_krw/amount;row.projected_weight=(holdings[a]+row.amount_krw)/(total+amount);}
  result.cash_shortfall_after_krw=Math.max(0,Math.ceil(policy.cashFloor*(total+amount)-holdings.CASH-result.assets.CASH.amount_krw-1e-8));
  let budget=Math.max(0,holdings.CASH-policy.cashFloor*total)*policy.recoveryCashFraction;
  const ranked=assets.filter(a=>!stressed.has(a)&&!sells[a]&&scores[a].usable&&Number.isFinite(scores[a].score_1m_change)&&scores[a].current_score>=policy.recoveryScoreAtLeast&&scores[a].score_1m_change>=policy.recoveryMomentumAtLeast).sort((a,b)=>scores[b].current_score-scores[a].current_score||a.localeCompare(b));
  for(const a of ranked){const projected=total+amount,planned=holdings[a]+result.assets[a].amount_krw,room=Math.min(Math.max(0,rules.base[a]*projected-planned),Math.max(0,rules.max[a]*projected-planned),policy.recoveryMaxPortfolioFraction*projected),spend=Math.floor(Math.min(budget,room));if(spend>0){reentry[a]=spend;budget-=spend;}}
  result.policy_context={id:policy.id,label:policy.label,score_model_version:scoreVersion,status:'active',research_status:policy.researchStatus,cash_floor:policy.cashFloor,stop_buy_weight:policy.stopBuyWeight,max_defensive_sales:policy.maxDefensiveSalesPerCycle};
  result.policy_actions={sells,reentry_buys:reentry,statuses,reset_counts:resetCounts};return result;
 }
 const api={recommend};root.AllocationPolicy=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
