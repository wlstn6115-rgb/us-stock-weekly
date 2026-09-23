"""Public daily chart series, independent of score inputs."""
import argparse, csv, io, json, math
from datetime import datetime, timezone, timedelta, date
from pathlib import Path
from urllib.request import urlopen
from update_historical_prices import atomic_write

def valid(rows):
    previous=''
    for r in rows:
        date.fromisoformat(r['date'])
        if r['date']<=previous or not math.isfinite(r['value']): raise ValueError('Invalid chart data')
        previous=r['date']
    if len(rows)<2: raise ValueError('Not enough observations')

def main():
    p=argparse.ArgumentParser();p.add_argument('--config',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    old=json.loads(a.output.read_text(encoding='utf-8')) if a.output.exists() else {'series':[]}
    previous={s['id']:s for s in old['series']};now=datetime.now(timezone.utc);start=(now-timedelta(days=370)).date().isoformat();result=[]
    for spec in json.loads(a.config.read_text(encoding='utf-8')):
        try:
            if spec['provider']=='FRED':
                url='https://fred.stlouisfed.org/graph/fredgraph.csv?id='+spec['ticker']+'&cosd='+start
                with urlopen(url,timeout=45) as response: data=response.read().decode('utf-8-sig')
                records=list(csv.reader(io.StringIO(data)))[1:]
                rows=[{'date':r[0],'value':float(r[1])} for r in records if len(r)>1 and r[1] not in ('','.','NA') and start<=r[0]<=now.date().isoformat()]
                link='https://fred.stlouisfed.org/series/'+spec['ticker']
            else:
                import yfinance as yf
                frame=yf.download(spec['ticker'],period='1y',interval='1d',auto_adjust=False,multi_level_index=False,progress=False,threads=False)
                rows=[{'date':stamp.date().isoformat(),'value':float(v)} for stamp,v in frame['Close'].dropna().items() if stamp.date()<=now.date()]
                link='https://finance.yahoo.com/quote/'+spec['ticker']+'/'
            valid(rows)
            result.append({**spec,'sourceUrl':link,'updatedAt':now.isoformat(),'status':'ok','observations':rows})
            print(spec['id'],len(rows),rows[-1]['date'])
        except Exception as e:
            saved=previous.get(spec['id'],{**spec,'observations':[]})
            result.append({**saved,'status':'refresh_failed','error':'수집 실패: 이전 관측 유지','lastAttemptAt':now.isoformat()})
            print(spec['id'],'FAILED',str(e))
    atomic_write(a.output,{'schemaVersion':1,'updatedAt':now.isoformat(),'series':result},lambda p: True)

if __name__=='__main__':main()
