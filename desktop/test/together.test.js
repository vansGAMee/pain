const test=require('node:test'),assert=require('node:assert/strict'),{fixture}=require('./together-fixture.cjs');
test('two real app servers share a controlled queue, proposals, playback, range audio and equal rights without storing audio on the relay',async t=>{
 const f=await fixture();t.after(()=>f.close());
 await f.call(0,'create',{mode:'host'});const host=await f.wait(0,s=>s.connected);assert.equal(host.state.mode,'host');
 const {invite}=await f.call(0,'invite');await f.call(1,'join',{invite});await f.wait(1,s=>s.state?.members.length===2);
 await f.call(0,'add',{trackId:'host0'});await f.call(1,'add',{trackId:'guest0'});let s=await f.wait(0,s=>s.state?.proposals.length===1&&s.state.queue.length===1);
 const first=s.state.queue[0].uid,suggestion=s.state.proposals[0].uid;
 await f.call(1,'play',{uid:first});await f.wait(1,s=>/ведущим/.test(s.error));assert.equal((await f.status(0)).state.playback.uid,null);
 await f.call(0,'accept',{uid:suggestion});await f.wait(1,s=>s.state.queue.length===2&&!s.state.proposals.length);
 await f.call(0,'play',{uid:first});await f.wait(1,s=>s.state.playback.uid===first&&!s.state.playback.paused);
 // Guest has no host0 file: full bytes and seek range must cross both app
 // backends and the real HTTP relay, rather than an intercepted browser route.
 const full=await fetch(f.bases[1]+'/api/listen/audio/'+first);assert.equal(full.status,200);assert.deepEqual(Buffer.from(await full.arrayBuffer()),f.body);
 const range=await fetch(f.bases[1]+'/api/listen/audio/'+first,{headers:{Range:'bytes=100-499'}});assert.equal(range.status,206);assert.equal(range.headers.get('content-range'),`bytes 100-499/${f.body.length}`);assert.deepEqual(Buffer.from(await range.arrayBuffer()),f.body.subarray(100,500));
 await f.call(0,'transport',{paused:true,position:4});await f.wait(1,s=>s.state.playback.paused&&s.state.playback.position===4);
 await f.call(0,'mode',{mode:'equal'});await f.wait(1,s=>s.state.mode==='equal');await f.call(1,'add',{trackId:'guest1'});s=await f.wait(0,s=>s.state.queue.length===3);
 const epoch=s.state.playback.epoch;await Promise.all([f.call(0,'next',{automatic:true,epoch}),f.call(1,'next',{automatic:true,epoch})]);await f.wait(0,s=>s.state.playback.uid===suggestion);
 assert.equal((await f.status(1)).state.playback.uid,suggestion,'concurrent endings advance exactly once');
 const health=await(await fetch(f.relayURL+'/health')).json();assert.equal(health.streams,0);assert.equal(f.relay.transfers.size,0);
 assert.equal((await fetch(f.relayURL+'/stream/'+'A'.repeat(32),{method:'POST',body:'not authorized'})).status,404);
 assert.equal((await fetch(f.bases[0]+'/api/listen/control',{method:'POST',body:'{}'})).status,403);
 await f.call(0,'leave');await f.wait(1,s=>!s.connected);assert.equal(f.relay.rooms.size,0);
});
