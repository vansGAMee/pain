/* The disk checkpoint survives localhost port changes and full browser storage. */
(function(root){
  'use strict';
  let pending=Promise.resolve(),clock=0;
  root.PlaybackMemory={
    save(id,position){
      const value={id:String(id),position,updatedAt:Math.max(Date.now(),clock+1)};clock=value.updatedAt;
      try{localStorage.setItem('pain_last_playback',JSON.stringify(value));}catch(_){}
      pending=fetch('/api/playback-checkpoint',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value),keepalive:true,signal:AbortSignal.timeout(5000)}).catch(()=>{});
      return pending;
    },
    async read(){
      let local=null,disk=null;try{local=JSON.parse(localStorage.getItem('pain_last_playback'));}catch(_){}
      try{const response=await fetch('/api/playback-checkpoint',{signal:AbortSignal.timeout(2000)});if(response.ok)disk=(await response.json()).value;}catch(_){}
      return disk&&(!local||(disk.updatedAt||0)>(local.updatedAt||0))?disk:local;
    },
    flush:()=>pending
  };
})(globalThis);
