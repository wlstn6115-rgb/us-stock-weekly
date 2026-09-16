(function(root){
 'use strict';
 const P=root.PortfolioEngine||(typeof require!=='undefined'?require('./portfolio-engine.js'):null);
 function summarize(points){
   if(!Array.isArray(points)||points.length<2)return null;
   if(points.some(p=>!Number.isFinite(p.value)||p.value<0||!Number.isFinite(p.principal)||p.principal<0))throw Error('유효한 평가액·납입원금 이력이 필요합니다.');
   let index=1,peak=1,mdd=0,peakMonth=0,recovery=0,underwater=false,adjustedPeak=points[0].value,maxDrawdownKRW=0,maxPrincipalLoss=0;
   const returns=[],curve=[{date:points[0].date,index:1,drawdown:0}];
   for(let i=1;i<points.length;i++){
     const previous=points[i-1],p=points[i],deposit=p.principal-previous.principal;
     if(deposit<0)throw Error('V1 성과 계산은 출금을 지원하지 않습니다.');
     const base=previous.value+deposit;
     if(base===0&&p.value!==0)throw Error('납입이나 원금 없이 평가액이 증가했습니다.');
     if(base>0){const r=p.value/base-1;returns.push(r);index*=1+r;}
     const dd=peak>0?index/peak-1:0;mdd=Math.min(mdd,dd);
     if(index>=peak-1e-12){if(underwater)recovery=Math.max(recovery,i-peakMonth);peak=Math.max(peak,index);peakMonth=i;underwater=false;}else underwater=true;
     adjustedPeak+=deposit;maxDrawdownKRW=Math.max(maxDrawdownKRW,adjustedPeak-p.value);adjustedPeak=Math.max(adjustedPeak,p.value);
     maxPrincipalLoss=Math.max(maxPrincipalLoss,p.principal-p.value);
     curve.push({date:p.date,index,drawdown:dd});
   }
   const last=points.at(-1),n=returns.length,mean=n?returns.reduce((a,b)=>a+b)/n:0;
   const variance=n>1?returns.reduce((s,r)=>s+(r-mean)**2,0)/(n-1):null;
   return {value:last.value,principal:last.principal,profit:last.value-last.principal,twr:n?index-1:null,cagr:n?index**(12/(points.length-1))-1:null,mdd:n?mdd:null,volatility:variance===null?null:Math.sqrt(variance)*Math.sqrt(12),maxDrawdownKRW:Math.round(maxDrawdownKRW),maxPrincipalLoss:Math.round(maxPrincipalLoss),recoveryMonths:recovery,unrecoveredMonths:underwater?points.length-1-peakMonth:0,curve,months:points.length-1};
 }
 function report(session,currency='KRW'){
   if(session.cursor!==session.duration*12)return {completed:false};
   if(currency==='USD'){
     if(!session.window?.every(s=>Number.isFinite(s.fx?.value)&&s.fx.value>0))return {completed:true,unavailable:true};
     let principal=P.value(session.initialAssets)/session.window[0].fx.value;
     const points=[{date:session.startDate,value:principal,principal}];
     session.decisions.forEach((d,i)=>{principal+=d.contribution/session.window[i].fx.value;points.push({date:d.nextDate,value:P.value(d.nextPortfolio)/session.window[i+1].fx.value,principal});});
     if(points.length!==session.cursor+1)throw Error('월별 판단 이력이 불완전합니다.');
     return {completed:true,rows:[{label:'사용자 (USD)',...summarize(points)}],benchmarkAvailable:false};
   }
   const points=[{date:session.startDate,value:P.value(session.initialAssets),principal:P.value(session.initialAssets)}];let principal=points[0].principal;
   for(const d of session.decisions){principal+=d.contribution;points.push({date:d.nextDate,value:P.value(d.nextPortfolio),principal});}
   if(points.length!==session.cursor+1)throw Error('월별 판단 이력이 불완전합니다.');
   const rows=[{label:'사용자',...summarize(points)}];
   if(session.benchmarks?.available){for(const [key,label] of [['developer','개발자 전략'],['sp500','S&P500 100%']])rows.push({label,...summarize(session.benchmarks.history.map(p=>({date:p.date,value:p[key],principal:p.principal})))});}
   return {completed:true,rows,benchmarkAvailable:!!session.benchmarks?.available};
 }
 const api={summarize,report};root.PerformanceEngine=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
