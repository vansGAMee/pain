const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{fixture}=require('./together-fixture.cjs');
async function room(t){const f=await fixture();t.after(()=>f.close());await f.call(0,'create',{mode:'equal'});await f.wait(0,s=>s.connected);await f.call(1,'join',{invite:(await f.call(0,'invite')).invite});await f.wait(1,s=>s.connected);await f.call(0,'add',{trackId:'host0'});const state=await f.wait(1,s=>s.state?.queue.length===1);return {f,uid:state.state.queue[0].uid};}
test('saving needs the host permission even in equal mode, validates real audio, is idempotent and never stores relay audio',async t=>{
 const {f,uid}=await room(t);await assert.rejects(f.call(1,'save',{uid}),/не разрешил/);await assert.rejects(f.call(1,'sharing',{enabled:true}),/ведущий/);
 await f.call(0,'sharing',{enabled:true});await f.wait(1,s=>s.state.allowDownloads);
 const saved=await f.call(1,'save',{uid});assert.ok(saved.saved.id.startsWith('pc_upload_'));assert.equal(saved.saved.bytes,f.body.length);
 const library=await(await fetch(f.bases[1]+'/api/saved-library')).json();assert.equal(library.tracks.length,4);
 assert.deepEqual(await fs.readFile(path.join(f.root,'guest','downloads',saved.saved.path)),f.body);
 const again=await f.call(1,'save',{uid});assert.equal(again.saved.id,saved.saved.id);assert.equal((await(await fetch(f.bases[1]+'/api/saved-library')).json()).tracks.length,4);
 await f.call(0,'sharing',{enabled:false});await f.wait(1,s=>!s.state.allowDownloads);await assert.rejects(f.call(1,'save',{uid}),/не разрешил/);
 assert.equal(f.relay.transfers.size,0);assert.equal((await fs.readdir(path.join(f.root,'guest','downloads'))).filter(n=>n.endsWith('.tmp')).length,0);
});
test('excluded files cannot be offered and exclusion or deletion withdraws already shared files',async t=>{
 const {f,uid}=await room(t);
 const post=(route,body)=>fetch(f.bases[0]+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await post('/api/excluded-tracks',['host0','host1'])).status,200);await f.wait(1,s=>!s.state.queue.length);
 await assert.rejects(f.call(0,'add',{trackId:'host1'}),/Исключённый/);
 await f.call(0,'add',{trackId:'host2'});await f.wait(1,s=>s.state.queue.length===1);assert.equal((await post('/api/library/remove',{trackId:'host2'})).status,200);await f.wait(1,s=>!s.state.queue.length);
 const missing=await fetch(f.bases[0]+'/api/cached-track/host2');assert.equal(missing.status,410);assert.equal(f.relay.transfers.size,0);
});
test('permission revocation and queue removal cancel in-flight saves and clean partial files',async t=>{
 const {f,uid}=await room(t),route=f.relay.route;
 f.relay.route=(req,res)=>{if(req.method==='POST'&&req.url.startsWith('/stream/')){req.pause();setTimeout(()=>route(req,res),200);}else route(req,res);};
 await f.call(0,'sharing',{enabled:true});await f.wait(1,s=>s.state.allowDownloads);
 const pending=assert.rejects(f.call(1,'save',{uid}));
 for(let i=0;i<100&&!f.relay.transfers.size;i++)await new Promise(r=>setTimeout(r,10));
 assert.ok(f.relay.transfers.size);await f.call(0,'sharing',{enabled:false});await pending;
 assert.equal(f.relay.transfers.size,0);assert.equal((await fs.readdir(path.join(f.root,'guest','downloads'))).length,0);
 await f.call(0,'sharing',{enabled:true});await f.wait(1,s=>s.state.allowDownloads);
 const removing=assert.rejects(f.call(1,'save',{uid}));for(let i=0;i<100&&!f.relay.transfers.size;i++)await new Promise(r=>setTimeout(r,10));
 await f.call(0,'remove',{uid});await removing;assert.equal(f.relay.transfers.size,0);assert.equal((await fs.readdir(path.join(f.root,'guest','downloads'))).length,0);
});
