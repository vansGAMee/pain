const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const create=require('../src/genre-service'),wait=require('node:timers/promises').setTimeout;
async function until(check){for(let i=0;i<300;i++){if(await check())return;await wait(10);}throw Error('Timed out');}
test('file genres avoid internet requests and survive restart; changed track identity invalidates them',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pain-genres-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 let requests=0;const track={id:'a',title:'One',artist:'Artist'},options={interval:1,getTracks:()=>[track],loadStats:async()=>({}),localMedia:{read:async track=>({track,metadata:{genre:'Hip-Hop;R&B'}})},catalog:{genres:async()=>{requests++;return null;}}};
 const service=create(dir,options);t.after(()=>service.close());await service.enqueue(track);
 await until(()=>service.entry(track)?.names.length&&!service.status().active);
 assert.deepEqual(service.entry(track).names,['hip hop','r&b']);assert.equal(requests,0);
 const restored=create(dir,options);t.after(()=>restored.close());await restored.ready;
 assert.deepEqual((await restored.snapshot()).a.names,['hip hop','r&b']);
 assert.equal(restored.entry({...track,title:'Different song'}),null);
});
test('disabling cancels the in-flight genre lookup and persists across restart',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pain-genres-cancel-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const track={id:'a',title:'One',artist:'Artist'};let started=false,aborted=false;
 const options={interval:1,getTracks:()=>[track],loadStats:async()=>({}),localMedia:{read:async track=>({track})},catalog:{genres:async(track,{signal})=>new Promise((resolve,reject)=>{started=true;signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);});})}};
 const service=create(dir,options);t.after(()=>service.close());await service.enqueue(track);await until(()=>started);
 await service.setEnabled(false);await until(()=>!service.status().active);
 assert.ok(aborted);assert.equal(service.entry(track),null);assert.equal(service.status().queued,0);
 const restored=create(dir,options);t.after(()=>restored.close());await restored.ready;assert.equal(restored.status().enabled,false);
});
test('maximum saving completes internet metadata for the library and prioritizes the current song',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pain-genres-maximum-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const tracks=[{id:'a',title:'A'},{id:'b',title:'B'}],seen=[];
 const service=create(dir,{interval:1,getTracks:()=>tracks,loadStats:async()=>({}),localMedia:{read:async track=>({track})},catalog:{genres:async track=>{seen.push(track.id);return null;}}});t.after(()=>service.close());
 service.setMode('maximum');await service.enqueue(tracks[0]);await service.enqueue(tracks[1],true);
 await until(()=>service.entry(tracks[0])&&!service.status().active);
 assert.deepEqual(seen,['b','a']);assert.deepEqual(service.entry(tracks[1]).names,[]);
});
test('an unavailable source cannot erase previously identified genres during refresh',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pain-genres-offline-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const track={id:'a',title:'Song',artist:'Artist'},saved={names:['rock'],scope:'recording',signature:JSON.stringify([2,track.title,track.artist,track.album,track.duration]),at:1};
 await fs.writeFile(path.join(dir,'genres.json'),JSON.stringify({entries:{a:saved}}));
 const service=create(dir,{interval:1,getTracks:()=>[track],loadStats:async()=>({}),localMedia:{read:async track=>({track})},catalog:{genres:async()=>{throw Error('offline');}}});t.after(()=>service.close());
 await service.enqueue(track);await until(()=>service.entry(track)?.failed&&!service.status().active);
 assert.deepEqual(service.entry(track).names,['rock']);assert.equal(service.entry(track).scope,'recording');
});
test('genres of one song never fill unrelated songs by the same performer',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pain-genres-scope-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const a={id:'a',title:'Song A',artist:'Artist'},b={id:'b',title:'Song B',artist:'Artist'};
 await fs.writeFile(path.join(dir,'genres.json'),JSON.stringify({entries:{a:{names:['rock'],scope:'recording',signature:JSON.stringify([2,a.title,a.artist,a.album,a.duration]),at:Date.now()}}}));
 const service=create(dir,{getTracks:()=>[a,b],loadStats:async()=>({})});t.after(()=>service.close());
 const snapshot=await service.snapshot();assert.deepEqual(snapshot.a.names,['rock']);assert.deepEqual(snapshot.b.names,[]);
});
