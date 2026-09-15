(function(root){
 'use strict';
 const P=root.PortfolioEngine||(typeof require!=='undefined'?require('./portfolio-engine.js'):null);
 const copy=x=>JSON.parse(JSON.stringify(x));
 function allocationValid(s){const d=s.developer;
   return d&&typeof d.version==='string'&&Number.isFinite(Date.parse(d.availableAt))&&Date.parse(d.availableAt)<=Date.parse(s.date+'T23:59:59.999Z')&&d.allocation&&Object.keys(d.allocation).sort().join()===P.ASSETS.slice().sort().join()&&Object.values(d.allocation).every(x=>Number.isFinite(x)&&x>=0&&x<=1)&&Math.abs(Object.values(d.allocation).reduce((a,b)=>a+b,0)-1)<1e-9;
 }
 function supported(window){return window.every((s,i)=>Number.isFinite(s.sp500TotalReturnKRW)&&s.sp500TotalReturnKRW>0&&(i===window.length-1||allocationValid(s)));}
 function initial(window,holdings){
   if(!supported(window))return {available:false,reason:'S&P500 원화 총수익지수 또는 당시 개발자 월배분 이력이 부족합니다.'};
   const n=P.value(holdings);return {available:true,developer:copy(holdings),sp500:n,principal:n,userFactor:1,developerFactor:1,sp500Factor:1,observedPeriods:0,history:[{date:window[0].date,user:n,developer:n,sp500:n,principal:n}],lastAllocation:null};
 }
 function split(amount,weights){const out=Object.fromEntries(P.ASSETS.map(a=>[a,Math.floor(amount*weights[a])]));let remaining=amount-Object.values(out).reduce((a,b)=>a+b,0);const order=P.ASSETS.slice().sort((a,b)=>(amount*weights[b]-out[b])-(amount*weights[a]-out[a]));for(let i=0;i<remaining;i++)out[order[i%order.length]]++;return out;}
 function step(state,today,next,deposit,userBefore,userAfter){
   if(!state?.available)return state||{available:false,reason:'이전 형식의 세션에는 비교 상태가 없습니다.'};
   if(!allocationValid(today)||!Number.isFinite(next.sp500TotalReturnKRW)||next.sp500TotalReturnKRW<=0)throw Error('벤치마크 데이터가 유효하지 않습니다.');
   const r=copy(state),buys=split(deposit,today.developer.allocation),before=P.value(r.developer);
   for(const a of P.ASSETS)r.developer[a]+=buys[a];
   r.developer=P.markToMarket(r.developer,Object.fromEntries(P.ASSETS.map(a=>[a,next.prices[a]/today.prices[a]-1])));
   const spBefore=r.sp500;r.sp500=Math.round((spBefore+deposit)*(1+(next.sp500TotalReturnKRW/today.sp500TotalReturnKRW-1)));
   const ur=P.periodReturn(userBefore,userAfter,deposit),dr=P.periodReturn(before,P.value(r.developer),deposit),sr=P.periodReturn(spBefore,r.sp500,deposit);
   r.periodCounts=r.periodCounts||{userFactor:r.observedPeriods,developerFactor:r.observedPeriods,sp500Factor:r.observedPeriods}; for(const [factor,rate] of [['userFactor',ur],['developerFactor',dr],['sp500Factor',sr]])if(rate!==null){r[factor]*=1+rate;r.periodCounts[factor]++;} r.observedPeriods++;
   r.principal+=deposit;r.lastAllocation={decisionDate:today.date,version:today.developer.version,weights:copy(today.developer.allocation),amounts:buys};
   r.history.push({date:next.date,user:userAfter,developer:P.value(r.developer),sp500:r.sp500,principal:r.principal});return r;
 }
 function view(state,cursor){if(!state?.available)return {available:false,reason:state?.reason||'이전 세션은 비교 데이터가 없습니다.'};if(!cursor)return {available:true,hidden:true};const last=state.history.at(-1);return {available:true,hidden:false,history:copy(state.history),lastAllocation:copy(state.lastAllocation),rows:[['사용자','user','userFactor'],['개발자 전략','developer','developerFactor'],['S&P500 100%','sp500','sp500Factor']].map(([label,key,f])=>({label,value:last[key],principal:state.principal,profit:last[key]-state.principal,twr:(state.periodCounts?state.periodCounts[f]:state.observedPeriods)?state[f]-1:null}))};}
 const api={allocationValid,supported,initial,step,view,split};root.BenchmarkEngine=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
