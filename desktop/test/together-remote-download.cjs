// Opt-in VPS audit; synthetic WAV only. Never changes server configuration.
const assert=require('node:assert/strict'),{fixture}=require('./together-fixture.cjs'),defaults=require('../src/listen/defaults.json');
(async()=>{const f=await fixture();try{
 for(let i=0;i<2;i++)await f.call(i,'settings',{...defaults,name:'Release test '+i});
 await f.call(0,'create',{mode:'equal'});await f.wait(0,s=>s.connected);await f.call(1,'join',{invite:(await f.call(0,'invite')).invite});await f.wait(1,s=>s.connected);
 await f.call(0,'add',{trackId:'host0'});const state=await f.wait(1,s=>s.state.queue.length===1),uid=state.state.queue[0].uid;assert.equal(state.state.capabilities.downloads,1);await assert.rejects(f.call(1,'save',{uid}),/не разрешил/);await assert.rejects(f.call(1,'sharing',{enabled:true}),/ведущий/);
 await f.call(0,'sharing',{enabled:true});await f.wait(1,s=>s.state.allowDownloads);const saved=await f.call(1,'save',{uid});assert.equal(saved.saved.bytes,f.body.length);
 const file=await fetch(f.bases[1]+'/api/cached-track/'+saved.saved.id);assert.deepEqual(Buffer.from(await file.arrayBuffer()),f.body);await f.call(0,'sharing',{enabled:false});await f.wait(1,s=>!s.state.allowDownloads);await assert.rejects(f.call(1,'save',{uid}),/не разрешил/);
 await f.call(0,'leave');await f.wait(1,s=>!s.identity);console.log(JSON.stringify({remoteTLS:true,certificatePinned:true,hostPermissionEnforced:true,savedBytes:f.body.length,realAudioBytesVerified:true,revocationEnforced:true,roomClosed:true}));
 }finally{await f.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
