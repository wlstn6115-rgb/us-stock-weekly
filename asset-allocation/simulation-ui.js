(async function(){
 'use strict';
 const host=document.getElementById('simulation-section');if(!host)return;
 const E=SimulationEngine,P=PortfolioEngine,S=AllocationStore;
 const names={QQQ:'주식 (SPY)',GOLD:'금',BTC:'비트코인',CASH:'현금·단기채 (BIL)'},steps=['시장 확인 · 투자 선택','이유 기록','결과 확인','다음 달'];
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const get=id=>document.getElementById(id),percent=n=>n===null||n===undefined?'평가 불가':(n*100).toFixed(2)+'%';
 let rows=[],config={},session=null,locked=false,available=false;
 const fmt=(n,usd)=>AllocationCurrency.money(n,session?.window[session.cursor]?.fx?.value??null,usd);
 host.innerHTML=`<h2>과거에서 판단 연습</h2><p class="muted">연습용 초기자산을 아래에서 자유롭게 설정하세요. 투자현황의 실제 보유액과 별도로 저장됩니다. 연속 자료가 있는 시작 월을 무작위로 선택합니다. 단계 이동과 초안 저장 시 이 브라우저에 저장됩니다. 실제 연월은 완료 후 공개합니다. 가격 수준으로 시기를 추측할 수는 있습니다.</p>
 <section id="sim-asset-trend" class="sim-asset-trend" hidden></section><p id="sim-status" role="status" aria-live="polite">데이터 확인 중…</p><details id="sim-setup" class="sim-setup" open><summary>새 연습 설정</summary>
 <fieldset><legend>연습용 초기자산 (원)</legend>${P.ASSETS.map(a=>`<label>${names[a]} <input id="sim-initial-${a}" type="number" min="0" max="1000000000000000" step="1" value="${a==='CASH'?10000000:0}" required></label>`).join('')}<p class="muted">기본값은 연습용 현금 1,000만 원입니다. 매월 납입금은 별도로 추가됩니다.</p></fieldset>
 <label>기간 <select id="sim-years">${[1,3,5,10].map(y=>`<option value="${y}">${y}년</option>`).join('')}</select></label>
 <label>매월 새로 적립할 금액 (원) <input id="sim-monthly" type="number" min="0" max="1000000000000000" step="1" placeholder="반복 월납입금"></label>
 <label>연습 방식 <select id="sim-mode"><option value="free">자유롭게 판단</option><option value="philosophy">내 투자 원칙과 비교</option></select></label>
 <label id="sim-principle-label" hidden>이번 연습의 투자 원칙 <textarea id="sim-principle" maxlength="2000" placeholder="예: 매월 같은 금액 투자, 현금 10% 이상 유지"></textarea></label>
 <button id="sim-start" class="secondary" disabled>새 연습 시작</button></details>
 <details><summary>저장한 연습 이어하기</summary><div id="sim-sessions"></div></details><div id="sim-body"></div>`;
 function dateLabel(date,s=session){
   if(!s)return '20XX년 X월';
   if(s.cursor>=s.window.length-1)return esc(date);
   const month=d=>Number(d.slice(0,4))*12+Number(d.slice(5,7));
   const delta=month(date)-month(s.startDate);
   return delta===0?'20XX년 X월':`${delta>0?'+':''}${delta}M`;
 }
 function benchmarkView(){
   if(session.cursor>=session.window.length-1)return session;
   const copy=structuredClone(session);
   if(copy.benchmarks?.history)copy.benchmarks.history.forEach(r=>r.date=dateLabel(r.date));
   if(copy.benchmarks?.lastAllocation)copy.benchmarks.lastAllocation.decisionDate=dateLabel(copy.benchmarks.lastAllocation.decisionDate);
   return copy;
 }
 const status=text=>{get('sim-status').textContent=text;};
 get('sim-mode').onchange=()=>{get('sim-principle-label').hidden=get('sim-mode').value!=='philosophy';};
 async function perform(fn){
   if(locked)return;locked=true;
   const controls=[...host.querySelectorAll('button,input,select,textarea')].map(e=>[e,e.disabled]);controls.forEach(([e])=>e.disabled=true);
   try{await fn();}catch(e){status(e.message);}
   finally{locked=false;controls.forEach(([e,disabled])=>{if(e.isConnected)e.disabled=disabled;});get('sim-start').disabled=!available;}
 }
 async function list(){
   const all=await S.list('sessions');
   get('sim-sessions').innerHTML=all.length?all.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(s=>`<button class="secondary" data-session="${esc(s.id)}">${dateLabel(s.startDate,s)} · ${s.duration}년 · ${s.cursor}/${s.duration*12}개월 이어보기</button>`).join(''):'저장된 연습이 없습니다.';
   get('sim-sessions').querySelectorAll('button').forEach(b=>b.onclick=()=>perform(async()=>{session=await S.get('sessions',b.dataset.session);draw();status('저장된 단계와 초안을 불러왔습니다.');}));
 }
 function defaultDraft(){
   const inputs={};
   for(const a of ['QQQ','GOLD','BTC']){
     const previous=session.decisions.at(-1)?.action?.find(o=>o.asset===a);
     inputs['buy-'+a]=String(previous?.buyAmount||0);
     inputs['sell-'+a]='0';inputs['percent-'+a]='0';
   }
   return {inputs,reason:'',memo:'',principleCheck:''};
 }
 function draft(){
   const d=structuredClone(session.uiDraft||defaultDraft());d.inputs=d.inputs||{};
   ['QQQ','GOLD','BTC'].forEach(a=>['buy','sell','percent'].forEach(k=>{const input=get(`sim-${k}-${a}`);if(input)d.inputs[`${k}-${a}`]=input.value;}));
   if(get('sim-reason')){d.reason=get('sim-reason').value;d.memo=get('sim-memo').value;d.principleCheck=get('sim-principle-check')?.value||'';}
   return d;
 }
 function orders(d){
   const number=k=>{const value=d.inputs?.[k]??'0';if(String(value).trim()===''||!Number.isFinite(Number(value)))throw Error('매수·매도 금액을 입력하세요. 거래하지 않으면 0입니다.');return Number(value);};
   return ['QQQ','GOLD','BTC'].map(a=>({asset:a,buyAmount:number('buy-'+a),sellAmount:number('sell-'+a),sellPercent:number('percent-'+a)}));
 }
 async function move(step,d=draft()){
   session=await S.saveSimulationUI(session,step,d);draw();status('진행 단계와 초안을 저장했습니다.');
 }
 function button(id,fn){get(id)?.addEventListener('click',()=>perform(fn));}
 function preview(d){
   const p=P.preview(session.portfolio,session.monthlyContribution,orders(d));
   return `<h4>거래 후 예상 비중</h4><p>아직 다음 월 가격을 반영하지 않은 거래 미리보기입니다.</p><div class="table-wrap"><table><tr><th>자산</th><th>거래 전 → 후</th><th>거래 후 평가액</th></tr>${P.ASSETS.map(a=>`<tr><th>${names[a]}</th><td>${percent(p.weightsBefore[a])} → ${percent(p.weightsAfter[a])}</td><td>${fmt(p.after[a])}</td></tr>`).join('')}</table></div>`;
 }
 function draw(){
   get('sim-setup').open=false;assetTrend();
   const v=E.view(session),last=session.decisions.at(-1);
   let step=session.uiStep|| (v.completed?4:1);
   if(v.completed&&step<4)step=4;
   if(step>=4&&!last)step=1;
   const displayStep=step<=2?1:step-1;
   const d=session.uiDraft||defaultDraft();
   get('sim-body').innerHTML=`<div class="sim-progress"><p>완료 ${session.cursor} / ${session.duration*12}개월 · ${dateLabel(session.startDate)} 시작</p><progress max="${session.duration*12}" value="${session.cursor}" aria-label="완료한 투자 월"></progress><ol>${steps.map((name,i)=>`<li ${displayStep===i+1?'aria-current="step"':''}>${i+1}. ${i===3&&v.completed?'최종 정리':name}</li>`).join('')}</ol></div>
   <h3 id="sim-step-title" tabindex="-1">${displayStep}. ${step===5&&v.completed?'최종 정리':steps[displayStep-1]}</h3>
   <p>${step>=4&&last?`${dateLabel(last.decisionDate)} 판단 → ${dateLabel(last.nextDate)} 평가`:`판단 기준 ${dateLabel(v.date)}`}</p>
   ${session.principle?`<aside class="sim-principle"><strong>시작할 때 정한 원칙</strong><p>${esc(session.principle)}</p></aside>`:''}
   <div id="sim-step-content"></div><details class="sim-records"><summary>확정한 판단 기록 (${session.decisions.length}건)</summary>${session.decisions.map(x=>`<p>${dateLabel(x.decisionDate)} · ${esc(x.reasonCategory)}${x.principleCheck?` · 원칙 ${x.principleCheck==='followed'?'준수':'예외'}`:''}<br>${esc(x.reasonMemo)}</p>`).join('')||'아직 확정한 판단이 없습니다.'}</details>`;
   const content=get('sim-step-content');
   if(step<=2){
     content.innerHTML=`<div class="sim-decision-grid"><section class="sim-market"><h4>시장과 현재 보유자산</h4><p>${v.fx?`당시 환율 1 USD = ${v.fx.value.toFixed(2)}원 (${dateLabel(v.fx.sourceDate)})`:'당시 환율 미확보'}</p><p>총자산 ${fmt(P.value(v.portfolio))} · 이번 달 신규자금 ${fmt(v.monthlyContribution)}</p><p class="muted">이 시점까지의 정보만 확인하세요. 추정 Score는 과거 가격으로 재계산한 환경값이며 실제 당시 기록이나 상승 확률이 아닙니다.</p>
     <div class="table-wrap"><table><tr><th>자산</th><th>평가액</th><th>비중</th><th>Score (기록/추정)</th><th>관측가격 (원화)</th></tr>${P.ASSETS.map(a=>`<tr><th>${names[a]}</th><td>${fmt(v.portfolio[a])}</td><td>${percent(P.allocation(v.portfolio)[a])}</td><td>${v.scores[a]===null?'이력 부족 / 기록 없음':`${v.scores[a]}${v.scoreEstimate?' (추정)':''}`}</td><td>${Math.round(v.prices[a]).toLocaleString('ko-KR')}</td></tr>`).join('')}</table></div>
     ${v.scoreEstimate?`<details><summary>추정 모델 ${esc(v.scoreEstimate.modelVersion)} · 계산 근거</summary><p>달러 가격 기준 ${session.scoreModel?.momentumMonths||6}개월 추세, 12개월 연율 변동성, 12개월 고점 대비 하락폭. 현금은 BIL 가격 환경과 주식·BTC 방어 점수를 혼합합니다. 매크로 지표 미포함 · 현재 모델과 별개 · 조정가격 수정 이력은 미검증.</p>${v.scoreEstimate.reason?`<p>${esc(v.scoreEstimate.reason)}</p>`:''}${Object.entries(v.scoreEstimate.factors).map(([a,f])=>`<p>${names[a]}: 추세 ${percent(f.momentum)}, 변동성 ${percent(f.volatility)}, 고점 대비 ${percent(f.drawdown)}</p>`).join('')}</details>`:'<p class="muted">이 저장 연습에는 추정 모델이 없습니다. 새 연습에서 추정 Score를 사용할 수 있습니다.</p>'}
     <label>과거 그래프 <select id="sim-lookback"><option value="1">1개월</option><option value="6">6개월</option><option value="12" selected>1년</option></select></label><label>자산 선택 <select id="sim-chart-asset"><option value="separate">자산별 그래프 (독립 Y축)</option><option value="all">전체 비교 (공통 Y축)</option>${P.ASSETS.map(a=>`<option value="${a}">${names[a]}</option>`).join('')}</select></label><div id="sim-chart"></div></section><section class="sim-trading"><h4>이번 달 투자 선택</h4><div id="sim-order-panel"></div></section></div>`;
     chart();get('sim-lookback').onchange=chart;get('sim-chart-asset').onchange=chart;
     get('sim-order-panel').innerHTML=`<p>이번 달 신규자금 ${fmt(v.monthlyContribution)}. 입력은 원화입니다. 거래하지 않을 자산은 0을 유지하세요. 매도 후 매수를 처리하며 남은 금액은 현금·단기채에 둡니다.</p>
     <div id="sim-cash-summary" aria-live="polite"></div><form id="sim-orders-form"><div class="table-wrap"><table><tr><th>자산</th><th>매수 원</th><th>매도 원</th><th>또는 매도 %</th></tr>${['QQQ','GOLD','BTC'].map(a=>`<tr><th>${names[a]}</th>${['buy','sell','percent'].map(k=>`<td><input id="sim-${k}-${a}" aria-label="${names[a]} ${k}" type="number" value="${esc(d.inputs?.[k+'-'+a]??'0')}" min="0" max="${k==='percent'?100:1e15}" step="${k==='percent'?0.1:1}" required></td>`).join('')}</tr>`).join('')}</table></div><p class="small">매도 금액과 매도 비율은 동시에 입력하지 마세요.</p><button class="primary" type="submit">선택 확인 · 이유 기록으로</button></form><p class="small">직전 확정 월의 매수금액을 자동으로 불러옵니다. 수정하거나 0으로 지울 수 있습니다. 매도는 반복하지 않습니다. 실제 반영은 판단 확정 시에만 이루어집니다.</p><button id="sim-clear-buys" class="secondary">매수금액 모두 0으로</button><button id="sim-selection-save" class="secondary">선택 초안 저장</button>`;
     get('sim-orders-form').onsubmit=e=>{e.preventDefault();perform(async()=>{const next=draft();P.preview(session.portfolio,session.monthlyContribution,orders(next));await move(3,next);});};
     get('sim-orders-form').addEventListener('input',cashSummary);cashSummary();button('sim-clear-buys',async()=>{for(const a of ['QQQ','GOLD','BTC'])get('sim-buy-'+a).value='0';cashSummary();await move(1);});button('sim-selection-save',()=>move(1));
   }else if(step===3){
     content.innerHTML=preview(d)+`<form id="sim-reason-form"><label>그때 왜 그렇게 했나요? <select id="sim-reason" required><option value="">이유 선택</option>${E.REASONS.map(r=>`<option ${d.reason===r?'selected':''}>${esc(r)}</option>`).join('')}</select></label><label>메모 <textarea id="sim-memo" maxlength="4000">${esc(d.memo)}</textarea></label>
     ${session.mode==='philosophy'?`<label>정한 원칙과 비교 <select id="sim-principle-check" required><option value="">선택</option><option value="followed" ${d.principleCheck==='followed'?'selected':''}>원칙을 따랐습니다</option><option value="exception" ${d.principleCheck==='exception'?'selected':''}>이번에는 예외로 판단했습니다</option></select></label><p>예외로 판단했다면 메모에 이유를 남겨 주세요. 원칙 평가는 자기 기록이며 자동 판정이 아닙니다.</p>`:''}
     <p>확정하면 판단과 이번 달 납입금이 한 번 저장되고 다음 월 결과가 공개됩니다.</p><button id="sim-confirm" class="primary" type="submit">판단 확정 · 결과 보기</button></form><div class="sim-actions"><button id="sim-back" class="secondary">투자 선택 수정</button><button id="sim-draft-save" class="secondary">초안 저장</button></div>`;
     button('sim-back',()=>move(2));button('sim-draft-save',()=>move(3));
     get('sim-reason-form').onsubmit=e=>{e.preventDefault();perform(async()=>{
       const nextDraft=draft();
       if(session.mode==='philosophy'&&(!['followed','exception'].includes(nextDraft.principleCheck)||(nextDraft.principleCheck==='exception'&&!nextDraft.memo.trim())))throw Error('원칙 준수 여부와 예외 사유를 남겨 주세요.');
       const result=E.decide(session,orders(nextDraft),nextDraft.reason,nextDraft.memo);
       if(session.mode==='philosophy'){result.decision.principleCheck=nextDraft.principleCheck;result.decision.principleSnapshot=session.principle;}
       await S.commitSimulation(result.session,result.decision);session=result.session;draw();status('판단과 납입금을 저장했습니다. 결과를 확인하세요.');await list();
     });};
   }else if(step===4){
     content.innerHTML=`<p>판단 이유: ${esc(last.reasonCategory)} · ${esc(last.reasonMemo)}</p><p>원화 월수익률 <strong>${percent(last.periodReturn)}</strong>${last.periodReturnUSD!==undefined?` · 달러 월수익률 <strong>${percent(last.periodReturnUSD)}</strong>`:''}</p>
     <p>평가자산 ${fmt(P.value(v.portfolio))} · 누적 납입원금 ${fmt(v.principal,v.principalUSD)} · 손익 ${fmt(P.value(v.portfolio)-v.principal,v.fx&&v.principalUSD!==null?P.value(v.portfolio)/v.fx.value-v.principalUSD:undefined)}</p><p>${last.fxAtDecision?`판단 환율 ${last.fxAtDecision.value.toFixed(2)} → 평가 환율 ${last.fxAtValuation.value.toFixed(2)}원/USD`:'환율 미확보: 원화 결과만 계산합니다.'}</p>
     <div class="table-wrap"><table><tr><th>자산</th><th>이번 판단의 거래 후 원화</th><th>다음 월 평가액</th></tr>${P.ASSETS.map(a=>`<tr><th>${names[a]}</th><td>${last.portfolioAfter[a].toLocaleString('ko-KR')}원</td><td>${fmt(last.nextPortfolio[a])}</td></tr>`).join('')}</table></div><div id="sim-benchmarks"></div><button id="sim-next" class="primary">${v.completed?'최종 정리로':'다음 달 준비로'}</button>`;
     renderBenchmark(benchmarkView(),get('sim-benchmarks'));button('sim-next',()=>move(5,null));
   }else{
     content.innerHTML=v.completed?'<h4>모든 월의 판단을 마쳤습니다. 실제 기간을 공개합니다.</h4><div id="sim-performance"></div><p>메인 탭의 최신 환경과 과거의 판단을 비교해 보세요.</p><a href="#home">현재 시장으로</a>':`<p>다음 판단 기준은 ${dateLabel(v.date)}입니다. 방금 확인한 결과를 출발점으로 새로운 달을 시작합니다.</p><p>아래 버튼은 화면만 전환합니다. 다음 납입금은 다음 판단을 확정할 때 한 번 반영됩니다.</p><button id="sim-open-month" class="primary">새 달의 시장 확인</button>`;
     if(v.completed)renderPerformance(session,get('sim-performance'));else button('sim-open-month',()=>move(1,null));
     content.insertAdjacentHTML('beforeend','<button id="sim-back" class="secondary">방금 결과 다시 보기</button>');button('sim-back',()=>move(4,null));
   }
   if(v.completed)content.insertAdjacentHTML('afterbegin',`<p class="sim-reveal">실제 연습 기간: ${esc(session.startDate)} ~ ${esc(session.endDate)} · 아래 확정한 판단 기록에서 실제 날짜별로 복기하세요.</p>`);
   get('sim-step-title').focus({preventScroll:true});
 }
 function assetTrend(){
   const host=get('sim-asset-trend');if(!session){host.hidden=true;return;}host.hidden=false;
   const h=E.trend(session),usd=AllocationCurrency.mode==='USD',suffix=usd?'USD':'',keys=['principal','user','benchmark'],labels=['누적 납입금','내 평가액','S&P500'],colors=['#758b9c','#3264e8','#e59932'],last=h.at(-1);
   const all=h.flatMap(r=>keys.map(k=>r[k+suffix])).filter(Number.isFinite),lo=all.length?Math.min(...all):0,hi=all.length?Math.max(...all):0,pad=Math.max((hi-lo)*0.08,Math.abs(hi)*0.0001,1),min=Math.max(0,lo-pad),max=hi+pad,y=n=>200-(n-min)/(max-min)*175,x=i=>100+i/Math.max(1,h.length-1)*480;
   const rates=E.returns(session,AllocationCurrency.mode);
   const money=n=>n===null?'자료 없음':(usd?'$':'')+Math.round(n).toLocaleString('ko-KR')+(usd?'':'원');
   host.innerHTML=`<strong>월별 자산 트렌드 · ${AllocationCurrency.mode}</strong><div class="sim-trend-values">${keys.map((k,i)=>`<span style="color:${colors[i]}">${labels[i]} <b>${money(last[k+suffix])}</b></span>`).join('')}</div><div class="sim-trend-values" id="sim-total-returns"><span>내 누적 수익률(TWR) <b>${percent(rates.user)}</b></span><span>S&P500 누적 수익률(TWR) <b>${percent(rates.benchmark)}</b></span></div><div class="sim-trend-values" id="sim-asset-returns">${P.ASSETS.map(a=>`<span>${names[a]} ${percent(rates.assets[a])}</span>`).join('')}</div><small>자산별: 연습 시작 이후 가격 수익률(개인 매수단가 수익률과 다름). 전체·벤치마크: 납입 효과를 제외한 TWR · 선택 통화 기준.</small><svg viewBox="0 0 600 230" role="img" aria-label="확정한 월까지 누적 납입금, 내 평가액, S&P500 평가액">${[min,min+(max-min)/3,min+2*(max-min)/3,max].map(t=>`<text x="0" y="${y(t)}" font-size="11">${Math.round(t).toLocaleString('ko-KR')}</text><line x1="100" x2="580" y1="${y(t)}" y2="${y(t)}" stroke="#e5eaf2"/>`).join('')}${keys.map((k,i)=>{const points=h.map((r,j)=>({v:r[k+suffix],j})).filter(p=>Number.isFinite(p.v));return `<polyline fill="none" stroke="${colors[i]}" stroke-width="2" points="${points.map(p=>`${x(p.j)},${y(p.v)}`).join(' ')}"/>${points.map(p=>`<circle cx="${x(p.j)}" cy="${y(p.v)}" r="2" fill="${colors[i]}"><title>${dateLabel(h[p.j].date)} ${labels[i]} ${money(p.v)}</title></circle>`).join('')}`;}).join('')}<text x="100" y="222" font-size="11">${dateLabel(h[0].date)}</text><text x="470" y="222" font-size="11">${dateLabel(last.date)}</text></svg><small>Y축은 표시 금액의 최소·최대에 맞춰 자동 확대합니다(0부터 시작하지 않을 수 있음). 초기 총액 전부 + 같은 월 납입금을 SPY에 투자한 비교입니다. 확정한 월까지만 표시 · 당시 환율 반영 · 비용 제외.</small><details><summary>월별 금액 표</summary><div class="table-wrap"><table><tr><th>월</th>${labels.map(l=>`<th>${l}</th>`).join('')}</tr>${h.map(r=>`<tr><th>${dateLabel(r.date)}</th>${keys.map(k=>`<td>${money(r[k+suffix])}</td>`).join('')}</tr>`).join('')}</table></div></details>`;
 }
 function cashSummary(){
   const output=get('sim-cash-summary');if(!output||!session)return;
   const held=session.portfolio.CASH,deposit=session.monthlyContribution;
   output.innerHTML=`<p>현재 현금·단기채 평가액 <strong>${fmt(held)}</strong><br>이번 달 신규 납입 <strong>${fmt(deposit)}</strong></p>`;
   try{
     const requested=orders(draft()),sales=P.preview(session.portfolio,deposit,requested.map(o=>({...o,buyAmount:0})));
     const saleAmount=sales.cashAvailable-held-deposit;
     output.innerHTML+=`<p>입력한 매도대금 ${fmt(saleAmount)}<br>총 매수 가능액 <strong>${fmt(sales.cashAvailable)}</strong></p>`;
     const p=P.preview(session.portfolio,deposit,requested),buys=p.orders.reduce((sum,o)=>sum+o.buyAmount,0);
     output.innerHTML+=`<p>입력한 매수 합계 ${fmt(buys)}<br>거래 후 현금·단기채 <strong>${fmt(p.after.CASH)}</strong></p><p class="small">이전 달 잔액에 가격·환율 변동이 반영된 BIL 평가액입니다. 납입은 판단 확정 시 한 번 적용됩니다.</p>`;
   }catch(e){const warning=document.createElement('p');warning.className='error';warning.textContent=e.message;output.append(warning);}
 }
 function chart(){
   if(!get('sim-chart'))return;
   const h=E.view(session).history.slice(-Number(get('sim-lookback').value)-1),usd=AllocationCurrency.mode==='USD';
   if(usd&&h.some(x=>!Number.isFinite(x.fx?.value)||x.fx.value<=0)){get('sim-chart').textContent='당시 환율이 없어 달러 그래프를 표시할 수 없습니다.';return;}
   if(h.length<2){get('sim-chart').textContent='이 시점 이전의 그래프 데이터가 부족합니다.';return;}
   const colors=['#3264e8','#9b883f','#e59932','#758b9c'],selected=get('sim-chart-asset').value;
   function plot(keys){
    const values=keys.map(a=>h.map(s=>s.prices[a]/(usd?s.fx.value:1))),all=values.flat(),lo=Math.min(...all),hi=Math.max(...all),padding=Math.max((hi-lo)*0.1,0.1),min=Math.max(0,lo-padding),max=hi+padding,y=v=>160-(v-min)/(max-min)*130;
    return `<figure style="margin:12px 0"><figcaption>${keys.map(a=>names[a]).join(' · ')} · ${AllocationCurrency.mode} · 실제 가격 (조정종가/종가)</figcaption><svg viewBox="0 0 600 200" role="img" aria-label="${keys.map(a=>names[a]).join(' · ')} 현재 판단까지 실제 가격">${[min,(min+max)/2,max].map(t=>`<text x="0" y="${y(t)}" font-size="12">${Math.round(t).toLocaleString('ko-KR')}</text><line x1="105" x2="580" y1="${y(t)}" y2="${y(t)}" stroke="#e5eaf2"/>`).join('')}${values.map((line,i)=>`<polyline fill="none" stroke="${colors[P.ASSETS.indexOf(keys[i])]}" stroke-width="2" points="${line.map((v,j)=>`${105+j/(h.length-1)*475},${y(v)}`).join(' ')}"/>`).join('')}<text x="105" y="190" font-size="12">${dateLabel(h[0].date)}</text><text x="470" y="190" font-size="12">${dateLabel(h.at(-1).date)}</text></svg><p class="small">구간 변화 ${keys.map((a,i)=>names[a]+' '+percent(values[i].at(-1)/values[i][0]-1)).join(' · ')}</p></figure>`;
   }
   get('sim-chart').innerHTML='<p class="muted">자산별 그래프는 Y축 범위가 다릅니다. 기울기 대신 축 숫자와 구간 변화율을 비교하세요.</p>'+(selected==='separate'?P.ASSETS.map(a=>plot([a])).join(''):plot(selected==='all'?P.ASSETS:[selected]));
 }
 window.addEventListener('currencychange',()=>{if(session){assetTrend();chart();cashSummary();if(get('sim-performance'))renderPerformance(session,get('sim-performance'));}});
 get('sim-start').onclick=()=>perform(async()=>{
   const input=Object.fromEntries(P.ASSETS.map(a=>{const e=get('sim-initial-'+a);if(!e.value.trim())throw Error('연습용 초기자산을 모두 입력하세요. 미보유 자산은 0입니다.');return [a,Number(e.value)];}));
   if(!get('sim-monthly').value.trim())throw Error('반복 월납입금을 입력하세요.');
   const next=E.start(rows,Number(get('sim-years').value),input,Number(get('sim-monthly').value),Math.random,{...config,mode:get('sim-mode').value,principle:get('sim-principle').value});
   await S.add('sessions',next);session=next;draw();await list();status('연습을 저장했습니다. 첫 단계에서 시장을 확인하세요.');
 });
 try{
   const [range,settings]=await Promise.all([AllocationHistory.get().getAvailableDateRange(),AllocationData.get().getSimulationConfig()]);
   if(range.errors?.historical)throw Error(range.errors.historical);rows=range.rows;config=settings;
   for(const option of get('sim-years').options)option.disabled=!E.candidates(rows,Number(option.value),config).length;
   const first=[...get('sim-years').options].find(o=>!o.disabled);available=!!first;if(first)get('sim-years').value=first.value;get('sim-start').disabled=!available;
   status(available?`${rows.length}개월 가격 연결. 진행 중 실제 연월은 비공개이며 완료 후 공개합니다. 주식=SPY, 현금·단기채=BIL. 당시 환율을 반영하고 월말 가격에 거래한다고 가정합니다. 가격 기반 추정 Score 모델 ${config.scoreModel?.version||'없음'} · 실제 과거 Score와 개발자 전략은 미확보입니다.`:'선택 기간을 충족하는 연속 자료가 없습니다. 기존 저장 연습은 아래에서 이어볼 수 있습니다.');
 }catch(e){status(e.message);}
 try{await list();}catch(e){status('저장소를 열 수 없습니다: '+e.message);}
})();
