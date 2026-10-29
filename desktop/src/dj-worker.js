/* Same queue/model as playback, on a dedicated worker with a captured clock. */
importScripts('/session-graph.js','/audio-timbre.js','/audio-profile.js','/recommendation-model.js',
  '/queue-engine.js','/pulseflow-player.js','/personal-player.js');
self.onmessage=async ({data})=>{
  try{
    const queue=QueueEngine.fromWorkerSnapshot(data.snapshot);
    let result;
    const player=queue.pulseflowPolicy==='taste'?PersonalPlayer:PulseFlowPlayer;
    if(data.action==='mix')result=await player.mix(data.tracks,queue,data.limit);
    else result=await player.next(queue);
    self.postMessage({id:data.id,result,personalPreparing:queue.pulseflowPolicy==='taste'&&PersonalPlayer.isPreparing()});
  }catch(error){self.postMessage({id:data.id,error:String(error?.message||error)});}
};
