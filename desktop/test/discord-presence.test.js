const test=require('node:test'),assert=require('node:assert/strict'),net=require('node:net'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const create=require('../src/discord-presence');
const wait=async predicate=>{const until=Date.now()+3000;while(!predicate()){if(Date.now()>until)throw Error('RPC timeout');await new Promise(r=>setTimeout(r,10));}};
test('Discord activity is Listening with accurate speed/seek clocks; pauses have no moving clock',()=>{
 const track={title:'Песня',artist:'Artist',album:'Album',favorite:1};const a=create.activity({track,playing:true,position:30,duration:180,rate:1.5,smart:true},100000);
 assert.equal(a.type,2);assert.equal(a.details,'Песня');assert.ok(a.state.includes('♥'));assert.ok(a.state.includes('Smart DJ'));assert.deepEqual(a.timestamps,{start:80,end:200});assert.ok(a.buttons.every(b=>b.url.startsWith('https://')));
 assert.equal(a.instance,true);assert.equal(a.status_display_type,2,'the member list displays the actual song details');
 assert.equal(create.activity({track,playing:false},100000).timestamps,undefined);assert.equal(create.activity({track:null}),null);
 assert.deepEqual(create.activity({track,playing:true,position:30,duration:180,observedAt:95000},100000).timestamps,{start:65,end:245});
 assert.ok(create.paths('win32',{}).every(p=>p.startsWith('\\\\?\\pipe\\discord-ipc-')));assert.ok(create.paths('linux',{XDG_RUNTIME_DIR:'/run/user/123'}).includes('/run/user/123/app/com.discordapp.Discord/discord-ipc-9'));
});
test('Vesktop arRPC uses its default activity type and instance flag while retaining music, updates and clear-on-disable',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pain-arrpc-')),pipe=path.join(dir,'ipc'),frames=[],clients=new Set();
 const server=net.createServer(socket=>{clients.add(socket);socket.on('close',()=>clients.delete(socket));let buffer=Buffer.alloc(0);socket.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);while(buffer.length>=8){const op=buffer.readUInt32LE(),size=buffer.readUInt32LE(4);if(buffer.length<size+8)return;const message=JSON.parse(buffer.subarray(8,size+8));buffer=buffer.subarray(size+8);if(op===0)socket.write(create.frame(1,{evt:'READY',data:{user:{id:'1045800378228281345',username:'arrpc'}}}));if(op===1){frames.push(message);socket.write(create.frame(1,{nonce:message.nonce,data:message.args.activity?{...message.args.activity,name:'',type:0}:null}));}}});});
 await new Promise(r=>server.listen(pipe,r));const rpc=create(dir,{sockets:()=>[pipe]});t.after(async()=>{rpc.close();for(const socket of clients)socket.destroy();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 rpc.setEnabled(true);rpc.update({track:{id:'first',title:'First song',artist:'Artist'},playing:true,duration:180,position:10});await wait(()=>rpc.status().published);
 const sent=frames[0].args.activity;assert.equal(sent.type,0);assert.equal(sent.instance,true);assert.equal(sent.status_display_type,2);assert.equal(sent.details,'First song');assert.equal(sent.state,'Artist');assert.ok(sent.timestamps.end>sent.timestamps.start);
 assert.equal(rpc.status().transport,'arrpc');assert.equal(rpc.status().visibility,'unknown','a local bridge acknowledgement is not proof of remote publication');
 rpc.update({track:{id:'second',title:'Second song',artist:'Other artist'},playing:true,duration:120,position:0});await wait(()=>rpc.status().publishedTrack==='Second song');assert.equal(frames.at(-1).args.activity.type,0);
 rpc.setEnabled(false);await wait(()=>frames.at(-1).args.activity===null);
});
test('native IPC handles split frames, heartbeat, activity acknowledgements and clear-on-disable',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pain-rpc-')),pipe=path.join(dir,'ipc'),frames=[],clients=new Set();let clock=100000;
 const server=net.createServer(socket=>{clients.add(socket);let buffer=Buffer.alloc(0);socket.on('close',()=>clients.delete(socket));socket.on('data',b=>{buffer=Buffer.concat([buffer,b]);while(buffer.length>=8){const op=buffer.readUInt32LE(),size=buffer.readUInt32LE(4);if(buffer.length<8+size)return;const data=JSON.parse(buffer.subarray(8,8+size));buffer=buffer.subarray(8+size);frames.push({op,data});if(op===0){const ready=create.frame(1,{evt:'READY'});socket.write(ready.subarray(0,5));socket.write(ready.subarray(5));socket.write(create.frame(3,{ping:true}));}else if(op===1)socket.write(create.frame(1,{nonce:data.nonce,data:{name:'PAIN'}}));}});});
 await new Promise(r=>server.listen(pipe,r));const rpc=create(dir,{sockets:()=>[path.join(dir,'absent'),pipe],now:()=>clock});t.after(async()=>{rpc.close();for(const s of clients)s.destroy();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 assert.equal(rpc.status().enabled,false);rpc.setEnabled(true);rpc.update({track:{id:'actual',title:'Actual song',artist:'Artist'},playing:true,duration:180,position:10});await wait(()=>rpc.status().appName==='PAIN');
 assert.equal(frames[0].data.client_id,'1565047962818838568');assert.ok(frames.some(f=>f.op===4));assert.ok(frames.some(f=>f.data.cmd==='SET_ACTIVITY'&&f.data.args.activity.type===2));
 assert.equal(rpc.status().publishedTrack,'Actual song');
 for(let i=0;i<8;i++){clock+=100;rpc.update({track:{id:'actual',title:'Actual song',artist:'Artist'},playing:true,duration:180,position:10+(clock-100000)/1000,observedAt:clock+(i%2?400:-400),heartbeat:true});await new Promise(r=>setTimeout(r,5));}
 await new Promise(r=>setTimeout(r,300));assert.equal(frames.filter(f=>f.data.cmd==='SET_ACTIVITY').length,1,'heartbeat timestamp jitter must not spend the Discord update quota');
 clock+=2000;rpc.update({track:{title:'Actual song',artist:'Artist'},playing:false,duration:180,position:12});await wait(()=>frames.filter(f=>f.data.cmd==='SET_ACTIVITY').length>=2);assert.equal(frames.filter(f=>f.data.cmd==='SET_ACTIVITY').at(-1).data.args.activity.timestamps,undefined);
 for(let i=0;i<3;i++){clock++;rpc.update({track:{title:'Song '+i,artist:'Artist'},playing:true,duration:180,position:0});await wait(()=>frames.filter(f=>f.data.cmd==='SET_ACTIVITY').length===3+i);}
 clock++;rpc.update({track:{title:'Queued song',artist:'Artist'},playing:true,duration:180,position:0});await new Promise(r=>setTimeout(r,20));assert.equal(frames.filter(f=>f.data.cmd==='SET_ACTIVITY').length,5,'respect the published five-updates-per-20-seconds limit');assert.equal(rpc.status().pending,true);assert.ok(rpc.status().retryAfterMs>0);
 clock+=20001;rpc.update({track:{title:'Latest song',artist:'Artist'},playing:true,duration:180,position:0});await wait(()=>frames.filter(f=>f.data.cmd==='SET_ACTIVITY').at(-1).data.args.activity.details==='Latest song');
 rpc.setEnabled(false);await wait(()=>frames.filter(f=>f.data.cmd==='SET_ACTIVITY').at(-1).data.args.activity===null);assert.equal(rpc.status().connected,false);assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'discord-presence.json'))).enabled,false);
});
