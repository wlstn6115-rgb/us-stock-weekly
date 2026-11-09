(function(root){
  'use strict';
  const labels={'SPY':'주식','^TNX':'미 10년 금리','GLD':'금','BTC-USD':'비트코인','CL=F':'WTI','DX-Y.NYB':'달러지수'};
  const signed=(x,d=2)=>(x>0?'+':'')+(x*100).toFixed(d)+'%';
  const pctPoints=n=>(n*100).toFixed(1)+'%p';
  function render(data,result,causes){
    const f=data.features,c=data.correlations,pairs=Object.entries(c),strong=pairs.filter(([,v])=>Math.abs(v)>=.5);
    const cards=[
      ['연준 총자산 · 13주',signed(f.walcl_13w,3),f.walcl_13w<0?'감소':'증가 또는 보합','증가와 BTC/금 상승 시 주식 → BTC; 감소와 상관계수 > 0.1이면 주식 → 금'],
      ['비트코인/금 · 3개월',signed(f.relative_3m),f.relative_3m<0?'BTC 상대 약세':'BTC 상대 강세 또는 보합','0% 미만이고 주식·BTC 상관계수 > 0.5이면 BTC → 금'],
      ['주식·비트코인 상관계수',f.corr60.toFixed(2),'최근 60일','0.1과 0.5 초과 여부를 다른 지표와 함께 판단'],
      ['비트코인 변동성',signed(f.btcvol60).replace('+',''),'60일 연율화','60% 초과·공포지수 < 25·상관계수 > 0.5이면 BTC → 현금'],
      ['공포·탐욕지수',f.fear.toFixed(1)+' / 100',f.fear<55?'55 미만':'55 이상','55 미만과 주식·BTC 상관계수 > 0.1이면 주식 → 금'],
      ['자산 간 상관관계',strong.length+' / '+pairs.length+'쌍','최근 60일 · 절댓값 0.5 이상','3쌍 이상이면 주식 → 현금'],
      ['주식 수익률 · 3개월',signed(f.stock_3m),'참고 지표','수집 중이나 현재 배분 규칙에는 미사용']
    ];
    const list=pairs.map(([key,value])=>{const [a,b]=key.split('|');return `<span class="factor-pair">${labels[a]||a} · ${labels[b]||b} <b>${value.toFixed(2)}</b>${Math.abs(value)>=.5?' <small>해당</small>':''}</span>`}).join('');
    const moves=result.moves.map(m=>`<li>${causes[m.reason]||m.reason} <b>${pctPoints(m.amount)}</b> 이동</li>`).join('');
    return `<style>
      .factor-table-wrap{overflow-x:auto;margin:10px 0}.factor-table{width:100%;border-collapse:collapse;font-size:12px;line-height:1.4}.factor-table th,.factor-table td{text-align:left;padding:6px 8px;border-bottom:1px solid #e1e9f2}.factor-table thead{color:#536b85;background:#f5f8fd}.factor-table td b{color:#2457ca}.factor-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:14px 0}
      .factor-card{background:#f5f8fd;border:1px solid #dce6f5;border-radius:10px;padding:12px;min-width:0}
      .factor-card-title{color:#4c6580;font-size:12px;font-weight:700}.factor-card-value{display:block;color:#17395f;font-size:21px;font-weight:800;margin:5px 0 2px}
      .factor-card-state{color:#2457ca;font-size:12px;font-weight:700}.factor-card-rule{font-size:11px;line-height:1.45;color:#657b91;margin:6px 0 0}
      .factor-pairs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 12px;margin-top:10px}
      .factor-pair{font-size:12px;color:#405e7a}.factor-pair small{color:#2457ca}
      .factor-moves{margin:8px 0 0;padding-left:21px}.factor-moves li{margin:5px 0;line-height:1.5}
      @media(max-width:850px){.factor-cards{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:430px){.factor-cards{gap:7px}.factor-card{padding:9px}.factor-card-value{font-size:18px}.factor-pairs{grid-template-columns:1fr}}
    </style><h2>현재 비중에 영향을 준 환경</h2>
      <p class="small" style="text-align:left;margin:8px 0">모델 입력값과 판단 기준 · 각 조건은 다른 지표와 함께 적용됩니다.</p>
      <div class="factor-table-wrap"><table class="factor-table"><thead><tr><th>지표</th><th>현재 값</th><th>상태</th><th>배분 판단 기준</th></tr></thead><tbody>${cards.map(([title,value,state,rule])=>`<tr><th scope="row">${title}</th><td><b>${value}</b></td><td>${state}</td><td>${rule}</td></tr>`).join('')}</tbody></table></div>
      <details><summary>자산 간 상관관계 14쌍 보기</summary><p class="small" style="text-align:left">주식·BTC 한 쌍은 별도로 판단합니다. 음의 상관도 절댓값이 0.5 이상이면 집계합니다.</p><div class="factor-pairs">${list}</div></details>
      <p style="margin:14px 0 5px">기본 비중 주식 50% · 비트코인 14% · 금 26% · 현금 10%</p>
      ${moves?`<ul class="factor-moves">${moves}</ul>`:'<p>현재 기본 비중을 조정한 신호가 없습니다.</p>'}`;
  }
  root.AllocationFactors={render};
})(globalThis);
