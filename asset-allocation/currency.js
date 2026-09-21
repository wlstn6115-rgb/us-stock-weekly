(function(root){
  'use strict';
  let mode='KRW',latest=null;
  const valid=n=>Number.isFinite(n)&&n>0;
  function format(n,fx){if(!Number.isFinite(n))return '—';return mode==='USD'?(valid(fx)?'$'+(n/fx).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'환율 미확보'):Math.round(n).toLocaleString('ko-KR')+'원';}
  function money(n,fx,usd){const value=Number(n);if(!Number.isFinite(value))return '—';return `<span data-money="${value}" ${Number.isFinite(usd)?`data-usd="${usd}"`:''} data-fx="${fx===undefined?'latest':valid(fx)?fx:'unavailable'}">${mode==='USD'&&Number.isFinite(usd)?format(usd,1):format(value,fx===undefined?latest?.value:fx)}</span>`;}
  function repaint(){document.querySelectorAll('[data-money]').forEach(e=>{e.textContent=mode==='USD'&&e.hasAttribute('data-usd')?format(Number(e.dataset.usd),1):format(Number(e.dataset.money),e.dataset.fx==='latest'?latest?.value:Number(e.dataset.fx));});}
  root.AllocationCurrency={money,format,get mode(){return mode;},get fx(){return latest;}};
  const select=document.getElementById('display-currency'),note=document.getElementById('currency-note');
  if(!select)return;
  try{mode=localStorage.getItem('allocation-display-currency')==='USD'?'USD':'KRW';}catch{}
  select.value=mode;
  select.onchange=()=>{mode=select.value;try{localStorage.setItem('allocation-display-currency',mode);}catch{}repaint();root.dispatchEvent(new Event('currencychange'));};
  async function refresh(){try{const fx=await root.AllocationData.get().getFX();const age=Date.now()-Date.parse(fx.date+'T00:00:00Z');if(age>8*86400000||age<0)throw Error('최근 환율 갱신 필요');latest=fx;note.textContent=`현재 화면 환산: 1 USD = ${fx.value.toLocaleString('ko-KR')}원 (${fx.observedAt?new Date(fx.observedAt).toLocaleString('ko-KR'):fx.date} 관측 · ${new Date().toLocaleTimeString('ko-KR')} 확인). 매시간 수집 / 화면 5분마다 확인. 휴장 시 마지막 관측값 유지. 입력은 원화, 시뮬레이션은 당시 환율을 사용합니다.`;}catch(e){latest=null;note.textContent='현재 자산 달러 환산: '+e.message+' · 원화 입력과 과거 환율 계산은 유지됩니다.';}repaint();}
  root.addEventListener('focus',refresh);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});refresh();setInterval(refresh,300000);
})(globalThis);
