(function(root){
  'use strict';
  const M=root.AllocationModels||(typeof require!=='undefined'?require('./data-models.js'):null);
  class ExistingFileProvider{
    constructor({url='./market.json',fetcher=root.fetch?.bind(root)}={}){this.url=url;this.fetcher=fetcher;}
    async read(){const r=await this.fetcher(this.url+'?t='+Date.now(),{cache:'no-store'});if(!r.ok)throw Error('게시된 시장 데이터를 불러오지 못했습니다.');return r.json();}
    async getLatestSnapshot(){const s=M.snapshot(await this.read());if(s){M.validDate(s.date);if(!Number.isFinite(Date.parse(s.availableAt)))throw Error('시장 데이터 가용시각 오류');}return s;}
    async getSnapshot(date){
      M.validDate(date);
      const s=await this.getLatestSnapshot();
      // This provider has no vintage archive. Never substitute today's data for a past decision.
      return s&&s.date===date&&Date.parse(s.availableAt)<=Date.parse(date+'T23:59:59.999Z')?s:null;
    }
    async getAssetScores(date){const s=date?await this.getSnapshot(date):await this.getLatestSnapshot();return s?Object.fromEntries(Object.entries(s.assets).map(([k,v])=>[k,v.score])):null;}
    async getAssetPrices(date){const s=date?await this.getSnapshot(date):await this.getLatestSnapshot();return s?Object.fromEntries(Object.keys(s.assets).map(k=>[k,null])):null;}
    async getHistoricalPrices(asset,start,end){if(!Object.values(M.assets).some(a=>a.id===asset)||start>end)throw Error('자산 또는 기간을 확인하세요.');return [];}
    async getAvailableDateRange(){const s=await this.getLatestSnapshot();return {latestDate:s?.date||null,startDate:null,endDate:null,completeMonthlyWindows:[],simulationAvailable:false,reason:'가격 이력과 당시 공개된 Score 이력이 아직 연결되지 않았습니다.'};}
    async getDashboardState(){
      const p=await this.read();const s=M.snapshot(p);
      const stale=!s||Date.now()-Date.parse(s.date+'T00:00:00Z')>6*86400000;
      return {...p,stale,normalizedSnapshot:s};
    }
  }
  root.CurrentDataAdapter=ExistingFileProvider;if(typeof module!=='undefined')module.exports=ExistingFileProvider;
})(globalThis);
