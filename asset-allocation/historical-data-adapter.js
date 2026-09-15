(function(root){
  'use strict';
  const M=root.AllocationModels||(typeof require!=='undefined'?require('./data-models.js'):null);
  class HistoricalDataAdapter{
    constructor({url='./simulation-history.json',fetcher=root.fetch?.bind(root)}={}){this.url=url;this.fetcher=fetcher;}
    async read(){
      const response=await this.fetcher(this.url,{cache:'no-store'});
      if(response.status===404)return [];
      if(!response.ok)throw Error('과거 데이터 조회 실패');
      const p=await response.json();
      if(p.schemaVersion!==1||!Array.isArray(p.snapshots))throw Error('과거 데이터 형식 오류');
      let previous='';const months=new Set();
      for(const row of p.snapshots){
        M.validDate(row.date);const month=row.date.slice(0,7);
        if(row.date<=previous||months.has(month))throw Error('과거 데이터 중복 또는 날짜 순서 오류');
        if(!Number.isFinite(Date.parse(row.availableAt)))throw Error('과거 데이터 가용시각 누락');
        if(!row.currency||!row.priceBasis||!row.prices)throw Error('과거 가격 메타데이터 누락');
        for(const key of Object.keys(M.assets))if(!Number.isFinite(row.prices[key])||row.prices[key]<=0)throw Error('과거 가격 누락 또는 잘못된 값');
        for(const score of Object.values(row.scores||{}))if(score!==null&&(!Number.isFinite(score)||score<0||score>100))throw Error('과거 Score 범위 오류');
        previous=row.date;months.add(month);
      }
      return M.clone(p.snapshots);
    }
  }
  root.HistoricalDataAdapter=HistoricalDataAdapter;if(typeof module!=='undefined')module.exports=HistoricalDataAdapter;
})(globalThis);
