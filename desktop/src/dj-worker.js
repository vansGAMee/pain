/* Same queue/model as playback, on a dedicated worker with a captured clock. */
importScripts('/session-graph.js','/audio-timbre.js','/audio-profile.js','/recommendation-model.js',
  '/queue-engine.js','/pulseflow-player.js');
self.onmessage=async ({data})=>{
  try{
    const queue=QueueEngine.fromWorkerSnapshot(data.snapshot);
    let result;
    if(data.action==='mix')result=await PulseFlowPlayer.mix(data.tracks,queue,data.limit);
    else result=await PulseFlowPlayer.next(queue);
    self.postMessage({id:data.id,result});
  }catch(error){self.postMessage({id:data.id,error:String(error?.message||error)});}
};
