(function(root){
 const host=document.getElementById('score-trends');if(!host)return;
 const names={QQQ:'QQQ · 주식',BTC:'Bitcoin',GOLD:'Gold · 금',CASH:'Cash · 현금'},colors={QQQ:'#3264e8',BTC:'#e59932',GOLD:'#9b883f',CASH:'#758b9c'};
 const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 async function draw(){try{
   const [all,latest]=await Promise.all([AllocationData.get().getScoreHistory(),AllocationData.get().getLatestSnapshot()]);
   const rows=all.filter(r=>r.modelVersion===latest?.modelVersion&&Date.parse(r.availableAt)<=Date.now()).sort((a,b)=>a.date.localeCompare(b.date));
   host.innerHTML='<h2>자산별 Score 추이</h2><p class="muted">실제로 기록된 같은 모델의 Score만 표시합니다. 빈 날짜는 새로 계산하지 않습니다. 세로축 0~100.</p><div class="trend-grid">'+Object.keys(names).map(a=>{
     const points=rows.filter(r=>Number.isFinite(r.scores[a]));if(!points.length)return `<article><h3>${names[a]}</h3><p>기록이 아직 없습니다.</p></article>`;
     const first=Date.parse(points[0].date),last=Date.parse(points.at(-1).date),x=r=>35+(Date.parse(r.date)-first)/(last-first||1)*280,y=r=>125-r.scores[a];
     return `<article><h3>${names[a]}</h3><svg viewBox="0 0 350 160" role="img" aria-label="${names[a]} 환경 Score 추이"><text x="0" y="28">100</text><text x="14" y="128">0</text><path d="M30 25V125H325" fill="none" stroke="#cdd8e4"/><polyline points="${points.map(r=>`${x(r)},${y(r)}`).join(' ')}" fill="none" stroke="${colors[a]}" stroke-width="2"/>${points.map(r=>`<circle cx="${x(r)}" cy="${y(r)}" r="3" fill="${colors[a]}"><title>${r.date}: ${r.scores[a].toFixed(2)}</title></circle>`).join('')}<text x="30" y="150">${points[0].date}</text><text x="240" y="150">${points.at(-1).date}</text></svg><p>${points.length}개 관측 · 최근 ${points.at(-1).scores[a].toFixed(2)}점</p></article>`;
   }).join('')+'</div><details><summary>날짜별 Score 값 보기</summary><div class="table-wrap"><table><tr><th>기준일</th>'+Object.values(names).map(n=>`<th>${n}</th>`).join('')+'</tr>'+rows.map(r=>`<tr><td>${r.date}</td>${Object.keys(names).map(a=>`<td>${r.scores[a]===null?'—':r.scores[a].toFixed(2)}</td>`).join('')}</tr>`).join('')+'</table></div></details><p class="small">모델 '+esc(latest?.modelVersion?.slice(0,12)||'미확보')+' · 모델이 바뀌면 다른 버전의 선을 연결하지 않습니다.</p>';
 }catch(e){host.textContent='Score 추이를 불러오지 못했습니다: '+e.message;}}
 draw();setInterval(draw,30000);
})(globalThis);
