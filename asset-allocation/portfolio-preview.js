(function(){
 const host=document.getElementById('trade-preview-section');if(!host)return;
 const names={QQQ:'주식',GOLD:'금',BTC:'비트코인',CASH:'현금·단기채'};
 const fmt=n=>AllocationCurrency.money(n),pct=n=>(n*100).toFixed(1)+'%';
 host.innerHTML=`<h2>매수·매도 전 포트폴리오 미리보기</h2><p class="muted">위에 입력한 현재 평가액과 이번 달 남은 투자금을 사용합니다. 매도대금도 매수에 사용할 수 있습니다.</p><p><button id="trade-use-allocation" class="secondary" type="button" disabled>추천 배분을 미리보기에 불러오기</button> <button id="trade-clear" class="secondary" type="button">거래 입력 초기화</button></p><p id="trade-allocation-note" class="muted">위에서 추천 배분을 계산하면 불러올 수 있습니다.</p><form id="trade-preview-form"><div class="table-wrap"><table><thead><tr><th>자산</th><th>매수금액 (원)</th><th>매도 방식</th><th>매도 입력</th></tr></thead><tbody>${['QQQ','GOLD','BTC'].map(a=>`<tr><th>${names[a]}</th><td><input aria-label="${names[a]} 매수금액" id="trade-buy-${a}" type="number" min="0" max="1000000000000000" step="1" value="0" required></td><td><select aria-label="${names[a]} 매도 방식" id="trade-mode-${a}"><option value="amount">금액 (원)</option><option value="percent">보유액 비율 (%)</option></select></td><td><input aria-label="${names[a]} 매도금액 또는 비율" id="trade-sell-${a}" type="number" min="0" max="1000000000000000" step="1" value="0" required></td></tr>`).join('')}</tbody></table></div><p class="small" style="text-align:left">매도 비율은 현재 보유 평가액 기준입니다. 비율 계산 결과는 원 미만을 버립니다. 거래비용·세금·가격변동은 포함하지 않습니다.</p><button class="secondary" type="submit">변경 전후 미리보기</button></form><div id="trade-preview-result" aria-live="polite"></div><p class="muted">가상 미리보기입니다. 실제 주문·보유액 저장·월 투자금 차감은 실행하지 않습니다.</p>`;
 const output=document.getElementById('trade-preview-result');
 let recommendation=null;
 const use=document.getElementById('trade-use-allocation'),note=document.getElementById('trade-allocation-note');
 function clear(){for(const a of ['QQQ','GOLD','BTC']){document.getElementById('trade-buy-'+a).value='0';document.getElementById('trade-sell-'+a).value='0';}invalidate();}
 function revoke(){recommendation=null;use.disabled=true;note.textContent='입력 또는 시장 자료가 바뀌면 추천 배분을 다시 계산해 주세요.';}
 window.addEventListener('allocationinvalidated',revoke);
 window.addEventListener('portfolioinputchanged',()=>{revoke();invalidate();});
 window.addEventListener('allocationcalculated',e=>{recommendation=JSON.parse(JSON.stringify(e.detail));use.disabled=false;note.textContent='계산된 신규자금 배분을 불러옵니다. 기존 거래 입력은 교체되고 현금 배분은 현금으로 남습니다.';});
 document.getElementById('trade-clear').onclick=clear;
 use.onclick=()=>{
   if(!recommendation)return;
   const {input,allocation}=recommendation;
   if(PortfolioEngine.ASSETS.some(a=>Number(document.getElementById(a).value)!==input.portfolio[a])||Number(document.getElementById('budget').value)!==input.remaining_monthly_investment_krw){revoke();invalidate();return;}
   clear();for(const a of ['QQQ','GOLD','BTC'])document.getElementById('trade-buy-'+a).value=allocation.assets[a].amount_krw;
   document.getElementById('trade-preview-form').requestSubmit();
 };

 for(const a of ['QQQ','GOLD','BTC'])document.getElementById('trade-mode-'+a).addEventListener('change',()=>{const p=document.getElementById('trade-mode-'+a).value==='percent',input=document.getElementById('trade-sell-'+a);input.max=p?'100':'1000000000000000';input.step=p?'0.1':'1';input.value='0';invalidate();});
 function invalidate(){output.textContent='입력값이 바뀌었습니다. 변경 전후 미리보기를 다시 눌러 주세요.';}
 host.querySelector('form').addEventListener('input',invalidate);
 document.getElementById('portfolio-form').addEventListener('input',invalidate);
 document.getElementById('trade-preview-form').addEventListener('submit',event=>{
   event.preventDefault();try{
     const read=id=>{const element=document.getElementById(id);if(!element.value.trim())throw Error('현재 자산과 남은 월 투자금을 모두 입력해 주세요. 미보유 자산은 0을 입력하세요.');return Number(element.value);};
     const before=Object.fromEntries(PortfolioEngine.ASSETS.map(a=>[a,read(a)]));
     const orders=['QQQ','GOLD','BTC'].map(a=>({asset:a,buyAmount:read('trade-buy-'+a),[document.getElementById('trade-mode-'+a).value==='percent'?'sellPercent':'sellAmount']:read('trade-sell-'+a)}));
     const r=PortfolioEngine.preview(before,read('budget'),orders);
     output.innerHTML=`<p>현재 자산 <strong>${fmt(r.totalBefore)}</strong> + 신규자금 <strong>${fmt(r.contribution)}</strong> = 변경 후 <strong>${fmt(r.totalAfter)}</strong></p><p>납입·매도 후 매수 가능 현금 ${fmt(r.cashAvailable)} · 매수 후 현금 ${fmt(r.after.CASH)}</p><div class="table-wrap"><table><thead><tr><th>자산</th><th>변경 전</th><th>변경 후</th><th>비중 변화</th></tr></thead><tbody>${PortfolioEngine.ASSETS.map(a=>`<tr><th>${names[a]}</th><td>${fmt(r.before[a])}</td><td>${fmt(r.after[a])}</td><td>${pct(r.weightsBefore[a])} → ${pct(r.weightsAfter[a])}</td></tr>`).join('')}</tbody></table></div><ul>${r.notes.map(n=>`<li>${n}</li>`).join('')}</ul>`;
   }catch(error){output.textContent=error.message;}
 });
})();
