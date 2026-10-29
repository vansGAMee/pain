/* One local CPU process, bounded pending requests. No Python in the renderer. */
const path=require('node:path'),fs=require('node:fs'),{spawn}=require('node:child_process'),readline=require('node:readline');
module.exports=function createPersonalService(dataDir){
 const runtime=__dirname.includes('app.asar')?path.dirname(dataDir):path.join(__dirname,'..');
 const python=process.env.PAIN_PULSEFLOW_PYTHON||path.join(runtime,'.pulseflow-venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
 let child=null,sequence=0,status={state:'idle'};const pending=new Map();
 function stop(error=new Error('Personal recommender stopped'),reset=false){const process=child;child=null;for(const job of pending.values()){clearTimeout(job.timer);job.reject(error);}pending.clear();process?.kill();status=reset?{state:'idle'}:{state:'error',error:error.message};}
 function start(){
  if(child)return child;if(!fs.existsSync(python))throw Error('Install the local music runtime in Settings');
  const process=child=spawn(python,[path.join(__dirname.replace('app.asar','app.asar.unpacked'),'personal','serve.py'),'--data',dataDir],
   {windowsHide:true,env:{...global.process.env,OPENBLAS_NUM_THREADS:'1',OMP_NUM_THREADS:'1',MKL_NUM_THREADS:'1',PYTHONUNBUFFERED:'1'},stdio:['pipe','pipe','pipe']});
  readline.createInterface({input:process.stdout}).on('line',line=>{
   if(child!==process)return;
   try{
    const m=JSON.parse(line);
    if(m.event==='ready'){status={state:'ready',...m.diagnostics};return;}
    if(m.event==='error'){status={state:'error',error:m.error};return;}
    const job=pending.get(m.id);if(!job)return;
    pending.delete(m.id);clearTimeout(job.timer);
    if(m.error){status={state:'error',error:m.error};job.reject(Error(m.error));}
    else{if(m.result?.diagnostics)status={state:'ready',...m.result.diagnostics};job.resolve(m.result);}
   }catch(_){}
  });
  process.stderr.on('data',()=>{});process.stdin.on('error',e=>{if(child===process)stop(e);});process.on('error',e=>{if(child===process)stop(e);});process.on('exit',()=>{if(child===process)stop(Error('Personal recommender exited'));});return process;
 }
 function request(payload){return new Promise((resolve,reject)=>{
  if(pending.size>=3)return reject(Error('Personal recommender busy'));
  try{const process=start(),id=++sequence,timer=setTimeout(()=>stop(Error('Personal recommender timed out')),120000);if(status.state==='idle'&&!['embedding','abandon'].includes(payload.action))status={...status,state:'training'};pending.set(id,{resolve,reject,timer});process.stdin.write(JSON.stringify({...payload,id})+'\n');}catch(e){reject(e);}
 });}
 async function route(req,res){
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  let local=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  try{if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)local=false;}catch(_){local=false;}
  if(!local||req.method!=='POST'||req.headers['x-pain-update']!=='personal'){res.writeHead(403);res.end('{}');return;}
  try{req.setEncoding('utf8');let body='',bytes=0;for await(const chunk of req){bytes+=Buffer.byteLength(chunk);if(bytes>2*1024*1024)throw Error('Request too large');body+=chunk;}
   const value=JSON.parse(body);if(value.action==='status'){res.end(JSON.stringify(status));return;}if(value.action==='abandon'){if(value.cancel)stop(new Error('Personal mode disabled'),true);else if(child)await request(value);res.end(JSON.stringify({abandoned:true}));return;}if(!Array.isArray(value.eligible)&&value.action!=='embedding')throw Error('Missing eligible tracks');
   const result=await request(value);if(!res.destroyed)res.end(JSON.stringify(result));
  }catch(error){if(!res.destroyed){res.writeHead(503);res.end(JSON.stringify({error:error.message}));}}
 }
 process.once('exit',()=>stop());return {route,request,status:()=>({...status}),close:stop};
};
