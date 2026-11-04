(function () {
  'use strict';
  const scores = document.getElementById('scores');
  if (!scores) return;
  const host = document.createElement('section');
  host.className = 'panel factors-panel';
  host.id = 'v2-tracking';
  scores.insertAdjacentElement('afterend', host);
  const money = x => Math.round(x).toLocaleString('ko-KR') + '원';
  const pct = x => (x >= 0 ? '+' : '') + (x * 100).toFixed(2) + '%';
  const labels = [['equity', '미국 주식'], ['btc', '비트코인'], ['gold', '금'], ['cash', '현금']];

  function draw(d) {
    const rows = d.observations;
    if (!rows?.length) throw Error('추이 자료 없음');
    const last = rows.at(-1), all = rows.flatMap(r => [r.ver2, r.sp500]);
    const lo = Math.min(...all), hi = Math.max(...all), pad = Math.max((hi - lo) * .12, 1);
    const min = lo - pad, max = hi + pad;
    const y = v => 195 - (v - min) / (max - min) * 160;
    const x = i => 100 + i / Math.max(1, rows.length - 1) * 500;
    const lines = [['ver2', '#2458e9'], ['sp500', '#f18b18']].map(([key, color]) =>
      `<polyline fill="none" stroke="${color}" stroke-width="3" points="${rows.map((r, i) => `${x(i).toFixed(1)},${y(r[key]).toFixed(1)}`).join(' ')}"/>`).join('');
    const start = rows.findIndex(r => r.phase === 'tracking');
    const marker = start >= 0 ? `<line x1="${x(start)}" x2="${x(start)}" y1="25" y2="195" stroke="#6b7280" stroke-dasharray="5 4"/><text x="${x(start)}" y="18" text-anchor="middle">실제 관측 시작</text>` : '';
    const missing = rows.filter(r => r.signalMissing).map(r => r.date);
    host.innerHTML = `<div class="section-title"><h2>Ver2 · S&amp;P 500 거치식 추이</h2><span class="tag">기준 ${last.date}</span></div>
      <p>2026년 첫 거래일부터 각각 1억 원 · 추가 납입 없음 · 원화 기준</p>
      <div class="sim-trend-values"><span style="color:#2458e9">Ver2 <b>${money(last.ver2)} · ${pct(last.ver2Return)}</b></span><span style="color:#f18b18">S&amp;P 500 <b>${money(last.sp500)} · ${pct(last.sp500Return)}</b></span></div>
      <div style="position:relative">
        <svg viewBox="0 0 620 230" font-size="10" role="img" tabindex="0" aria-label="Ver2와 S&amp;P 500의 일별 원화 평가액. 좌우 방향키로 날짜 선택" style="width:100%;height:auto;touch-action:pan-y">
          <text x="0" y="33">${money(max)}</text><text x="0" y="195">${money(min)}</text>
          <line x1="100" y1="195" x2="600" y2="195" stroke="#ccd5e2"/>${lines}${marker}
          <line data-cursor x1="100" x2="100" y1="25" y2="195" stroke="#596b82" stroke-dasharray="3 3" visibility="hidden"/>
          <circle data-dot cx="100" cy="100" r="3" fill="#2458e9" stroke="#fff" visibility="hidden"/>
          <rect data-hit x="100" y="25" width="500" height="170" fill="transparent" style="cursor:crosshair"/>
          <text x="100" y="220">${rows[0].date}</text><text x="515" y="220">${last.date}</text>
        </svg>
        <div data-tooltip role="status" aria-live="polite" hidden style="position:absolute;top:8px;z-index:2;pointer-events:none;background:#fff;border:1px solid #cdd9e8;border-radius:10px;box-shadow:0 4px 18px #10233a26;padding:10px 12px;font-size:12px;line-height:1.6;color:#102a43;min-width:215px;max-width:95%"></div>
      </div>
      <p class="small">그래프에 마우스를 올리거나 터치하면 해당 날짜의 평가액과 실제 구성 비중을 볼 수 있습니다. 실제 구성은 목표 비중과 다를 수 있습니다.</p>
      <p class="small">파랑 Ver2 · 주황 S&amp;P 500 가격지수. 각 월 첫 미국 거래일에 Ver2를 재배분하며 매수·매도 각 0.1% 반영, 세금·스프레드·현금이자·배당 제외. 금·BTC와 원/달러는 직전 가용일 기준입니다. 2026-01-01 BTC만 Yahoo 대용치입니다.</p>
      <p class="small">11월 2일까지는 사후 백테스트이며, 이후 수집한 시점별 신호로 관측합니다. 과거 신호의 당시 이용 가능성은 검증되지 않았습니다. ${missing.length ? '신호가 없어 재배분하지 않은 월: ' + missing.join(', ') + '.' : ''} ${start < 0 ? '아직 시작일 이후 확정된 미국 종가가 없어 실시간 관측 구간은 표시되지 않습니다.' : ''}</p>`;
    const svg = host.querySelector('svg'), tip = host.querySelector('[data-tooltip]');
    const cursor = host.querySelector('[data-cursor]'), dot = host.querySelector('[data-dot]');
    let index = rows.length - 1;
    function show(i) {
      index = Math.max(0, Math.min(rows.length - 1, i));
      const row = rows[index], value = row.ver2, allocation = row.allocation;
      const detail = allocation && value > 0 && labels.every(([key]) => Number.isFinite(allocation[key]))
        ? labels.map(([key, label]) => `<div style="display:flex;justify-content:space-between;gap:12px"><span>${label}</span><span>${money(allocation[key])} · ${(allocation[key] / value * 100).toFixed(1)}%</span></div>`).join('')
        : '<div>자산 구성 데이터 없음</div>';
      tip.innerHTML = `<b>${row.date}</b><div style="color:#2458e9">Ver2 총액 <b>${money(value)}</b> (${pct(row.ver2Return)})</div><div style="color:#d97706">S&amp;P 500 <b>${money(row.sp500)}</b> (${pct(row.sp500Return)})</div><div style="border-top:1px solid #e0e7ef;margin-top:5px;padding-top:4px">실제 자산 구성</div>${detail}${row.rebalanced ? '<div>이 날짜에 재배분</div>' : ''}${row.signalMissing ? '<div>신호 없어 재배분 생략</div>' : ''}`;
      tip.hidden = false;
      const left = x(index) / 620 * 100;
      tip.style.left = left > 55 ? 'auto' : Math.min(left + 2, 60) + '%';
      tip.style.right = left > 55 ? Math.max(0, 100 - left + 2) + '%' : 'auto';
      cursor.setAttribute('x1', x(index)); cursor.setAttribute('x2', x(index));
      dot.setAttribute('cx', x(index)); dot.setAttribute('cy', y(value));
      cursor.setAttribute('visibility', 'visible'); dot.setAttribute('visibility', 'visible');
    }
    function hide() { tip.hidden = true; cursor.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); }
    function selectPointer(e) {
      const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
      const local = pt.matrixTransform(svg.getScreenCTM().inverse());
      if (local.x < 100 || local.x > 600 || local.y < 25 || local.y > 195) { hide(); return; }
      show(Math.round((local.x - 100) / 500 * (rows.length - 1)));
    }
    svg.addEventListener('pointermove', selectPointer);
    svg.addEventListener('pointerdown', selectPointer);
    svg.addEventListener('pointerleave', hide);
    svg.addEventListener('focus', () => show(index));
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); show(index + (e.key === 'ArrowLeft' ? -1 : 1)); }
      if (e.key === 'Escape') hide();
    });
  }
  async function refresh() {
    try {
      const r = await fetch('./ver2-tracking.json?t=' + Date.now(), {cache:'no-store'});
      if (!r.ok) throw Error('데이터 없음');
      draw(await r.json());
    } catch (e) {
      host.innerHTML = '<h2>Ver2 · S&amp;P 500 거치식 추이</h2><p>추이 자료 갱신을 확인해 주세요.</p>';
    }
  }
  refresh();
  setInterval(refresh, 300000);
})();
