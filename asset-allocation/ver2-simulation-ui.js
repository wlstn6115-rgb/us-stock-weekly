(async function () {
  'use strict';
  const host = document.getElementById('simulation-section');
  if (!host) return;
  const P = window.PortfolioEngine, V = window.ModelV2;
  const names = {QQQ:'미국 주식', BTC:'비트코인', GOLD:'금', CASH:'현금'};
  const keys = ['QQQ','BTC','GOLD','CASH'], traded = keys.slice(0,3);
  const key = 'allocation-observatory-ver2-practice-v1';
  const money = n => Math.round(n).toLocaleString('ko-KR') + '원';
  const weights = w => ({QQQ:w.equity, BTC:w.btc, GOLD:w.gold, CASH:w.cash});
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let rows = [], session = null;
  host.innerHTML = `<h2>Ver2 자산 시뮬레이터</h2>
    <p class="muted">초기 자산과 월 납입금을 정하고 과거 시장에서 직접 매수·매도해 보세요. 같은 조건의 Ver2 전체 자산 재배분 및 S&amp;P500과 비교합니다. 과거 Ver2 신호는 사후 재구성 값입니다.</p>
    <p id="v2-practice-status" role="status" aria-live="polite">시뮬레이션 자료 확인 중…</p>
    <details id="v2-setup" open><summary>새 연습 설정</summary>
      <fieldset><legend>연습용 초기 자산 (원)</legend>${keys.map(a=>`<label>${names[a]} <input id="v2-initial-${a}" type="number" min="0" step="1" value="${a==='CASH'?10000000:0}"></label>`).join('')}</fieldset>
      <label>매월 납입금 (원) <input id="v2-practice-deposit" type="number" min="0" step="1" value="2000000"></label>
      <label>기간 <select id="v2-years"><option value="1">1년</option><option value="3">3년</option><option value="5">5년</option></select></label>
      <p class="small">시작 시점은 연속된 자료 중 무작위로 선택하며, 실제 날짜는 연습을 마친 뒤 공개합니다.</p>
      <button id="v2-practice-start" class="primary" disabled>새 연습 시작</button>
    </details>
    <div id="v2-practice-body"></div>
    <details><summary>Ver2 전체 기간 자동 계산</summary><p>초기 0원에서 매월 납입하고 전체 자산을 Ver2 목표로 재배분합니다. 신호가 없는 달은 납입과 재배분을 건너뜁니다.</p><label>월 납입금 <input id="v2-monthly" type="number" min="1" step="1" value="2000000"> 원</label> <button id="v2-sim-run">계산</button><p id="v2-sim-result" role="status"></p></details>
    <details><summary>기존 저장 연습</summary><p>기존 기록은 그대로 보존됩니다. 기존 Ver1 연습은 Ver2로 자동 변환하지 않습니다.</p><div id="v2-old-sessions"></div></details>`;
  const get = id => document.getElementById(id);
  const status = msg => { get('v2-practice-status').textContent = msg; };
  const val = id => { const v = get(id).value; if (!v.trim() || !Number.isSafeInteger(Number(v)) || Number(v)<0) throw Error('금액은 0 이상의 정수로 입력하세요.'); return Number(v); };
  function candidates(years) {
    const n = years * 12, result = [];
    for (let i=0; i+n<rows.length; i++) {
      const slice=rows.slice(i,i+n+1);
      if (slice.every((r,j)=>r.status==='available' && r.target?.weights && keys.every(k=>Number.isFinite(r.prices?.[k])&&r.prices[k]>0) && (!j || month(r.month)===month(slice[j-1].month)+1))) result.push(i);
    }
    return result;
  }
  function month(s){return Number(s.slice(0,4))*12+Number(s.slice(5,7));}
  function starts() {
    const list=candidates(Number(get('v2-years').value));
    get('v2-practice-start').disabled=!list.length;
    if(!list.length) status('선택한 기간에 연속된 Ver2 자료가 없습니다.');
    else status('연습 기간을 선택하세요. 결측 월이 포함된 구간은 선택하지 않습니다.');
  }
  function save(){try{localStorage.setItem(key,JSON.stringify(session));}catch(e){status('저장하지 못했습니다. 브라우저 저장 설정을 확인하세요.');}}
  function trendChart(done) {
    const initial=session.principal-session.deposit*session.cursor;
    const points=[{date:session.startMonth,user:initial,model:initial,sp500:initial,principal:initial},
      ...session.history.map((h,i)=>({...h,date:h.next,principal:initial+session.deposit*(i+1)}))];
    if(points.some(p=>!['user','model','sp500','principal'].every(k=>Number.isFinite(p[k])&&p[k]>=0))) return '<p>그래프에 필요한 과거 평가액이 부족합니다.</p>';
    const series=[['user','내 평가액','#2458e9'],['model','Ver2','#059669'],['sp500','S&amp;P 500','#e88312'],['principal','누적 원금','#73899c']];
    const all=points.flatMap(p=>series.map(([k])=>p[k]));
    const low=Math.min(...all),high=Math.max(...all),padding=Math.max((high-low)*.12,high*.01,1),min=Math.max(0,low-padding),max=high+padding;
    const x=i=>110+(points.length===1?0:i/(points.length-1)*480),y=n=>185-(n-min)/(max-min)*150;
    const title=(p,i)=>done?esc(p.date):(i===0?'시작':i+'개월 후');
    const ticks=Array.from({length:4},(_,i)=>min+(max-min)*i/3).map(v=>`<text x="102" y="${y(v)+3}" text-anchor="end" font-size="10">${money(v)}</text><line x1="110" x2="590" y1="${y(v)}" y2="${y(v)}" stroke="#e0e7ef"/>`).join('');
    const lines=series.map(([k,label,color])=>`<polyline data-series="${k}" fill="none" stroke="${color}" stroke-width="2.5" ${k==='principal'?'stroke-dasharray="5 4"':''} points="${points.map((p,i)=>`${x(i)},${y(p[k])}`).join(' ')}"/>${points.map((p,i)=>`<circle cx="${x(i)}" cy="${y(p[k])}" r="3" fill="${color}" tabindex="0"><title>${title(p,i)} · ${label}: ${money(p[k])}</title></circle>`).join('')}`).join('');
    const labels=points.length===1?'':`<text x="110" y="207" font-size="10">${title(points[0],0)}</text><text x="590" y="207" text-anchor="end" font-size="10">${title(points.at(-1),points.length-1)}</text>`;
    return `<section aria-label="월별 자산 추이" style="margin:18px 0"><h4>월별 자산 추이</h4><div style="display:flex;gap:12px;flex-wrap:wrap;font-size:13px">${series.map(([,label,color])=>`<span style="color:${color}">● ${label}</span>`).join('')}</div><svg viewBox="0 0 620 215" role="img" aria-label="지금까지의 내 평가액, Ver2, S&amp;P 500 및 누적 원금" style="width:100%;height:auto;max-height:360px">${ticks}${lines}${labels}</svg><p class="small">확정한 달까지만 표시합니다. 금액에는 동일한 월 납입금이 포함됩니다. 점에 마우스를 올리면 금액을 볼 수 있습니다. Y축은 금액 범위에 맞춰 조정됩니다.</p></section>`;
  }
  function draw() {
    if(!session)return;
    const row=rows[session.start+session.cursor], next=rows[session.start+session.cursor+1], done=session.cursor>=session.months;
    const total=P.value(session.portfolio), benchmark=Object.values(session.model).reduce((a,b)=>a+b,0);
    const target=weights(row.target.weights);
    get('v2-practice-body').innerHTML=`<section style="margin-top:20px">
      <h3>${done?'연습 완료 · '+esc(session.startMonth)+' ~ '+esc(row.month):'이번 달 투자 선택 · '+(session.cursor+1)+'번째 달'}</h3>
      <p>진행 ${session.cursor} / ${session.months}개월 · 누적 납입 원금 ${money(session.principal)}</p>
      <p><strong>내 평가액 ${money(total)}</strong> · Ver2 ${money(benchmark)} · S&amp;P500 ${money(session.sp500)}</p>
      ${trendChart(done)}
      <p class="small">비교 자산은 같은 초기 자산과 월 납입금으로 시작합니다. Ver2는 월별 전체 자산을 재배분합니다. 사용자 거래에는 수수료 0.1%, Ver2에도 매수·매도 각 0.1%를 적용합니다. S&amp;P500은 수수료·배당·세금 제외 가격 대용치입니다.</p>
      <div class="table-wrap"><table><thead><tr><th>자산</th><th>현재 평가액</th><th>현재 비중</th><th>Ver2 목표 비중</th>${done?'':'<th>매수 (원)</th><th>매도 (원)</th>'}</tr></thead><tbody>
      ${keys.map(a=>`<tr><th>${names[a]}</th><td>${money(session.portfolio[a])}</td><td>${(total?session.portfolio[a]/total*100:0).toFixed(1)}%</td><td>${(target[a]*100).toFixed(1)}%</td>${done?'':(a==='CASH'?'<td>—</td><td>—</td>':`<td><input id="v2-buy-${a}" aria-label="${names[a]} 매수" type="number" min="0" step="1" value="0" style="width:110px"></td><td><input id="v2-sell-${a}" aria-label="${names[a]} 매도" type="number" min="0" step="1" value="0" style="width:110px"></td>`)}</tr>`).join('')}</tbody></table></div>
      ${done?'<p>선택한 기간의 연습을 마쳤습니다. 실제 기간을 공개합니다.</p>':`<p>이번 달 납입 ${money(session.deposit)} · 다음 평가: ${session.cursor+2}번째 달</p><label>투자 이유 <input id="v2-reason" type="text" maxlength="300" placeholder="선택 사항"></label> <button id="v2-next" class="primary">판단 확정 · 다음 달 결과</button>`}
      <details><summary>월별 기록 (${session.history.length}건)</summary><div class="table-wrap"><table><thead><tr><th>판단 월</th><th>다음 평가 월</th><th>내 평가액</th><th>Ver2</th><th>S&amp;P500</th><th>이유</th></tr></thead><tbody>${session.history.map((h,i)=>`<tr><td>${done?esc(h.date):(i+1)+'번째 달'}</td><td>${done?esc(h.next):(i+2)+'번째 달'}</td><td>${money(h.user)}</td><td>${money(h.model)}</td><td>${money(h.sp500)}</td><td>${esc(h.reason)}</td></tr>`).join('')}</tbody></table></div></details>
      </section>`;
    if(!done)get('v2-next').onclick=()=>{
      try {
        const orders=traded.map(a=>({asset:a,buyAmount:val('v2-buy-'+a),sellAmount:val('v2-sell-'+a),sellPercent:0}));
        const p=P.preview(session.portfolio,session.deposit,orders);
        const fee=Math.round(orders.reduce((sum,o)=>sum+o.buyAmount+o.sellAmount,0)*.001);
        if(p.after.CASH<fee) throw Error('거래 수수료를 낼 현금이 부족합니다. 매수 금액을 줄여 주세요.');
        p.after.CASH-=fee;
        const model=V.rebalance(session.model,session.deposit,target).after;
        const ratios=Object.fromEntries(keys.map(a=>[a,next.prices[a]/row.prices[a]]));
        const nextPortfolio=P.markToMarket(p.after,Object.fromEntries(keys.map(a=>[a,ratios[a]-1])));
        const nextModel=Object.fromEntries(keys.map(a=>[a,model[a]*ratios[a]]));
        const sp500=(session.sp500+session.deposit)*ratios.QQQ;
        if(!Number.isFinite(sp500))throw Error('비교 가격 자료가 유효하지 않습니다.');
        session.history.push({date:row.month,next:next.month,user:P.value(nextPortfolio),model:Object.values(nextModel).reduce((a,b)=>a+b,0),sp500,reason:get('v2-reason').value});
        session.portfolio=nextPortfolio;session.model=nextModel;session.sp500=sp500;session.principal+=session.deposit;session.cursor++;
        save();draw();status('판단과 다음 달 결과를 저장했습니다.');
      } catch(e){status(e.message);}
    };
  }
  get('v2-years').onchange=starts;
  try {
    const response=await fetch('./ver2-simulation-history.json?t='+Date.now(),{cache:'no-store'});
    if(!response.ok)throw Error('과거 시뮬레이션 자료를 불러오지 못했습니다.');
    rows=(await response.json()).observations;
    if(!Array.isArray(rows)||!rows.length)throw Error('과거 시뮬레이션 자료가 비어 있습니다.');
    get('v2-sim-run').onclick=()=>{
      const out=get('v2-sim-result');
      try {
        const deposit=val('v2-monthly');if(!deposit)throw Error('월 납입금은 0보다 커야 합니다.');
        let vals={QQQ:0,BTC:0,GOLD:0,CASH:0},last=null,prev=null,idx=1,peak=1,mdd=0,paid=0,skips=0,used=0;
        for(const x of rows){if(x.status!=='available'){skips++;continue;}if(last)for(const a of keys)vals[a]*=x.prices[a]/last[a];const before=Object.values(vals).reduce((a,b)=>a+b,0);const z=V.rebalance(vals,deposit,weights(x.target.weights));idx*=prev===null?1-z.cost/deposit:(before-z.cost)/prev;vals=z.after;prev=Object.values(vals).reduce((a,b)=>a+b,0);last=x.prices;peak=Math.max(peak,idx);mdd=Math.min(mdd,idx/peak-1);paid+=deposit;used++;}
        if(!used)throw Error('사용 가능한 과거 자료가 없습니다.');
        out.textContent=`납입 ${money(paid)} · 평가액 ${money(prev)} · 월말 MDD ${(mdd*100).toFixed(2)}% · 계산 ${used}개월 · 결측 제외 ${skips}개월. 사후 재구성 신호 기준입니다.`;
      }catch(e){out.textContent=e.message;}
    };
    starts();
    get('v2-practice-start').onclick=()=>{
      try {
        const portfolio=Object.fromEntries(keys.map(a=>[a,val('v2-initial-'+a)]));
        const deposit=val('v2-practice-deposit'),months=Number(get('v2-years').value)*12,options=candidates(months/12);
        if(!options.length)throw Error('선택한 기간의 자료를 확인하세요.');
        const start=options[Math.floor(Math.random()*options.length)];
        const total=P.value(portfolio);if(total===0&&deposit===0)throw Error('초기 자산 또는 월 납입금을 입력하세요.');
        session={schemaVersion:1,start,startMonth:rows[start].month,months,cursor:0,deposit,portfolio,model:{...portfolio},sp500:total,principal:total,history:[]};
        save();get('v2-setup').open=false;draw();status('연습을 시작했습니다.');
      }catch(e){status(e.message);}
    };
    try { const stored=JSON.parse(localStorage.getItem(key)||'null'); if(stored && Number.isInteger(stored.cursor) && stored.cursor<=stored.months){ const start=rows.findIndex(r=>r.month===stored.startMonth); if(start<0||!rows[start+stored.cursor])throw Error('저장된 기간의 자료가 없습니다.'); stored.start=start;session=stored;P.portfolio(session.portfolio);draw();status('이 브라우저에 저장된 Ver2 연습을 불러왔습니다.');} } catch(e){session=null;status('기존 저장 연습을 자동으로 불러오지 못했습니다. 새 연습을 시작할 수 있습니다.');}
  } catch(e){status(e.message);}
  try {const old=await AllocationStore.list('sessions');get('v2-old-sessions').textContent=`기존 저장 연습 ${old.length}개 · 원본 기록 유지`;}catch(e){get('v2-old-sessions').textContent='기존 기록 저장소를 불러오지 못했습니다. 기록은 삭제하지 않았습니다.';}
})();
