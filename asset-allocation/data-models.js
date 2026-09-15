(function(root){
  'use strict';
  const assets=Object.freeze({QQQ:{id:'Equity',label:'주식'},GOLD:{id:'Gold',label:'금'},BTC:{id:'Bitcoin',label:'비트코인'},CASH:{id:'Cash',label:'현금·단기채'}});
  const clone=x=>JSON.parse(JSON.stringify(x));
  function validSettings(x){
    if(!x||!x.portfolio||Object.keys(x.portfolio).sort().join()!==Object.keys(assets).sort().join())throw Error('네 자산의 평가액이 필요합니다.');
    if([...Object.values(x.portfolio),x.remaining_monthly_investment_krw].some(v=>!Number.isSafeInteger(v)||v<0||v>1e15))throw Error('유효한 원화 금액을 입력하세요.');
    return clone(x);
  }
  function snapshot(payload){
    const r=payload.result;
    if(!r?.market_date||!r.scores||!r.generated_at||!Number.isFinite(Date.parse(r.generated_at)))return null;
    const output={schemaVersion:1,date:r.market_date,availableAt:r.available_at||r.generated_at,modelVersion:r.model_version||r.config_hash||'legacy-unversioned',assets:{},quality:{pricesAvailable:false,historicalPointInTime:false}};
    for(const [key,a] of Object.entries(assets)){
      const score=r.scores[key]?.current_score;
      if(!Number.isFinite(score)||score<0||score>100)throw Error('Score는 0~100이어야 합니다.');
      output.assets[a.id]={price:null,priceCurrency:null,score,scoreUsable:!!r.scores[key].usable};
    }
    return output;
  }
  function validateRecord(store,r){
    if(!r||typeof r.id!=='string'||!r.id||r.schemaVersion!==1)throw Error('id와 schemaVersion=1이 필요합니다.');
    const fields={sessions:['startDate','endDate','duration','mode','initialAssets','monthlyContribution','createdAt'],decisions:['sessionId','decisionDate','portfolioBefore','assetScores','assetPrices','action','portfolioAfter','reasonCategory','reasonMemo','modelVersion'],journals:['tradeDate','portfolioBefore','assetScoresAtDecision','pricesAtDecision','modelVersion','actions','portfolioAfter','reasonCategory','reasonMemo'],philosophies:['rules','allocationLimits','behaviorRules']}[store];
    if(!fields||fields.some(k=>r[k]===undefined))throw Error('기록의 필수 필드가 누락되었습니다.');
    if(['decisions','journals'].includes(store)&&(!r.reasonCategory||typeof r.reasonMemo!=='string'))throw Error('판단 이유가 필요합니다.');
    return clone(r);
  }
  const assetIds=Object.freeze({QQQ:'equity',Equity:'equity',equity:'equity',GOLD:'gold',Gold:'gold',gold:'gold',BTC:'bitcoin',Bitcoin:'bitcoin',bitcoin:'bitcoin',CASH:'cash',Cash:'cash',cash:'cash',benchmark:'benchmark'});
  function assetId(value){if(!Object.hasOwn(assetIds,value))throw Error('알 수 없는 자산 ID');return assetIds[value];}
  function validDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw Error('유효한 날짜가 필요합니다.');return value;}
  const api={assets,assetIds,assetId,validDate,clone,validSettings,snapshot,validateRecord};
  root.AllocationModels=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
