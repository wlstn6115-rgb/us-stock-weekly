(function(){
  'use strict';
  const tabs=Array.from(document.querySelectorAll('.tab-nav [role="tab"]'));
  function show(){
    const active=tabs.find(t=>t.hash===location.hash)||tabs[0];
    if(location.hash!==active.hash)history.replaceState(null,'',active.hash);
    const previous=document.activeElement;
    tabs.forEach(t=>{
      const selected=t===active,panel=document.getElementById(t.getAttribute('aria-controls'));
      t.setAttribute('aria-selected',String(selected));t.tabIndex=selected?0:-1;
      panel.hidden=!selected;
      if(!selected&&panel.contains(previous))active.focus();
    });
    window.dispatchEvent(new Event('resize'));
  }
  tabs.forEach((t,i)=>t.addEventListener('keydown',e=>{
    const index=e.key==='ArrowRight'?(i+1)%tabs.length:e.key==='ArrowLeft'?(i+tabs.length-1)%tabs.length:e.key==='Home'?0:e.key==='End'?tabs.length-1:null;
    if(index!==null){e.preventDefault();tabs[index].focus();location.hash=tabs[index].hash;}
  }));
  window.addEventListener('hashchange',show);show();
})();
