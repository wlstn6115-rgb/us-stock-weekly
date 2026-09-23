(async function(){
 'use strict';const $=id=>document.getElementById(id),esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=n=>Math.round(n).toLocaleString('ko-KR'),pct=n=>n===null?'—':(n*100).toFixed(2)+'%',num=n=>n===null?'—':n.toFixed(2);
 const names={bounded:'Score + 제한 배분',fixed:'고정비중 DCA',equal:'동일비중 DCA',score:'Score 비례 DCA',sp500:'S&P500 거치 + DCA'};
 let rows,versions,output;
 function renderVersions(){$('versions').innerHTML=versions.map(v=>`<label><input type="checkbox" data-version value="${esc(v.id)}" ${v.kind==='price'?'checked':'disabled'}> ${esc(v.label)} ${v.reason?'<small>'+esc(v.reason)+'</small>':''}</label>`).join('');}
 function show(results){
  const colors=['#2457e8','#dc8621','#159888','#9567b0','#64748b','#bd394d'];
  const all=results.flatMap(r=>r.history.map(h=>h.value)),min=Math.min(...all),max=Math.max(...all),pad=Math.max(1,(max-min)*.08),lo=min-pad,hi=max+pad;
  const y=v=>250-(v-lo)/(hi-lo)*220,x=i=>100+i/(results[0].history.length-1)*780;
  $('results').innerHTML='<h2>버전·전략 비교</h2><p>모든 금액은 원화이며 당시 환율을 반영합니다. 선은 평가금액, 성과지표는 TWR입니다.</p>'+`<svg viewBox="0 0 920 285" role="img" aria-label="전략별 평가금액 추이">${[lo,(lo+hi)/2,hi].map(v=>`<text x="0" y="${y(v)}" font-size="12">${money(v)}</text><path d="M100 ${y(v)}H880" stroke="#e2e8f0"/>`).join('')}${results.map((r,j)=>`<polyline points="${r.history.map((h,i)=>x(i)+','+y(h.value)).join(' ')}" stroke="${colors[j%colors.length]}" fill="none" stroke-width="2"><title>${esc(r.version+' '+names[r.strategy])}</title></polyline>`).join('')}<text x="100" y="280" font-size="12">${results[0].history[0].date}</text><text x="790" y="280" font-size="12">${results[0].history.at(-1).date}</text></svg>`+
  '<div class="table-wrap"><table><thead><tr><th>버전 / 전략</th><th>최종자산</th><th>납입원금</th><th>누적 TWR</th><th>CAGR</th><th>MDD</th><th>변동성</th><th>Sharpe</th><th>Sortino</th><th>최악 1년</th><th>최대 수중기간</th><th>평균 매수비율</th></tr></thead><tbody>'+results.map((r,j)=>{const m=r.metrics;return `<tr><th style="color:${colors[j%colors.length]}">${esc(r.version)} / ${names[r.strategy]}</th><td>${money(m.ending)}</td><td>${money(m.principal)}</td><td>${pct(m.twr)}</td><td>${pct(m.cagr)}</td><td>${pct(m.mdd)}</td><td>${pct(m.volatility)}</td><td>${num(m.sharpe)}</td><td>${num(m.sortino)}</td><td>${pct(m.worst1Y)}</td><td>${m.longestUnderwaterMonths}개월${m.unrecovered?' · 미회복':''}</td><td>${pct(m.purchaseRatio)}</td></tr>`;}).join('')+'</tbody></table></div>'+results.filter(r=>r.strategy==='bounded').map(r=>`<details><summary>${esc(r.version)} 월별 Score → 매수금액 확인</summary><div class="table-wrap"><table><tr><th>신호일</th><th>매수일</th><th>Score (주식/BTC/금/현금)</th><th>매수액 (주식/BTC/금/현금)</th><th>평가액</th></tr>${r.audit.map(a=>`<tr><td>${a.signalDate}</td><td>${a.tradeDate}</td><td>${['QQQ','BTC','GOLD','CASH'].map(k=>a.scores[k]).join(' / ')}</td><td>${['QQQ','BTC','GOLD','CASH'].map(k=>money(a.buys[k])).join(' / ')}</td><td>${money(a.value)}</td></tr>`).join('')}</table></div></details>`).join('');
 }
 $('retry').onclick=()=>location.reload();
 let bundled=false;
 async function readData(name){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
  try{const response=await fetch('./'+name,{cache:'no-store',signal:controller.signal});if(!response.ok)throw Error('HTTP '+response.status);return await response.json();}
  catch(error){const bundle=JSON.parse($('backtest-data')?.textContent||'{}');if(!bundle[name])throw Error(name+' 자료를 불러오지 못했습니다. 자료 다시 불러오기를 눌러 주세요.');bundled=true;return bundle[name];}
  finally{clearTimeout(timer);}
 }
 try{
  $('status').textContent='버전 설정과 월별 자료를 불러오는 중입니다…';
  const [registry,history]=await Promise.all([readData('backtest-versions.json'),readData('simulation-history.json')]);versions=registry.versions;
  rows=await new HistoricalDataAdapter({fetcher:async()=>({ok:true,json:async()=>history})}).read();if(rows.length<15)throw Error('월별 자료가 부족합니다.');
  const invalidate=()=>{output=null;$('download').disabled=true;$('results').textContent='설정이 변경되었습니다. 다시 실행하세요.';};
  document.querySelector('.controls').addEventListener('input',invalidate);$('versions').addEventListener('change',invalidate);
  $('data-info').textContent=`${bundled?'네트워크 조회 실패로 페이지에 포함된 자료 사용 · ':''}자료 ${rows[0].date} ~ ${rows.at(-1).date} · ${rows.length}개월 · 데이터 버전 ${rows[0].dataVersion}`;
  for(const id of ['start','end'])$(id).innerHTML=rows.map((r,i)=>i>=13?`<option value="${i}">${r.date}</option>`:'').join('');$('end').value=String(rows.length-1);renderVersions();$('run').disabled=false;
  $('template').disabled=false;$('add').disabled=false;$('status').textContent='자료 준비 완료. 선택 버전 비교 실행을 누르세요.';
  $('template').onclick=()=>{$('config').value=JSON.stringify({...versions.find(v=>v.kind==='price'),id:'price-experiment-2',label:'가격 기반 실험 2'},null,2);};
  $('add').onclick=()=>{try{const v=JSON.parse($('config').value);DeveloperBacktest.validateVersion(v);if(versions.some(x=>x.id===v.id))throw Error('새로운 고유 id를 입력하세요.');versions.push(v);renderVersions();$('status').textContent='실험 버전을 추가했습니다.';}catch(e){$('status').textContent=e.message;}};
  $('run').onclick=()=>{try{
   $('download').disabled=true;output=null;const selected=versions.filter(v=>[...document.querySelectorAll('[data-version]:checked')].some(e=>e.value===v.id));if(!selected.length)throw Error('가격 기반 실험 버전을 선택하세요.');
   const options={start:Number($('start').value),end:Number($('end').value),initial:Number($('initial').value),monthly:Number($('monthly').value),feeBps:Number($('fee').value),cashMode:$('cash').value};
   if(['initial','monthly','fee'].some(id=>!$(id).value.trim()))throw Error('금액과 비용을 입력하세요.');
   const results=selected.flatMap(v=>DeveloperBacktest.run(rows,v,options));
   output={schemaVersion:1,engineVersion:'monthly-lagged-dca-v1',createdAt:new Date().toISOString(),dataVersion:rows[0].dataVersion,pointInTimeVerified:false,options,versions:selected,results};show(results);$('download').disabled=false;$('status').textContent=`${selected.length}개 버전 · ${results.length}개 전략 실행 완료. 메인 매크로 ver1의 검증 결과가 아닙니다.`;
  }catch(e){$('results').textContent='실행 실패: '+e.message;$('status').textContent=e.message;}};
  $('download').onclick=()=>{if(!output)return;const url=URL.createObjectURL(new Blob([JSON.stringify(output,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='backtest-results.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 }catch(e){$('status').textContent=e.message;}
})();
