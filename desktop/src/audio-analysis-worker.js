// Decode and DSP run away from Electron's window/event loop.
const {parentPort,workerData}=require('node:worker_threads');
const {decodePcmServer}=require('./audio-decode');
const {analyzePcm}=require('./audio-analyzer');
const abort=new AbortController();
parentPort.on('message',()=>abort.abort());
(async()=>{
  try{
    const pcm=await decodePcmServer(workerData.file,{signal:abort.signal});
    if(abort.signal.aborted)throw new Error('Audio analysis cancelled');
    parentPort.postMessage({result:analyzePcm(pcm.left,pcm.right,pcm.sampleRate,workerData.track,pcm.sampling)});
  }catch(error){parentPort.postMessage({error:String(error.message||error)});}
  finally{parentPort.close();}
})();
