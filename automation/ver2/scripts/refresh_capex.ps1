param([Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
function Write-TextFile {
    param([string]$Path,[string]$Text,[System.Text.Encoding]$Encoding)
    [IO.Directory]::CreateDirectory((Split-Path -Parent $Path)) | Out-Null
    [IO.File]::WriteAllText($Path, $Text, $Encoding)
}
$officialIrHostsByCompany = @{
    'Amazon'    = @('ir.aboutamazon.com', 's2.q4cdn.com', 'www.sec.gov', 'sec.gov', 'data.sec.gov')
    'Alphabet'  = @('abc.xyz', 's206.q4cdn.com', 'www.sec.gov', 'sec.gov', 'data.sec.gov')
    'Meta'      = @('investor.atmeta.com', 's21.q4cdn.com', 'www.sec.gov', 'sec.gov', 'data.sec.gov')
    'Microsoft' = @('www.microsoft.com', 'microsoft.com', 'www.sec.gov', 'sec.gov', 'data.sec.gov')
    'Oracle'    = @('investor.oracle.com', 'www.sec.gov', 'sec.gov', 'data.sec.gov')
}

$secCapexCacheDir = Join-Path $PSScriptRoot 'sec_capex_cache'
$secCapexUserAgent = if ($env:SEC_USER_AGENT) { $env:SEC_USER_AGENT } else { 'PublicMarketBriefing/1.0 (contact@example.com)' }

$capexOfficialIrOnly = $true

function Test-IsOfficialIrUrl {
    param(
        [string]$Company,
        [string]$Url
    )

    if ([string]::IsNullOrWhiteSpace($Company) -or [string]::IsNullOrWhiteSpace($Url)) { return $false }
    $allowedHosts = @($officialIrHostsByCompany[$Company])
    if ($allowedHosts.Count -eq 0) { return $false }
    try {
        $uri = [System.Uri]$Url
    } catch {
        return $false
    }
    $urlHost = $uri.Host.ToLowerInvariant()
    return @(
        $allowedHosts |
            Where-Object {
                $candidate = [string]$_
                $urlHost -eq $candidate -or $urlHost.EndsWith('.' + $candidate)
            }
    ).Count -gt 0
}

function Get-OfficialIrEvidenceLinks {
    param(
        [string]$Company,
        [object[]]$Evidence
    )

    return @(
        @($Evidence) |
            Where-Object {
                $_ -and
                -not [string]::IsNullOrWhiteSpace([string]$_['url']) -and
                (Test-IsOfficialIrUrl -Company $Company -Url ([string]$_['url']))
            } |
            ForEach-Object {
                [ordered]@{
                    label = [string]$_['label']
                    url   = [string]$_['url']
                }
            }
    )
}

function Get-SecCapexCacheFilePath {
    param(
        [string]$Company,
        [string]$Fact
    )

    if (-not (Test-Path $secCapexCacheDir)) {
        New-Item -ItemType Directory -Path $secCapexCacheDir | Out-Null
    }

    $safeCompany = ($Company -replace '[^A-Za-z0-9_\-]', '_')
    $safeFact = ($Fact -replace '[^A-Za-z0-9_\-]', '_')
    return (Join-Path $secCapexCacheDir ($safeCompany + '_' + $safeFact + '.json'))
}

function Get-SecCompanyConceptData {
    param(
        [string]$Company,
        [string]$Cik,
        [string]$Fact
    )

    $cachePath = Get-SecCapexCacheFilePath -Company $Company -Fact $Fact
    if (Test-Path $cachePath) {
        try {
            return (Get-Content -LiteralPath $cachePath -Raw -Encoding UTF8 | ConvertFrom-Json)
        } catch {
        }
    }

    $headers = @{ 'User-Agent' = $secCapexUserAgent }
    $uri = "https://data.sec.gov/api/xbrl/companyconcept/CIK$Cik/us-gaap/$Fact.json"
    $raw = (Invoke-WebRequest -Uri $uri -Headers $headers -UseBasicParsing -TimeoutSec 40).Content
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    Write-TextFile -Path $cachePath -Text $raw -Encoding $utf8NoBom
    return ($raw | ConvertFrom-Json)
}

function Get-SecFilingIndexUrl {
    param(
        [string]$Cik,
        [string]$Accession
    )

    if ([string]::IsNullOrWhiteSpace($Cik) -or [string]::IsNullOrWhiteSpace($Accession)) { return $null }
    $trimmedCik = ($Cik -replace '^0+', '')
    $accnNoDash = ($Accession -replace '-', '')
    return "https://www.sec.gov/Archives/edgar/data/$trimmedCik/$accnNoDash/$Accession-index.htm"
}

function Get-SecAnnualCapexRecords {
    param(
        [string]$Company,
        [string]$Cik,
        [string]$Fact,
        [ValidateSet('CY','FY')]
        [string]$PeriodBasis,
        [int]$StartYear = 2022
    )

    $concept = $null
    try {
        $concept = Get-SecCompanyConceptData -Company $Company -Cik $Cik -Fact $Fact
    } catch {
        Write-Warning ("SEC CAPEX fetch failed for " + $Company + ": " + $_.Exception.Message)
        return @()
    }

    $usdRows = @($concept.units.USD)
    $annualRows = @(
        $usdRows |
            Where-Object {
                $_.form -match '^10-K' -and
                -not [string]::IsNullOrWhiteSpace([string]$_.end) -and
                [datetime]$_.end -ge ([datetime]::new($StartYear, 1, 1))
            } |
            Group-Object { [string]$_.end } |
            ForEach-Object {
                $_.Group | Sort-Object { [datetime]$_.filed } -Descending | Select-Object -First 1
            } |
            Sort-Object { [datetime]$_.end }
    )

    return @(
        foreach ($row in $annualRows) {
            $startDate = [datetime]$row.start
            $endDate = [datetime]$row.end
            $periodYear = $endDate.Year
            $period = if ($PeriodBasis -eq 'FY') { 'FY' + $periodYear } else { 'CY' + $periodYear }
            $amountBillion = [math]::Round(([double]$row.val / 1000000000), 2)
            $sourceUrl = Get-SecFilingIndexUrl -Cik $Cik -Accession ([string]$row.accn)
            [ordered]@{
                date = ([datetime]$row.filed).ToString('yyyy-MM-dd')
                company = $Company
                year = $periodYear
                period = $period
                metricType = '연간 실제치'
                amountBillion = $amountBillion
                amountText = ('$' + $amountBillion.ToString('0.##') + 'B')
                summary = ('공식 SEC 10-K 기준 ' + $period + ' CAPEX/PP&E 투자 ' + $amountBillion.ToString('0.##') + 'B 입니다.')
                source = 'SEC 10-K'
                sourceUrl = $sourceUrl
                requiresManualCheck = $false
                evidence = @(
                    if ($sourceUrl) {
                        [ordered]@{ label = 'SEC filing index'; url = $sourceUrl }
                    }
                )
                categories = @('Hyperscaler')
                startDate = $startDate.ToString('yyyy-MM-dd')
                endDate = $endDate.ToString('yyyy-MM-dd')
            }
        }
    )
}

$capexTrackerItems = New-Object System.Collections.Generic.List[object]
$capexInvestmentEvents = New-Object System.Collections.Generic.List[object]
$verifiedWebCapexRecords = @(
    [ordered]@{
        date = '2026-07-30'
        company = 'Amazon'
        year = 2026
        period = 'Q2 2026'
        metricType = '분기 실제치'
        amountBillion = 54.2
        amountText = '$54.2B'
        summary = 'Q2 2026 purchases of property and equipment는 542억 달러입니다. 매각·인센티브를 차감한 순 CAPEX는 531억 달러이며, 분기 FCF는 -77억 달러입니다.'
        source = 'Amazon IR'
        sourceUrl = 'https://ir.aboutamazon.com/news-release/news-release-details/2026/Amazon-com-Announces-Second-Quarter-Results/default.aspx'
        requiresManualCheck = $false
        evidence = @(
            [ordered]@{ label = 'Amazon Q2 실적자료'; url = 'https://ir.aboutamazon.com/news-release/news-release-details/2026/Amazon-com-Announces-Second-Quarter-Results/default.aspx' }
        )
        categories = @('Hyperscaler')
    },
    [ordered]@{
        date = '2026-04-30'
        company = 'Amazon'
        year = 2026
        period = 'Q1 2026'
        metricType = '분기 실제치'
        amountBillion = 44.2
        amountText = '$44.2B'
        summary = 'Q1 2026 purchases of property and equipment는 442억 달러. TTM 기준 PP&E 순투자 증가는 AI 투자가 주된 원인입니다.'
        source = 'Amazon IR'
        sourceUrl = 'https://ir.aboutamazon.com/news-release/news-release-details/2026/Amazon-com-Announces-First-Quarter-Results/default.aspx'
        requiresManualCheck = $false
        evidence = @(
            [ordered]@{ label = 'Amazon Q1 PDF'; url = 'https://s2.q4cdn.com/299287126/files/doc_earnings/2026/q1/earnings-result/AMZN-Q1-2026-Earnings-Release.pdf' }
        )
        categories = @('Hyperscaler')
    },
    [ordered]@{
        date = '2026-02-09'
        company = 'Amazon'
        year = 2026
        period = 'CY2026'
        metricType = '연간 가이던스'
        amountBillion = 200.0
        amountText = '$200B'
        summary = '2026년 전사 CAPEX 가이던스 약 2,000억 달러. AWS 데이터센터와 AI 인프라 증설이 핵심입니다.'
        source = 'Amazon IR'
        sourceUrl = 'https://ir.aboutamazon.com/news-release/news-release-details/2026/Amazon-com-Announces-Fourth-Quarter-Results/'
        requiresManualCheck = $false
        evidence = @(
            [ordered]@{ label = 'Industrial Info'; url = 'https://www.industrialinfo.com/news/article/amazon-boosts-2026-capex-to-200-billion-amid-data-center-surge--353118' },
            [ordered]@{ label = 'CIO Dive'; url = 'https://www.ciodive.com/news/amazon-adds-200b-ai-buildout-rush/811633/' },
            [ordered]@{ label = 'Amazon 주주서한'; url = 'https://ir.aboutamazon.com/files/doc_financials/2026/ar/2025-Shareholder-Letter-Final.pdf' }
        )
        categories = @('Hyperscaler')
    },
    [ordered]@{
        date = '2026-04-29'
        company = 'Alphabet'
        year = 2026
        period = 'Q1 2026'
        metricType = '분기 실제치'
        amountBillion = 35.7
        amountText = '$35.7B'
        summary = 'Q1 2026 CAPEX 357억 달러. 대부분은 AI 기회를 지원하기 위한 기술 인프라였고, 서버 60%, 데이터센터·네트워크 40%로 설명됐습니다.'
        source = 'Alphabet IR'
        sourceUrl = 'https://abc.xyz/investor/events/event-details/2026/2026-Q1-Earnings-Call-2026-nW8kCrBAKS/default.aspx'
        requiresManualCheck = $false
        evidence = @(
            [ordered]@{ label = 'Alphabet Q1 콜'; url = 'https://abc.xyz/investor/events/event-details/2026/2026-Q1-Earnings-Call-2026-nW8kCrBAKS/default.aspx' }
        )
        categories = @('Hyperscaler')
    },
    [ordered]@{
        date = '2026-02-04'
        company = 'Alphabet'
        year = 2026
        period = 'CY2026'
        metricType = '연간 가이던스'
        amountBillion = 185.0
        amountText = 'USD 175B~185B'
        summary = 'Q4 2025 콜 기준 2026년 CAPEX 가이던스는 1,750억~1,850억 달러였습니다.'
        source = 'Alphabet IR'
        sourceUrl = 'https://abc.xyz/investor/events/event-details/2026/2025-Q4-Earnings-Call-2026-Dr_C033hS6/default.aspx'
        requiresManualCheck = $false
        evidence = @(
            [ordered]@{ label = 'Seeking Alpha'; url = 'https://seekingalpha.com/news/4582436-alphabet-signals-2026-capex-180b-190b-while-expecting-2027-to-rise-significantly' }
        )
        categories = @('Hyperscaler')
    },
    [ordered]@{
        date = '2026-04-29'
        company = 'Alphabet'
        year = 2026
        period = 'CY2026'
        metricType = '연간 가이던스'
        amountBillion = 190.0
        amountText = 'USD 180B~190B'
        summary = '2026년 CAPEX 가이던스를 1,800억~1,900억 달러로 상향. AI 컴퓨트 수요와 Google Cloud 성장이 배경입니다.'
        source = 'Alphabet IR'
        sourceUrl = 'https://abc.xyz/investor/events/event-details/2026/2026-Q1-Earnings-Call-2026-nW8kCrBAKS/default.aspx'
        requiresManualCheck = $false
        evidence = @(
            [ordered]@{ label = 'Economic Times DC'; url = 'https://datacenters.economictimes.indiatimes.com/news/investments-deals/alphabet-boosts-2026-capex-to-190-billion-for-ai-infrastructure-amid-cloud-growth/130669925' },
            [ordered]@{ label = 'Seeking Alpha'; url = 'https://seekingalpha.com/news/4582436-alphabet-signals-2026-capex-180b-190b-while-expecting-2027-to-rise-significantly' }
        )
        categories = @('Hyperscaler')
    },
    [ordered]@{
        date = '2026-04-29'
        company = 'Alphabet'
        year = 2027
        period = 'CY2027'
        metricType = '차년도 방향'
        amountBillion = 0.0
        amountText = '미정'
        summary = '2027년 CAPEX는 2026년보다 의미 있게 증가할 전망이나, 정량 가이던스는 향후 실적 콜에서 제시한다고 밝혔습니다.'
        source = 'Alphabet IR'
        sourceUrl = 'https://abc.xyz/investor/events/event-details/2026/2026-Q1-Earnings-Call-2026-nW8kCrBAKS/default.aspx'
        requiresManualCheck = $false
        evidence = @(
            [ordered]@{ label = 'MarketWatch'; url = 'https://www.marketwatch.com/livecoverage/alphabet-earnings-google-stock-results-cloud-ai/card/alphabet-raises-ai-spending-plans-for-2026-and-2027-YemWtwomb9wm6FcozjEc' }
        )
        categories = @('Hyperscaler')
    },
    [ordered]@{
        date = '2026-07-29'
        company = 'Meta'
        year = 2026
        period = 'Q2 2026'
        metricType = '분기 실제치'
        amountBillion = 31.078
        amountText = '$31.08B'
        summary = 'Q2 2026 CAPEX는 금융리스 원금상환 포함 310.8억 달러입니다. 영업현금흐름 318.6억 달러에서 이를 차감한 FCF는 7.8억 달러입니다.'
        source = 'Meta IR'
        sourceUrl = 'https://investor.atmeta.com/investor-news/press-release-details/2026/Meta-Reports-Second-Quarter-2026-Results/default.aspx'
        requiresManualCheck = $false
        evidence = @(
            [ordered]@{ label = 'Meta Q2 실적자료'; url = 'https://investor.atmeta.com/investor-news/press-release-details/2026/Meta-Reports-Second-Quarter-2026-Results/default.aspx' }
        )
        categories = @('Hyperscaler')
    },
    [ordered]@{
        date = '2026-07-29'
        company = 'Meta'
        year = 2026
        period = 'CY2026'
        metricType = '연간 가이던스'
        amountBillion = 145.0
        amountText = 'USD 130B~145B'
        summary = '2026년 CAPEX 가이던스 범위를 1,300억~1,450억 달러로 좁혔습니다.'
        source = 'Meta IR'
        sourceUrl = 'https://investor.atmeta.com/investor-news/press-release-details/2026/Meta-Reports-Second-Quarter-2026-Results/default.aspx'
        requiresManualCheck = $false
        evidence = @(
            [ordered]@{ label = 'Meta Q2 실적자료'; url = 'https://investor.atmeta.com/investor-news/press-release-details/2026/Meta-Reports-Second-Quarter-2026-Results/default.aspx' }
        )
        categories = @('Hyperscaler')
    },
    [ordered]@{
        date = '2026-04-29'
        company = 'Meta'
        year = 2026
        period = 'Q1 2026'
        metricType = '분기 실제치'
        amountBillion = 19.84
        amountText = '$19.84B'
        summary = 'Q1 2026 CAPEX는 금융리스 원금상환 포함 198.4억 달러입니다.'
        source = 'Meta IR'
        sourceUrl = 'https://investor.atmeta.com/investor-news/press-release-details/2026/Meta-Reports-First-Quarter-2026-Results/default.aspx'
        requiresManualCheck = $false
        evidence = @(
            [ordered]@{ label = 'Meta Q1 PDF'; url = 'https://s21.q4cdn.com/399680738/files/doc_financials/2026/q1/Meta-03-31-2026-Exhibit-99-1_final.pdf' }
        )
        categories = @('Hyperscaler')
    },
    [ordered]@{
        date = '2026-04-29'
        company = 'Meta'
        year = 2026
        period = 'CY2026'
        metricType = '연간 가이던스'
        amountBillion = 145.0
        amountText = 'USD 125B~145B'
        summary = '2026년 CAPEX 가이던스를 1,250억~1,450억 달러로 상향. 부품 가격과 데이터센터 비용 증가가 원인입니다.'
        source = 'Meta IR'
        sourceUrl = 'https://investor.atmeta.com/investor-news/press-release-details/2026/Meta-Reports-First-Quarter-2026-Results/default.aspx'
        requiresManualCheck = $false
        evidence = @(
            [ordered]@{ label = 'Yahoo Finance'; url = 'https://finance.yahoo.com/markets/stocks/articles/meta-just-bumped-2026-capex-232250811.html' },
            [ordered]@{ label = 'Global Data Center Hub'; url = 'https://www.globaldatacenterhub.com/p/meta-q1-2026-the-145b-reset-and-the' }
        )
        categories = @('Hyperscaler')
    },
    [ordered]@{
        date = '2026-04-29'
        company = 'Microsoft'
        year = 2026
        period = 'FY2026 Q3'
        metricType = '분기 실제치'
        amountBillion = 31.9
        amountText = '$31.9B'
        summary = 'FY2026 Q3 CAPEX 319억 달러. 약 3분의 2는 GPU·CPU 등 단기자산, 나머지는 장기 데이터센터 자산입니다.'
        source = 'Microsoft Investor Relations'
        sourceUrl = 'https://www.microsoft.com/en-us/investor/events/fy-2026/earnings-fy-2026-q3'
        requiresManualCheck = $false
        evidence = @(
            [ordered]@{ label = 'Microsoft FY26 Q3 콜'; url = 'https://www.microsoft.com/en-us/investor/events/fy-2026/earnings-fy-2026-q3' },
            [ordered]@{ label = 'MarketWatch'; url = 'https://www.marketwatch.com/livecoverage/microsoft-earnings-stock-results-azure-guidance/card/here-s-what-may-be-worrying-microsoft-investors-3OxZoZsHXjJJ3SDEvFrE' }
        )
        categories = @('Hyperscaler')
    },
    [ordered]@{
        date = '2026-04-29'
        company = 'Microsoft'
        year = 2026
        period = 'CY2026'
        metricType = '연간 가이던스'
        amountBillion = 190.0
        amountText = '~$190B'
        summary = 'Calendar 2026 CAPEX를 약 1,900억 달러로 제시. 이 중 약 250억 달러는 부품 가격 상승 영향입니다.'
        source = 'Microsoft Investor Relations'
        sourceUrl = 'https://www.microsoft.com/en-us/investor/events/fy-2026/earnings-fy-2026-q3'
        requiresManualCheck = $false
        evidence = @(
            [ordered]@{ label = 'Microsoft FY26 Q3 콜'; url = 'https://www.microsoft.com/en-us/investor/events/fy-2026/earnings-fy-2026-q3' },
            [ordered]@{ label = 'Tom''s Hardware'; url = 'https://www.tomshardware.com/tech-industry/big-tech/big-techs-ai-spending-plans-reach-725-billion' }
        )
        categories = @('Hyperscaler')
    },
    [ordered]@{
        date = '2026-06-10'
        company = 'Oracle'
        year = 2026
        period = 'FY2026'
        metricType = '연간 실제치'
        amountBillion = 55.7
        amountText = '$55.7B'
        summary = 'FY2026 CAPEX 557억 달러. AI 클라우드 인프라와 데이터센터 확장 때문에 자유현금흐름이 마이너스로 전환됐습니다.'
        source = 'Oracle IR'
        sourceUrl = 'https://investor.oracle.com/investor-news/news-details/2026/Oracle-Announces-Record-Q4-and-FY-2026-Results-Driven-by-Cloud-Infrastructure--Cloud-Applications/default.aspx'
        requiresManualCheck = $false
        evidence = @(
            [ordered]@{ label = 'The Register'; url = 'https://www.theregister.com/paas-and-iaas/2026/06/11/oracles-ai-datacenter-splurge-gives-investors-the-capex-jitters/5254035' },
            [ordered]@{ label = 'StockTitan'; url = 'https://www.stocktitan.net/sec-filings/ORCL/8-k-oracle-corp-reports-material-event-808097bbcd84.html' },
            [ordered]@{ label = 'MarketWatch'; url = 'https://www.marketwatch.com/story/oracles-stock-slides-after-earnings-as-the-steep-price-of-ai-spooks-investors-0653b309' }
        )
        categories = @('Hyperscaler')
    },
    [ordered]@{
        date = '2026-06-10'
        company = 'Oracle'
        year = 2027
        period = 'FY2027'
        metricType = '차년도 가이던스'
        amountBillion = 95.0
        amountText = 'USD 90B~95B'
        summary = 'FY2027 총 CAPEX는 900억~950억 달러 수준으로 제시됐고, 이 중 순현금 CAPEX는 약 700억 달러로 컨퍼런스콜에서 언급됐습니다.'
        source = 'Oracle IR'
        sourceUrl = 'https://investor.oracle.com/investor-news/news-details/2026/Oracle-Announces-Record-Q4-and-FY-2026-Results-Driven-by-Cloud-Infrastructure--Cloud-Applications/default.aspx'
        requiresManualCheck = $true
        evidence = @(
            [ordered]@{ label = 'Fortune transcript'; url = 'https://fortune.com/company/oracle/earnings/q4-2026/' },
            [ordered]@{ label = 'Sherwood News'; url = 'https://sherwood.news/tech/oracle-q4-earnings-and-revenue-top-estimates/' }
        )
        categories = @('Hyperscaler')
    }
)
$secAnnualCapexSpecs = @(
    @{ company = 'Amazon'; cik = '0001018724'; fact = 'PaymentsToAcquireProductiveAssets'; periodBasis = 'CY' },
    @{ company = 'Alphabet'; cik = '0001652044'; fact = 'PaymentsToAcquirePropertyPlantAndEquipment'; periodBasis = 'CY' },
    @{ company = 'Meta'; cik = '0001326801'; fact = 'PaymentsToAcquirePropertyPlantAndEquipment'; periodBasis = 'CY' },
    @{ company = 'Microsoft'; cik = '0000789019'; fact = 'PaymentsToAcquirePropertyPlantAndEquipment'; periodBasis = 'FY' },
    @{ company = 'Oracle'; cik = '0001341439'; fact = 'PaymentsToAcquirePropertyPlantAndEquipment'; periodBasis = 'FY' }
)
foreach ($secSpec in $secAnnualCapexSpecs) {
    $verifiedWebCapexRecords += @(Get-SecAnnualCapexRecords -Company $secSpec.company -Cik $secSpec.cik -Fact $secSpec.fact -PeriodBasis $secSpec.periodBasis -StartYear 2022)
}
foreach ($record in $verifiedWebCapexRecords) {
    if ($record.requiresManualCheck -eq $true) { continue }
    $officialSourceUrl = [string]$record.sourceUrl
    if (-not (Test-IsOfficialIrUrl -Company ([string]$record.company) -Url $officialSourceUrl)) { continue }
    $officialEvidence = @(Get-OfficialIrEvidenceLinks -Company ([string]$record.company) -Evidence @($record.evidence))
    $capexTrackerItems.Add([ordered]@{
        date = $record.date
        amountBillion = $record.amountBillion
        amountText = $record.amountText
        company = $record.company
        year = $record.year
        period = $record.period
        startDate = $record.startDate
        endDate = $record.endDate
        metricType = $record.metricType
        summary = $record.summary
        text = $record.summary
        source = $record.source
        sourceUrl = $officialSourceUrl
        evidence = @($officialEvidence)
        isOfficialIr = $true
        categories = @($record.categories)
    })
    $capexInvestmentEvents.Add([ordered]@{
        date = $record.date
        company = $record.company
        year = $record.year
        period = $record.period
        startDate = $record.startDate
        endDate = $record.endDate
        metricType = $record.metricType
        amountBillion = $record.amountBillion
        amountText = $record.amountText
        summary = $record.summary
        text = $record.summary
        source = $record.source
        sourceUrl = $officialSourceUrl
        evidence = @($officialEvidence)
        isOfficialIr = $true
        categories = @($record.categories)
    })
}
$capexTrackerItems = @(
    $capexTrackerItems |
        Where-Object { $_['isOfficialIr'] -eq $true -and -not [string]::IsNullOrWhiteSpace([string]$_['sourceUrl']) } |
        Sort-Object { $_['date'] }
)
$capexTimeline = @(
    $capexTrackerItems |
        Group-Object { $_['date'] } |
        Sort-Object Name |
        ForEach-Object {
            [ordered]@{
                date = $_.Name
                count = $_.Count
            }
        }
)
$capexCategoryCounts = [ordered]@{}
foreach ($item in $capexTrackerItems) {
    foreach ($category in @($item['categories'])) {
        if (-not $capexCategoryCounts.Contains($category)) { $capexCategoryCounts[$category] = 0 }
        $capexCategoryCounts[$category]++
    }
}
$capexInvestmentRows = @(
    $capexInvestmentEvents |
        Where-Object { $_['isOfficialIr'] -eq $true -and -not [string]::IsNullOrWhiteSpace([string]$_['sourceUrl']) } |
        Sort-Object { $_['date'] } |
        Group-Object { $_['company'] + '|' + $_['year'] + '|' + $_['metricType'] + '|' + $_['period'] } |
        ForEach-Object {
            $events = @($_.Group | Sort-Object { $_['date'] })
            $latest = $events[-1]
            $previous = @($events | Where-Object { [double]($_['amountBillion']) -ne [double]($latest['amountBillion']) } | Select-Object -Last 1)
            [ordered]@{
                key = $_.Name
                company = $latest['company']
                year = $latest['year']
                period = $latest['period']
                startDate = $latest['startDate']
                endDate = $latest['endDate']
                metricType = $latest['metricType']
                currentAmountBillion = [double]$latest['amountBillion']
                previousAmountBillion = if ($previous.Count) { [double]$previous[-1]['amountBillion'] } else { $null }
                currentDate = $latest['date']
                previousDate = if ($previous.Count) { $previous[-1]['date'] } else { $null }
                amountText = if ($latest['amountText']) { $latest['amountText'] } else { ('$' + ([double]$latest['amountBillion']).ToString('0.##') + 'B') }
                summary = $latest['summary']
                text = $latest['summary']
                source = $latest['source']
                sourceUrl = $latest['sourceUrl']
                evidence = @($latest['evidence'])
                isOfficialIr = $true
                categories = @($latest['categories'])
                eventCount = $events.Count
            }
        } |
        Sort-Object @{Expression={ [int]($_['year']) };Descending=$false}, @{Expression={ [double]($_['currentAmountBillion']) };Descending=$true}
)
$capexTracker = [ordered]@{
    start = if ($capexTrackerItems.Count) { $capexTrackerItems[0]['date'] } else { $null }
    end = if ($capexTrackerItems.Count) { $capexTrackerItems[-1]['date'] } else { $null }
    total = $capexTrackerItems.Count
    timeline = $capexTimeline
    categoryCounts = $capexCategoryCounts
    investments = $capexInvestmentRows
    items = @($capexTrackerItems | Where-Object { @($_['evidence']).Count -gt 0 } | Select-Object -Last 80)
}

$annualCompanies = @($capexTracker.items | Where-Object { $_['source'] -eq 'SEC 10-K' } |
    ForEach-Object { $_['company'] } | Sort-Object -Unique)
if ($capexTracker.total -lt 1 -or @($capexTracker.investments).Count -lt 1 -or $annualCompanies.Count -lt 5) {
    throw 'CAPEX tracker output is incomplete.'
}
[IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputPath), ($capexTracker | ConvertTo-Json -Depth 9), [Text.UTF8Encoding]::new($false))
