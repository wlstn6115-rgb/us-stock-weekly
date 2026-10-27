(function (root) {
  'use strict';
  const TARGET_ORDER = ['buffett', 'druckenmiller', 'thiel', 'ackman', 'nps', 'fisher', 'pelosi'];
  const TARGET_NAMES = { buffett: '워렌 버핏', druckenmiller: '드러켄밀러', thiel: '피터 틸', ackman: '빌 애크먼', nps: '국민연금', fisher: '켄 피셔', pelosi: '낸시 펠로시' };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const number = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
  const count = value => number(value) === null ? '—' : Number(value).toLocaleString('en-US', { maximumFractionDigits: 4 });
  function isIsoDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
    const parsed = new Date(value + 'T00:00:00Z');
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }
  const date = value => isIsoDate(value) ? String(value) : '확인 중';
  const money = value => number(value) === null ? '—' : '$' + Number(value).toLocaleString('en-US', {maximumFractionDigits: 0});
  function compactMoney(value) {
    const n = number(value);
    if (n === null) return '—';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toLocaleString('en-US', {maximumFractionDigits: 2}) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toLocaleString('en-US', {maximumFractionDigits: 2}) + 'M';
    return money(n);
  }
  function safeSourceUrl(value) {
    try {
      const url = new URL(String(value || ''));
      if (url.protocol !== 'https:' || url.username || url.password) return null;
      if (!['www.sec.gov', 'sec.gov', 'data.sec.gov', 'disclosures-clerk.house.gov', 'www.disclosures-clerk.house.gov', 'ethics.house.gov'].includes(url.hostname)) return null;
      return url.href;
    } catch (_) { return null; }
  }
  function sourceLink(value, label, className = '') {
    const url = safeSourceUrl(value);
    return url ? `<a class="${className}" href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(label)} ↗</a>` : '';
  }
  function isPtr(target) { return String(target?.filingType || '').toUpperCase() === 'PTR' || target?.id === 'pelosi'; }
  function validateSnapshot(data) {
    if (data?.schemaVersion !== 1 || !Array.isArray(data.targets) || !isIsoDate(data.asOfDate)) throw new Error('공시 데이터 형식 확인 필요');
    const ids = data.targets.map(target => target.id);
    if (new Set(ids).size !== ids.length || ids.some(id => !TARGET_ORDER.includes(id)) || TARGET_ORDER.some(id => !ids.includes(id))) throw new Error('공시 대상 누락 또는 중복');
    for (const target of data.targets) {
      for (const field of ['filingDate', 'reportPeriod', 'priorReportPeriod']) if (target[field] && !isIsoDate(target[field])) throw new Error('공시 날짜 형식 확인 필요');
      if (target.filingDate && target.filingDate > data.asOfDate) throw new Error('조회 기준일 이후 공시');
      if (target.reportPeriod && target.reportPeriod > data.asOfDate) throw new Error('조회 기준일 이후 관측 분기');
      if (target.priorReportPeriod && target.reportPeriod && target.priorReportPeriod >= target.reportPeriod) throw new Error('전분기 비교 기준 확인 필요');
      if (!Array.isArray(target.holdings || []) || !Array.isArray(target.transactions || [])) throw new Error('공시 행 형식 확인 필요');
      for (const row of target.holdings || []) if (row.filingDate && (!isIsoDate(row.filingDate) || row.filingDate > data.asOfDate)) throw new Error('조회 기준일 이후 보유 공시 행');
      for (const row of target.transactions || []) {
        for (const field of ['transactionDate', 'disclosureDate', 'filingDate']) if (row[field] && !isIsoDate(row[field])) throw new Error('거래공시 날짜 형식 확인 필요');
        if ((row.disclosureDate || row.filingDate || '') > data.asOfDate || (row.transactionDate || '') > data.asOfDate) throw new Error('조회 기준일 이후 거래공시');
      }
    }
    return data;
  }
  function ownerText(owner) {
    const raw = String(owner || '').trim();
    const labels = {SP: '배우자 (SP)', SELF: '본인', JT: '공동 (JT)', DC: '부양자녀 (DC)', '': '원문 확인 필요'};
    return labels[raw.toUpperCase()] || raw;
  }
  function positionType(row) {
    const option = String(row.putCall || '').toUpperCase();
    if (option === 'PUT') return '풋옵션';
    if (option === 'CALL') return '콜옵션';
    return row.shareType === 'PRN' ? '원금 단위 (PRN)' : '현물 / 기타 증권';
  }
  function shareChange(row) {
    const change = number(row.shareChange);
    const kind = String(row.changeType || '').toUpperCase();
    const labels = {NEW: '신규 신고', INCREASE: '수량 증가', DECREASE: '수량 감소', UNCHANGED: '동일 수량', EXITED: '전량 미신고', NO_COMPARISON: '비교 자료 없음'};
    let label = labels[kind] || '비교 자료 없음';
    if (change !== null && !['NEW', 'NO_COMPARISON'].includes(kind)) label += ' · ' + (change > 0 ? '+' : '') + count(change);
    const tone = kind === 'NEW' || kind === 'INCREASE' ? 'increase' : kind === 'DECREASE' || kind === 'EXITED' ? 'decrease' : '';
    return {label, tone};
  }
  function filterHoldings(rows, query) {
    const q = String(query || '').trim().toLocaleLowerCase();
    return rows.filter(row => !q || [row.issuer, row.titleOfClass, row.cusip, row.ticker, row.putCall].some(value => String(value || '').toLocaleLowerCase().includes(q)))
      .slice().sort((a, b) => (number(b.valueUsd) ?? number(b.asFiledValue) ?? -Infinity) - (number(a.valueUsd) ?? number(a.asFiledValue) ?? -Infinity));
  }
  function filterTransactions(rows, query) {
    const q = String(query || '').trim().toLocaleLowerCase();
    return rows.filter(row => !q || [row.assetName, row.asset, row.ticker, row.owner, row.transactionType, row.instrument].some(value => String(value || '').toLocaleLowerCase().includes(q)))
      .slice().sort((a, b) => String(b.transactionDate || '').localeCompare(String(a.transactionDate || '')));
  }
  function statusLabel(target) {
    const status = String(target.status || '').toUpperCase();
    if (status === 'VERIFIED_SOURCE') return {text: '공식 원문 수집 · 신고 기준 자료', tone: ''};
    if (status === 'UNAVAILABLE') return {text: '원문 확인 불가 · 숫자를 임의로 채우지 않음', tone: 'error'};
    return {text: '원문·비교 기준 검토 필요', tone: 'warning'};
  }
  function notesHtml(target) {
    const notes = (Array.isArray(target.notes) ? target.notes : []).filter(item => typeof item === 'string');
    return notes.length ? '<ul class="target-notes">' + notes.map(note => `<li>${escape(note)}</li>`).join('') + '</ul>' : '';
  }
  function amendmentsText(target) {
    if (Array.isArray(target.amendments) && target.amendments.length) return `정정 ${target.amendments.length}건 반영`;
    return target.isAmendment ? '정정 공시 포함' : '원신고 / 정정 여부는 원문 확인';
  }
  function renderOverview(target) {
    if (isPtr(target)) {
      const rows = filterTransactions(target.transactions || [], '').slice(0, 7);
      return `<section class="visual-summary"><h3>최근 신고 거래</h3><p class="visual-caption">PTR은 보유 비중이 아닌 거래 신고입니다. 금액은 원문 구간 그대로 표시합니다.</p>${rows.length ? '<ol class="transaction-timeline">' + rows.map(row => `<li><time>${date(row.transactionDate)}</time><div><strong>${escape(row.assetName || row.asset || '원문 확인 필요')}</strong><span>${escape(ownerText(row.owner))} · ${escape(row.transactionType || '거래 종류 확인 필요')} · ${escape(row.amountRange || '금액 확인 필요')}</span><small>신고일 ${date(row.disclosureDate || row.filingDate)}</small></div></li>`).join('') + '</ol>' : '<p>확인된 거래가 없습니다. 원문과 수집 상태를 확인하세요.</p>'}</section>`;
    }
    const rows = filterHoldings(target.holdings || [], '').slice(0, 7);
    const pending = target.valueUnitStatus === 'NEEDS_REVIEW';
    const counts = {NEW:0, INCREASE:0, DECREASE:0, UNCHANGED:0};
    for (const row of target.holdings || []) if (Object.hasOwn(counts, row.changeType)) counts[row.changeType]++;
    const comparable = target.comparisonStatus === 'QUANTITY_COMPARISON';
    const summary = comparable ? `<div class="change-summary"><span>신규 신고 <b>${counts.NEW}</b></span><span>수량 증가 <b>${counts.INCREASE}</b></span><span>수량 감소 <b>${counts.DECREASE}</b></span><span>수량 동일 <b>${counts.UNCHANGED}</b></span></div><p class="visual-caption">현재 신고된 항목 기준. 미신고된 전분기 항목은 이 집계에 없으며 수량 변화는 실제 매수·매도 건수가 아닙니다.</p>` : '<p class="visual-caption">신고 범위가 달라 전분기 수량 증감은 비교하지 않습니다.</p>';
    const max = Math.max(0, ...rows.map(row => number(row.weightPct) ?? 0));
    const chart = rows.length ? '<ol class="holding-chart">' + rows.map((row, i) => {
      const weight = number(row.weightPct), change = shareChange(row);
      const bar = !pending && weight !== null && max > 0 ? `<div class="bar-track" aria-hidden="true"><span style="width:${Math.max(0, Math.min(100, weight / max * 100)).toFixed(2)}%"></span></div><strong class="bar-value">${weight.toFixed(2)}%</strong>` : '<span class="bar-pending">비중 검토 중</span>';
      const duplicateIssuer = rows.filter(other => other.issuer === row.issuer).length > 1;
      return `<li><div class="bar-label"><span class="rank">${i + 1}</span><strong>${escape(row.issuer || '원문 명칭 확인 필요')}</strong>${duplicateIssuer ? `<small>${escape(row.titleOfClass || row.cusip || '증권 구분 확인')}</small>` : ''}${row.putCall ? `<small>${escape(positionType(row))}</small>` : ''}</div><div class="bar-measure">${bar}</div><span class="change ${change.tone}">${escape(change.label)}</span></li>`;
    }).join('') + '</ol>' : '<p>표시할 보유 항목이 없습니다.</p>';
    return `<section class="visual-summary"><h3>상위 7개 신고 항목</h3><p class="visual-caption">${pending ? '원문 기재 순위 · 금액 단위 확인 전이므로 막대와 비중을 표시하지 않습니다.' : '전체 13F 신고가치 대비 비중 · 막대는 상위 항목 간 상대 크기 · 옵션 포함'}</p>${chart}${summary}</section>`;
  }
  function renderTargetHeader(target) {
    const ptr = isPtr(target), label = statusLabel(target);
    const unitPending = target.valueUnitStatus === 'NEEDS_REVIEW';
    const reportedValue = `<div class="kpi"><dt>13F 신고 보유가치</dt><dd>${unitPending ? '단위 검토 중' : compactMoney(target.reportedValueUsd)}<small>${unitPending ? escape(target.valueUnitLabel || '원문 기재값 · 달러 단위 대사 필요') : money(target.reportedValueUsd) + ' · 전체 AUM 아님'}</small></dd></div>`;
    const ptrValue = `<div class="kpi"><dt>이 화면의 거래 행</dt><dd>${count((target.transactions || []).length)}<small>금액 구간은 합산하지 않음</small></dd></div>`;
    return `<section class="detail-card"><div class="detail-head"><div><span class="filing-label ${ptr ? 'ptr' : ''}">${ptr ? '의회 거래공시 · PTR' : 'SEC 기관 보유공시 · 13F'}</span><h2>${escape(target.nameKo || TARGET_NAMES[target.id] || target.personName || target.entityName)}</h2><p class="entity-name">${escape(target.entityName || '')}${target.cik ? ' · CIK ' + escape(target.cik) : ''}</p><p class="person-note">${ptr ? '신고자·거래 소유자를 구분합니다. 현재 보유 포트폴리오가 아닙니다.' : '아래 수치는 해당 신고 법인의 공시 범위이며, 개인의 전체 자산을 뜻하지 않습니다.'}</p></div>${sourceLink(target.sourceUrl, '공식 공시 원문', 'source-link')}</div><div class="status-banner ${label.tone}">${escape(label.text)}${target.statusReason ? ' · ' + escape(target.statusReason) : ''}</div><dl class="kpi-grid"><div class="kpi"><dt>${ptr ? '최근 신고일' : '보유 관측 분기말'}</dt><dd>${date(ptr ? target.filingDate : target.reportPeriod)}<small>${ptr ? '공시된 거래일은 표에서 별도 확인' : '현재 포지션과 구분'}</small></dd></div><div class="kpi"><dt>${ptr ? '최근 거래일' : '실제 제출일'}</dt><dd>${date(ptr ? (target.transactions || []).map(row => row.transactionDate).filter(Boolean).sort().at(-1) : target.filingDate)}<small>${ptr ? '이 화면에 수록된 거래 기준' : amendmentsText(target)}</small></dd></div>${ptr ? ptrValue : reportedValue}<div class="kpi"><dt>${ptr ? '공시 방식' : '집계 보유 항목'}</dt><dd>${ptr ? '금액 구간' : count(target.positionCount ?? (target.holdings || []).length)}<small>${ptr ? '배우자·옵션 거래 별도 표시' : '원문 행 ' + count(target.rawRowCount) + '개 · 중복 구분 후 집계'}</small></dd></div></dl><p class="details-meta">${target.accession ? '<span>접수번호 ' + escape(target.accession) + '</span>' : ''}${target.priorReportPeriod ? '<span>수량 비교 기준 ' + date(target.priorReportPeriod) + '</span>' : ''}${sourceLink(target.priorSourceUrl, '비교 원문')}${target.latestCheckAt ? '<span>원문 조회 ' + escape(target.latestCheckAt) + '</span>' : ''}</p><div id="disclosure-table-region"></div>${notesHtml(target)}</section>`;
  }
  function renderHoldings(rows) {
    if (!rows.length) return '<div class="empty"><strong>표시할 보유 항목이 없습니다.</strong><p>검색어를 바꾸거나 공시 상태와 원문을 확인하세요. 빈 표를 보유액 0원으로 해석하지 않습니다.</p></div>';
    return '<div class="table-wrap" tabindex="0" role="region" aria-label="기관 보유 표 · 가로 스크롤 가능"><table><thead><tr><th scope="col">기업 / 증권</th><th scope="col">신고 구분</th><th scope="col" class="numeric">신고가치 · USD</th><th scope="col" class="numeric">공시 비중</th><th scope="col" class="numeric">수량</th><th scope="col">전분기 대비</th></tr></thead><tbody>' + rows.map(row => {
      const change = shareChange(row), weight = number(row.weightPct);
      const rawValue = number(row.valueUsd) === null && number(row.asFiledValue) !== null ? '<span class="cell-sub">원문 기재값 ' + count(row.asFiledValue) + '<br>달러 단위 대사 필요</span>' : '';
      return `<tr><td class="issuer">${escape(row.issuer || '원문 명칭 확인 필요')}${row.ticker ? ' · ' + escape(row.ticker) : ''}<span class="cell-sub">${escape(row.titleOfClass || '')} · CUSIP ${escape(row.cusip || '—')}</span></td><td><span class="position-tag ${row.putCall ? 'option' : ''}">${escape(positionType(row))}</span></td><td class="numeric">${money(row.valueUsd)}${rawValue}</td><td class="numeric">${weight === null ? '—' : weight.toFixed(2) + '%'}</td><td class="numeric">${count(row.shares)}<span class="cell-sub">${escape(row.shareType || '단위 확인 필요')}</span></td><td><span class="change ${change.tone}">${escape(change.label)}</span><span class="cell-sub">전분기 ${count(row.priorShares)}</span></td></tr>`;
    }).join('') + '</tbody></table></div>';
  }
  function renderTransactions(rows) {
    if (!rows.length) return '<div class="empty"><strong>확인된 거래 행이 없습니다.</strong><p>공식 원문과 수집 상태를 확인하세요. 거래가 없었다거나 현재 보유액이 0이라는 뜻은 아닙니다.</p></div>';
    return '<div class="table-wrap" tabindex="0" role="region" aria-label="의회 신고 거래 표 · 가로 스크롤 가능"><table class="ptr-table"><thead><tr><th scope="col">거래일 / 신고일</th><th scope="col">자산 / 거래</th><th scope="col">소유자</th><th scope="col">신고 금액 구간</th><th scope="col">원문</th></tr></thead><tbody>' + rows.map(row => `<tr><td>${date(row.transactionDate)}<span class="cell-sub">신고 ${date(row.disclosureDate || row.filingDate)}</span></td><td class="asset-cell"><strong>${escape(row.assetName || row.asset || '명칭 확인 필요')}${row.ticker ? ' · ' + escape(row.ticker) : ''}</strong><span class="cell-sub">${escape(row.transactionType || '종류 확인 필요')} · ${escape(row.instrument || '')}</span>${row.description ? '<span class="cell-sub">' + escape(row.description) + '</span>' : ''}</td><td>${escape(ownerText(row.owner))}</td><td class="amount-cell"><span class="raw-amount">${escape(row.amountRange || '원문 구간 확인 필요')}</span><span class="cell-sub">정확한 거래금액·보유가치 아님</span></td><td>${sourceLink(row.sourceUrl, 'PTR')}</td></tr>`).join('') + '</tbody></table></div>';
  }
  const api = {escape, number, count, date, isIsoDate, money, compactMoney, safeSourceUrl, validateSnapshot, isPtr, ownerText, positionType, shareChange, filterHoldings, filterTransactions, renderHoldings, renderTransactions, renderTargetHeader, renderOverview};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.InstitutionalDisclosures = api;
  if (!root.document) return;
  const doc = root.document, $ = id => doc.getElementById(id);
  let snapshot = null, selected = '', query = '', limit = 20;
  function renderTable() {
    const target = snapshot.targets.find(row => row.id === selected);
    if (!target) return;
    const ptr = isPtr(target), all = ptr ? filterTransactions(target.transactions || [], query) : filterHoldings(target.holdings || [], query);
    const rows = limit === 0 ? all : all.slice(0, limit);
    $('disclosure-table-region').innerHTML = `<div class="table-tools"><label class="search-label" for="disclosure-search">${ptr ? '자산·거래 종류 검색' : '기업·CUSIP 검색'}<input id="disclosure-search" type="search" autocomplete="off" placeholder="${ptr ? '예: REOF' : '예: APPLE 또는 037833100'}" value="${escape(query)}"></label><label for="row-limit">표시 행<select id="row-limit"><option value="20"${limit === 20 ? ' selected' : ''}>상위 / 최근 20</option><option value="50"${limit === 50 ? ' selected' : ''}>상위 / 최근 50</option><option value="0"${limit === 0 ? ' selected' : ''}>전체</option></select></label></div><p class="table-caption">${ptr ? '최신 거래일 순. 거래금액 구간은 합산하거나 보유 비중으로 환산하지 않습니다.' : '신고가치 내림차순. 비중은 전체 정보표 신고가치(옵션 포함) 대비이며 실제 투자원금·AUM 비중이 아닙니다.'} <strong>${rows.length.toLocaleString()} / ${all.length.toLocaleString()}개 표시</strong></p><div id="table-output">${ptr ? renderTransactions(rows) : renderHoldings(rows)}</div>`;
    $('disclosure-search').addEventListener('input', event => {
      query = event.target.value;
      const available = ptr ? filterTransactions(target.transactions || [], query) : filterHoldings(target.holdings || [], query);
      const visible = limit === 0 ? available : available.slice(0, limit);
      $('table-output').innerHTML = ptr ? renderTransactions(visible) : renderHoldings(visible);
      doc.querySelector('.table-caption strong').textContent = `${visible.length.toLocaleString()} / ${available.length.toLocaleString()}개 표시`;
    });
    $('row-limit').addEventListener('change', event => { limit = Number(event.target.value); renderTable(); });
  }
  function selectTarget(id, updateHash = true) {
    if (!snapshot?.targets.some(target => target.id === id)) id = snapshot?.targets[0]?.id;
    if (!id) return;
    selected = id; query = ''; limit = 20;
    for (const button of $('target-picker').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.target === selected));
    const target = snapshot.targets.find(row => row.id === selected);
    $('disclosure-detail').innerHTML = renderTargetHeader(target);
    $('disclosure-table-region').insertAdjacentHTML('beforebegin', renderOverview(target));
    renderTable();
    $('disclosure-detail').setAttribute('aria-busy', 'false');
    $('page-status').textContent = `${target.nameKo || TARGET_NAMES[target.id]} · ${isPtr(target) ? '의회 거래공시' : '기관 13F'} · 조회 기준일 ${date(snapshot.asOfDate)}`;
    if (updateHash && root.location.hash !== '#' + id) root.history.replaceState(null, '', '#' + id);
  }
  async function load() {
    try {
      const response = await root.fetch('./institutional-disclosures.json', {cache: 'no-store'});
      if (!response.ok) throw new Error('HTTP ' + response.status);
      snapshot = validateSnapshot(await response.json());
      snapshot.targets = snapshot.targets.slice().sort((a, b) => TARGET_ORDER.indexOf(a.id) - TARGET_ORDER.indexOf(b.id));
      $('snapshot-date').textContent = date(snapshot.asOfDate);
      const stamp = new Date(snapshot.generatedAt);
      $('snapshot-updated').textContent = Number.isNaN(stamp.getTime()) ? '' : '수집 ' + stamp.toLocaleString('ko-KR', {timeZone: 'Asia/Seoul'}) + ' KST';
      $('target-picker').innerHTML = snapshot.targets.map(target => `<button class="target-button ${isPtr(target) ? 'ptr' : ''}" type="button" data-target="${escape(target.id)}" aria-pressed="false"><strong>${escape(target.nameKo || TARGET_NAMES[target.id] || target.personName)}</strong><small>${isPtr(target) ? '의회 거래공시 · PTR' : '기관 보유공시 · 13F'}</small></button>`).join('');
      $('target-picker').addEventListener('click', event => { const button = event.target.closest('button[data-target]'); if (button) selectTarget(button.dataset.target); });
      $('collection-note').textContent = '이 화면은 게시된 공시 스냅샷을 읽습니다. 페이지를 여는 것만으로 SEC·의회 원문을 새로 수집하지 않습니다.';
      selectTarget(root.location.hash.slice(1), false);
      root.addEventListener('hashchange', () => selectTarget(root.location.hash.slice(1), false));
    } catch (error) {
      $('snapshot-date').textContent = '확인 불가';
      $('page-status').classList.add('error');
      $('page-status').textContent = '공시 자료를 불러오지 못했습니다. 이전 날짜를 오늘 자료로 표시하거나 보유액을 0으로 바꾸지 않습니다.';
      $('disclosure-detail').setAttribute('aria-busy', 'false');
      $('disclosure-detail').innerHTML = '<div class="detail-card no-data"><h3>공시 데이터 확인이 필요합니다</h3><p>게시 파일 또는 인터넷 연결을 확인한 뒤 페이지를 다시 열어 주세요. 자산배분 관측소의 개인 입력·저장 자료는 이 화면에서 읽거나 변경하지 않습니다.</p></div>';
    }
  }
  load();
})(typeof window !== 'undefined' ? window : globalThis);
