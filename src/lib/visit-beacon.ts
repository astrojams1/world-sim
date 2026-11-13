// First-party visit beacon: one request per page load to the shared astrojams-apps counter,
// which keeps only daily page-view totals by page and source (no cookies, IP or visitor id).
// See https://astrojams-apps.vercel.app/visits.
export const VISIT_BEACON_SCRIPT =
  "(function(){try{var q=new URLSearchParams(location.search),r='';try{r=document.referrer?new URL(document.referrer).hostname:''}catch(e){}var u='https://astrojams-apps.vercel.app/api/visit?s=world-sim&u='+encodeURIComponent(location.pathname)+'&p='+encodeURIComponent(q.get('p')||'')+'&utm='+encodeURIComponent(q.get('utm_source')||'')+'&r='+encodeURIComponent(r);navigator.sendBeacon?navigator.sendBeacon(u):fetch(u,{method:'POST',mode:'no-cors',keepalive:true})}catch(e){}})();";
