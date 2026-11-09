(function () {
  'use strict';
  const assets = [['QQQ','미국 주식','#3264e8'],['BTC','비트코인','#e9952c'],['GOLD','금','#a48c39'],['CASH','현금','#768b9d']];
  const money = n => Math.round(n).toLocaleString('ko-KR') + '원';
  const percent = n => (n * 100).toFixed(1) + '%';
  const delta = n => (n > 0.0005 ? '+' : n < -0.0005 ? '−' : '') + Math.abs(n * 100).toFixed(1) + '%p';
  function render(r) {
    const host = document.getElementById('allocation');
    if (!host || !r?.before || !r?.after) return;
    const before = assets.map(([k]) => Number(r.before[k]));
    const after = assets.map(([k]) => Number(r.after[k]));
    if ([...before,...after].some(n=>!Number.isFinite(n)||n<0)) return;
    const bt=before.reduce((a,b)=>a+b,0), at=after.reduce((a,b)=>a+b,0);
    const bw=before.map(n=>bt?n/bt:0), aw=after.map(n=>at?n/at:0);
    function circle(ws,total,label) {
      let offset=0;
      const stops=ws.map((w,i)=>{const begin=offset;offset+=w*100;return assets[i][2]+' '+begin.toFixed(5)+'% '+offset.toFixed(5)+'%';}).join(',');
      const bg=total>0?'conic-gradient('+stops+')':'#e5ebf2';
      const alt=assets.map((a,i)=>a[1]+' '+(total?percent(ws[i]):'—')).join(', ');
      return `<div class="rebalance-chart-side"><strong>${label}</strong><div class="rebalance-donut" role="img" aria-label="${label}: ${alt}" style="background:${bg}"><div><span>총자산</span><b>${money(total)}</b></div></div></div>`;
    }
    const section=document.createElement('section');
    section.id='rebalance-charts';
    section.setAttribute('aria-label','재배분 전후 자산 비중');
    section.innerHTML=`<style>
      #rebalance-charts{margin:16px 0 20px;padding:16px;border:1px solid #dce5f1;border-radius:12px;background:#f7f9fc}
      .rebalance-chart-pair{display:flex;justify-content:center;align-items:start;gap:clamp(20px,7vw,76px);flex-wrap:wrap}
      .rebalance-chart-side{text-align:center;color:#17334e;font-size:14px}
      .rebalance-donut{width:150px;height:150px;border-radius:50%;display:grid;place-items:center;margin:9px auto}
      .rebalance-donut>div{width:98px;height:98px;border-radius:50%;background:#f7f9fc;display:flex;flex-direction:column;justify-content:center;align-items:center}
      .rebalance-donut span{font-size:11px;color:#667d91}.rebalance-donut b{font-size:12px;color:#102a43}
      .rebalance-chart-table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}
      .rebalance-chart-table th,.rebalance-chart-table td{padding:7px 4px;text-align:right;border-top:1px solid #e1e9f1}
      .rebalance-chart-table th:first-child{text-align:left}.rebalance-chart-note{font-size:12px;color:#667d91;margin:10px 0 0}
      @media(max-width:500px){.rebalance-donut{width:116px;height:116px}.rebalance-donut>div{width:78px;height:78px}.rebalance-donut b{font-size:10px}.rebalance-chart-pair{gap:14px}.rebalance-chart-table{font-size:12px}}
    </style><h4 style="margin:0 0 12px">재배분 전후 비중</h4>
      <div class="rebalance-chart-pair">${circle(bw,bt,'재배분 전')}${circle(aw,at,'재배분 후')}</div>
      <table class="rebalance-chart-table"><thead><tr><th>자산</th><th>전</th><th>후</th><th>변화</th></tr></thead><tbody>
      ${assets.map((a,i)=>`<tr><th><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${a[2]};margin-right:6px"></span>${a[1]}</th><td>${bt?percent(bw[i]):'—'}</td><td>${at?percent(aw[i]):'—'}</td><td>${bt&&at?delta(aw[i]-bw[i]):'—'}</td></tr>`).join('')}</tbody></table>
      <p class="rebalance-chart-note">재배분 전은 신규 납입금을 현금에 포함한 기준입니다. 재배분 후 총액에는 예상 거래비용이 반영됩니다. 변화는 비중 차이(%p)입니다.</p>`;
    const old=document.getElementById('rebalance-charts');if(old)old.remove();
    const firstRow=host.querySelector('.buy-row');
    if(firstRow)firstRow.before(section);else host.append(section);
  }
  window.addEventListener('allocationcalculated', event => render(event.detail?.rebalance));
  window.addEventListener('portfolioinputchanged', () => document.getElementById('rebalance-charts')?.remove());
})();
