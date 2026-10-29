const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),{Worker}=require('node:worker_threads');
module.exports=function createTransitionAudio(dataDir){
 const memory=new Map(),pending=new Map();let active=0,writes=0;
 const folder=path.join(dataDir,'transition-audio');
 const put=(key,value)=>{if(memory.size>=128)memory.delete(memory.keys().next().value);memory.set(key,value);return value;};
 async function prune(){
  // Bounded disk cache; asynchronous housekeeping runs once per 32 new profiles.
  try{
   const names=(await fs.readdir(folder)).filter(n=>/^[a-f0-9]{64}\.json$/.test(n));
   if(names.length<=512)return;
   const rows=await Promise.all(names.map(async name=>({name,time:(await fs.stat(path.join(folder,name))).mtimeMs})));
   rows.sort((a,b)=>a.time-b.time);
   for(const row of rows.slice(0,rows.length-512))await fs.unlink(path.join(folder,row.name));
  }catch(_){}
 }
 return async function get(file,{cachedOnly=false,signal}={}){
  const stat=await fs.stat(file),identity=JSON.stringify([file,stat.size,stat.mtimeMs]),key=crypto.createHash('sha256').update(identity).digest('hex');
  if(memory.has(key))return memory.get(key);
  try{const cached=JSON.parse(await fs.readFile(path.join(folder,key+'.json'),'utf8'));if(require('./smart-transition').valid(cached))return put(key,cached);}catch(_){}
  if(cachedOnly)return null;
  if(pending.has(key))return pending.get(key);
  // No work queue grows with repeated Next clicks. At most one decoder worker.
  if(active)return null;
  if(signal?.aborted)return null;
  active++;
  const job=new Promise((resolve,reject)=>{
   const worker=new Worker(path.join(__dirname,'transition-audio-worker.js'),{workerData:{file}});let settled=false;
   const abort=()=>worker.postMessage('abort');signal?.addEventListener('abort',abort,{once:true});
   const finish=(error,result)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',abort);error?reject(error):resolve(result);};
   worker.once('message',m=>finish(m.error?Error(m.error):null,m.result));worker.once('error',finish);
   worker.once('exit',()=>finish(Error('Transition worker exited')));
  }).then(async result=>{
   const after=await fs.stat(file);if(after.size!==stat.size||after.mtimeMs!==stat.mtimeMs)throw Error('Audio changed during analysis');
   if(!require('./smart-transition').valid(result))throw Error('Invalid transition profile');
   await fs.mkdir(folder,{recursive:true});const target=path.join(folder,key+'.json'),tmp=target+'.tmp';
   await fs.writeFile(tmp,JSON.stringify(result));await fs.rename(tmp,target);
   if(writes++%32===0)await prune();return put(key,result);
  }).finally(()=>{active--;pending.delete(key);});
  pending.set(key,job);return job;
 };
};
