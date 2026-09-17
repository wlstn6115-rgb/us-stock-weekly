(function(root){
  'use strict';
  const M=root.AllocationModels||(typeof require!=='undefined'?require('./data-models.js'):null);
  const Current=root.CurrentDataAdapter||(typeof require!=='undefined'?require('./current-data-adapter.js'):null);
  const Historical=root.HistoricalDataAdapter||(typeof require!=='undefined'?require('./historical-data-adapter.js'):null);
  const end=date=>Date.parse(M.validDate(date)+'T23:59:59.999Z');
  function canonical(s){
    if(!s)return null;
    return {...M.clone(s),schemaVersion:2,observationDate:s.date,source:'instagram-derived-market',scoreType:'live',indicators:[],assets:Object.fromEntries(Object.entries(s.assets).map(([k,v])=>[M.assetId(k),v]))};
  }
  function historicalSnapshot(r){
    if(!r)return null;
    const verified=r.pointInTimeVerified===true;
    return {schemaVersion:2,date:r.date,observationDate:r.date,availableAt:r.availableAt,source:r.source||'historical-file',modelVersion:r.modelVersion||'unavailable',scoreType:r.scoreType||null,indicators:[],assets:Object.fromEntries(Object.keys(M.assets).map(k=>[M.assetId(k),{price:r.prices[k],priceCurrency:r.currency,priceType:r.assetDetails?.[M.assetId(k)]?.priceType||r.priceBasis,sourceDate:r.assetDetails?.[M.assetId(k)]?.sourceDate||r.date,ticker:r.assetDetails?.[M.assetId(k)]?.ticker||null,score:verified?(r.scores?.[k]??null):null,scoreUsable:verified&&Number.isFinite(r.scores?.[k])}])),dataVersion:r.dataVersion||null,fx:r.fx||null,cashModel:r.cashModel||null,quality:{pricesAvailable:true,historicalPointInTime:verified}};
  }
  class UnifiedDataProvider{
    async getSimulationConfig(){const c=await this.current.resource('simulation-config.json');if(c.schemaVersion!==1)throw Error('시뮬레이션 설정 버전 오류');M.validDate(c.SIMULATION_MIN_DATE);return {minDate:c.SIMULATION_MIN_DATE};}
    async getScoreHistory(){return this.current.getScoreHistory();}
    async getFX(){return this.current.getFX();}
    constructor({current=new Current(),historical=new Historical()}={}){this.current=current;this.historical=historical;}
    async getLatestSnapshot(){return canonical(await this.current.getLatestSnapshot());}
    async getSnapshot(date){
      const cutoff=end(date);
      const [live,past]=await Promise.allSettled([this.current.getSnapshot(date),this.historical.read()]);
      if(live.status==='fulfilled'&&live.value)return canonical(live.value);
      if(past.status==='fulfilled'){
        const found=past.value.find(r=>r.date===date&&Date.parse(r.availableAt)<=cutoff);
        if(found)return historicalSnapshot(found);
      }
      if(live.status==='rejected')throw live.reason;
      if(past.status==='rejected')throw past.reason;
      return null;
    }
    async getLatestScores(){return this.getAssetScores();}
    async getAssetScores(date){const s=date?await this.getSnapshot(date):await this.getLatestSnapshot();return s?{date:s.date,availableAt:s.availableAt,modelVersion:s.modelVersion,scoreType:s.scoreType,assets:Object.fromEntries(Object.entries(s.assets).map(([k,v])=>[k,{score:v.score,usable:v.scoreUsable}]))}:null;}
    async getIndicators(date){const s=date?await this.getSnapshot(date):await this.getLatestSnapshot();return {date:s?.date||null,values:[],status:'unavailable',reason:'원본 지표의 값·단위·가용시각은 아직 공개 데이터에 포함되지 않았습니다.'};}
    async getAssetPrices(date){const s=date?await this.getSnapshot(date):await this.getLatestSnapshot();return s?Object.fromEntries(Object.entries(s.assets).map(([k,v])=>[k,v.price])):null;}
    async getMonthlySnapshots(){return this.historical.read();}
    async getMonthlySnapshot(month,asOf=new Date().toISOString().slice(0,10)){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('유효한 월이 필요합니다.');const cutoff=end(asOf);const rows=await this.historical.read();return historicalSnapshot(rows.find(r=>r.date.slice(0,7)===month&&Date.parse(r.availableAt)<=cutoff));}
    async getMonthlyAssetPrices(asset,start,finish){
      const id=M.assetId(asset);end(start);end(finish);if(start>finish)throw Error('기간 순서 오류');
      const key=Object.keys(M.assets).find(k=>M.assetId(k)===id);
      return (await this.historical.read()).filter(r=>r.date>=start&&r.date<=finish&&Date.parse(r.availableAt)<=Date.now()&&(key||r.assetDetails?.[id])).map(r=>({assetId:id,date:r.date,availableAt:r.availableAt,value:r.assetDetails?.[id]?.value??r.prices[key],currency:r.currency,priceType:r.assetDetails?.[id]?.priceType||r.priceBasis,source:r.source||'historical-file',sourceDate:r.assetDetails?.[id]?.sourceDate||r.date,frequency:'monthly',ticker:r.assetDetails?.[id]?.ticker||null,fx:r.fx||null}));
    }
    // Journal's daily-price contract remains unavailable; monthly observations cannot support D1.
    async getHistoricalPrices(asset,start,finish){M.assetId(asset);end(start);end(finish);if(start>finish)throw Error('기간 순서 오류');return [];}
    async getLatestDate(){return (await this.getLatestSnapshot())?.date||null;}
    async getAvailableDateRange(){
      const [live,past]=await Promise.allSettled([this.getLatestDate(),this.getMonthlySnapshots()]);
      const rows=past.status==='fulfilled'?past.value:[];
      const periods=Object.fromEntries([1,3,5,10].map(y=>[y,root.SimulationEngine?root.SimulationEngine.candidates(rows,y).length:0]));
      return {latestDate:live.status==='fulfilled'?live.value:null,startDate:rows[0]?.date||null,endDate:rows.at(-1)?.date||null,rows,periods,completeMonthlyWindows:Object.keys(periods).filter(y=>periods[y]>0).map(Number),simulationAvailable:Object.values(periods).some(Boolean),errors:{current:live.status==='rejected'?live.reason.message:null,historical:past.status==='rejected'?past.reason.message:null},reason:past.status==='rejected'?past.reason.message:'실행에는 연속 가격·당시 Score와 원화 평가 자료가 필요합니다.'};
    }
    async getDashboardState(){const p=await this.current.getDashboardState();return {...p,normalizedSnapshot:canonical(p.normalizedSnapshot)};}
  }
  let active=new UnifiedDataProvider();
  const required=['getLatestSnapshot','getSnapshot','getAssetScores','getAssetPrices','getHistoricalPrices','getAvailableDateRange','getDashboardState','getLatestScores','getIndicators','getMonthlyAssetPrices','getMonthlySnapshot','getMonthlySnapshots','getLatestDate'];
  const api={ExistingFileProvider:Current,UnifiedDataProvider,get:()=>active,set(p){if(required.some(k=>typeof p[k]!=='function'))throw Error('DataProvider 인터페이스 불완전');active=p;}};
  root.AllocationData=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
