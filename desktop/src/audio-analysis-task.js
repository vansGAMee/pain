const {Worker}=require('node:worker_threads');
const path=require('node:path');
module.exports=function analyzeFile(file,track,{signal}={}){
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(new Error('Audio analysis cancelled'));return;}
    const worker=new Worker(path.join(__dirname,'audio-analysis-worker.js'),{workerData:{file,track}});
    let settled=false;
    const abort=()=>worker.postMessage('abort');
    const finish=(error,result)=>{
      if(settled)return;settled=true;signal?.removeEventListener('abort',abort);
      if(error)reject(error);else resolve(result);
    };
    signal?.addEventListener('abort',abort,{once:true});
    worker.once('message',message=>finish(message.error?new Error(message.error):null,message.result));
    worker.once('error',finish);
    worker.once('exit',code=>finish(new Error(`Audio analysis worker exited (${code})`)));
  });
};
