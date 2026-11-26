"""Research v2 target weights. Inputs must be available before the decision."""
import math
BASE=(.50,.14,.26,.10)
PAIRS=14

def target(f,correlations):
 required=('relative_3m','walcl_13w','corr60','btcvol60','stock_3m','fear')
 if any(f.get(k) is None or not math.isfinite(float(f[k])) for k in required):
  raise ValueError('Ver2 신호 입력 누락')
 vals=list(correlations.values())
 if len(vals)!=PAIRS or any(v is None or not math.isfinite(float(v)) or abs(float(v))>1 for v in vals):
  raise ValueError('추가 상관관계 14개 필요')
 w=list(BASE);moves=[]
 def transfer(src,dst,amount,reason):
  v=min(amount,w[src]);w[src]-=v;w[dst]+=v
  if v:moves.append({'reason':reason,'amount':v})
 rho=f['corr60'];fear=f['fear'];rel=f['relative_3m'];fed=f['walcl_13w']
 if fed>0 and rel>0:transfer(0,1,min(.15,max(0,.35-w[1])),'기본 상승')
 if rho>.5 and f['btcvol60']>.6 and fear<25:transfer(1,3,.15,'기본 방어')
 if rho>.1 and fed<0:transfer(0,2,.30,'연준 자산 감소')
 if rho>.5 and rel<0:transfer(1,2,.20,'BTC/금 상대 약세')
 if rho>.1 and fear<55:transfer(0,2,.20,'공포 환경')
 if sum(abs(float(v))>=.5 for v in vals)>=3:transfer(0,3,.10,'자산 간 상관관계')
 assert abs(sum(w)-1)<1e-8 and min(w)>=-1e-8
 return {'version':'ver2-research','weights':dict(zip(('equity','btc','gold','cash'),w)),'moves':moves}
