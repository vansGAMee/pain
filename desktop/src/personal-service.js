/* One local CPU process, bounded pending requests. No Python in the renderer. */
const path=require('node:path'),fs=require('node:fs'),{spawn}=require('node:child_process'),readline=require('node:readline');
module.exports=function createPersonalService(dataDir,{spawnImpl=spawn}={}){
 const runtime=require('./music-runtime')(dataDir),python=runtime.python;
 let child=null,sequence=0,status={state:'idle'},booting=false,bootRequest=null,stderr='';const pending=new Map();
 function stop(error=new Error('Personal recommender stopped'),reset=false){const process=child;child=null;for(const job of pending.values()){clearTimeout(job.timer);job.reject(error);}pending.clear();process?.kill();status=reset?{state:'idle'}:{state:'error',error:error.message};}
 function start(){
  if(child)return child;if(!runtime.installed())throw Error('Install local analysis in Settings');
  booting=true;bootRequest=null;stderr='';
  const process=child=spawnImpl(python,[path.join(runtime.sources,'personal','serve.py'),'--data',dataDir],
   {windowsHide:true,env:runtime.env(),stdio:['pipe','pipe','pipe']});
  require('./background-priority')(process);
  readline.createInterface({input:process.stdout}).on('line',line=>{
   if(child!==process)return;
   try{
    const m=JSON.parse(line);
    if(m.event==='booted'){booting=false;return;}
    if(m.event==='ready'){status={state:'ready',...m.diagnostics};return;}
    if(m.event==='error'){status=m.diagnostics?{...m.diagnostics,state:'ready',updateError:m.error}:{state:'error',error:m.error};return;}
    const job=pending.get(m.id);if(!job)return;
    pending.delete(m.id);clearTimeout(job.timer);
    if(m.error){status={state:'error',error:m.error};job.reject(Error(m.error));}
    else{if(m.result?.diagnostics)status={...m.result.diagnostics,state:m.result.preparing?'training':m.result.updating?'updating':'ready',...(m.result.updateError?{updateError:m.result.updateError}:{})};job.resolve(m.result);}
   }catch(_){}
  });
  process.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-8000);});process.stdin.on('error',e=>{if(child===process)stop(e);});process.on('error',e=>{if(child===process)stop(e);});process.on('exit',()=>{if(child===process)stop(Error(stderr.trim()||'Personal recommender exited'));});return process;
 }
 function send(payload,process){return new Promise((resolve,reject)=>{
  if(pending.size>=3)return reject(Error('Personal recommender busy'));
  try{const id=++sequence,timer=setTimeout(()=>stop(Error('Personal recommender timed out')),120000);if(status.state==='idle'&&!['embedding','abandon'].includes(payload.action))status={...status,state:'training'};pending.set(id,{resolve,reject,timer});process.stdin.write(JSON.stringify({...payload,id})+'\n');}catch(e){reject(e);}
 });}
 function request(payload){
  try{
   const process=start();
   if(booting&&Array.isArray(payload.eligible)){
    // Cold numpy/sklearn imports can take seconds on a weak Windows PC.
    // Queue one training request; playback receives its baseline immediately.
    if(!bootRequest){bootRequest=send(payload,process);const clear=()=>{if(child===process)bootRequest=null;};bootRequest.then(clear,clear);}
    return Promise.resolve({preparing:true,tracks:[],diagnostics:{state:'training'}});
   }
   return send(payload,process);
  }catch(error){status={state:'error',error:error.message};return Promise.reject(error);}
 }
 async function route(req,res){
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  let local=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  try{if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)local=false;}catch(_){local=false;}
  if(!local||req.method!=='POST'||req.headers['x-pain-update']!=='personal'){res.writeHead(403);res.end('{}');return;}
  try{req.setEncoding('utf8');let body='',bytes=0;for await(const chunk of req){bytes+=Buffer.byteLength(chunk);if(bytes>2*1024*1024)throw Error('Request too large');body+=chunk;}
   const value=JSON.parse(body);if(value.action==='status'){res.end(JSON.stringify(status));return;}if(value.action==='abandon'){if(value.cancel)stop(new Error('Personal mode disabled'),true);else if(child)await request(value);res.end(JSON.stringify({abandoned:true}));return;}if(!Array.isArray(value.eligible)&&value.action!=='embedding')throw Error('Missing eligible tracks');
   await runtime.ensureSources();const result=await request(value);if(!res.destroyed)res.end(JSON.stringify(result));
  }catch(error){if(!res.destroyed){res.writeHead(503);res.end(JSON.stringify({error:error.message}));}}
 }
 process.once('exit',()=>stop());return {route,request,status:()=>({...status}),reload:()=>stop(new Error('Runtime changed'),true),close:stop};
};
