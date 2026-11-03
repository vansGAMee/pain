const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const create=require('../src/discord-presence');
test('local playback snapshot is accurate without enabling or connecting Discord',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pain-companion-'));let now=100000,connections=0;
 const rpc=create(dir,{now:()=>now,connect:()=>{connections++;throw Error('must not connect');},sockets:()=>[]});
 t.after(()=>{rpc.close();fs.rmSync(dir,{recursive:true,force:true});});
 rpc.update({track:{id:'a',title:'Ночь',artist:'Artist',album:'Album',bpm:94},playing:true,position:10,duration:180,observedAt:now});
 now+=5000;
 assert.deepEqual(rpc.playback(),{source:'pain',player:'pain',playing:true,track_id:'a',title:'Ночь',artist:'Artist',album:'Album',position:15,duration:180,volume:null,bpm:94,observed_at:105,heartbeat_age:5});
 assert.equal(rpc.status().enabled,false);assert.equal(connections,0);
 rpc.update({track:{id:'a',title:'Ночь',artist:'Artist'},playing:false,position:18,duration:180,observedAt:now});
 now+=1000;assert.equal(rpc.playback().position,18);assert.equal(rpc.playback().playing,false);
});
test('stale browser playback cannot remain playing indefinitely; heartbeat preserves clock anchor',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pain-companion-'));let now=100000;
 const rpc=create(dir,{now:()=>now,sockets:()=>[]});t.after(()=>{rpc.close();fs.rmSync(dir,{recursive:true,force:true});});
 const track={id:'a',title:'Track'};rpc.update({track,playing:true,position:10,duration:180,observedAt:now});
 now+=8000;rpc.update({track,playing:true,position:18.4,duration:180,observedAt:now+400,heartbeat:true});
 now+=2000;assert.equal(rpc.playback().position,20);assert.equal(rpc.playback().playing,true);
 now+=21000;assert.equal(rpc.playback().playing,false);
 rpc.update({track:null,playing:false});assert.equal(rpc.playback().track_id,'');assert.equal(rpc.playback().title,'');
});
test('localhost endpoint exports real playback facts and refuses writes',async t=>{
 const http=require('node:http'),{spawn}=require('node:child_process');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pain-companion-api-'));
 const reserve=http.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const child=spawn(process.execPath,[path.join(__dirname,'../src/server.js')],{env:{...process.env,PAIN_DATA_DIR:dir,PORT:String(port),PAIN_DISCOVERY:'false',OPEN_BROWSER:'false',PAIN_PULSEFLOW_AUTO_INDEX:'false'},stdio:['ignore','pipe','pipe']});
 t.after(async()=>{child.kill();await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(()=>{child.kill('SIGKILL');resolve();},3000).unref();});fs.rmSync(dir,{recursive:true,force:true});});
 await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('startup timeout')),8000);child.stdout.on('data',data=>{output+=data;if(output.includes('Web UI:')){clearTimeout(timer);resolve();}});child.once('error',reject);});
 const base=`http://127.0.0.1:${port}`;
 let result=await fetch(base+'/api/companion-playback');assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'no-store');assert.equal((await result.json()).source,'pain');
 result=await fetch(base+'/api/companion-playback',{method:'POST'});assert.equal(result.status,405);
 await fetch(base+'/api/save-library',{method:'POST',body:JSON.stringify({tracks:[{id:'actual',title:'Ночная песня',artist:'Artist',album:'Album',duration:180000,bpm:96}]})});
 await fetch(base+'/api/discord-presence',{method:'POST',body:JSON.stringify({trackId:'actual',playing:true,position:42,rate:1})});
 const live=await (await fetch(base+'/api/companion-playback')).json();assert.equal(live.playing,true);assert.equal(live.title,'Ночная песня');assert.equal(live.artist,'Artist');assert.equal(live.duration,180);assert.equal(live.bpm,96);assert.ok(live.position>=42&&live.position<44);
 const status=await (await fetch(base+'/api/discord-presence')).json();assert.equal(status.enabled,false,'local observation does not enable Discord');
});
