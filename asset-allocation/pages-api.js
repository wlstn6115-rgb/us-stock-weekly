/* GitHub Pages adapter: holdings never leave this browser. */
let publishedState;
const storageKey = 'allocation-observatory-portfolio-v1';
function browserAllocate(scores, input, rules) {
  const names = Object.keys(rules.base);
  if (!input || !input.portfolio || Object.keys(input.portfolio).sort().join() !== names.slice().sort().join()) throw Error('네 자산의 보유액을 입력하세요.');
  const amount = input.remaining_monthly_investment_krw;
  if ([amount,...Object.values(input.portfolio)].some(v=>!Number.isSafeInteger(v)||v<0||v>1e15)) throw Error('금액은 0 이상 1,000조 원 이하의 정수여야 합니다.');
  const sum = Object.values(input.portfolio).reduce((x,y)=>x+y,0);
  const fallback = names.some(a=>!scores[a].usable);
  const q={},lower={},upper={},current={};
  for(const a of names){
    current[a]=sum?input.portfolio[a]/sum:rules.reference[a];
    lower[a]=Math.max(rules.min[a],rules.base[a]-rules.max_tilt[a]);
    upper[a]=Math.min(rules.max[a],rules.base[a]+rules.max_tilt[a]);
    const tilt=fallback?0:rules.score_strength*(scores[a].current_score-50)/50+rules.momentum_strength*Math.max(-1,Math.min(1,(scores[a].score_1m_change||0)/20));
    q[a]=rules.base[a]+tilt+rules.portfolio_strength*(rules.reference[a]-current[a]);
  }
  if(names.some(a=>lower[a]>upper[a])||Object.values(lower).reduce((a,b)=>a+b,0)>1+1e-10||Object.values(upper).reduce((a,b)=>a+b,0)<1-1e-10)throw Error('배분 제약을 만족할 수 없습니다.');
  let lo=-10,hi=10;
  for(let i=0;i<100;i++){const mid=(lo+hi)/2;const total=names.reduce((s,a)=>s+Math.max(lower[a],Math.min(upper[a],q[a]-mid)),0);if(total>1)lo=mid;else hi=mid;}
  const weights={},buys={},mins={},maxs={};
  for(const a of names){weights[a]=Math.max(lower[a],Math.min(upper[a],q[a]-(lo+hi)/2));mins[a]=Math.ceil(amount*lower[a]-1e-8);maxs[a]=Math.floor(amount*upper[a]+1e-8);buys[a]=amount?Math.max(mins[a],Math.min(maxs[a],Math.floor(amount*weights[a]))):0;}
  if(Object.values(mins).reduce((a,b)=>a+b,0)>amount||Object.values(maxs).reduce((a,b)=>a+b,0)<amount)throw Error('금액이 너무 작아 원 단위 배분이 불가능합니다.');
  let remainder=amount-Object.values(buys).reduce((a,b)=>a+b,0);
  while(remainder){const direction=Math.sign(remainder);const eligible=names.filter(a=>direction>0?buys[a]<maxs[a]:buys[a]>mins[a]);eligible.sort((a,b)=>direction*((amount*weights[b]-buys[b])-(amount*weights[a]-buys[a])));buys[eligible[0]]+=direction;remainder-=direction;}
  return {remaining_monthly_investment_krw:amount,fallback_due_to_data:fallback,assets:Object.fromEntries(names.map(a=>[a,{current_weight:current[a],suggested_weight:weights[a],amount_krw:buys[a],projected_weight:sum+amount?(input.portfolio[a]+buys[a])/(sum+amount):0,lower_bound:lower[a],upper_bound:upper[a],constraint_active:Math.abs(weights[a]-lower[a])<1e-8||Math.abs(weights[a]-upper[a])<1e-8}]))};
}
async function pagesApi(path,data){
  if(path==='state'||path==='refresh'){
    const response=await fetch('./market.json?t='+Date.now(),{cache:'no-store'});
    if(!response.ok)throw Error('게시된 시장 데이터를 불러오지 못했습니다.');
    publishedState=await response.json();
    const d=publishedState.result?.market_date;
    publishedState.stale=!d||Date.now()-Date.parse(d+'T00:00:00Z')>6*86400000;
    let portfolio=null;try{portfolio=JSON.parse(localStorage.getItem(storageKey));}catch{}
    return {...publishedState,portfolio};
  }
  if(path==='simulate'||path==='save'){
    // Re-fetch for calculations so an old open tab cannot use stale market data.
    const latest=await pagesApi('state');
    if(latest.stale||!latest.result?.scores)throw Error('최신 시장 데이터가 필요합니다. 일일 게시 상태를 확인해 주세요.');
    const allocation=browserAllocate(latest.result.scores,data,latest.rules);
    if(path==='save')localStorage.setItem(storageKey,JSON.stringify(data));
    return {allocation,saved:path==='save'};
  }
  throw Error('지원하지 않는 작업입니다.');
}
if(typeof module!=='undefined')module.exports={browserAllocate};
