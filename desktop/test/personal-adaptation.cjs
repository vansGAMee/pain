// Refit/cache audit on a temporary copy with genuinely newer saved feedback.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
(async()=>{
 const source=process.env.PAIN_AUDIT_DATA;assert.ok(source,'supply an isolated audit snapshot');
 const root=path.resolve(__dirname,'..'),directory=await fs.mkdtemp(path.join(os.tmpdir(),'pain-real-adaptation-'));let service;
 try{
  await fs.mkdir(path.join(directory,'pulseflow'));
  for(const name of ['library.json','stats.json','dj-state.json','pulseflow/catalog.npz'])await fs.copyFile(path.join(source,name),path.join(directory,name));
  const library=JSON.parse(await fs.readFile(path.join(directory,'library.json')));
  service=require('../src/personal-service')(directory);
  const query={eligible:library.tracks.slice(0,3).map(t=>t.id),length:1,kind:'mix',seed:1,now:Date.now(),offset:-240};
  async function readyQuery(payload){
   let result=await service.request(payload),begin=Date.now();
   while(result.preparing){
    const state=service.status();if(state.state==='error')throw Error(state.error);
    if(Date.now()-begin>120000)throw Error('training readiness timeout');
    await new Promise(resolve=>setTimeout(resolve,50));
    if(service.status().state==='ready')result=await service.request(payload);
   }
   return result;
  }
  const initial=await service.request(query);assert.equal(initial.preparing,true);const first=await readyQuery(query);
  // Read the ongoing application's new history; never write to its data folder.
  const current=await fs.readFile(path.join(root,'data/stats.json'));
  await fs.writeFile(path.join(directory,'stats.json'),current);
  const updating=await service.request({...query,now:Date.now()});assert.equal(updating.preparing,true,'new real feedback must trigger a nonblocking background refit');
  const updated=await readyQuery({...query,now:Date.now()});
  assert.ok(updated.diagnostics.events>first.diagnostics.events,'requires genuinely newer terminal feedback in the running app');
  const begin=performance.now();const cached=await service.request({...query,now:Date.now()});const warmMs=performance.now()-begin;
  assert.equal(cached.diagnostics.events,updated.diagnostics.events);
  console.log(JSON.stringify({genuineFeedback:true,oldEvents:first.diagnostics.events,newEvents:updated.diagnostics.events,initialFitMs:first.diagnostics.fitMs,refitMs:updated.diagnostics.fitMs,warmRequestMs:Math.round(warmMs),writes:'temporary copy only'}));
 }finally{service?.close();await fs.rm(directory,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
