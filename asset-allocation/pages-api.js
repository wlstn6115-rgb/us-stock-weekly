/* GitHub Pages adapter: holdings never leave this browser. */
let publishedState;
const browserAllocate=(globalThis.AllocationModel||(typeof require!=='undefined'?require('./dist/allocation-model.js'):null)).allocate;

async function pagesApi(path,data){
  if(path==='state'||path==='refresh'){
    publishedState=await AllocationData.get().getDashboardState();
    let portfolio=null;
    try{portfolio=AllocationStore.settings(localStorage).get();}
    catch(error){publishedState.storageError=error.message;}
    return {...publishedState,portfolio};
  }
  if(path==='simulate'||path==='save'){
    // Re-fetch for calculations so an old open tab cannot use stale market data.
    const latest=await pagesApi('state');
    if(latest.stale||!latest.result?.scores)throw Error('최신 시장 데이터가 필요합니다. 일일 게시 상태를 확인해 주세요.');
    const allocation=browserAllocate(latest.result.scores,data,latest.rules);
    if(path==='save')AllocationStore.settings(localStorage).save(data);
    allocation.score_context={market_date:latest.result.market_date,config_hash:latest.result.config_hash,generated_at:latest.result.generated_at,scores:latest.result.scores};
    return {allocation,scoreState:latest,saved:path==='save'};
  }
  throw Error('지원하지 않는 작업입니다.');
}
if(typeof module!=='undefined')module.exports={browserAllocate};
