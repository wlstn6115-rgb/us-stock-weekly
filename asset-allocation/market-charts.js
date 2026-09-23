(function(){
 const host=document.getElementById('market-charts');if(!host)return;
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const ids=['sp500','bitcoin','gold','ust1','ust10','wti','dxy','nasdaq'];
 const colors=['#3264e8','#e59932','#9b883f','#758b9c','#6a60a9','#b57649','#518f82','#5273b3'];
 let data=null;
 host.innerHTML='<h2>시장 가격·금리</h2><label>조회 기간 <select id="market-chart-range"><option value="30">1개월</option><option value="90" selected>3개월</option><option value="180">6개월</option><option value="370">1년</option></select></label><p class="small">지수는 포인트, 가격은 달러, 국채는 수익률(%)입니다. 금·WTI는 선물 종가이며 현물 가격과 다릅니다. Score 입력과 별도 수집합니다.</p><div class="market-chart-grid"></div>';
 function draw(){
  if(!data)return;
  const cutoff=new Date(Date.now()-Number(document.getElementById('market-chart-range').value)*86400000).toISOString().slice(0,10);
  host.querySelector('.market-chart-grid').innerHTML=ids.map((id,index)=>{
   const s=data.series.find(s=>s.id===id);if(!s)return '<article>자료 없음</article>';
   const rows=s.observations.filter(r=>r.date>=cutoff&&r.date<=new Date().toISOString().slice(0,10));
   const last=rows.at(-1),f=n=>n.toLocaleString('ko-KR',{maximumFractionDigits:2});
   if(!last)return `<article><h3>${esc(s.name)}</h3><p>선택 기간 자료 없음</p></article>`;
   const values=rows.map(r=>r.value),low=Math.min(...values),high=Math.max(...values),pad=Math.max((high-low)*0.08,Math.abs(high)*0.001,0.01),lo=low-pad,hi=high+pad;
   const start=Date.parse(rows[0].date),end=Date.parse(last.date),x=r=>75+(Date.parse(r.date)-start)/(end-start||1)*265,y=v=>145-(v-lo)/(hi-lo)*115;
   const stale=Date.now()-Date.parse(last.date)>7*86400000;
   return `<article><h3>${esc(s.name)}</h3><strong>${f(last.value)} ${esc(s.unit)}</strong><p class="small">${last.date} 관측${stale?' · 오래된 관측':''}${s.status!=='ok'?' · 최근 수집 실패':''}</p><svg viewBox="0 0 360 175" role="img" aria-label="${esc(s.name)} 실제 값 추이">${[lo,(lo+hi)/2,hi].map(n=>`<text x="0" y="${y(n)}" font-size="10">${f(n)}</text><line x1="75" x2="340" y1="${y(n)}" y2="${y(n)}" stroke="#e5eaf2"/>`).join('')}<polyline fill="none" stroke="${colors[index]}" stroke-width="2" points="${rows.map(r=>`${x(r)},${y(r.value)}`).join(' ')}"/>${rows.map(r=>`<circle tabindex="0" data-chart-id="${id}" data-date="${r.date}" data-value="${r.value}" cx="${x(r)}" cy="${y(r.value)}" r="3" fill="${colors[index]}" aria-label="${r.date} ${f(r.value)} ${esc(s.unit)}"><title>${r.date}: ${f(r.value)} ${esc(s.unit)}</title></circle>`).join('')}<text x="75" y="170" font-size="10">${rows[0].date}</text><text x="275" y="170" font-size="10">${last.date}</text></svg><p id="market-point-${id}" class="small" aria-live="polite">${last.date} · ${f(last.value)} ${esc(s.unit)}</p><small>${s.sourceUrl?.startsWith('https://')?`<a href="${esc(s.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(s.provider)} · ${esc(s.ticker)}</a>`:esc(s.provider)+' · '+esc(s.ticker)}</small></article>`;
  }).join('');
  host.querySelectorAll('[data-chart-id]').forEach(e=>{const show=()=>{const s=data.series.find(s=>s.id===e.dataset.chartId);document.getElementById('market-point-'+s.id).textContent=e.dataset.date+' · '+Number(e.dataset.value).toLocaleString('ko-KR',{maximumFractionDigits:2})+' '+s.unit;};['mouseenter','focus','click'].forEach(k=>e.addEventListener(k,show));});
 }
 async function refresh(){try{const next=await AllocationData.get().getMarketCharts();if(next.schemaVersion!==1||!Array.isArray(next.series))throw Error('자료 형식 오류');for(const s of next.series)for(const r of s.observations){AllocationModels.validDate(r.date);if(!Number.isFinite(r.value))throw Error('가격 오류');}data=next;draw();}catch(e){if(!data)host.querySelector('.market-chart-grid').textContent='시장 차트 조회 실패: '+e.message;}}
 document.getElementById('market-chart-range').onchange=draw;refresh();setInterval(refresh,300000);
})();
