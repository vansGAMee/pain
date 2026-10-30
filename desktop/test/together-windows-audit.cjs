// Actual Windows Node runtime under Wine, connected to a Linux app via TLS VPS.
const fs=require('node:fs/promises'),fss=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http'),{spawn}=require('node:child_process'),{fixture}=require('./together-fixture.cjs'),defaults=require('../src/listen/defaults.json');
(async()=>{
 const f=await fixture(),root=path.join(f.root,'windows'),prefix=path.join(f.root,'wine');await fs.mkdir(path.join(root,'data'),{recursive:true});await fs.mkdir(path.join(root,'cache'));const track={id:'windows-song',title:'Проверка Windows',artist:'Windows source',duration:12000,bytes:f.body.length,mime:'audio/wav'};
 await fs.writeFile(path.join(root,'data/library.json'),JSON.stringify({tracks:[track]}));await fs.writeFile(path.join(root,'cache',track.id+'.mp3'),f.body);
 const reserve=http.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));const base='http://127.0.0.1:'+port;
 const env={...process.env,WINEPREFIX:prefix,WINEDEBUG:'-all',WINEDLLOVERRIDES:'winemenubuilder.exe=d;winewayland.drv=d',DISPLAY:'',OPEN_BROWSER:'false',PAIN_DISCOVERY:'false',PAIN_PULSEFLOW_AUTO_INDEX:'false',PAIN_DATA_DIR:'Z:'+root.replaceAll('/','\\'),PORT:String(port)};delete env.WAYLAND_DISPLAY;delete env.PAIN_PULSEFLOW_PYTHON;
 const log=fss.openSync('/tmp/pain-together-windows-output.log','w'),child=spawn('wine',[path.resolve(__dirname,'../dist/Pain.exe')],{env,stdio:['ignore',log,log]});
 const call=async(action,fields={})=>{const r=await fetch(base+'/api/listen/control',{method:'POST',headers:{'Content-Type':'application/json','X-Pain-Update':'listen'},body:JSON.stringify({action,...fields})});const body=await r.json();assert.equal(r.status,200,body.error);return body;};
 const wait=async predicate=>{const until=Date.now()+90000;while(Date.now()<until){try{const s=await(await fetch(base+'/api/listen/status')).json();if(predicate(s))return s;}catch(_){}await new Promise(r=>setTimeout(r,100));}throw Error('Windows server timeout');};
 try{
  await wait(s=>s.settings);const source=await fetch(base+'/together.js');assert.equal(source.status,200);assert.equal(await source.text(),await fs.readFile(path.resolve(__dirname,'../src/together.js'),'utf8'));
  await call('settings',{...defaults,name:'Windows'});await call('create',{mode:'equal'});await wait(s=>s.connected);const {invite}=await call('invite');await f.call(1,'join',{invite});await f.wait(1,s=>s.connected);
  await call('add',{trackId:track.id});const state=await f.wait(1,s=>s.state.queue.length===1),uid=state.state.queue[0].uid;assert.equal(state.state.queue[0].title,track.title);await call('play',{uid});await f.wait(1,s=>s.state.playback.uid===uid);
  const audio=await fetch(f.bases[1]+'/api/listen/audio/'+uid,{headers:{Range:'bytes=200-9999'}});assert.equal(audio.status,206);assert.deepEqual(Buffer.from(await audio.arrayBuffer()),f.body.subarray(200,10000));
  await f.call(1,'transport',{paused:true,position:3});await wait(s=>s.state.playback.paused&&s.state.playback.position===3);await call('leave');
  console.log(JSON.stringify({windowsRuntimeUnderWine:true,linuxPartner:true,remoteTLS:true,packagedUI:true,unicodeMetadata:true,sharedControls:true,streamedBytes:9800}));
 }finally{await new Promise(r=>spawn('wineserver',['-k'],{env,stdio:'ignore'}).once('exit',r));await new Promise(r=>spawn('wineserver',['-w'],{env,stdio:'ignore'}).once('exit',r));if(child.exitCode===null)child.kill();fss.closeSync(log);await f.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
