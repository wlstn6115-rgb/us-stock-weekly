const $ = id => document.getElementById(id);
const assets = ['QQQ','BTC','GOLD','CASH'];
const labels = {QQQ:'주식',BTC:'비트코인',GOLD:'금',CASH:'현금·단기채'};
const captions = {QQQ:'주식 환경',BTC:'비트코인 환경',GOLD:'금 환경',CASH:'현금 보유 환경'};
const factorLabels = {equity_trend:'나스닥100 추세',relative_equity:'미국 주식 상대강도',btc_trend:'비트코인 추세',gold_trend:'금 가격 추세',btc_gold:'비트코인 / 금',dollar:'달러인덱스 변화',nominal_yield:'명목 10년 금리 변화',liquidity:'연준 자산 변화'};
const colors = {QQQ:'#3264e8',BTC:'#e59932',GOLD:'#9b883f',CASH:'#758b9c'};
const won = value => AllocationCurrency.money(Number(value));
const percent = value => (value*100).toFixed(1)+'%';
const signed = value => (value >= 0 ? '+' : '')+value.toFixed(2);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let current = null, selected = 'QQQ', dirty = false, busy = false;
function message(text, error=false) { $('message').textContent=text; $('message').className=error?'error':''; $('message').hidden=!text; }
async function api(path,data) { return pagesApi(path,data); }

function inputValues() {
  const values = [...assets,'budget'].map(id => {
    if ($(id).value.trim()==='') throw new Error('모든 금액을 입력해 주세요. 보유하지 않은 자산은 0을 입력하세요.');
    const value = Number($(id).value);
    if (!Number.isSafeInteger(value) || value < 0 || value > 1e15) throw new Error('금액은 0 이상 1,000조 원 이하의 정수여야 합니다.');
    return value;
  });
  const counts=Object.fromEntries(['QQQ','BTC','GOLD'].map(a=>{const field=$('sold-'+a),raw=field.value.trim();if(!raw)return [a,null];const n=Number(raw);if(!Number.isInteger(n)||n<0||n>3)throw new Error('분할매도 실행 횟수는 0~3으로 입력하세요.');return [a,n];}));
  return {portfolio:Object.fromEntries(assets.map((a,i)=>[a,values[i]])),remaining_monthly_investment_krw:values[4],policy_state:{policy_version:current?.allocation_policy?.id||null,defensive_sales_completed:counts}};
}
function invalidateAllocation() {
  window.dispatchEvent(new Event('allocationinvalidated'));
  $('allocation').classList.add('pending');
}
function total() {
  try {
    const x=inputValues(),sum=Object.values(x.portfolio).reduce((a,b)=>a+b,0);
    $('total').innerHTML=won(sum);
    $('holding-weights').textContent=assets.map(a=>labels[a]+' '+(sum?percent(x.portfolio[a]/sum):'—')).join(' · ');
    $('portfolio-summary').innerHTML=`<p>현재 총 투자자산 <strong>${won(sum)}</strong> · 이번 달 남은 투자금 <strong>${won(x.remaining_monthly_investment_krw)}</strong></p><p class="muted">보유액 합계로 계산합니다. 남은 투자금은 위 보유 현금에 아직 포함하지 않은 신규자금입니다.</p>`;
  } catch {
    $('total').textContent='—';$('holding-weights').textContent='모든 금액을 올바르게 입력하면 비중을 표시합니다.';
    $('portfolio-summary').textContent='현재 보유액과 이번 달 남은 투자금을 입력하세요. 미보유 자산은 0을 입력하세요.';
  }
  window.dispatchEvent(new Event('portfolioinputchanged'));
}
async function calculate(path='simulate') {
  invalidateAllocation();
  const input=inputValues(),fingerprint=JSON.stringify(input);
  const r=await api(path,input);
  let unchanged=false;try{unchanged=JSON.stringify(inputValues())===fingerprint;}catch{}
  if(!unchanged){invalidateAllocation();message('계산 중 입력값이 바뀌었습니다. 현재 입력으로 다시 계산해 주세요.');return false;}
  if(!r.scoreState&&r.allocation?.score_context)r.scoreState={...current,result:{...current?.result,...r.allocation.score_context}};
  if(r.scoreState){current=r.scoreState;renderScores();$('basis').textContent=`시장 기준 ${current.result.market_date} · 모델 ${AllocationModels.modelLabel(current.result.config_hash)} · 투자현황과 동일 Score`; }
  renderAllocation(r.allocation);
  window.dispatchEvent(new CustomEvent('allocationcalculated',{detail:{input,allocation:r.allocation}}));
  return true;
}

