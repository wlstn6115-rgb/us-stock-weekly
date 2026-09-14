(function(root){
  'use strict';
  const M=root.AllocationModels||(typeof require!=='undefined'?require('./data-models.js'):null);
  const legacyKey='allocation-observatory-portfolio-v1',settingsKey='allocation-observatory-settings-v1';
  function settings(storage){return {
    get(){
      let raw;try{raw=storage.getItem(settingsKey);if(raw)return M.validSettings(JSON.parse(raw).inputs);raw=storage.getItem(legacyKey);if(!raw)return null;const value=M.validSettings(JSON.parse(raw));this.save(value);return value;}
      catch(e){throw Error('저장값을 읽지 못했습니다. 기존 데이터는 삭제하지 않았습니다. '+e.message);}
    },
    save(inputs){const checked=M.validSettings(inputs);storage.setItem(settingsKey,JSON.stringify({schemaVersion:1,updatedAt:new Date().toISOString(),inputs:checked}));return checked;}
  };}
  function openDB(){return new Promise((resolve,reject)=>{
    if(!root.indexedDB)return reject(Error('이 브라우저에서 IndexedDB를 사용할 수 없습니다.'));
    const request=root.indexedDB.open('allocation-observatory',1);
    request.onupgradeneeded=()=>{
      const db=request.result;
      for(const name of ['sessions','decisions','journals','philosophies'])if(!db.objectStoreNames.contains(name)){
        const store=db.createObjectStore(name,{keyPath:'id'});
        if(name==='decisions')store.createIndex('sessionId','sessionId',{unique:false});
        if(name==='journals')store.createIndex('tradeDate','tradeDate',{unique:false});
      }
    };
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(Error('다른 탭을 닫고 저장소를 다시 열어 주세요.'));
    request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result);};
  });}
  async function transact(name,mode,operation){
    const db=await openDB();return new Promise((resolve,reject)=>{
      const tx=db.transaction(name,mode);let value;
      try{const req=operation(tx.objectStore(name));req.onsuccess=()=>{value=req.result;};}
      catch(e){tx.abort();db.close();reject(e);return;}
      tx.oncomplete=()=>{db.close();resolve(value);};tx.onerror=tx.onabort=()=>{db.close();reject(tx.error||Error('저장하지 못했습니다.'));};
    });
  }
  const api={settings,openDB,
    // add, not put: decision-time snapshots cannot be silently overwritten.
    add:(store,record)=>transact(store,'readwrite',s=>s.add(M.validateRecord(store,record))),
    get:(store,id)=>transact(store,'readonly',s=>s.get(id)),
    list:(store)=>transact(store,'readonly',s=>s.getAll()),
    async commitSimulation(session,decision){
      M.validateRecord('sessions',session);M.validateRecord('decisions',decision);
      const db=await openDB();return new Promise((resolve,reject)=>{
        const tx=db.transaction(['sessions','decisions'],'readwrite'),sessions=tx.objectStore('sessions');let failure;
        const request=sessions.get(session.id);
        request.onsuccess=()=>{const previous=request.result;if(!previous||previous.cursor!==session.cursor-1||decision.sessionId!==session.id){failure=Error('다른 탭에서 진행된 세션입니다. 다시 불러오세요.');tx.abort();return;}tx.objectStore('decisions').add(decision);sessions.put(session);};
        tx.oncomplete=()=>{db.close();resolve();};tx.onabort=tx.onerror=()=>{db.close();reject(failure||tx.error);};
      });
    },
    async updatePerformance(store,id,futurePerformance){
      if(!['decisions','journals'].includes(store))throw Error('성과 업데이트 대상이 아닙니다.');
      const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite'),s=tx.objectStore(store),r=s.get(id);let failure;
        r.onsuccess=()=>{if(!r.result){failure=Error('기록이 없습니다.');tx.abort();return;}s.put({...r.result,futurePerformance:M.clone(futurePerformance),performanceUpdatedAt:new Date().toISOString()});};
        tx.oncomplete=()=>{db.close();resolve();};tx.onabort=tx.onerror=()=>{db.close();reject(failure||tx.error);};
      });
    }
  };
  root.AllocationStore=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
