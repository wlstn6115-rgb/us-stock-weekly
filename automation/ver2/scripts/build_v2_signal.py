from pathlib import Path
import sys,json,re,math,argparse
from datetime import datetime,timezone
import pandas as pd
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'src'))
from model_v2 import target
names={'SPY':'S&P 500','^TNX':'US 10Y Treasury','GLD':'Gold','BTC-USD':'Bitcoin (USD)','CL=F':'WTI Crude','DX-Y.NYB':'Dollar Index'}
from itertools import combinations

def fear_history(data, latest, cache_paths):
 """Use dated CNN observations only; never assign a stale value to a new date."""
 candidates=[]
 raw=data.get('Fear & Greed') or {}
 if raw.get('dates') and len(raw['dates'])==len(raw.get('values',[])):
  candidates.append(('report', raw['dates'], raw['values']))
 if isinstance(cache_paths,(str,Path)):cache_paths=[cache_paths]
 for cache_path in cache_paths:
  try:
   cache=json.loads(Path(cache_path).read_text(encoding='utf-8-sig'))
   rows=cache.get('items') if 'items' in cache else cache.get('rows')
   if cache.get('source') == 'CNN Fear & Greed' and isinstance(rows,list):
    source='cnn_history_cache' if 'items' in cache else 'cnn_daily_cache'
    candidates.append((source,[r['date'] for r in rows],[r['value'] for r in rows]))
  except (OSError,ValueError,KeyError,TypeError,json.JSONDecodeError):
   continue
 choices=[]
 for source,dates,values in candidates:
  try:
   points=pd.Series(values,index=pd.to_datetime(dates,errors='raise'),dtype=float).loc[:latest].dropna().sort_index()
   points=points[(points>=0)&(points<=100)]
   if len(points) and (latest-points.index[-1]).days<=5 and (source=='report' or points.index[-1].date()==latest.date()):
    choices.append((points.index[-1],source,points))
  except (ValueError,TypeError,OverflowError):
   continue
 if not choices:raise ValueError('공포지수 자료 없음 또는 오래됨')
 # Prefer the report on ties, and retain the observation date in public metadata.
 choices.sort(key=lambda item:(item[0],{'report':2,'cnn_daily_cache':1,'cnn_history_cache':0}[item[1]]),reverse=True)
 return choices[0][2],choices[0][1]

def build(path, fear_cache_path=None):
 html=path.read_text(encoding='utf-8-sig');match=re.search(r'(?m)^    const series = (.*?);\s*$',html)
 if not match:raise ValueError('보고서 시계열 없음')
 cache_paths=[fear_cache_path] if fear_cache_path else [root.parent/'fear_greed_history_cache.json',root.parent/'05_database/market_cache/cnn_fear_greed_cache.json']
 captured=datetime.fromtimestamp(path.stat().st_mtime,timezone.utc)
 return build_from_series(json.loads(match.group(1)), captured, cache_paths)

def build_from_series(d, captured, cache_paths=(), source='weekly report: TradingView/FRED/CNN'):
 series={}
 for key,name in names.items():
  x=d[name];series[key]=pd.Series(x['values'],index=pd.to_datetime(x['dates']),dtype=float).sort_index()
 dates=[x.index[-1] for x in series.values()];latest=min(dates)
 if max((max(dates)-x).days for x in dates)>5:raise ValueError('시장 시계열 날짜 불일치')
 data=pd.concat(series,axis=1).loc[:latest];rets=data.pct_change(fill_method=None);rets=rets.where((data>0)&(data.shift(1)>0));cor={}
 for a,b in combinations(names,2):
  paired=rets[[a,b]].dropna().tail(60)
  if len(paired)<60 or (latest-paired.index[-1]).days>5:raise ValueError('상관관계 자료 부족 '+a+' '+b)
  cor[a+'|'+b]=float(paired[a].corr(paired[b]))
 if any(not math.isfinite(v) for v in cor.values()):raise ValueError('상관관계 계산 불가')
 hist=data[['SPY','BTC-USD','GLD']].dropna();cur=hist.iloc[-1];old=hist.loc[:latest-pd.DateOffset(months=3)].iloc[-1]
 fed=d['Federal Reserve Balance Sheet'];fs=pd.Series(fed['values'],index=pd.to_datetime(fed['dates']),dtype=float).loc[:latest].dropna().sort_index()
 gs,fear_source=fear_history(d,latest,cache_paths)
 if len(fs)<14 or (latest-fs.index[-1]).days>14 or not len(gs) or (latest-gs.index[-1]).days>5:raise ValueError('연준 또는 공포지수 자료 부족')
 btc=rets[['SPY','BTC-USD']].dropna().tail(60)
 f={'relative_3m':float((cur['BTC-USD']/cur['GLD'])/(old['BTC-USD']/old['GLD'])-1),'stock_3m':float(cur['SPY']/old['SPY']-1),'walcl_13w':float(fs.iloc[-1]/fs.iloc[-14]-1),'fear':float(gs.iloc[-1]),'corr60':cor['SPY|BTC-USD'],'btcvol60':float(btc['BTC-USD'].std(ddof=1)*math.sqrt(252))}
 other={k:v for k,v in cor.items() if k!='SPY|BTC-USD'};result=target(f,other)
 return {'marketDate':str(latest.date()),'availableAt':datetime.now(timezone.utc).isoformat(),'reportCapturedAt':captured.isoformat(),'features':f,'correlations':other,'target':result,'source':source,'fearObservation':{'date':str(gs.index[-1].date()),'source':fear_source},'caveat':'연구 데이터의 SPY·GLD·선물 대용치와 운영 보고서 지수·현물 원천은 다를 수 있습니다.'}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('report',type=Path);p.add_argument('output',type=Path);a=p.parse_args();out=build(a.report);a.output.write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps({'marketDate':out['marketDate'],'target':out['target']},ensure_ascii=False))
