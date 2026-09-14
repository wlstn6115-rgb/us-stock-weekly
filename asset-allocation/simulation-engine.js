(function(root){
 'use strict';
 const E=root.PortfolioEngine||(typeof require!=='undefined'?require('./portfolio-engine.js'):null);
 const REASONS=['싸 보여서','비싸 보여서','더 오를 것 같아서','하락할 것 같아서','Score가 높아서','Score가 낮아서','내 원칙대로','리밸런싱','현금 확보','위험 축소','기타'];
 const clone=x=>JSON.parse(JSON.stringify(x));
 function month(d){const x=new Date(d+'T00:00:00Z');return x.getUTCFullYear()*12+x.getUTCMonth();}
 function valid(s){return s&&/^\d{4}-\d{2}-\d{2}$/.test(s.date)&&Number.isFinite(Date.parse(s.date))&&Number.isFinite(Date.parse(s.availableAt))&&Date.parse(s.availableAt)<=Date.parse(s.date+'T23:59:59.999Z')&&s.currency==='KRW'&&s.priceBasis==='total_return_index'&&s.pointInTimeVerified===true&&typeof s.modelVersion==='string'&&E.ASSETS.every(a=>Number.isFinite(s.prices?.[a])&&s.prices[a]>0&&Number.isFinite(s.scores?.[a])&&s.scores[a]>=0&&s.scores[a]<=100);}
 function candidates(rows,years){
   if(![1,3,5,10].includes(years))throw Error('기간은 1·3·5·10년 중 선택하세요.');
   const n=years*12,starts=[];
   for(let i=0;i+n<rows.length;i++){const w=rows.slice(i,i+n+1);if(w.every((s,j)=>valid(s)&&(!j||month(s.date)===month(w[j-1].date)+1)))starts.push(i);}
   return starts;
 }
 function start(rows,years,initial,monthly,rng=Math.random){
   E.portfolio(initial);E.contribution(initial,monthly);const options=candidates(rows,years);if(!options.length)throw Error('선택한 기간 전체의 가격·당시 Score 데이터가 없습니다.');
   const random=rng();if(!(random>=0&&random<1))throw Error('무작위 값 오류');const index=options[Math.floor(random*options.length)],window=clone(rows.slice(index,index+years*12+1));
   return {id:root.crypto.randomUUID(),schemaVersion:1,startDate:window[0].date,endDate:window.at(-1).date,duration:years,mode:'free',initialAssets:clone(initial),monthlyContribution:monthly,createdAt:new Date().toISOString(),cursor:0,portfolio:clone(initial),principal:E.value(initial),window,decisions:[]};
 }
 function view(session){const s=session.window[session.cursor];return {date:s.date,scores:clone(s.scores),prices:clone(s.prices),portfolio:clone(session.portfolio),principal:session.principal,monthlyContribution:session.monthlyContribution,completed:session.cursor>=session.window.length-1,history:clone(session.window.slice(0,session.cursor+1))};}
 function decide(session,orders,reason,memo=''){
   if(session.cursor>=session.window.length-1)throw Error('종료된 세션입니다.');if(!REASONS.includes(reason))throw Error('그때 왜 그렇게 했나요? 이유를 선택하세요.');if(typeof memo!=='string'||memo.length>4000||(reason==='기타'&&!memo.trim()))throw Error('기타 이유는 메모가 필요합니다. 메모는 4,000자 이내입니다.');
   const today=session.window[session.cursor],next=session.window[session.cursor+1];
   const p=E.preview(session.portfolio,session.monthlyContribution,orders);
   const returns=Object.fromEntries(E.ASSETS.map(a=>[a,next.prices[a]/today.prices[a]-1]));
   const evaluated=E.markToMarket(p.after,returns);
   const decision={id:session.id+':'+session.cursor,schemaVersion:1,sessionId:session.id,decisionDate:today.date,portfolioBefore:clone(p.before),assetScores:clone(today.scores),assetPrices:clone(today.prices),action:p.orders,portfolioAfter:clone(p.after),reasonCategory:reason,reasonMemo:memo,modelVersion:today.modelVersion,contribution:session.monthlyContribution,nextDate:next.date,nextPortfolio:evaluated,periodReturn:E.periodReturn(p.totalBefore,E.value(evaluated),session.monthlyContribution)};
   const updated=clone(session);updated.cursor++;updated.portfolio=evaluated;updated.principal+=session.monthlyContribution;updated.decisions.push(decision);
   return {session:updated,decision};
 }
 const api={REASONS,valid,candidates,start,view,decide};root.SimulationEngine=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
