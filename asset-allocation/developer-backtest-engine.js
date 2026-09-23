(function(root){
 'use strict';
 const A=['QQQ','BTC','GOLD','CASH'],sum=o=>Object.values(o).reduce((s,v)=>s+v,0),copy=o=>JSON.parse(JSON.stringify(o));
 const allocator=root.AllocationModel||(typeof require!=='undefined'?require('./allocation-model.js'):null);
 const H=root.HistoricalScore||(typeof require!=='undefined'?require('./historical-score.js'):null);
 function validateVersion(v){
  if(!v||!v.id||v.kind!=='price')throw Error(v?.reason||'가격 기반 버전을 선택하세요. 메인 매크로 모델을 가격 추정으로 대체하지 않습니다.');
  H.validate(v.scoreModel);
  const r=v.rules;
  for(const field of ['base','reference','min','max','max_tilt'])if(!r?.[field]||Object.keys(r[field]).sort().join()!==A.slice().sort().join()||A.some(a=>!Number.isFinite(r[field][a])||r[field][a]<0||r[field][a]>1))throw Error('배분 규칙 범위 오류');
  if(Math.abs(sum(r.base)-1)>1e-9||Math.abs(sum(r.reference)-1)>1e-9)throw Error('기준비중 합계는 1이어야 합니다.');
  if(['score_strength','momentum_strength','portfolio_strength'].some(k=>!Number.isFinite(r[k])||r[k]<0||r[k]>1))throw Error('배분 강도는 0~1이어야 합니다.');
 }
 function metrics(history,rates,turns){
  if(!rates.length)throw Error('검증 기간 없음');
  let unit=1,peak=1,mdd=0,under=0,recovery=0;const curve=[1];
  for(const r of rates){unit*=1+r;curve.push(unit);peak=Math.max(peak,unit);mdd=Math.min(mdd,unit/peak-1);under=unit<peak-1e-10?under+1:0;recovery=Math.max(recovery,under);}
  const avg=rates.reduce((s,x)=>s+x,0)/rates.length,sd=rates.length>1?Math.sqrt(rates.reduce((s,x)=>s+(x-avg)**2,0)/(rates.length-1)):0;
  const downside=Math.sqrt(rates.reduce((s,x)=>s+Math.min(x,0)**2,0)/rates.length);
  const oneYear=curve.slice(12).map((x,i)=>x/curve[i]-1);
  return {ending:history.at(-1).value,principal:history.at(-1).principal,twr:unit-1,cagr:unit**(12/rates.length)-1,mdd,volatility:sd*Math.sqrt(12),sharpe:sd?avg/sd*Math.sqrt(12):null,sortino:downside?avg/downside*Math.sqrt(12):null,worst1Y:oneYear.length?Math.min(...oneYear):null,longestUnderwaterMonths:recovery,unrecovered:under>0,purchaseRatio:turns/rates.length};
 }
 function run(rows,version,options){
  validateVersion(version);
  const {start,end,initial,monthly,feeBps,cashMode}=options;
  if(!Number.isInteger(start)||!Number.isInteger(end)||start<13||end<=start||end>=rows.length)throw Error('준비 이력 13개월 이후부터 최소 1개월의 검증 기간을 선택하세요.');
  if(!['KRW','BIL'].includes(cashMode)||![initial,monthly].every(x=>Number.isSafeInteger(x)&&x>=0&&x<=1e15)||initial+monthly<=0||!Number.isFinite(feeBps)||feeBps<0||feeBps>1000)throw Error('금액·비용 설정 오류');
  const estimated=rows.map((_,i)=>H.estimate(rows,i,version.scoreModel)),fee=feeBps/10000;
  const strategies=['bounded','fixed','equal','score','sp500'];
  return strategies.map(strategy=>{
   const weights=strategy==='equal'?Object.fromEntries(A.map(a=>[a,.25])):version.rules.base;
   // All portfolio strategies start in the same reference mix, independent of the strategy's monthly rule.
   let holdings=Object.fromEntries(A.map(a=>[a,initial*version.rules.reference[a]])),benchmark=initial;
   let principal=initial,rates=[],turns=0,history=[{date:rows[start].date,value:initial,principal:initial}],audit=[];
   // Initial purchase costs apply consistently; KRW cash has no security purchase cost.
   for(const a of A)if(a!=='CASH'||cashMode==='BIL')holdings[a]*=1-fee;
   benchmark*=1-fee;
   for(let i=start;i<end;i++){
    const signal=rows[i-1],today=rows[i],next=rows[i+1],estimate=estimated[i-1],prior=estimated[i-2];
    if(Date.parse(signal.availableAt)>Date.parse(today.date+'T23:59:59Z'))throw Error('신호가 체결일 이후에 공개되었습니다.');
    if(A.some(a=>!Number.isFinite(estimate.scores[a])))throw Error('과거 Score 이력 부족: '+signal.date);
    const scores=Object.fromEntries(A.map(a=>[a,{current_score:estimate.scores[a],usable:true,score_1m_change:Number.isFinite(prior?.scores[a])?estimate.scores[a]-prior.scores[a]:null}]));
    const before=strategy==='sp500'?benchmark:sum(holdings);
    let buys;
    if(strategy==='bounded')buys=Object.fromEntries(Object.entries(allocator.allocate(scores,{portfolio:Object.fromEntries(A.map(a=>[a,Math.round(holdings[a])])),remaining_monthly_investment_krw:monthly},version.rules).assets).map(([a,v])=>[a,v.amount_krw]));
    else if(strategy==='score'){const total=A.reduce((s,a)=>s+scores[a].current_score,0);buys=Object.fromEntries(A.map(a=>[a,monthly*(total?scores[a].current_score/total:.25)]));}
    else buys=Object.fromEntries(A.map(a=>[a,monthly*weights[a]]));
    if(strategy==='sp500'){
     benchmark=(benchmark+monthly*(1-fee))*next.assetDetails.benchmark.value/today.assetDetails.benchmark.value;
    }else for(const a of A){
     const rate=a==='CASH'&&cashMode==='KRW'?1:next.prices[a]/today.prices[a];
     holdings[a]=(holdings[a]+buys[a]*(a==='CASH'&&cashMode==='KRW'?1:1-fee))*rate;
    }
    const value=strategy==='sp500'?benchmark:sum(holdings),denom=(i===start?initial:before)+monthly;
    if(denom<=0)throw Error('성과 기준 금액이 0입니다.');
    rates.push(value/denom-1);turns+=monthly/(before+monthly);principal+=monthly;
    history.push({date:next.date,value,principal});
    audit.push({signalDate:signal.date,signalAvailableAt:signal.availableAt,tradeDate:today.date,endDate:next.date,scores:estimate.scores,buys:strategy==='sp500'?{SPY:monthly}:buys,value,principal,return:rates.at(-1)});
   }
   const allocations=A.map(a=>{const vals=audit.map(r=>r.buys[a]||0),mean=vals.reduce((s,x)=>s+x,0)/vals.length;return {asset:a,monthlyBuyStd:Math.sqrt(vals.reduce((s,x)=>s+(x-mean)**2,0)/vals.length)};});
   return {strategy,version:version.id,metrics:metrics(history,rates,turns),history,audit,allocations};
  });
 }
 const api={run,metrics,validateVersion};root.DeveloperBacktest=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
