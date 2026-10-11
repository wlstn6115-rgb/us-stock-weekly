/* GitHub Pages adapter: holdings never leave this browser. */
let publishedState;
const browserAllocate=(globalThis.AllocationModel||(typeof require!=='undefined'?require('./dist/allocation-model.js'):null)).allocate;
const policyRecommend=(globalThis.AllocationPolicy||(typeof require!=='undefined'?require('./dist/allocation-policy.js'):null)).recommend;

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
    const allocation=policyRecommend(latest.result.scores,data,latest.rules,latest.allocation_policy,latest.result.model_version);
    if(path==='save'){
      const saved=JSON.parse(JSON.stringify(data));
      const reset=allocation.policy_actions?.reset_counts||[];
      if(reset.length&&allocation.policy_context?.id){
        if(saved.policy_state?.policy_version!==allocation.policy_context.id){
          saved.policy_state={policy_version:allocation.policy_context.id,defensive_sales_completed:{}};
        }
        for(const asset of reset)saved.policy_state.defensive_sales_completed[asset]=0;
      }
      AllocationStore.settings(localStorage).save(saved);
    }
    allocation.score_context={market_date:latest.result.market_date,config_hash:latest.result.config_hash,model_version:latest.result.model_version,generated_at:latest.result.generated_at,scores:latest.result.scores};
    return {allocation,scoreState:latest,saved:path==='save'};
  }
  throw Error('지원하지 않는 작업입니다.');
}
if(typeof module!=='undefined')module.exports={browserAllocate};
