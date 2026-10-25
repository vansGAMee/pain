/* Heavy selection runs outside the renderer. Requests never write user data. */
(function(root){
  if(typeof Worker === 'undefined')return;
  let worker=null,sequence=0;
  const pending=new Map();
  function stop(error){
    worker?.terminate();worker=null;
    for(const job of pending.values()){clearTimeout(job.timer);job.reject(error);}
    pending.clear();
  }
  function request(payload){
    return new Promise((resolve,reject)=>{
      try{
        if(!worker){
          worker=new Worker('/dj-worker.js');
          worker.onmessage=({data})=>{
            const job=pending.get(data.id);if(!job)return;
            pending.delete(data.id);clearTimeout(job.timer);
            if(data.error)job.reject(new Error(data.error));else job.resolve(data.result);
          };
          worker.onerror=()=>stop(new Error('Smart DJ worker failed'));
          worker.onmessageerror=()=>stop(new Error('Smart DJ response could not be read'));
        }
        const id=++sequence;
        const timer=setTimeout(()=>stop(new Error('Smart DJ selection timed out')),30000);
        pending.set(id,{resolve,reject,timer});
        try{worker.postMessage({id,...payload});}
        catch(error){pending.delete(id);clearTimeout(timer);reject(error);}
      }catch(error){reject(error);}
    });
  }
  root.DJWorker={request};
  root.addEventListener?.('pagehide',()=>stop(new Error('Player closed')));
})(globalThis);
