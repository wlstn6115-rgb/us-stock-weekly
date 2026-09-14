(function(root){
 const money=n=>n.toLocaleString('ko-KR')+'원';
 root.renderBenchmark=function(session,target){
   const v=root.BenchmarkEngine.view(session.benchmarks,session.cursor);
   if(!v.available){target.textContent=v.reason;return;}
   if(v.hidden){target.textContent='첫 판단을 확정하면 개발자 배분과 세 포트폴리오 비교가 공개됩니다.';return;}
   const h=v.history,colors=['#3264e8','#177765','#a66e23'],keys=['user','developer','sp500'],all=h.flatMap(p=>keys.map(k=>p[k])),lo=Math.min(...all),hi=Math.max(...all),y=n=>160-(n-lo)/(hi-lo||1)*130;
   target.innerHTML=`<h3>동일 납입 조건 비교</h3><p>같은 초기 총자산·같은 월납입금·같은 평가시점입니다. 개발자 전략은 초기 보유구성을 유지하고 신규자금만 월배분하며, S&P500은 초기자산과 신규자금 전액을 투자합니다.</p><div class="table-wrap"><table><thead><tr><th>전략</th><th>평가자산</th><th>총 납입원금</th><th>손익</th><th>누적 TWR</th></tr></thead><tbody>${v.rows.map(r=>`<tr><th>${r.label}</th><td>${money(r.value)}</td><td>${money(r.principal)}</td><td>${money(r.profit)}</td><td>${r.twr===null?'—':(r.twr*100).toFixed(2)+'%'}</td></tr>`).join('')}</tbody></table></div><svg viewBox="0 0 620 220" role="img" aria-label="판단 완료 월까지 사용자 개발자 S&P500 평가자산 비교">${keys.map((k,i)=>`<polyline stroke="${colors[i]}" stroke-width="2" fill="none" points="${h.map((p,j)=>`${25+j/(h.length-1)*560},${y(p[k])}`).join(' ')}"/>`).join('')}<text x="25" y="15" font-size="12">최대 ${Math.round(hi).toLocaleString('ko-KR')}원</text><text x="25" y="180" font-size="12">최소 ${Math.round(lo).toLocaleString('ko-KR')}원</text><text x="25" y="210" font-size="12">${h[0].date}</text><text x="490" y="210" font-size="12">${h.at(-1).date}</text></svg><p>${v.rows.map((r,i)=>`<span style="color:${colors[i]}">${r.label}</span>`).join(' · ')}</p><p>누적 TWR은 월초 납입을 제거한 월별 수익률을 연결한 값입니다. 평가자산 증가율과 다릅니다. 세금·수수료는 미반영입니다.</p><h4>직전 확정 월 개발자 신규자금 배분</h4><p>${Object.entries(v.lastAllocation.amounts).map(([a,n])=>`${({QQQ:'주식',GOLD:'금',BTC:'비트코인',CASH:'현금·단기채'})[a]} ${money(n)}`).join(' · ')}</p>`;
 };
})(globalThis);
