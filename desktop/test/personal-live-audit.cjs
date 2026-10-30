// Full live adapter/RPC audit using only copies of actual saved listening events.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const Queue=require('../src/queue-engine'),Player=require('../src/personal-player');
(async()=>{
 const source=process.env.PAIN_AUDIT_DATA;assert.ok(source,'Supply an isolated snapshot');
 assert.notEqual(path.resolve(source),path.resolve(__dirname,'../data'));
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'pain-personal-live-'));let service;
 try{
  await fs.mkdir(path.join(root,'pulseflow'));const inputs={};
  for(const name of ['library.json','stats.json','dj-state.json','pulseflow/catalog.npz']){inputs[name]=await fs.readFile(path.join(source,name));await fs.writeFile(path.join(root,name),inputs[name]);}
  const tracks=JSON.parse(inputs['library.json']).tracks,stats=JSON.parse(inputs['stats.json']),plays=[...stats.plays].sort((a,b)=>a.started-b.started);
  const cutoff=plays[Math.floor(plays.length*.9)].started;
  await fs.writeFile(path.join(root,'stats.json'),JSON.stringify({...stats,plays:plays.filter(p=>p.started<cutoff)}));
  service=require('../src/personal-service')(root);
  const payload={eligible:tracks.map(t=>String(t.id)),length:6,kind:'mix',seed:42,now:Date.now(),offset:-240};
  const begin=performance.now(),cold=await service.request(payload),coldMs=performance.now()-begin;assert.equal(cold.preparing,true);
  async function ready(){const start=Date.now();while(service.status().state!=='ready'){if(service.status().state==='error')throw Error(service.status().error);if(Date.now()-start>120000)throw Error('Model readiness timed out');await new Promise(r=>setTimeout(r,100));}}
  await ready();const initial=await service.request(payload);assert.ok(!initial.preparing&&initial.tracks.length);
  await fs.writeFile(path.join(root,'dj-state.json'),inputs['dj-state.json']);
  const rewritten=await service.request(payload);assert.ok(!rewritten.preparing&&!rewritten.updating,'unchanged sync bytes must not retrain the model');
  await fs.writeFile(path.join(root,'stats.json'),inputs['stats.json']);
  const refitStart=performance.now(),during=await service.request(payload),duringMs=performance.now()-refitStart;
  assert.ok(during.updating&&!during.preparing&&during.tracks.length,'new real history must keep the last fitted model serving');
  assert.ok(during.tracks.every(t=>t.explanation.method==='personal-taste'));
  await ready();const updated=await service.request(payload);assert.ok(updated.diagnostics.events>initial.diagnostics.events);
  const q=new Queue({shuffleMode:'smart',pulseflowPolicy:'taste',stats});q.smartSeed=42;q.setContext('library',tracks,0);
  const learned=[],fallback=[],latencies=[];
  for(let i=0;i<30;i++){const start=performance.now();learned.push((await Player.next(q,p=>service.request(p))).trackId);latencies.push(performance.now()-start);assert.equal(q.lastTransition.explanation.method,'personal-taste');}
  const offline=new Queue({shuffleMode:'smart',pulseflowPolicy:'taste',stats});offline.smartSeed=42;offline.setContext('library',tracks,0);
  for(let i=0;i<30;i++)fallback.push((await Player.next(offline,async()=>({preparing:true,tracks:[]}))).trackId);
  assert.ok(new Set(learned).size>2);assert.ok(new Set(fallback).size>2);
  await fs.writeFile(path.join(root,'pulseflow/catalog.npz'),'broken update');
  const failing=await service.request(payload);assert.ok(failing.tracks.length&&!failing.preparing);
  await ready();
  const recovered=await service.request(payload);
  assert.ok(recovered.updateError&&recovered.tracks.every(t=>t.explanation.method==='personal-taste'),'a failed update must preserve the working model and expose its error');
  for(const name of Object.keys(inputs))assert.deepEqual(await fs.readFile(path.join(source,name)),inputs[name]);
  const report={library:tracks.length,coldResponseMs:Math.round(coldMs),initialEvents:initial.diagnostics.events,updatedEvents:updated.diagnostics.events,
   refitResponseMs:Math.round(duringMs),servedLearnedModelDuringRefit:true,unchangedSyncAvoidsRefit:true,failedRefitPreservesModel:true,
   choices:30,learnedUnique:new Set(learned).size,fallbackUnique:new Set(fallback).size,warmMaxMs:Math.round(Math.max(...latencies)),snapshotUnchanged:true};
  if(process.env.PAIN_AUDIT_REPORT)await fs.writeFile(process.env.PAIN_AUDIT_REPORT,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{service?.close();await fs.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
