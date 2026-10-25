/* Same queue/model as playback, on a dedicated worker with a captured clock. */
importScripts('/session-graph.js','/audio-timbre.js','/audio-profile.js','/taste-model.js',
  '/queue-engine.js','/listening-insights.js','/home-model.js');
self.onmessage=({data})=>{
  try{
    const queue=QueueEngine.fromWorkerSnapshot(data.snapshot);
    let result;
    if(data.action==='mix')result=HomeModel.mix(data.tracks,queue,data.limit,data.variation);
    else{
      const track=queue.next();
      result={trackId:track?.id??null,navigation:queue.navigationSnapshot()};
    }
    self.postMessage({id:data.id,result});
  }catch(error){self.postMessage({id:data.id,error:String(error?.message||error)});}
};
