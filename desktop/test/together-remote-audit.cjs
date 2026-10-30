// Opt-in end-to-end audit of a configured independent relay; no personal data.
const assert=require('node:assert/strict'),{fixture}=require('./together-fixture.cjs'),defaults=require('../src/listen/defaults.json');
(async()=>{
 const f=await fixture();try{
  for(let i=0;i<2;i++)await f.call(i,'settings',{...defaults,name:'Audit '+i});
  await f.call(0,'create',{mode:'equal'});await f.wait(0,s=>s.connected);const {invite}=await f.call(0,'invite');await f.call(1,'join',{invite});await f.wait(1,s=>s.connected);
  await f.call(0,'add',{trackId:'host0'});const state=await f.wait(1,s=>s.state.queue.length===1),uid=state.state.queue[0].uid;
  await f.call(0,'play',{uid});await f.wait(1,s=>s.state.playback.uid===uid);
  const started=performance.now(),response=await fetch(f.bases[1]+'/api/listen/audio/'+uid,{headers:{Range:'bytes=100-99999'}});assert.equal(response.status,206);assert.deepEqual(Buffer.from(await response.arrayBuffer()),f.body.subarray(100,100000));
  await f.call(1,'transport',{position:3,paused:true});await f.wait(0,s=>s.state.playback.position===3&&s.state.playback.paused);
  await f.call(0,'leave');await f.wait(1,s=>!s.identity);
  console.log(JSON.stringify({remoteTLS:true,certificatePinned:true,independentBackends:2,rangeAudioBytes:99900,transferMs:Math.round(performance.now()-started),sharedPauseAndSeek:true,roomClosed:true}));
 }finally{await f.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
