/* Separate playback and Home workers: previews cannot delay the next song.
 * Each lane keeps one running and one newest waiting request, bounding CPU/memory.
 */
(function(root){
  if(typeof Worker === 'undefined')return;
  const lanes=new Map();let sequence=0;
  const superseded=()=>new Error('Smart DJ request superseded');
  function stop(lane,error){
    lane.worker?.terminate();lane.worker=null;
    clearTimeout(lane.timer);lane.timer=null;
    lane.active?.reject(error);lane.waiting?.reject(error);
    lane.active=lane.waiting=null;
  }
  function start(lane,job){
    lane.active=job;
    try{
      if(!lane.worker){
        lane.worker=new Worker('/dj-worker.js');
        lane.worker.onmessage=({data})=>{
          if(data.id!==lane.active?.id)return;
          clearTimeout(lane.timer);lane.timer=null;
          const done=lane.active;lane.active=null;
          if(data.personalPreparing)root.dispatchEvent?.(new Event('pain:personal-preparing'));
          if(data.error)done.reject(new Error(data.error));else done.resolve(data.result);
          const next=lane.waiting;lane.waiting=null;if(next)start(lane,next);
        };
        lane.worker.onerror=()=>stop(lane,new Error('Smart DJ worker failed'));
        lane.worker.onmessageerror=()=>stop(lane,new Error('Smart DJ response could not be read'));
      }
      // Operational latency limit, unrelated to musical ranking.
      lane.timer=setTimeout(()=>stop(lane,new Error('Smart DJ selection timed out')),20000);
      lane.worker.postMessage({id:job.id,...job.payload});
    }catch(error){stop(lane,error);}
  }
  function request(payload){
    return new Promise((resolve,reject)=>{
      const name=payload.action==='mix'?'home':'playback';
      let lane=lanes.get(name);if(!lane){lane={};lanes.set(name,lane);}
      const job={id:++sequence,payload,resolve,reject};
      if(lane.active){lane.waiting?.reject(superseded());lane.waiting=job;}
      else start(lane,job);
    });
  }
  root.DJWorker={request};
  root.addEventListener?.('pagehide',()=>{for(const lane of lanes.values())stop(lane,new Error('Player closed'));});
})(globalThis);
