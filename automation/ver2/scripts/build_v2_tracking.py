"""KRW 100m model vs S&P price index, daily closes and monthly targets."""
import json,re,math
from datetime import datetime,timezone
from pathlib import Path
import pandas as pd
ROOT=Path(__file__).resolve().parents[1]

def build(report,site,signal_history):
 text=Path(report).read_text(encoding='utf-8-sig');match=re.search(r'(?m)^    const series = (.*?);\s*$',text)
 if not match:raise ValueError('report series missing')
 return build_from_series(json.loads(match.group(1)),site,signal_history)

def build_from_series(data,site,signal_history,previous_prices=None):
 fields={'equity':'S&P 500','btc':'Bitcoin (USD)','gold':'Gold','fx':'USD/KRW'};frames={}
 for k,name in fields.items():
  x=data[name];v=pd.Series(x['values'],index=pd.to_datetime(x['dates']),dtype=float).dropna().sort_index();frames[k]=v[~v.index.duplicated(keep='last')]
 # Bootstrap only the missing Jan 1 BTC close from the frozen Yahoo BTC/USD snapshot.
 # Later observations retain their original source; this is explicitly disclosed.
 seed=ROOT/'analysis/tracking_price_snapshot.csv'
 if seed.exists():
  raw=pd.read_csv(seed,index_col=0,parse_dates=True)
  if pd.Timestamp('2026-01-01') in raw.index and pd.Timestamp('2026-01-01') not in frames['btc'].index:
   v=raw.loc[pd.Timestamp('2026-01-01'),'BTC-USD']
   if pd.notna(v) and float(v)>0:frames['btc']=pd.concat([frames['btc'],pd.Series([float(v)],index=[pd.Timestamp('2026-01-01')])]).sort_index()
 dates=frames['equity'].index;rows=[];missing_dates=[]
 for day in dates:
  if day<pd.Timestamp('2026-01-02'):continue
  # Prior completed dates for gold, BTC and FX avoid a later same-day close.
  vals={};source_dates={}
  for k in ('equity','gold','btc','fx'):
   cutoff=day if k=='equity' else day-pd.Timedelta(days=1);s=frames[k].loc[:cutoff].dropna()
   if s.empty or (day-s.index[-1]).days>5:break
   vals[k]=float(s.iloc[-1]);source_dates[k]=str(s.index[-1].date())
  if len(vals)==4 and all(math.isfinite(v) and v>0 for v in vals.values()):rows.append({'date':str(day.date()),'prices':vals,'sourceDates':source_dates})
  else:missing_dates.append(str(day.date()))
 if not rows:raise ValueError('tracking price data unavailable')
 path=Path(site)/'asset-allocation/ver2-tracking-prices.json'
 old=previous_prices if previous_prices is not None else (json.loads(path.read_text(encoding='utf8'))['observations'] if path.exists() else [])
 merged={x['date']:x for x in old}
 for x in rows:merged.setdefault(x['date'],x)
 if any(d not in merged for d in missing_dates):raise ValueError('tracking inputs unavailable for '+','.join(d for d in missing_dates if d not in merged))
 rows=[merged[k] for k in sorted(merged) if k>='2026-01-02']
 if rows[0]['date']!='2026-01-02':raise ValueError('tracking start date missing')
 if any((pd.Timestamp(b['date'])-pd.Timestamp(a['date'])).days>5 for a,b in zip(rows,rows[1:])):raise ValueError('tracking has a missing market-data interval')
 research=json.loads((ROOT/'web/dist/ver2-research-history.json').read_text(encoding='utf8'));hist={o['month']:o for o in research['observations']}
 obs=signal_history.get('observations',[]);fee=.001;initial=100_000_000;vals={a:0.0 for a in fields if a!='fx'};cash=float(initial);benchmark=float(initial);prev=None;previous_month=None;bench_units=None;points=[]
 for row in rows:
  date=row['date'];pr=row['prices'];prices={'equity':pr['equity']*pr['fx'],'btc':pr['btc']*pr['fx'],'gold':pr['gold']*pr['fx']}
  if prev:
   for k in vals:vals[k]*=prices[k]/prev[k]
  else:bench_units=initial*(1-fee)/prices['equity']
  benchmark=bench_units*prices['equity'];month=date[:7];trade=False;missing=False;decision=None
  if month!=previous_month:
   if date<'2026-11-03':
    h=hist.get(month);target=h.get('target') if h and h.get('status')=='available' else None;decision={'type':'retrospective','cutoff':h.get('signal_cutoff')} if target else None
   else:
    # Only signals computed before this market date are eligible; no same-session hindsight.
    candidates=[o for o in obs if o.get('marketDate','')<date and o.get('availableAt','')[:10]<date and o.get('target')]
    chosen=max(candidates,key=lambda x:x['availableAt']) if candidates else None;target=chosen['target'] if chosen else None;decision={'type':'observed','availableAt':chosen['availableAt'],'marketDate':chosen['marketDate']} if chosen else None
   if target:
    w=target['weights'];total=sum(vals.values())+cash;net=total
    for _ in range(20):net=total-fee*sum(abs(net*w[k]-vals[k]) for k in vals)
    vals={k:net*w[k] for k in vals};cash=net*w['cash'];trade=True
   else:missing=True
   previous_month=month
  value=sum(vals.values())+cash
  allocation={**{k:round(v,2) for k,v in vals.items()},'cash':round(cash,2)}
  points.append({'date':date,'ver2':round(value,2),'sp500':round(benchmark,2),'ver2Return':value/initial-1,'sp500Return':benchmark/initial-1,'allocation':allocation,'phase':'backtest' if date<'2026-11-03' else 'tracking','rebalanced':trade,'signalMissing':missing,'decision':decision,'targetWeights':target['weights'] if trade else None,'sourceDates':row['sourceDates']});prev=prices
 out={'schemaVersion':1,'initialKRW':initial,'startDate':points[0]['date'],'trackingStart':'2026-11-03','through':points[-1]['date'],'modelVersion':'ver2','priceBasis':'S&P 500 price index, BTC/USD, gold USD, USD/KRW; no dividends; gold, BTC and FX prior available date; 2026-01-01 BTC bootstrap Yahoo, later values TradingView report','fees':'매수·매도 각 0.1%, 세금·스프레드·현금이자 제외','schedule':'각 월 첫 미국 거래일 월 1회, 직전 사용가능 신호. 첫날 이전 전액 현금.','historyNotice':'2026-11-02까지 과거 시점 신호 사후 재구성, 원본 당시 가용성 미검증. 11-03 이후 실제 관측한 신호만 이용.','observations':points}
 return {'schemaVersion':1,'observations':rows},out
