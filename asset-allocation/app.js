const $ = id => document.getElementById(id);
const assets = ['QQQ','BTC','GOLD','CASH'];
const labels = {QQQ:'QQQ',BTC:'Bitcoin',GOLD:'Gold',CASH:'Cash'};
const captions = {QQQ:'주식 환경',BTC:'비트코인 환경',GOLD:'금 환경',CASH:'현금 보유 환경'};
const factorLabels = {equity_trend:'나스닥100 추세',relative_equity:'미국 주식 상대강도',btc_trend:'비트코인 추세',gold_trend:'금 가격 추세',btc_gold:'비트코인 / 금',dollar:'달러인덱스 변화',nominal_yield:'명목 10년 금리 변화',liquidity:'연준 자산 변화'};
const colors = {QQQ:'#3264e8',BTC:'#e59932',GOLD:'#9b883f',CASH:'#758b9c'};
const won = value => Number(value).toLocaleString('ko-KR')+'원';
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
  return {portfolio:Object.fromEntries(assets.map((a,i)=>[a,values[i]])),remaining_monthly_investment_krw:values[4]};
}
function total() { const sum=assets.reduce((n,a)=>n+(Number($(a).value)||0),0); $('total').textContent=won(sum); }
function renderScores() {
  const result=current?.result;
  if (!result?.scores) { $('scores').innerHTML='<p>아직 계산 결과가 없습니다. 최신 자료로 다시 계산해 주세요.</p>'; $('factors').textContent='사용 가능한 Score가 없습니다.'; return; }
  $('scores').innerHTML=assets.map(a=>{
    const s=result.scores[a];
    return `<article class="score-card" style="--asset:${colors[a]}"><div class="card-top">${labels[a]}<span class="asset-caption">${captions[a]}</span></div><div class="score-number">${s.current_score.toFixed(1)} <small>/ 100</small></div><div class="score-state">${escape(s.recommendation)}</div><div class="deltas">${[['1d','1D'],['1w','1W'],['1m','1M']].map(([k,t])=>`<span>${t} <b>${s['score_'+k+'_change'] == null ? '—' : signed(s['score_'+k+'_change'])}</b></span>`).join('')}</div></article>`;
  }).join('');
  renderFactors();
}
function renderFactors() {
  const score=current?.result?.scores?.[selected]; if (!score) return;
  $('factors').innerHTML=`<div class="table-wrap"><table><thead><tr><th>관측 요인</th><th>기준 → 현재 가중치</th><th>전일 대비</th><th>Score 기여</th><th>데이터</th></tr></thead><tbody>${score.contributions.map(c=>`<tr><td class="factor-name">${escape(factorLabels[c.factor]||c.factor)}<span>${escape(c.factor)}</span></td><td>${percent(c.base_weight)} → <strong>${percent(c.weight)}</strong></td><td>${signed(c.weight_change*100)}%p</td><td class="points ${c.points>=0?'positive':'negative'}">${signed(c.points)}</td><td>${c.data_status==='ok'?'반영됨':escape(c.data_status)}</td></tr>`).join('')}</tbody></table></div><p class="small" style="text-align:left">설정된 지표 충족률 ${percent(score.data_coverage)} · 1D / 1W / 1M의 — 표시는 비교 이력이 아직 없다는 뜻입니다.</p>`;
}
function renderAllocation(allocation) {
  const n=allocation.remaining_monthly_investment_krw;
  $('allocation').classList.remove('pending');
  $('allocation').innerHTML=`<div class="allocation-total">${won(n)} <small>배분 합계</small></div><p class="muted">높은 Score와 현재 보유비중을 함께 반영한 제안입니다.</p><div class="stack" aria-label="자산별 추천 배분">${assets.map(a=>`<span style="width:${allocation.assets[a].suggested_weight*100}%;background:${colors[a]}" title="${labels[a]} ${percent(allocation.assets[a].suggested_weight)}"></span>`).join('')}</div>${assets.map(a=>{const x=allocation.assets[a];return `<div class="buy-row"><div class="buy-label"><i class="dot" style="background:${colors[a]}"></i>${labels[a]}</div><div class="buy-meta">현재 ${percent(x.current_weight)} → 투자 후 ${percent(x.projected_weight)}<br>${x.constraint_active?'월 배분 한도 적용':'월 배분 범위 '+percent(x.lower_bound)+'~'+percent(x.upper_bound)}</div><div class="buy-value">${won(x.amount_krw)}<small>신규자금의 ${percent(x.suggested_weight)}</small></div></div>`;}).join('')}${allocation.fallback_due_to_data?'<p class="fallback">데이터가 부족해 Score 조정을 중지했습니다. 기본배분과 보유비중만 반영했습니다.</p>':''}`;
}
async function load(initial=false) {
  const next=await api('state'); const changed=current?.result?.generated_at!==next.result?.generated_at;
  current=next;
  $('basis').textContent=next.result?.market_date?`시장 기준 ${next.result.market_date} · ${next.result.regime==='risk_off'?'위험회피 환경':'일반 환경'} · 30초마다 갱신 확인`:'아직 계산된 시장 데이터가 없습니다.';
  if (changed || initial) {
    renderScores();
    $('warnings').innerHTML=(next.result?.warnings||[]).map(w=>`<li>${escape(w)}</li>`).join('');
    if (next.stale || next.result?.status==='error') {
      message('현재 결과가 오래되었거나 갱신에 실패했습니다. 인스타 데이터 상태를 확인해 주세요.',true);
      $('allocation').innerHTML='<div class="empty"><h3>최신 결과가 필요합니다.</h3><p>데이터 갱신 후 다시 계산해 주세요.</p></div>';
    } else if (changed && !initial) {
      $('allocation').classList.add('pending');
      message('새로운 시장 결과를 불러왔습니다. 현재 입력값으로 추천 배분을 다시 계산해 주세요.');
    }
  }
  if (initial && next.portfolio) {
    for (const a of assets) $(a).value=next.portfolio.portfolio[a];
    $('budget').value=next.portfolio.remaining_monthly_investment_krw;
    total();
    if (!next.stale && next.result?.scores) renderAllocation((await api('simulate',inputValues())).allocation);
    $('save-note').textContent='저장된 입력값을 불러왔습니다.';
  }
}
async function action(fn) {
  if (busy) return;
  busy=true; document.querySelectorAll('#portfolio-form button,#refresh').forEach(b=>b.disabled=true);
  try { await fn(); } catch(e) { message(e.message,true); }
  finally {busy=false;document.querySelectorAll('#portfolio-form button,#refresh').forEach(b=>b.disabled=false);}
}
$('portfolio-form').addEventListener('submit',e=>{e.preventDefault();action(async()=>{const r=await api('simulate',inputValues());renderAllocation(r.allocation);message('현재 입력값으로 계산했습니다. 저장하면 다음 접속 때 다시 불러옵니다.');});});
$('portfolio-form').addEventListener('input',()=>{dirty=true;total();$('allocation').classList.add('pending');$('save-note').textContent='입력값이 변경되었습니다. 계산 후 저장해 주세요.';message('입력값이 바뀌었습니다. 추천 배분 계산을 눌러 반영해 주세요.');});
$('save').addEventListener('click',()=>action(async()=>{if(!$('portfolio-form').reportValidity())return;const r=await api('save',inputValues());renderAllocation(r.allocation);dirty=false;$('save-note').textContent='이 브라우저에 저장됨';message('보유자산과 남은 투자금을 저장했습니다.');}));
$('refresh').addEventListener('click',()=>action(async()=>{message('게시된 최신 시장 데이터를 불러오고 있습니다.');await api('refresh',{});await load();message('게시된 Score를 불러왔습니다. 현재 입력값으로 추천 배분을 계산할 수 있습니다.');}));
document.querySelectorAll('[data-asset]').forEach(button=>button.addEventListener('click',()=>{selected=button.dataset.asset;document.querySelectorAll('[data-asset]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));renderFactors();}));
load(true).catch(e=>message(e.message,true));
setInterval(()=>{if(!busy)load().catch(()=>message('자료를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.',true));},30000);
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
// Same calculation action as the visible form; no saving or account side effects.
if(document.modelContext?.registerTool){
  const lifetime=new AbortController();
  Promise.resolve(document.modelContext.registerTool({name:'preview_asset_allocation',title:'자산배분 미리 계산',description:'보유 평가액과 남은 월 투자금을 화면에 입력하고 배분을 계산합니다. 저장하지 않습니다.',inputSchema:{type:'object',properties:{portfolio:{type:'object',properties:Object.fromEntries(assets.map(a=>[a,{type:'integer',minimum:0,maximum:1e15}])),required:assets,additionalProperties:false},remaining_monthly_investment_krw:{type:'integer',minimum:0,maximum:1e15}},required:['portfolio','remaining_monthly_investment_krw'],additionalProperties:false},annotations:{readOnlyHint:false},execute:async input=>{if(busy)throw new Error('다른 계산이 진행 중입니다.');const r=await api('simulate',input);for(const a of assets)$(a).value=input.portfolio[a];$('budget').value=input.remaining_monthly_investment_krw;total();dirty=true;renderAllocation(r.allocation);return r.allocation;}},{signal:lifetime.signal})).catch(()=>{});
  window.addEventListener('pagehide',()=>lifetime.abort(),{once:true});
}
