(function(root){
 'use strict';
 const E=root.PortfolioEngine||(typeof require!=='undefined'?require('./portfolio-engine.js'):null);
 const B=root.BenchmarkEngine||(typeof require!=='undefined'?require('./benchmark-engine.js'):null);
 const H=root.HistoricalScore||(typeof require!=='undefined'?require('./historical-score.js'):null);
 const scores=s=>Object.fromEntries(E.ASSETS.map(a=>[a,s.scores?.[a]??s.scoreEstimate?.scores?.[a]??null]));
 const REASONS=['싸 보여서','비싸 보여서','더 오를 것 같아서','하락할 것 같아서','Score가 높아서','Score가 낮아서','내 원칙대로','리밸런싱','현금 확보','위험 축소','기타'];
 const clone=x=>JSON.parse(JSON.stringify(x));
 function month(d){const x=new Date(d+'T00:00:00Z');return x.getUTCFullYear()*12+x.getUTCMonth();}
 function legacyValid(s){return s&&/^\d{4}-\d{2}-\d{2}$/.test(s.date)&&Number.isFinite(Date.parse(s.date))&&Number.isFinite(Date.parse(s.availableAt))&&Date.parse(s.availableAt)<=Date.parse(s.date+'T23:59:59.999Z')&&s.currency==='KRW'&&s.priceBasis==='total_return_index'&&s.pointInTimeVerified===true&&typeof s.modelVersion==='string'&&E.ASSETS.every(a=>Number.isFinite(s.prices?.[a])&&s.prices[a]>0&&Number.isFinite(s.scores?.[a])&&s.scores[a]>=0&&s.scores[a]<=100);}
 function fxValid(s){return s?.priceOnly===true&&s.currency==='KRW'&&Number.isFinite(s.fx?.value)&&s.fx.value>0&&Number.isFinite(Date.parse(s.decisionAt))&&Date.parse(s.availableAt)<=Date.parse(s.decisionAt)&&Date.parse(s.decisionAt)<=Date.parse(s.date+'T00:00:00Z')+86400000&&E.ASSETS.every(a=>Number.isFinite(s.prices?.[a])&&s.prices[a]>0);}
 function valid(s){return legacyValid(s)||fxValid(s);}
 function candidates(rows,years,{minDate=null,scoreModel=null}={}){
   if(![1,3,5,10].includes(years))throw Error('기간은 1·3·5·10년 중 선택하세요.');
   if(minDate!==null&&(!/^\d{4}-\d{2}-\d{2}$/.test(minDate)||!Number.isFinite(Date.parse(minDate))||new Date(minDate+'T00:00:00Z').toISOString().slice(0,10)!==minDate))throw Error('시작 제한 날짜 오류');
   const n=years*12,starts=[];
   const ready=rows.map((r,i)=>!scoreModel||!r.priceOnly||E.ASSETS.every(a=>Number.isFinite((r.scoreEstimate||H.estimate(rows,i,scoreModel)).scores[a])));
   for(let i=0;i+n<rows.length;i++){const w=rows.slice(i,i+n+1);if((minDate===null||w[0].date>=minDate)&&w.every((s,j)=>ready[i+j]&&valid(s)&&(!j||month(s.date)===month(w[j-1].date)+1)))starts.push(i);}
   return starts;
 }
 function start(rows,years,initial,monthly,rng=Math.random,config={}){
   if(!['free','philosophy'].includes(config.mode||'free'))throw Error('연습 모드 오류');
   if(config.mode==='philosophy'&&(typeof config.principle!=='string'||!config.principle.trim()||config.principle.length>2000))throw Error('투자 원칙을 2,000자 이내로 입력하세요.');
   if(config.scoreModel){H.validate(config.scoreModel);rows=rows.map((r,i)=>({...r,scoreEstimate:r.priceOnly?H.estimate(rows,i,config.scoreModel):null}));}
   E.portfolio(initial);E.contribution(initial,monthly);const options=candidates(rows,years,config);if(!options.length)throw Error('선택한 기간을 충족하는 연속 데이터가 없습니다.');
   const random=rng();if(!(random>=0&&random<1))throw Error('무작위 값 오류');const index=options[Math.floor(random*options.length)],window=clone(rows.slice(index,index+years*12+1));
   return {id:root.crypto.randomUUID(),schemaVersion:1,scoreModel:config.scoreModel?clone(config.scoreModel):null,uiStep:1,uiRevision:0,uiDraft:null,minDate:config.minDate||null,principle:config.mode==='philosophy'?config.principle.trim():null,startDate:window[0].date,endDate:window.at(-1).date,duration:years,mode:config.mode||'free',initialAssets:clone(initial),monthlyContribution:monthly,createdAt:new Date().toISOString(),cursor:0,portfolio:clone(initial),principal:E.value(initial),prehistory:clone(rows.slice(Math.max(0,index-12),index)),window,decisions:[],principalUSD:window[0].fx?E.value(initial)/window[0].fx.value:null,benchmarks:B.initial(window,initial)};
 }
 function view(session){const s=session.window[session.cursor];return {date:s.date,fx:s.fx||null,decisionAt:s.decisionAt||s.date,principalUSD:session.principalUSD??null,scores:scores(s),scoreEstimate:clone(s.scoreEstimate||null),prices:clone(s.prices),portfolio:clone(session.portfolio),principal:session.principal,monthlyContribution:session.monthlyContribution,completed:session.cursor>=session.window.length-1,history:[...(session.prehistory||[]),...session.window.slice(0,session.cursor+1)].map(x=>({date:x.date,fx:x.fx||null,prices:clone(x.prices),scores:clone(x.scores||Object.fromEntries(E.ASSETS.map(a=>[a,null])))}))};}
 function decide(session,orders,reason,memo=''){
   if(session.cursor>=session.window.length-1)throw Error('종료된 세션입니다.');if(!REASONS.includes(reason))throw Error('그때 왜 그렇게 했나요? 이유를 선택하세요.');if(typeof memo!=='string'||memo.length>4000||(reason==='기타'&&!memo.trim()))throw Error('기타 이유는 메모가 필요합니다. 메모는 4,000자 이내입니다.');
   const today=session.window[session.cursor],next=session.window[session.cursor+1];
   const p=E.preview(session.portfolio,session.monthlyContribution,orders);
   const returns=Object.fromEntries(E.ASSETS.map(a=>[a,next.prices[a]/today.prices[a]-1]));
   const evaluated=E.markToMarket(p.after,returns);
   const decision={id:session.id+':'+session.cursor,schemaVersion:1,sessionId:session.id,decisionDate:today.date,portfolioBefore:clone(p.before),assetScores:scores(today),scoreEstimate:clone(today.scoreEstimate||null),assetPrices:clone(today.prices),action:p.orders,portfolioAfter:clone(p.after),reasonCategory:reason,reasonMemo:memo,modelVersion:today.modelVersion,contribution:session.monthlyContribution,nextDate:next.date,nextPortfolio:evaluated,periodReturn:E.periodReturn(p.totalBefore,E.value(evaluated),session.monthlyContribution)};
   const updated=clone(session);updated.cursor++;updated.portfolio=evaluated;updated.principal+=session.monthlyContribution;if(today.fx&&next.fx){decision.fxAtDecision=clone(today.fx);decision.fxAtValuation=clone(next.fx);decision.decisionAt=today.decisionAt;decision.contributionUSD=session.monthlyContribution/today.fx.value;decision.periodReturnUSD=(E.value(session.portfolio)+session.monthlyContribution)>0?(E.value(evaluated)/next.fx.value)/((E.value(session.portfolio)+session.monthlyContribution)/today.fx.value)-1:null;updated.principalUSD=(session.principalUSD??E.value(session.initialAssets)/session.window[0].fx.value)+decision.contributionUSD;}updated.decisions.push(decision);
   updated.benchmarks=B.step(session.benchmarks,today,next,session.monthlyContribution,E.value(session.portfolio),E.value(evaluated));
   if(updated.benchmarks.available){decision.developerPortfolio=clone(updated.benchmarks.developer);decision.benchmarkPortfolio={SP500:updated.benchmarks.sp500};decision.developerDecision=clone(updated.benchmarks.lastAllocation);}
   updated.uiStep=4;updated.uiDraft=null;updated.uiRevision=(session.uiRevision||0)+1;
   return {session:updated,decision};
 }
 function trend(session){
   const first=session.window[0],n=E.value(session.initialAssets),price=r=>r.assetDetails?.benchmark?.value??r.sp500TotalReturnKRW;
   let principal=n,principalUSD=first.fx?.value>0?n/first.fx.value:null,benchmark=Number.isFinite(price(first))&&price(first)>0?n:null;
   const point=(r,user)=>({date:r.date,principal,user,benchmark,principalUSD,userUSD:r.fx?.value>0?user/r.fx.value:null,benchmarkUSD:r.fx?.value>0&&benchmark!==null?benchmark/r.fx.value:null});
   const history=[point(first,n)];
   for(let i=0;i<Math.min(session.cursor,session.decisions.length);i++){
     const d=session.decisions[i],today=session.window[i],next=session.window[i+1];
     principal+=d.contribution;
     principalUSD=principalUSD!==null&&today.fx?.value>0?principalUSD+d.contribution/today.fx.value:null;
     benchmark=benchmark!==null&&Number.isFinite(price(today))&&price(today)>0&&Number.isFinite(price(next))&&price(next)>0?Math.round((benchmark+d.contribution)*price(next)/price(today)):null;
     history.push(point(next,E.value(d.nextPortfolio)));
   }
   return history;
 }
 function returns(session,currency='KRW'){
   const h=trend(session),usd=currency==='USD',suffix=usd?'USD':'',first=session.window[0],last=session.window[h.length-1];
   function twr(key){let factor=1,count=0;
     for(let i=1;i<h.length;i++){
       const d=session.decisions[i-1],fx=session.window[i-1].fx?.value;
       const before=h[i-1][key+suffix],after=h[i][key+suffix];
       if(before===null||after===null||(usd&&!(fx>0)))return null;
       const base=before+(usd?d.contribution/fx:d.contribution);
       if(base>0){factor*=after/base;count++;}
     }
     return count?factor-1:null;
   }
   const assetReturns=Object.fromEntries(E.ASSETS.map(a=>{
     const validFX=!usd||(first.fx?.value>0&&last.fx?.value>0);
     return [a,validFX? (last.prices[a]/(usd?last.fx.value:1))/(first.prices[a]/(usd?first.fx.value:1))-1:null];
   }));
   return {user:twr('user'),benchmark:twr('benchmark'),assets:assetReturns};
 }
 const api={REASONS,valid,candidates,start,view,decide,trend,returns};root.SimulationEngine=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
