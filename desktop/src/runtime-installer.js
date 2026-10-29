// A single asynchronous installation job, with pinned bootstrap checksums.
const fs=require('node:fs'),path=require('node:path'),https=require('node:https'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{pipeline}=require('node:stream/promises'),{Transform}=require('node:stream'),zlib=require('node:zlib');
const createLayout=require('./music-runtime'),artifacts=require('./runtime-artifacts.json');
const hosts=new Set(['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com']);
const hashFile=async file=>{const h=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))h.update(chunk);return h.digest('hex');};
function response(url,signal,redirects=5){return new Promise((resolve,reject)=>{
 let parsed;try{parsed=new URL(url);}catch(error){reject(error);return;}
 if(parsed.protocol!=='https:'||!hosts.has(parsed.hostname)){reject(Error('Untrusted runtime download'));return;}
 const req=https.get(parsed,{signal,headers:{'User-Agent':'PAIN-runtime-installer'}},res=>{
  if(res.statusCode>=300&&res.statusCode<400){res.resume();if(!redirects||!res.headers.location)return reject(Error('Runtime download redirect failed'));resolve(response(new URL(res.headers.location,parsed).href,signal,redirects-1));}
  else if(res.statusCode!==200){res.resume();reject(Error('Runtime download HTTP '+res.statusCode));}else resolve(res);
 });req.setTimeout(30000,()=>req.destroy(Error('Runtime download timed out')));req.on('error',reject);
});}
async function download(url,file,digest,signal,{transport=response,onProgress}={}){
 if(fs.existsSync(file)&&await hashFile(file)===digest)return file;
 await fs.promises.mkdir(path.dirname(file),{recursive:true});const part=file+'.part';
 try{
  const stream=await transport(url,signal);let bytes=0;const total=Number(stream.headers?.['content-length'])||0;
  const bounded=new Transform({transform(chunk,_,callback){bytes+=chunk.length;onProgress?.({received:bytes,total});callback(bytes>128*1024*1024?Error('Runtime bootstrap is too large'):null,chunk);}});
  await pipeline(stream,bounded,fs.createWriteStream(part),{signal});
  if(await hashFile(part)!==digest)throw Error('Runtime download checksum mismatch');
  await fs.promises.rm(file,{force:true});await fs.promises.rename(part,file);return file;
 }finally{await fs.promises.rm(part,{force:true}).catch(()=>{});}
}
module.exports=function createInstaller(dataDir,options={}){
 const layout=options.layout||createLayout(dataDir),spawnImpl=options.spawn||spawn;
 const fetchFile=(...args)=>(options.download||download)(...args,{onProgress:progress=>{state.progress=progress;}});
 let job=null,controller=null,child=null,closed=false,log='';
 let state={state:layout.installed()?'ready':'missing',phase:null,running:false};
 const status=()=>({...state,installed:layout.installed(),supported:['win32','linux'].includes(layout.platform)&&process.arch==='x64'});
 async function save(){await fs.promises.mkdir(layout.home,{recursive:true});const temp=layout.stateFile+'.tmp';await fs.promises.writeFile(temp,JSON.stringify({...state,managed:true}));await fs.promises.rename(temp,layout.stateFile);}
 async function phase(value){state={state:'installing',phase:value,running:true,error:null};await save();}
 function run(command,args){return new Promise((resolve,reject)=>{
  if(controller.signal.aborted)return reject(Error('Installation cancelled'));
  const proc=child=spawnImpl(command,args,{env:layout.env(),windowsHide:true,detached:layout.platform!=='win32',stdio:['ignore','pipe','pipe']});
  require('./background-priority')(proc);
  const append=data=>{log=(log+data.toString()).slice(-24000);fs.promises.appendFile(path.join(layout.home,'install.log'),data).catch(()=>{});};
  proc.stdout.on('data',append);proc.stderr.on('data',append);proc.once('error',reject);
  proc.once('close',code=>{if(child===proc)child=null;code===0?resolve():reject(Error('Runtime command failed ('+code+'): '+log.slice(-1500)));});
 });}
 async function install(){
  const config=artifacts[layout.platform];if(!config||process.arch!=='x64')throw Error('Unsupported runtime platform');
  await phase('tools');await layout.ensureSources();
  const cache=path.join(layout.home,'downloads');await fs.promises.mkdir(layout.bin,{recursive:true});
  const archive=await fetchFile(`https://github.com/astral-sh/uv/releases/download/${artifacts.uvVersion}/${config.uv.file}`,path.join(cache,config.uv.file),config.uv.sha256,controller.signal);
  const unpack=path.join(layout.home,'uv');await fs.promises.mkdir(unpack,{recursive:true});
  if(layout.platform==='win32')await require('extract-zip')(archive,{dir:unpack});else await run('tar',['-xzf',archive,'-C',unpack]);
  const uv=path.join(unpack,layout.platform==='win32'?'uv.exe':'uv-x86_64-unknown-linux-gnu/uv');
  for(const name of ['ffmpeg','ffprobe']){
   const base=`https://github.com/eugeneware/ffmpeg-static/releases/download/${artifacts.mediaVersion}/${name}-${layout.platform}-x64`;
   const gz=await fetchFile(base+'.gz',path.join(cache,name+'.gz'),config[name].sha256,controller.signal);
   const target=path.join(layout.bin,name+(layout.platform==='win32'?'.exe':'')),part=target+'.part';
   await pipeline(fs.createReadStream(gz),zlib.createGunzip(),fs.createWriteStream(part),{signal:controller.signal});
   if(await hashFile(part)!==config[name].binarySha256)throw Error('Audio tool checksum mismatch');
   await fs.promises.rm(target,{force:true});await fs.promises.rename(part,target);if(layout.platform!=='win32')await fs.promises.chmod(target,0o755);
  }
  await fetchFile(`https://github.com/eugeneware/ffmpeg-static/releases/download/${artifacts.mediaVersion}/${layout.platform}-x64.LICENSE`,path.join(layout.bin,'FFmpeg-LICENSE.txt'),artifacts.mediaLicenseSha256,controller.signal);
  await phase('python');
  const venv=path.join(layout.root,'.pulseflow-venv');
  if(path.resolve(path.dirname(path.dirname(layout.python)))!==path.resolve(venv))throw Error('The configured custom Python is unavailable; restore its path before installing');
  await run(uv,['--no-config','venv','--python','3.11','--managed-python','--allow-existing',venv]);
  await phase('packages');
  await require('./runtime-pytorch')(args=>run(uv,args),{python:layout.python,platform:layout.platform,signal:controller.signal,onSource:async source=>{state.source=source;await save();}});
  state.source='pypi.org';await save();
  await run(uv,['--no-config','pip','install','--python',layout.python,'-r',path.join(layout.sources,'pulseflow/requirements.lock'),'--index-url','https://pypi.org/simple']);
  await phase('checking');
  await run(uv,['--no-config','pip','check','--python',layout.python]);
  await run(layout.python,['-c',"import numpy, scipy, sklearn, faiss, torch, torchaudio, laion_clap; a=numpy.eye(2,dtype='float32'); i=faiss.IndexFlatIP(2); i.add(a); assert i.search(a,1)[1].shape==(2,1); assert torch.ones(2).sum().item()==2; print('PAIN runtime ready')"]);
  for(const tool of ['ffmpeg','ffprobe'])await run(path.join(layout.bin,tool+(layout.platform==='win32'?'.exe':'')),['-version']);
  state={state:'ready',phase:null,running:false,error:null};await save();await Promise.resolve(options.onReady?.()).catch(()=>{});
 }
 function start(){
  if(closed)throw Error('Runtime installer closed');
  if(job)return status();
  if(layout.installed()){state={state:'ready',running:false};return status();}
  controller=new AbortController();state={state:'installing',phase:'tools',running:true,error:null};log='';
  job=install().catch(async error=>{state={state:controller.signal.aborted?'cancelled':'error',phase:null,running:false,error:String(error.message)};await save().catch(()=>{});}).finally(()=>{job=null;});
  return status();
 }
 function cancel(){
  controller?.abort();const proc=child;
  if(proc?.pid&&proc.exitCode===null){
   if(layout.platform==='win32')spawnImpl('taskkill',['/PID',String(proc.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'}).on('error',()=>{});
   else try{process.kill(-proc.pid,'SIGTERM');}catch(_){proc.kill();}
  }
 }
 async function route(req,res){
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  let local=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  try{if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)local=false;}catch(_){local=false;}
  if(!local){res.writeHead(403);res.end('{}');return;}
  try{
   if(req.method==='GET'){res.end(JSON.stringify({...status(),details:state.state==='error'?log.slice(-12000):''}));return;}
   if(req.method!=='POST'||req.headers['x-pain-update']!=='runtime'){res.writeHead(403);res.end('{}');return;}
   req.setEncoding('utf8');let body='';for await(const chunk of req){body+=chunk;if(body.length>1024)throw Error('Request too large');}
   const action=JSON.parse(body||'{}').action;
   if(action==='install')start();else if(action==='cancel')cancel();else throw Error('Unknown runtime action');
   res.end(JSON.stringify(status()));
  }catch(error){res.writeHead(400);res.end(JSON.stringify({error:error.message}));}
 }
 return {status,start,cancel,route,done:()=>job,close(){closed=true;cancel();},layout};
};
module.exports.download=download;
