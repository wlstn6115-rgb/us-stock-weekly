(function(root){
function browserAllocate(scores, input, rules) {
  const names = Object.keys(rules.base);
  if (!input || !input.portfolio || Object.keys(input.portfolio).sort().join() !== names.slice().sort().join()) throw Error('네 자산의 보유액을 입력하세요.');
  const amount = input.remaining_monthly_investment_krw;
  if ([amount,...Object.values(input.portfolio)].some(v=>!Number.isSafeInteger(v)||v<0||v>1e15)) throw Error('금액은 0 이상 1,000조 원 이하의 정수여야 합니다.');
  const sum = Object.values(input.portfolio).reduce((x,y)=>x+y,0);
  const fallback = names.some(a=>!scores[a].usable);
  const q={},lower={},upper={},current={};
  for(const a of names){
    current[a]=sum?input.portfolio[a]/sum:rules.reference[a];
    lower[a]=Math.max(rules.min[a],rules.base[a]-rules.max_tilt[a]);
    upper[a]=Math.min(rules.max[a],rules.base[a]+rules.max_tilt[a]);
    const tilt=fallback?0:rules.score_strength*(scores[a].current_score-50)/50+rules.momentum_strength*Math.max(-1,Math.min(1,(scores[a].score_1m_change||0)/20));
    q[a]=rules.base[a]+tilt+rules.portfolio_strength*(rules.reference[a]-current[a]);
  }
  if(names.some(a=>lower[a]>upper[a])||Object.values(lower).reduce((a,b)=>a+b,0)>1+1e-10||Object.values(upper).reduce((a,b)=>a+b,0)<1-1e-10)throw Error('배분 제약을 만족할 수 없습니다.');
  const reasons=Object.fromEntries(names.map(a=>[a,[]]));
  let cashNeed=0;
  const guard=rules.portfolio_guardrails;
  if(guard){
    const floor=guard.cash_floor,caps=guard.stop_buy_weight;
    if(!(floor>=0&&floor<=1)||Object.entries(caps).some(([a,c])=>!(c>rules.reference[a]&&c<=1)))throw Error('Invalid portfolio guardrails');
    cashNeed=Math.max(0,floor*(sum+amount)-input.portfolio.CASH);
    const safety=cashNeed>0||Object.keys(caps).some(a=>sum&&current[a]>rules.reference[a]);
    if(safety){
      for(const a of names)lower[a]=0;
      upper.CASH=1;
      if(amount){lower.CASH=Math.min(1,Math.ceil(cashNeed-1e-8)/amount);if(cashNeed)reasons.CASH.push(`현금 ${(floor*100).toFixed(0)}% 확보 우선: 부족액 ${Math.ceil(cashNeed).toLocaleString('ko-KR')}원`);}
      for(const [a,cap] of Object.entries(caps)){
        const reference=rules.reference[a];
        if(sum&&current[a]>=cap){upper[a]=0;reasons[a].push(`현재 비중 ${(current[a]*100).toFixed(1)}% ≥ 매수중단 기준 ${(cap*100).toFixed(0)}%: 신규매수 0원`);}
        else if(sum&&current[a]>reference){upper[a]*=(cap-current[a])/(cap-reference);reasons[a].push(`기준 비중 ${(reference*100).toFixed(0)}% 초과: 추가매수 단계적 축소`);}
        if(amount)upper[a]=Math.min(upper[a],Math.max(0,Math.floor(cap*(sum+amount)-input.portfolio[a]+1e-8))/amount);
      }
      for(const a of names)if(a!=='CASH'&&lower.CASH>0){upper[a]=Math.min(upper[a],1-lower.CASH);reasons[a].push('현금 확보를 위해 일반 월 최소배분·Max Tilt 하한 해제');}
    }
  }
  let lo=-10,hi=10;
  for(let i=0;i<100;i++){const mid=(lo+hi)/2;const total=names.reduce((s,a)=>s+Math.max(lower[a],Math.min(upper[a],q[a]-mid)),0);if(total>1)lo=mid;else hi=mid;}
  const weights={},buys={},mins={},maxs={};
  for(const a of names){weights[a]=Math.max(lower[a],Math.min(upper[a],q[a]-(lo+hi)/2));mins[a]=Math.ceil(amount*lower[a]-1e-8);maxs[a]=Math.floor(amount*upper[a]+1e-8);buys[a]=amount?Math.max(mins[a],Math.min(maxs[a],Math.floor(amount*weights[a]))):0;}
  if(Object.values(mins).reduce((a,b)=>a+b,0)>amount||Object.values(maxs).reduce((a,b)=>a+b,0)<amount)throw Error('금액이 너무 작아 원 단위 배분이 불가능합니다.');
  let remainder=amount-Object.values(buys).reduce((a,b)=>a+b,0);
  while(remainder){const direction=Math.sign(remainder);const eligible=names.filter(a=>direction>0?buys[a]<maxs[a]:buys[a]>mins[a]);eligible.sort((a,b)=>direction*((amount*weights[b]-buys[b])-(amount*weights[a]-buys[a])));buys[eligible[0]]+=direction;remainder-=direction;}
  return {remaining_monthly_investment_krw:amount,fallback_due_to_data:fallback,cash_shortfall_after_krw:Math.max(0,Math.ceil(cashNeed-buys.CASH-1e-8)),assets:Object.fromEntries(names.map(a=>[a,{current_weight:current[a],suggested_weight:weights[a],amount_krw:buys[a],reasons:reasons[a],projected_weight:sum+amount?(input.portfolio[a]+buys[a])/(sum+amount):0,lower_bound:lower[a],upper_bound:upper[a],constraint_active:Math.abs(weights[a]-lower[a])<1e-8||Math.abs(weights[a]-upper[a])<1e-8}]))};
}
root.AllocationModel={allocate:browserAllocate};if(typeof module!=='undefined')module.exports=root.AllocationModel;
})(globalThis);
