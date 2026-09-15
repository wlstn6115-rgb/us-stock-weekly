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
      if(![1,2].includes(p.schemaVersion)||!Array.isArray(p.snapshots))throw Error('과거 데이터 형식 오류');
      if(p.schemaVersion===2){
        if(p.metadata?.frequency!=='monthly'||p.metadata?.currency!=='KRW')throw Error('월별 원화 메타데이터 오류');
        let previousMonth=null;
        p.snapshots=p.snapshots.map(row=>{
          M.validDate(row.date);
          const d=new Date(row.date+'T00:00:00Z'),month=d.getUTCFullYear()*12+d.getUTCMonth();
          if(new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).toISOString().slice(0,10)!==row.date||(previousMonth!==null&&month!==previousMonth+1))throw Error('월말 또는 연속 월 검증 실패');
          previousMonth=month;
          if(!Number.isFinite(row.fx?.value)||row.fx.value<=0)throw Error('환율 누락');
          M.validDate(row.fx.sourceDate);
          if(row.fx.sourceDate>row.date)throw Error('미래 환율');
          for(const id of ['equity','gold','bitcoin','cash','benchmark']){
            const a=row.assets?.[id];
            if(!a||!Number.isFinite(a.value)||a.value<=0||a.currency!=='KRW'||!['close','adjusted_close'].includes(a.priceType))throw Error('자산 가격 형식 오류');
            M.validDate(a.sourceDate);if(a.sourceDate>row.date||a.sourceDate.slice(0,7)!==row.date.slice(0,7))throw Error('가격 관측일 오류');
          }
          return {date:row.date,availableAt:row.availableAt,currency:'KRW',priceBasis:p.metadata.priceType,
            source:p.metadata.source,dataVersion:p.metadata.dataVersion,scoreType:null,modelVersion:'unavailable',pointInTimeVerified:false,
            prices:Object.fromEntries(Object.keys(M.assets).map(k=>[k,row.assets[M.assetId(k)].value])),
            assetDetails:row.assets,fx:row.fx,cashModel:p.metadata.cashModel};
        });
      }
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
