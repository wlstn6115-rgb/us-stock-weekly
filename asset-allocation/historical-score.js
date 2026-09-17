(function(root){
 'use strict';
 const assets=['QQQ','GOLD','BTC','CASH'],copy=x=>JSON.parse(JSON.stringify(x)),clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
 function validate(c){
  if(!c||c.method!=='price-environment-v1'||typeof c.version!=='string'||!c.version.trim()||c.lookback!==12||!Number.isInteger(c.momentumMonths)||c.momentumMonths<1||c.momentumMonths>12||!Number.isFinite(c.cashDefensiveWeight)||c.cashDefensiveWeight<0||c.cashDefensiveWeight>1)throw Error('과거 Score 모델 설정 오류');
  for(const a of assets){const p=c.assets?.[a];if(!p||!['momentumScale','volatilityScale','drawdownScale'].every(k=>Number.isFinite(p[k])&&p[k]>0)||!Array.isArray(p.weights)||p.weights.length!==3||!p.weights.every(w=>Number.isFinite(w)&&w>=0)||Math.abs(p.weights.reduce((x,y)=>x+y,0)-1)>1e-9)throw Error('과거 Score 자산별 설정 오류');}
 }
 function estimate(rows,index,c){
  validate(c);const now=rows[index],cutoff=Date.parse(now.decisionAt||now.availableAt);
  const h=rows.slice(Math.max(0,index-c.lookback),index+1);
  const result={scoreType:'estimated',modelVersion:c.version,currency:'USD',asOf:now.date,pointInTimeVerified:false,scores:Object.fromEntries(assets.map(a=>[a,null])),factors:{},reason:null};
  const month=d=>{const t=new Date(d);return t.getUTCFullYear()*12+t.getUTCMonth();};
  if(!Number.isFinite(cutoff)||h.length!==13||h.some((r,i)=>!Number.isFinite(Date.parse(r.availableAt))||Date.parse(r.availableAt)>cutoff||r.date>now.date||(i&&month(r.date)!==month(h[i-1].date)+1)||!Number.isFinite(r.fx?.value)||r.fx.value<=0||assets.some(a=>!Number.isFinite(r.prices?.[a])||r.prices[a]<=0))){result.reason='가용한 연속 12개월 가격·환율 이력 부족';return result;}
  for(const a of assets){
   const p=c.assets[a],v=h.map(r=>r.prices[a]/r.fx.value),returns=v.slice(1).map((x,i)=>Math.log(x/v[i])),mean=returns.reduce((x,y)=>x+y,0)/12;
   const volatility=Math.sqrt(returns.reduce((s,x)=>s+(x-mean)**2,0)/11)*Math.sqrt(12),momentum=v.at(-1)/v[12-c.momentumMonths]-1,drawdown=v.at(-1)/Math.max(...v)-1;
   const components=[50+50*clamp(momentum/p.momentumScale,-1,1),100*(1-clamp(volatility/p.volatilityScale,0,1)),100*(1-clamp(-drawdown/p.drawdownScale,0,1))];
   result.scores[a]=components.reduce((s,x,i)=>s+x*p.weights[i],0);
   result.factors[a]={momentum,volatility,drawdown,components,weights:copy(p.weights)};
  }
  const defensive=100-(result.scores.QQQ+result.scores.BTC)/2;
  result.factors.CASH.defensiveScore=defensive;
  result.scores.CASH=result.scores.CASH*(1-c.cashDefensiveWeight)+defensive*c.cashDefensiveWeight;
  for(const a of assets)result.scores[a]=Math.round(clamp(result.scores[a],0,100)*10)/10;
  return result;
 }
 const api={validate,estimate};root.HistoricalScore=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