function renderScores() {
  const result=current?.result;
  if (!result?.scores) { $('scores').innerHTML='<p>아직 계산 결과가 없습니다. 최신 자료로 다시 계산해 주세요.</p>'; $('factors').textContent='사용 가능한 Score가 없습니다.'; return; }
  $('scores').innerHTML=assets.map(a=>{
    const s=result.scores[a];
    return `<article class="score-card" style="--asset:${colors[a]}"><div class="card-top">${labels[a]}<span class="asset-caption">${captions[a]}</span></div><div class="score-number">${s.current_score.toFixed(1)} <small>/ 100</small></div><div id="score-chart-${a}" class="score-mini-chart"></div><div class="score-state">${!s.usable?'데이터 부족':s.current_score<40?'부담':s.current_score<60?'중립':s.current_score<80?'우호':'매우 우호'}</div>${!s.usable?`<p class="small">유효 데이터 ${(s.data_coverage*100).toFixed(1)}% / 기준 ${((result.minimum_score_coverage??0.7)*100).toFixed(0)}%<br>${s.contributions.filter(c=>c.data_status!=='ok').map(c=>escape(factorLabels[c.factor]||c.factor)+': '+escape(({stale:'관측이 오래됨',missing:'자료 없음',warmup:'비교 이력 부족',zero_variance:'과거 변동 없음',nonpositive_price:'가격값 오류'})[c.data_status]||c.data_status)+((c.latest_observation||result.factors?.[c.factor]?.latest_observation)?' ('+escape((c.latest_observation||result.factors?.[c.factor]?.latest_observation))+')':'')).join('<br>')}</p>`:''}<div class="deltas">${[['1d','1D'],['1w','1W'],['1m','1M']].map(([k,t])=>`<span>${t} <b>${s['score_'+k+'_change'] == null ? '—' : (s['score_'+k+'_change']>0?'▲ ':s['score_'+k+'_change']<0?'▼ ':'→ ')+signed(s['score_'+k+'_change'])}</b></span>`).join('')}</div></article>`;
  }).join('');
  renderFactors();
  window.dispatchEvent(new Event('scorecardsrendered'));
}
function renderFactors() {
  const score=current?.result?.scores?.[selected]; if (!score) return;
  const top=(score.contributions||[]).filter(c=>c.data_status==='ok'&&Number.isFinite(c.points)&&c.points!==0).sort((a,b)=>Math.abs(b.points)-Math.abs(a.points)).slice(0,5);
  $('factors').innerHTML=`<ul class="factor-summary">${top.map(c=>`<li><strong>${escape(factorLabels[c.factor]||c.factor)}</strong> · ${c.points>0?'우호':'부담'} 기여 ${signed(c.points)}점</li>`).join('')||'<li>설명할 수 있는 유효 기여요인이 없습니다.</li>'}</ul><p class="muted">실질금리 · VIX · HY spread · 선행 PER: 데이터 연동 예정</p><div class="table-wrap"><table><thead><tr><th>관측 요인</th><th>기준 → 현재 가중치</th><th>전일 대비</th><th>Score 기여</th><th>데이터</th></tr></thead><tbody>${score.contributions.map(c=>`<tr><td class="factor-name">${escape(factorLabels[c.factor]||c.factor)}<span>${escape(c.factor)}</span></td><td>${percent(c.base_weight)} → <strong>${percent(c.weight)}</strong></td><td>${signed(c.weight_change*100)}%p</td><td class="points ${c.points>=0?'positive':'negative'}">${signed(c.points)}</td><td>${c.data_status==='ok'?'반영됨':escape(c.data_status)}</td></tr>`).join('')}</tbody></table></div><p class="small" style="text-align:left">설정된 지표 충족률 ${percent(score.data_coverage)} · 1D / 1W / 1M의 — 표시는 비교 이력이 아직 없다는 뜻입니다.</p>`;
}
function renderAllocation(allocation) {
  const n=allocation.remaining_monthly_investment_krw;
  $('allocation').classList.remove('pending');
  $('allocation').innerHTML=`<div class="allocation-total">${won(n)} <small>배분 합계</small></div><p class="muted">메인 Score → 보유비중 조정 → 제한된 신규 투자금 배분</p>${allocation.score_context?`<p class="small">기준 ${escape(allocation.score_context.market_date)} · 모델 ${escape(AllocationModels.modelLabel(allocation.score_context.config_hash))} · ${assets.map(a=>labels[a]+' '+allocation.score_context.scores[a].current_score.toFixed(1)).join(' / ')}</p>`:''}<div class="stack" aria-label="자산별 추천 배분">${assets.map(a=>`<span style="width:${allocation.assets[a].suggested_weight*100}%;background:${colors[a]}" title="${labels[a]} ${percent(allocation.assets[a].suggested_weight)}"></span>`).join('')}</div>${assets.map(a=>{const x=allocation.assets[a];return `<div class="buy-row"><div class="buy-label"><i class="dot" style="background:${colors[a]}"></i>${labels[a]}</div><div class="buy-meta">현재 ${percent(x.current_weight)} → 투자 후 ${percent(x.projected_weight)}<br>${(x.reasons||[]).map(escape).join('<br>')}<br>${x.constraint_active?'월 배분 한도 적용':'월 배분 범위 '+percent(x.lower_bound)+'~'+percent(x.upper_bound)}</div><div class="buy-value">${won(x.amount_krw)}<small>신규자금의 ${percent(x.suggested_weight)}</small></div></div>`;}).join('')}${allocation.cash_shortfall_after_krw>0?`<p class="fallback">이번 달 투자금을 반영해도 현금이 ${won(allocation.cash_shortfall_after_krw)} 부족합니다. 다음 달에도 현금 확보가 필요합니다.</p>`:''}${allocation.fallback_due_to_data?'<p class="fallback">데이터가 부족해 Score 조정을 중지했습니다. 기본배분과 보유비중만 반영했습니다.</p>':''}`;
  const policy=allocation.policy_context||{},actions=allocation.policy_actions||{};
  for(const a of actions.reset_counts||[]){const field=$('sold-'+a);if(field)field.value='0';}
  $('allocation-policy-tag').textContent=policy.status==='active'?policy.label:'기존 배분 · 정책 미등록';
  if(policy.status!=='active'){$('allocation').insertAdjacentHTML('beforeend','<p class="fallback">이 Score 버전에는 새 매도·재진입 규칙이 등록되지 않았습니다. 기존 신규자금 배분만 표시합니다.</p>');return;}
  const sells=Object.entries(actions.sells||{}).map(([a,x])=>`<li>${labels[a]} ${won(x.amount_krw)} ${x.kind==='defensive'?`방어 매도 검토 · 보유액의 5% · 이번 약세 구간 실행 ${x.completed_in_cycle}/3회`:'비중 초과분 완만한 매도 검토'}</li>`);
  const recoveries=Object.entries(actions.reentry_buys||{}).map(([a,value])=>`<li>${labels[a]} ${won(value)} · 기존 투자용 현금에서 추가매수 검토</li>`);
  const unknown=Object.entries(actions.statuses||{}).filter(([,status])=>status==='sale_history_required').map(([a])=>labels[a]);
  const limited=Object.entries(actions.statuses||{}).filter(([,status])=>status==='sale_limit_reached').map(([a])=>labels[a]);
  const missing=Object.entries(actions.statuses||{}).filter(([,status])=>status==='score_or_1m_unavailable').map(([a])=>labels[a]);
  const reset=(actions.reset_counts||[]).map(a=>labels[a]);
  $('allocation').insertAdjacentHTML('beforeend',`<div class="policy-advice"><div class="policy-context"><strong>${escape(policy.label)}</strong> · 정책 ${escape(policy.id)}<br>Score 모델 ${escape(policy.score_model_version||'미확인')} · 현금 바닥 ${percent(policy.cash_floor)} · BTC 매수중단 ${percent(policy.stop_buy_weight.BTC)} (소프트 캡)</div><h3>기존 자산·투자용 현금의 선택적 조정</h3>${sells.length?`<p>매도 검토</p><ul>${sells.join('')}</ul>`:''}${recoveries.length?`<p>회복 시 추가매수 검토</p><ul>${recoveries.join('')}</ul>`:''}${!sells.length&&!recoveries.length?'<p class="muted">현재 계산 가능한 추가 매도·재진입 검토안은 없습니다.</p>':''}${reset.length?`<p class="small">${reset.join('·')}: Score 55점 이상으로 분할매도 횟수를 0회로 초기화했습니다.</p>`:''}${unknown.length?`<p class="fallback">${unknown.join('·')}의 지난 분할매도 실행 횟수를 입력해야 3회 제한을 적용한 매도금액을 볼 수 있습니다. 신규매수는 일단 보류합니다.</p>`:''}${limited.length?`<p class="small">${limited.join('·')}: 이번 약세 구간의 3회 한도에 도달했습니다.</p>`:''}${missing.length?`<p class="small">${missing.join('·')}: 1개월 Score 변화 또는 유효 Score가 없어 방어·회복 신호를 보류합니다. 비중 초과 검토는 별개입니다.</p>`:''}<p class="policy-caution">이 규칙은 사후 재구성 Score의 탐색 결과입니다. 매매는 자동 실행되지 않으며 비용·세금·환전 차이는 이 금액에 포함되지 않습니다. 부동산 자금은 별도 원화로 확보하세요.</p></div>`);
}
async function load(initial=false) {
  const next=await api('state'); const changed=current?.result?.generated_at!==next.result?.generated_at;
  const policyChanged=!!current&&current.allocation_policy?.id!==next.allocation_policy?.id;
  current=next;
  if(policyChanged){for(const a of ['QQQ','BTC','GOLD'])$('sold-'+a).value='';invalidateAllocation();message('Score 모델에 연결된 추천 규칙이 바뀌었습니다. 분할매도 실행 횟수를 확인하고 다시 계산해 주세요.');}
  if(next.storageError)message(next.storageError,true);
  $('basis').textContent=next.result?.market_date?`시장 기준 ${next.result.market_date} · ${next.result.regime==='risk_off'?'위험회피 환경':'일반 환경'} · 갱신 ${next.result.generated_at||'미제공'} · 모델 ${AllocationModels.modelLabel(next.result.model_version||next.result.config_hash)} · 30초마다 갱신 확인`:'아직 계산된 시장 데이터가 없습니다.';
  if (changed || initial) {
    renderScores();
    $('warnings').innerHTML=(next.result?.warnings||[]).map(w=>`<li>${escape(w)}</li>`).join('');
    if (next.stale || next.result?.status==='error') {
      invalidateAllocation();
      message('현재 결과가 오래되었거나 갱신에 실패했습니다. 인스타 데이터 상태를 확인해 주세요.',true);
      $('allocation').innerHTML='<div class="empty"><h3>최신 결과가 필요합니다.</h3><p>데이터 갱신 후 다시 계산해 주세요.</p></div>';
    } else if (changed && !initial) {
      invalidateAllocation();
      message('새로운 시장 결과를 불러왔습니다. 현재 입력값으로 추천 배분을 다시 계산해 주세요.');
    }
  }
  if (initial && next.portfolio && !dirty) {
    for (const a of assets) $(a).value=next.portfolio.portfolio[a];
    $('budget').value=next.portfolio.remaining_monthly_investment_krw;
    for(const a of ['QQQ','BTC','GOLD'])$('sold-'+a).value=next.portfolio.policy_state?.policy_version===next.allocation_policy?.id?(next.portfolio.policy_state.defensive_sales_completed?.[a]??''):'';
    total();
    if (!next.stale && next.result?.scores) await calculate();
    $('save-note').textContent='저장된 입력값을 불러왔습니다.';
  }
}
async function action(fn) {
  if (busy) return;
  busy=true; document.querySelectorAll('#portfolio-form button,#refresh').forEach(b=>b.disabled=true);
  try { await fn(); } catch(e) { message(e.message,true); }
  finally {busy=false;document.querySelectorAll('#portfolio-form button,#refresh').forEach(b=>b.disabled=false);}
}
$('portfolio-form').addEventListener('submit',e=>{e.preventDefault();action(async()=>{if(!await calculate())return;message('현재 입력값으로 계산했습니다. 저장하면 다음 접속 때 다시 불러옵니다.');});});
$('portfolio-form').addEventListener('input',()=>{dirty=true;total();invalidateAllocation();$('save-note').textContent='입력값이 변경되었습니다. 계산 후 저장해 주세요.';message('입력값이 바뀌었습니다. 추천 배분 계산을 눌러 반영해 주세요.');});
$('save').addEventListener('click',()=>action(async()=>{if(!$('portfolio-form').reportValidity())return;if(!await calculate('save'))return;dirty=false;$('save-note').textContent='이 브라우저에 저장됨';message('보유자산과 남은 투자금을 저장했습니다.');}));
$('refresh').addEventListener('click',()=>action(async()=>{message('게시된 최신 시장 데이터를 불러오고 있습니다.');await api('refresh',{});await load();message('게시된 Score를 불러왔습니다. 현재 입력값으로 추천 배분을 계산할 수 있습니다.');}));
document.querySelectorAll('[data-asset]').forEach(button=>button.addEventListener('click',()=>{selected=button.dataset.asset;document.querySelectorAll('[data-asset]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));renderFactors();}));
total();
load(true).catch(e=>message(e.message,true));
setInterval(()=>{if(!busy)load().catch(()=>message('자료를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.',true));},30000);
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
// Same calculation action as the visible form; no saving or account side effects.
if(document.modelContext?.registerTool){
  const lifetime=new AbortController();
  Promise.resolve(document.modelContext.registerTool({name:'preview_asset_allocation',title:'자산배분 미리 계산',description:'보유 평가액과 남은 월 투자금을 화면에 입력하고 배분을 계산합니다. 저장하지 않습니다.',inputSchema:{type:'object',properties:{portfolio:{type:'object',properties:Object.fromEntries(assets.map(a=>[a,{type:'integer',minimum:0,maximum:1e15}])),required:assets,additionalProperties:false},remaining_monthly_investment_krw:{type:'integer',minimum:0,maximum:1e15}},required:['portfolio','remaining_monthly_investment_krw'],additionalProperties:false},annotations:{readOnlyHint:false},execute:async input=>{if(busy)throw new Error('다른 계산이 진행 중입니다.');const r=await api('simulate',input);for(const a of assets)$(a).value=input.portfolio[a];$('budget').value=input.remaining_monthly_investment_krw;total();dirty=true;renderAllocation(r.allocation);window.dispatchEvent(new CustomEvent('allocationcalculated',{detail:{input,allocation:r.allocation}}));return r.allocation;}},{signal:lifetime.signal})).catch(()=>{});
  window.addEventListener('pagehide',()=>lifetime.abort(),{once:true});
}
