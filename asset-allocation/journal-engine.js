(function(root){
 const P=root.PortfolioEngine||(typeof require!=='undefined'?require('./portfolio-engine.js'):null);
 const map={QQQ:'Equity',GOLD:'Gold',BTC:'Bitcoin',CASH:'Cash'},reasons=['싸 보여서','비싸 보여서','더 오를 것 같아서','하락할 것 같아서','Score가 높아서','Score가 낮아서','내 원칙대로','리밸런싱','현금 확보','위험 축소','기타'];
 const copy=x=>JSON.parse(JSON.stringify(x));
 function target(date,months=0,days=0){const d=new Date(date+'T00:00:00Z');const day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+months);const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,last)+days);return d.toISOString().slice(0,10);}
 function pending(date){return Object.fromEntries([['D1',0,1],['M1',1,0],['M3',3,0],['M6',6,0],['Y1',12,0]].map(([k,m,d])=>[k,{status:'pending',targetDate:target(date,m,d),portfolioReturn:null,mdd:null}]));}
 function create({date,before,deposit,orders,reason,memo,snapshot},today){
   if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date||date>today)throw Error('오늘 이전의 유효한 거래일을 입력하세요.');
   if(!reasons.includes(reason)||typeof memo!=='string'||memo.length>4000||(reason==='기타'&&!memo.trim()))throw Error('이유를 선택하세요. 기타는 메모가 필요합니다.');
   if(snapshot&&(snapshot.date>date||!Number.isFinite(Date.parse(snapshot.availableAt))||Date.parse(snapshot.availableAt)>Date.parse(date+'T23:59:59.999Z')))throw Error('거래 이후 공개된 Score는 당시 기록에 사용할 수 없습니다.');
   const p=P.preview(before,deposit,orders);
   return {id:root.crypto.randomUUID(),schemaVersion:1,createdAt:new Date().toISOString(),tradeDate:date,portfolioBefore:p.before,contribution:deposit,assetScoresAtDecision:Object.fromEntries(P.ASSETS.map(a=>[a,snapshot?.assets[map[a]]?.score??null])),pricesAtDecision:Object.fromEntries(P.ASSETS.map(a=>[a,snapshot?.assets[map[a]]?.price??null])),modelVersion:snapshot?.modelVersion||'unavailable',scoreObservationDate:snapshot?.date||null,scoreAvailableAt:snapshot?.availableAt||null,actions:p.orders,portfolioAfter:p.after,reasonCategory:reason,reasonMemo:memo,futurePerformance:pending(date),snapshotQuality:snapshot?'captured':'unavailable'};
 }
 async function impact(entry,provider,today){
   const result=pending(entry.tradeDate);if(entry.tradeDate>=today)return result;
   const histories=await Promise.all(P.ASSETS.map(a=>provider.getHistoricalPrices(map[a],entry.tradeDate,today)));
   const data=Object.fromEntries(P.ASSETS.map((a,i)=>[a,new Map(histories[i].filter(r=>r.date>=entry.tradeDate&&r.date<=today&&r.currency==='KRW'&&r.basis==='total_return_index'&&Number.isFinite(r.value)&&r.value>0).map(r=>[r.date,r.value]))]));
   const used=P.ASSETS.filter(a=>entry.portfolioAfter[a]>0||entry.portfolioBefore[a]>0||a==='CASH'&&entry.contribution>0);
   const counter=P.contribution(entry.portfolioBefore,entry.contribution),initial=P.value(entry.portfolioAfter);
   for(const r of Object.values(result)){
     if(r.targetDate>today)continue;
     if(!initial){r.status='not_applicable';r.reason='평가할 자산이 없습니다.';continue;}
     if(used.some(a=>!data[a].has(entry.tradeDate))){r.reason='거래일 원화 총수익 가격 데이터 대기';continue;}
     const common=[...data[used[0]].keys()].filter(d=>used.every(a=>data[a].has(d))).sort();
     const end=common.find(d=>d>=r.targetDate&&d<=target(r.targetDate,0,7));
     if(!end){r.reason='기간 도달 후 공통 평가일 데이터 대기';continue;}
     const worth=(p,d)=>used.reduce((n,a)=>n+p[a]*data[a].get(d)/data[a].get(entry.tradeDate),0);
     r.status='ready';r.valuationDate=end;r.portfolioReturn=worth(entry.portfolioAfter,end)/initial-1;r.counterfactualReturn=worth(counter,end)/initial-1;r.impactPercentagePoints=(r.portfolioReturn-r.counterfactualReturn)*100;
     let peak=initial,dd=0;const observed=common.filter(d=>d<=end);for(const d of observed){const v=worth(entry.portfolioAfter,d);peak=Math.max(peak,v);dd=Math.min(dd,v/peak-1);}r.mdd=observed.length>2?dd:null;r.observations=observed.length;r.method='결정 직후 보유구성 고정 · 후속 매매/납입 제외 · 관측일 기준 MDD';
   }
   return result;
 }
 const api={create,impact,pending,target,reasons};root.JournalEngine=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
