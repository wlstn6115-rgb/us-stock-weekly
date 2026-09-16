(function(root){
 const percent=n=>n===null?'—':(n*100).toFixed(2)+'%';
 root.renderPerformance=(session,target)=>{
   const currency=root.AllocationCurrency?.mode||'KRW',money=n=>currency==='USD'?'$'+n.toLocaleString('en-US',{maximumFractionDigits:2}):Math.round(n).toLocaleString('ko-KR')+'원';const report=root.PerformanceEngine.report(session,currency);if(report.unavailable){target.textContent='당시 환율이 없어 달러 성과를 계산할 수 없습니다.';return;}if(!report.completed){target.textContent='최종 성과 보고서는 연습 종료 후 표시됩니다.';return;}
   target.innerHTML=`<h3>최종 시뮬레이션 보고서 (${currency})</h3><div class="table-wrap"><table><thead><tr><th>지표</th>${report.rows.map(r=>`<th>${r.label}</th>`).join('')}</tr></thead><tbody>${[
     ['최종 평가자산',r=>money(r.value)],['총 납입원금',r=>money(r.principal)],['총 손익',r=>money(r.profit)],['누적 수익률 (TWR)',r=>percent(r.twr)],['연환산 수익률 (TWR CAGR)',r=>percent(r.cagr)],['최대 낙폭 (월별 TWR)',r=>percent(r.mdd)],['납입 조정 고점 대비 최대 손실',r=>money(-r.maxDrawdownKRW)],['납입원금 대비 최대 평가손실',r=>money(-r.maxPrincipalLoss)],['연환산 변동성',r=>percent(r.volatility)],['최장 회복기간',r=>r.twr===null?'—':r.unrecoveredMonths?`미회복 ${r.unrecoveredMonths}개월 · 회복 완료 최장 ${r.recoveryMonths}개월`:`${r.recoveryMonths}개월`]
   ].map(([title,render])=>`<tr><th>${title}</th>${report.rows.map(r=>`<td>${render(r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p>월초 납입을 제거한 월별 수익률로 TWR·CAGR·MDD를 계산합니다. 변동성은 월수익률의 표본 표준편차 × √12입니다.</p><p>금액 손실은 납입금을 더해 조정한 이전 고점과 비교하며, 납입원금 대비 손실도 별도로 표시합니다. MDD에 최종 자산을 곱한 추정금액이 아닙니다.</p><p>월별 관측이므로 월중 급락은 반영되지 않습니다. 세금·수수료는 미반영입니다. 과거 연습 결과이며 미래 기대수익률이 아닙니다.</p>${report.benchmarkAvailable?'':'<p>개발자·S&P500 비교 이력이 없어 사용자 결과만 표시합니다.</p>'}`;
 };
})(globalThis);
