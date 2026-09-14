(function(root){
 class MonthlyHistoryProvider{
   constructor(url='./simulation-history.json',fetcher=root.fetch.bind(root)){this.url=url;this.fetcher=fetcher;}
   async getMonthlySnapshots(){const response=await this.fetcher(this.url,{cache:'no-store'});if(response.status===404)return [];if(!response.ok)throw Error('과거 데이터를 불러오지 못했습니다.');const payload=await response.json();if(payload.schemaVersion!==1||!Array.isArray(payload.snapshots))throw Error('과거 데이터 형식을 확인하세요.');return payload.snapshots.slice().sort((a,b)=>a.date.localeCompare(b.date));}
   async getAvailableDateRange(){const rows=await this.getMonthlySnapshots();return {rows,periods:Object.fromEntries([1,3,5,10].map(y=>[y,root.SimulationEngine.candidates(rows,y).length]))};}
 }
 root.AllocationHistory={get:()=>active,set(p){if(typeof p.getAvailableDateRange!=='function'||typeof p.getMonthlySnapshots!=='function')throw Error('과거 공급자 인터페이스 오류');active=p;}};
 let active=new MonthlyHistoryProvider();
})(globalThis);
