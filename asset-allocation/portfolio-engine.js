(function(root){
 'use strict';
 const ASSETS=['QQQ','GOLD','BTC','CASH'];
 function money(n){if(!Number.isSafeInteger(n)||n<0||n>1e15)throw Error('금액은 0 이상 1,000조 원 이하의 정수여야 합니다.');return n;}
 function portfolio(p){if(!p||Object.keys(p).sort().join()!==ASSETS.slice().sort().join())throw Error('네 자산의 평가액이 필요합니다.');const c={};for(const a of ASSETS)c[a]=money(p[a]);return c;}
 function value(p){return Object.values(portfolio(p)).reduce((a,b)=>a+b,0);}
 function allocation(p){const v=value(p);return Object.fromEntries(ASSETS.map(a=>[a,v?p[a]/v:0]));}
 function contribution(p,n){const c=portfolio(p);c.CASH=money(c.CASH+money(n));return c;}
 function buy(p,a,n){const c=portfolio(p);money(n);if(!ASSETS.includes(a)||a==='CASH')throw Error('매수 자산을 확인하세요.');if(n>c.CASH)throw Error('매수 가능 현금보다 주문금액이 큽니다.');c.CASH-=n;c[a]=money(c[a]+n);return c;}
 function sell(p,a,n){const c=portfolio(p);money(n);if(!ASSETS.includes(a)||a==='CASH')throw Error('매도 자산을 확인하세요.');if(n>c[a])throw Error('보유 평가액보다 큰 금액은 매도할 수 없습니다.');c[a]-=n;c.CASH=money(c.CASH+n);return c;}
 function preview(before,deposit,orders){
   const original=portfolio(before);money(deposit);if(!Array.isArray(orders))throw Error('주문 목록을 확인하세요.');
   let after=contribution(original,deposit);const normalized=[],seen=new Set();
   for(const o of orders){
     if(!o||!ASSETS.includes(o.asset)||o.asset==='CASH'||seen.has(o.asset))throw Error('자산별 주문은 한 줄씩 입력하세요.');seen.add(o.asset);
     const b=money(o.buyAmount??0),s=money(o.sellAmount??0),pct=o.sellPercent??0;
     if(!Number.isFinite(pct)||pct<0||pct>100)throw Error('매도 비율은 0~100%여야 합니다.');
     if(s&&pct)throw Error('매도금액과 매도 비율 중 하나만 입력하세요.');
     if(b&&(s||pct))throw Error('같은 자산을 동시에 매수·매도할 수 없습니다.');
     normalized.push({asset:o.asset,buyAmount:b,sellAmount:pct?Math.floor(original[o.asset]*pct/100):s});
   }
   for(const o of normalized)after=sell(after,o.asset,o.sellAmount);
   const cashAvailable=after.CASH;
   for(const o of normalized)after=buy(after,o.asset,o.buyAmount);
   const weightsBefore=allocation(original),weightsAfter=allocation(after),notes=[];
   if(Math.max(...Object.values(weightsAfter))>Math.max(...Object.values(weightsBefore))+1e-9)notes.push('가장 큰 자산의 집중도가 증가합니다.');
   if(weightsAfter.CASH<weightsBefore.CASH-1e-9)notes.push('현금 완충 비중이 감소합니다.');
   if(weightsAfter.QQQ+weightsAfter.BTC>weightsBefore.QQQ+weightsBefore.BTC+1e-9)notes.push('주식·비트코인 비중이 증가합니다.');
   return {before:original,after,contribution:deposit,orders:normalized,cashAvailable,totalBefore:value(original),totalAfter:value(after),weightsBefore,weightsAfter,notes};
 }
 // Mark existing holdings with same-currency total-return multipliers, no invented prices.
 function markToMarket(p,returns){const c=portfolio(p);for(const a of ASSETS){if(!Number.isFinite(returns[a])||returns[a]<-1)throw Error('모든 자산의 유효한 기간수익률이 필요합니다.');c[a]=money(Math.round(c[a]*(1+returns[a])));}return c;}
 function periodReturn(start,end,deposit=0){money(start);money(end);money(deposit);const base=start+deposit;return base?end/base-1:null;}
 const api={ASSETS,portfolio,value,allocation,contribution,buy,sell,preview,markToMarket,periodReturn};
 root.PortfolioEngine=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
