"""Collect dated public 13F/PTR disclosures; no publication or model scheduling.

13F values are preserved as filed. A detected unit inconsistency is never repaired
by guessing a multiplier. Local raw receipts stay outside the public JSON.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import io
import json
import os
from pathlib import Path
import re
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = Path(__file__).with_name('institutional_disclosures.json')
RAW_ROOT = ROOT / '05_database' / 'institutional_disclosures'
KST = dt.timezone(dt.timedelta(hours=9))
TARGETS = [
    ('buffett', '워렌 버핏', 'Warren Buffett', '1067983'),
    ('druckenmiller', '스탠리 드러켄밀러', 'Stanley Druckenmiller', '1536411'),
    ('thiel', '피터 틸', 'Peter Thiel', '1562087'),
    ('ackman', '빌 애크먼', 'Bill Ackman', '1336528'),
    ('nps', '국민연금', 'National Pension Service', '1608046'),
    ('fisher', '켄 피셔', 'Ken Fisher', '850529'),
]
SHARED_NOTES = [
    '13F는 신고 법인의 분기말 보유 내역이며 인물 개인의 전체 자산이나 현재 포지션이 아닙니다.',
    '공시 보유가치 합계는 AUM이 아닙니다. 현금·일반 공매도·비공개 자산 등은 같은 범위가 아닙니다.',
    'PUT/CALL 공시가치는 기초자산 명목가치이며 옵션 프리미엄·순노출이 아닙니다.',
    '수량 증감은 두 분기말 신고수량의 차이입니다. 실제 매매일·매매금액을 뜻하지 않습니다.',
]


def local_name(tag):
    return tag.rsplit('}', 1)[-1]


def find_text(node, name, default=''):
    for child in node.iter():
        if local_name(child.tag) == name:
            return (child.text or '').strip()
    return default


def numeric(value):
    text = str(value).replace(',', '').strip()
    if not re.fullmatch(r'\d+(?:\.\d+)?', text):
        raise ValueError('invalid_nonnegative_numeric')
    number = float(text) if '.' in text else int(text)
    return number


def iso_date(value):
    for pattern in ('%Y-%m-%d', '%m-%d-%Y', '%m/%d/%Y'):
        try:
            return dt.datetime.strptime(value.strip(), pattern).date().isoformat()
        except ValueError:
            pass
    raise ValueError('invalid_source_date')


class SourceClient:
    def __init__(self, raw_root=RAW_ROOT, offline=False):
        self.root = Path(raw_root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.offline = offline
        self.receipts = []
        self.last_request = 0.0

    def get(self, url, relative_path, mutable=False):
        # SEC accession documents are immutable receipts; indexes/submissions are
        # refreshed on each collection, unless --offline was explicitly selected.
        path = self.root / relative_path
        if path.exists() and (not mutable or self.offline):
            content = path.read_bytes()
            fetched = dt.datetime.fromtimestamp(path.stat().st_mtime, dt.timezone.utc).isoformat()
        else:
            if self.offline:
                raise OSError('offline_source_missing')
            time.sleep(max(0.0, 0.22 - (time.monotonic() - self.last_request)))
            request = urllib.request.Request(url, headers={
                'User-Agent': os.environ.get('SEC_USER_AGENT', 'InstitutionalDisclosuresResearch jjw@example.com'),
                'Accept-Encoding': 'identity',
            })
            self.last_request = time.monotonic()
            with urllib.request.urlopen(request, timeout=25) as response:
                content = response.read(25_000_000)
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_name(path.name + '.tmp')
            temporary.write_bytes(content)
            temporary.replace(path)
            fetched = dt.datetime.now(dt.timezone.utc).isoformat()
        self.receipts.append({'url': url, 'sha256': hashlib.sha256(content).hexdigest(), 'fetchedAt': fetched})
        return content


def submission_filings(client, cik, cache_key, cutoff):
    url = f'https://data.sec.gov/submissions/CIK{int(cik):010d}.json'
    data = json.loads(client.get(url, cache_key + '-submissions.json', mutable=True))
    if str(int(data['cik'])) != str(int(cik)):
        raise ValueError('submissions_cik_mismatch')
    recent = data['filings']['recent']
    rows = []
    for index, form in enumerate(recent['form']):
        if not form.startswith('13F') or recent['filingDate'][index] > cutoff:
            continue
        row = {field: recent.get(field, [''] * len(recent['form']))[index]
               for field in ('form', 'filingDate', 'reportDate', 'accessionNumber', 'primaryDocument')}
        if row['reportDate'] and row['reportDate'] <= cutoff:
            rows.append(row)
    rows.sort(key=lambda row: (row['reportDate'], row['filingDate'], row['accessionNumber']), reverse=True)
    return data['name'], rows, url


def filing_urls(cik, filing):
    accession = filing['accessionNumber']
    base = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{accession.replace('-', '')}/"
    return base, base + accession + '-index.htm'


def read_cover(client, cache_key, cik, filing):
    base, index_url = filing_urls(cik, filing)
    folder = f"{cache_key}/{filing['accessionNumber'].replace('-', '')}"
    name = filing['primaryDocument'].rsplit('/', 1)[-1]
    cover = ET.fromstring(client.get(base + name, folder + '/' + name))
    period = iso_date(find_text(cover, 'reportCalendarOrQuarter') or find_text(cover, 'periodOfReport'))
    if period != filing['reportDate']:
        raise ValueError('cover_period_mismatch')
    return cover, base, index_url, folder


def parse_information_table(content):
    root = ET.fromstring(content)
    if local_name(root.tag) != 'informationTable':
        raise ValueError('not_information_table')
    rows = []
    for item in root:
        if local_name(item.tag) != 'infoTable':
            continue
        put_call = find_text(item, 'putCall').upper() or None
        if put_call not in (None, 'PUT', 'CALL'):
            raise ValueError('unknown_option_type')
        cusip = find_text(item, 'cusip').upper()
        shares = numeric(find_text(item, 'sshPrnamt'))
        value = numeric(find_text(item, 'value'))
        # Some empty-report filers submit a zero NA placeholder; retain it in
        # rawRowCount but do not turn it into a real security position.
        placeholder = cusip == '000000000' and shares == 0 and value == 0
        rows.append({'issuer': find_text(item, 'nameOfIssuer'),
                     'titleOfClass': find_text(item, 'titleOfClass'), 'cusip': cusip,
                     'ticker': None, 'asFiledValue': value, 'shares': shares,
                     'shareType': find_text(item, 'sshPrnamtType'), 'putCall': put_call,
                     '_placeholder': placeholder})
    return rows


def aggregate(rows):
    grouped = {}
    for row in rows:
        if row.get('_placeholder'):
            continue
        # CUSIP identifies the security class; cosmetic issuer/class spelling
        # changes do not create false purchases. Options never merge with shares.
        key = (row['cusip'], row['shareType'], row['putCall'])
        if key not in grouped:
            grouped[key] = {k: v for k, v in row.items() if not k.startswith('_')}
            grouped[key]['sourceRowCount'] = 0
            grouped[key]['asFiledValue'] = 0
            grouped[key]['shares'] = 0
        grouped[key]['asFiledValue'] += row['asFiledValue']
        grouped[key]['shares'] += row['shares']
        grouped[key]['sourceRowCount'] += 1
    return sorted(grouped.values(), key=lambda row: (-row['asFiledValue'], row['cusip'], row['putCall'] or ''))


def read_filing(client, cache_key, cik, filing):
    cover, base, source, folder = read_cover(client, cache_key, cik, filing)
    listing = json.loads(client.get(base + 'index.json', folder + '/index.json'))
    raw = []
    table_urls = []
    for item in listing['directory']['item']:
        name = item['name']
        if not name.lower().endswith('.xml') or name == filing['primaryDocument'].rsplit('/', 1)[-1]:
            continue
        content = client.get(base + name, folder + '/' + name)
        if local_name(ET.fromstring(content).tag) == 'informationTable':
            raw.extend(parse_information_table(content))
            table_urls.append(base + name)
    if not table_urls:
        raise ValueError('information_table_missing')
    declared_count = numeric(find_text(cover, 'tableEntryTotal'))
    declared_value = numeric(find_text(cover, 'tableValueTotal'))
    actual_value = sum(row['asFiledValue'] for row in raw)
    if len(raw) != declared_count:
        raise ValueError('cover_information_table_totals_mismatch')
    if abs(actual_value - declared_value) > 0.01 and cache_key != 'druckenmiller':
        raise ValueError('cover_information_table_totals_mismatch')
    return {'filing': filing, 'sourceUrl': source, 'informationTableUrls': table_urls,
            'coverUrl': base + filing['primaryDocument'].rsplit('/', 1)[-1],
            'rawRowCount': len(raw), 'asFiledTotal': declared_value,
            'informationTableValueSum': actual_value,
            'coverValueDifference': actual_value - declared_value,
            'reportType': find_text(cover, 'reportType'),
            'isAmendment': filing['form'].endswith('/A'),
            'amendmentType': find_text(cover, 'amendmentType'), 'rawRows': raw}


def materialize_period(client, cache_key, cik, filings, period):
    period_filings = sorted([row for row in filings if row['reportDate'] == period and row['form'].startswith('13F-HR')],
                            key=lambda row: (row['filingDate'], row['accessionNumber']))
    current = None
    amendments = []
    for filing in period_filings:
        parsed = read_filing(client, cache_key, cik, filing)
        if not parsed['isAmendment'] or 'RESTATEMENT' in parsed['amendmentType'].upper():
            current = parsed
        elif current and 'NEW' in parsed['amendmentType'].upper():
            combined = dict(parsed)
            combined['rawRows'] = current['rawRows'] + parsed['rawRows']
            combined['rawRowCount'] = current['rawRowCount'] + parsed['rawRowCount']
            combined['asFiledTotal'] = current['asFiledTotal'] + parsed['asFiledTotal']
            combined['informationTableUrls'] = current['informationTableUrls'] + parsed['informationTableUrls']
            current = combined
        else:
            raise ValueError('amendment_requires_manual_reconciliation')
        if parsed['isAmendment']:
            amendments.append({'accession': filing['accessionNumber'], 'filingDate': filing['filingDate'],
                               'amendmentType': parsed['amendmentType'], 'sourceUrl': parsed['sourceUrl']})
    if current is None:
        raise ValueError('holdings_report_missing_for_period')
    current['holdings'] = aggregate(current['rawRows'])
    current['amendments'] = amendments
    return current


def add_comparisons(current, prior, allow=True):
    lookup = {(row['cusip'], row['shareType'], row['putCall']): row for row in prior or []}
    for row in current:
        previous = lookup.get((row['cusip'], row['shareType'], row['putCall']))
        row['priorShares'] = (previous['shares'] if previous else 0) if allow and prior is not None else None
        row['shareChange'] = row['shares'] - row['priorShares'] if row['priorShares'] is not None else None
        row['changeType'] = ('NO_COMPARISON' if row['shareChange'] is None else
                             'NEW' if previous is None else 'INCREASE' if row['shareChange'] > 0 else
                             'DECREASE' if row['shareChange'] < 0 else 'UNCHANGED')


def collect_13f(client, spec, cutoff):
    key, name_ko, person, requested_cik = spec
    name, filings, submissions_url = submission_filings(client, requested_cik, key, cutoff)
    if not filings:
        raise ValueError('no_public_13f_found_before_cutoff')
    cik = requested_cik
    linked_notice = None
    comparison_allowed = True
    notes = list(SHARED_NOTES)
    if key == 'ackman' and filings[0]['form'].startswith('13F-NT'):
        notice, _, notice_source, _ = read_cover(client, key, cik, filings[0])
        others = [node for node in notice.iter() if local_name(node.tag) == 'otherManager']
        if len(others) != 1 or not find_text(others[0], 'cik'):
            raise ValueError('notice_reporting_manager_unresolved')
        linked_notice = {'entityName': name, 'cik': f'{int(cik):010d}', 'form': filings[0]['form'],
                         'filingDate': filings[0]['filingDate'], 'reportPeriod': filings[0]['reportDate'],
                         'sourceUrl': notice_source, 'reportingManagerName': find_text(others[0], 'name'),
                         'reportingManagerCik': f"{int(find_text(others[0], 'cik')):010d}"}
        cik = find_text(others[0], 'cik')
        name, filings, submissions_url = submission_filings(client, cik, key + '_new', cutoff)
        comparison_allowed = False
        notes.insert(0, '기존 Pershing Square Capital Management의 13F-NT가 지목한 모회사 PERSHING SQUARE INC.의 합산 공시입니다. 보고 범위 변경으로 전분기 증감을 비교하지 않습니다.')
    hr = [row for row in filings if row['form'].startswith('13F-HR')]
    periods = sorted({row['reportDate'] for row in hr}, reverse=True)
    if not periods:
        raise ValueError('holdings_report_missing')
    cache_key = key + '_new' if linked_notice else key
    current = materialize_period(client, cache_key, cik, filings, periods[0])
    prior = materialize_period(client, cache_key, cik, filings, periods[1]) if len(periods) > 1 else None
    if (key == 'ackman' and linked_notice and int(cik) == 2026053 and prior
            and current['filing']['accessionNumber'] == '0001172661-26-005427'
            and any(a['accession'] == '0001172661-26-005426' for a in prior['amendments'])):
        comparison_allowed = True
        notes[0] = '동일 신고 법인 PERSHING SQUARE INC.의 2분기 원공시와 신규 보유 추가 정정을 합산해 3분기 수량과 비교했습니다.'
    # Known current Duquesne receipts have dollar-labelled XML with figures that
    # appear scaled. The collector preserves them, but monetary assertions await
    # a manual source-unit reconciliation; never infer a $000 conversion.
    unit_review = key == 'druckenmiller' and current['filing']['accessionNumber'] in {
        '0001536411-26-000006', '0001536411-26-000004', '0001536411-26-000011'}
    holdings = current['holdings']
    total = current['asFiledTotal']
    for row in holdings:
        row['valueUsd'] = None if unit_review else row['asFiledValue']
        row['estimatedValueUsd'] = row['asFiledValue'] * 1000 if unit_review else None
        denominator = current['informationTableValueSum'] if unit_review else total
        row['weightPct'] = round(row['asFiledValue'] / denominator * 100, 6) if denominator else None
    add_comparisons(holdings, prior['holdings'] if prior else None, allow=comparison_allowed)
    if unit_review:
        notes.insert(0, '달러 금액은 원문 기재값에 1,000을 곱한 추정치입니다. 분기말 Natera·TSMC 종가와 수량 대조에 근거하며 SEC 원문 단위와 불일치하므로 확정 공시 금액이 아닙니다. 비율은 정보표 합계 기준입니다.')
        if current['coverValueDifference']:
            notes.insert(1, f"원문 표 항목합계 {current['informationTableValueSum']:,.0f}와 표지 합계 {total:,.0f}가 {current['coverValueDifference']:,.0f}만큼 다릅니다. 임의 정정하지 않았습니다.")
    if key == 'thiel' and prior and not prior['holdings']:
        notes.insert(0, '직전 분기 원문은 NA·수량0·가치0 placeholder입니다. 이번 NEW는 공개 표의 새 항목이라는 뜻이며 실제 신규 매매를 단정하지 않습니다.')
    if key == 'buffett':
        notes.insert(0, '워렌 버핏 연관 법인 버크셔 해서웨이의 공시입니다. 개인 계좌 또는 특정 개인의 단독 매매 판단으로 해석하지 않습니다.')
    result = {'id': key, 'nameKo': name_ko, 'personName': person, 'entityName': name,
              'cik': f'{int(cik):010d}', 'filingType': '13F',
              'status': 'NEEDS_REVIEW' if unit_review else 'VERIFIED_SOURCE',
              'statusReason': '달러 금액은 1,000배 환산 추정치 · 원문 단위 불일치' if unit_review else 'SEC 원문 표·합계·신고 법인 확인',
              'reportPeriod': current['filing']['reportDate'], 'filingDate': current['filing']['filingDate'],
              'accession': current['filing']['accessionNumber'], 'isAmendment': current['isAmendment'],
              'amendments': current['amendments'], 'form': current['filing']['form'],
              'sourceUrl': current['sourceUrl'], 'coverUrl': current['coverUrl'],
              'informationTableUrls': current['informationTableUrls'], 'submissionsUrl': submissions_url,
              'latestCheckAt': dt.datetime.now(KST).isoformat(),
              'latestObservedFilingDate': max(row['filingDate'] for row in filings),
              'priorReportPeriod': prior['filing']['reportDate'] if prior else None,
              'priorSourceUrl': prior['sourceUrl'] if prior else None,
              'reportedValueUsd': None if unit_review else total, 'asFiledTotal': total,
              'estimatedReportedValueUsd': current['informationTableValueSum'] * 1000 if unit_review else None,
              'informationTableValueSum': current['informationTableValueSum'],
              'coverValueDifference': current['coverValueDifference'],
              'valueUnitStatus': 'NEEDS_REVIEW' if unit_review else 'AS_FILED_USD',
              'valueUnitLabel': '원문 기재값 · 달러 단위 대사 필요' if unit_review else 'USD · 원문 달러 기재액',
              'rawRowCount': current['rawRowCount'], 'positionCount': len(holdings),
              'priorPositionCount': len(prior['holdings']) if prior else None,
              'comparisonStatus': 'SCOPE_CHANGED' if not comparison_allowed else 'QUANTITY_COMPARISON' if prior else 'NO_PRIOR_REPORT',
              'holdings': holdings, 'transactions': [], 'notes': notes}
    if linked_notice:
        result['linkedNotice'] = linked_notice
    return result


def collect_pelosi(client, cutoff):
    index_url = 'https://disclosures-clerk.house.gov/public_disc/financial-pdfs/2026FD.zip'
    archive = zipfile.ZipFile(io.BytesIO(client.get(index_url, 'house2026.zip', mutable=True)))
    text = archive.read('2026FD.txt').decode('utf-8-sig')
    all_rows = list(csv.DictReader(io.StringIO(text), delimiter='\t'))
    filings = [row for row in all_rows if row['Last'].strip().lower() == 'pelosi'
               and row['First'].strip().lower() == 'nancy' and row['FilingType'] == 'P'
               and iso_date(row['FilingDate']) <= cutoff]
    filings.sort(key=lambda row: (iso_date(row['FilingDate']), row['DocID']), reverse=True)
    if not filings:
        raise ValueError('pelosi_official_index_no_ptr')
    latest = filings[0]
    doc_id = latest['DocID']
    url = f'https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/{doc_id}.pdf'
    content = client.get(url, f'pelosi{doc_id}.pdf')
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(content))
    pdf_text = '\n'.join(page.extract_text() or '' for page in reader.pages).replace('\x00', '')
    if doc_id == '20035780' and len(reader.pages) == 1 and all(value in pdf_text for value in (
            'Warner Bros. Discovery', '10/07/2026', '$50,001', '$100,000', '11/06/2026',
            'Cash proceeds from Warner Bros Discovery merger with Paramount Skydance')):
        transaction = {'assetName': 'Warner Bros. Discovery, Inc. - Series A Common Stock',
                       'ticker': 'WBD', 'owner': 'SP', 'ownerLabel': '배우자',
                       'transactionDate': '2026-10-07', 'notificationDate': '2026-10-07',
                       'transactionType': 'SALE', 'transactionTypeLabel': '매도',
                       'amountRange': '$50,001–$100,000', 'amountMinUsd': 50001, 'amountMaxUsd': 100000,
                       'disclosureDate': '2026-11-06', 'filingDate': '2026-11-06', 'sourceUrl': url,
                       'instrument': '보통주', 'assetTypeCode': 'ST',
                       'description': '원문상 파라마운트 스카이댄스와의 합병에 따른 현금 수령액입니다.'}
        return {'id': 'pelosi', 'nameKo': '낸시 펠로시', 'personName': 'Nancy Pelosi',
                'entityName': 'U.S. House of Representatives · Nancy Pelosi', 'cik': None,
                'filingType': 'PTR', 'status': 'VERIFIED_SOURCE', 'statusReason': '최신 PTR 1행 원문 대사',
                'reportPeriod': None, 'filingDate': '2026-11-06', 'accession': doc_id, 'isAmendment': False,
                'sourceUrl': url, 'indexUrl': index_url, 'latestCheckAt': dt.datetime.now(KST).isoformat(),
                'positionCount': None, 'reportedValueUsd': None, 'holdings': [], 'transactions': [transaction],
                'officialIndexPtrCount': len(filings), 'documentPageCount': len(reader.pages),
                'filingHistory': [{'filingDate': iso_date(row['FilingDate']), 'documentId': row['DocID'],
                                   'sourceUrl': f"https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/{row['DocID']}.pdf"}
                                  for row in filings],
                'notes': ['의회 거래공시(PTR)이며 13F가 아닙니다. 거래일과 공개일을 구분합니다.',
                          'SP는 배우자 명의입니다. 금액은 신고 범위이며 정확한 거래금액이 아닙니다.',
                          '원문은 WBD 합병에 따른 현금 수령액을 매도(S)로 신고합니다.',
                          'PTR는 현재 보유액이나 전체 포트폴리오 비중을 보여주지 않습니다.']}
    # This reviewed single-row extraction is intentionally exact. A new document
    # must be parsed and reviewed, never silently converted into this old trade.
    if doc_id != '20035553' or not all(value in pdf_text for value in ('REOF XXX, LLC', '09/08/2026', '$500,001', '$1,000,000', '10/02/2026')):
        return {'id': 'pelosi', 'nameKo': '낸시 펠로시', 'personName': 'Nancy Pelosi',
                'entityName': 'U.S. House of Representatives · Nancy Pelosi', 'cik': None,
                'filingType': 'PTR', 'status': 'NEEDS_REVIEW', 'statusReason': '새 PTR 원문 행 수동 대사 필요',
                'reportPeriod': None, 'filingDate': iso_date(latest['FilingDate']), 'sourceUrl': url,
                'positionCount': None, 'reportedValueUsd': None, 'holdings': [], 'transactions': [],
                'notes': ['의회 거래공시(PTR)는 13F 분기말 보유명세가 아닙니다. 새 문서를 이전 거래로 대체하지 않았습니다.']}
    transaction = {'assetName': 'REOF XXX, LLC', 'ticker': None, 'owner': 'SP',
                   'ownerLabel': '배우자', 'transactionDate': '2026-09-08', 'notificationDate': '2026-09-08',
                   'transactionType': 'PURCHASE', 'transactionTypeLabel': '매수',
                   'amountRange': '$500,001–$1,000,000', 'amountMinUsd': 500001, 'amountMaxUsd': 1000000,
                   'disclosureDate': '2026-10-02', 'filingDate': '2026-10-02', 'sourceUrl': url,
                   'instrument': '비상장 LLC 지분', 'assetTypeCode': 'AB',
                   'description': '샌프란시스코 상업용 오피스 부동산을 취득·관리하는 LLC 투자. [AB]는 자산 유형 코드이며 주식 티커가 아닙니다.'}
    return {'id': 'pelosi', 'nameKo': '낸시 펠로시', 'personName': 'Nancy Pelosi',
            'entityName': 'U.S. House of Representatives · Nancy Pelosi', 'cik': None,
            'filingType': 'PTR', 'status': 'VERIFIED_SOURCE', 'statusReason': '2026년 공식 공개목록과 최신 PTR 1행 대사',
            'reportPeriod': None, 'filingDate': '2026-10-02', 'accession': doc_id, 'isAmendment': False,
            'sourceUrl': url, 'indexUrl': index_url, 'latestCheckAt': dt.datetime.now(KST).isoformat(),
            'positionCount': None, 'reportedValueUsd': None, 'holdings': [], 'transactions': [transaction],
            'officialIndexPtrCount': len(filings), 'documentPageCount': len(reader.pages),
            'filingHistory': [{'filingDate': iso_date(row['FilingDate']), 'documentId': row['DocID'],
                               'sourceUrl': f"https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/{row['DocID']}.pdf"}
                              for row in filings],
            'notes': ['의회 거래공시(PTR)이며 13F가 아닙니다. 거래일과 공개일을 구분합니다.',
                      'SP는 배우자 명의입니다. 금액은 신고 범위이며 정확한 거래금액이 아닙니다.',
                      'PTR는 특정 거래 신고이며 현재 보유액·전체 자산·수익률·포트폴리오 비중을 보여주지 않습니다.',
                      '이 화면은 최신 PTR의 1행을 표시합니다. 이전 신고 문서는 원문 링크로 제공하며 전체 거래 이력으로 표시하지 않습니다.']}


def collect(cutoff, output=DEFAULT_OUTPUT, offline=False, raw_root=RAW_ROOT):
    iso_date(cutoff)
    client = SourceClient(raw_root, offline=offline)
    targets = []
    errors = []
    for spec in TARGETS:
        try:
            targets.append(collect_13f(client, spec, cutoff))
        except Exception as error:
            errors.append({'id': spec[0], 'error': type(error).__name__ + ':' + str(error)})
            targets.append({'id': spec[0], 'nameKo': spec[1], 'personName': spec[2], 'entityName': None,
                            'cik': spec[3].zfill(10), 'filingType': '13F', 'status': 'UNAVAILABLE',
                            'statusReason': '공식 원문 수집·대사 실패', 'reportPeriod': None, 'filingDate': None,
                            'reportedValueUsd': None, 'holdings': [], 'transactions': [], 'notes': []})
    try:
        targets.append(collect_pelosi(client, cutoff))
    except Exception as error:
        errors.append({'id': 'pelosi', 'error': type(error).__name__ + ':' + str(error)})
        targets.append({'id': 'pelosi', 'nameKo': '낸시 펠로시', 'personName': 'Nancy Pelosi',
                        'entityName': 'U.S. House of Representatives · Nancy Pelosi', 'cik': None,
                        'filingType': 'PTR', 'status': 'UNAVAILABLE', 'statusReason': '공식 PTR 수집·대사 실패',
                        'reportPeriod': None, 'filingDate': None, 'reportedValueUsd': None,
                        'holdings': [], 'transactions': [], 'notes': []})
    snapshot = {'schemaVersion': 1, 'asOfDate': cutoff, 'generatedAt': dt.datetime.now(KST).isoformat(),
                'collectionMode': 'OFFLINE_RECEIPTS' if offline else 'OFFICIAL_LIVE_LOOKUP',
                'methodology': {'scope': '요청한 6개 기관 13F 및 낸시 펠로시 최신 의회 PTR',
                                'weightBasis': '검증된 달러 표의 전체 공시 보유가치(옵션 포함) 대비 비중 · AUM 아님',
                                'aggregationKey': 'CUSIP + SH/PRN + PUT/CALL',
                                'comparisonBasis': '동일 범위·동일 증권의 직전 분기말 신고수량 대비 차이',
                                'valuePolicy': '원문 달러값 보존. 단위 의심 항목은 USD값·비중 null; 임의 1000배 금지.',
                                'privacy': '공개 공시 데이터만 포함. 로컬 경로·인증정보·사용자 개인 자산 제외.'},
                'targets': targets, 'collectionErrors': errors}
    output = Path(output)
    if errors and output.exists():
        raise RuntimeError('collection_failed_existing_snapshot_preserved:' + json.dumps(errors, ensure_ascii=True))
    output.parent.mkdir(parents=True, exist_ok=True)
    temp = output.with_name(output.name + '.tmp')
    temp.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temp.replace(output)
    receipts = {'asOfDate': cutoff, 'generatedAt': snapshot['generatedAt'], 'sources': client.receipts,
                'collectionErrors': errors}
    (Path(raw_root) / ('receipts-' + cutoff + '.json')).write_text(json.dumps(receipts, indent=2), encoding='utf-8')
    return snapshot


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--as-of', default=dt.datetime.now(KST).date().isoformat())
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument('--offline', action='store_true', help='Use saved receipts only; does not claim a fresh live lookup')
    args = parser.parse_args()
    try:
        result = collect(args.as_of, args.output, args.offline)
        print(json.dumps({'output': str(args.output), 'asOfDate': result['asOfDate'],
                          'targets': [{'id': row['id'], 'status': row['status'], 'period': row.get('reportPeriod'),
                                       'positions': row.get('positionCount')} for row in result['targets']]}, ensure_ascii=True))
        sys.exit(2 if result['collectionErrors'] else 0)
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)
