// Real Electron, real audio and isolated saved data. No phone or user-data writes.
const {_electron}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const root=fs.mkdtempSync(path.resolve(__dirname,'../.native-playback-'));
 const source=process.env.PAIN_EVAL_DATA_DIR||path.resolve(__dirname,'../data');
 const library=JSON.parse(fs.readFileSync(path.join(source,'library.json')));
 fs.mkdirSync(path.join(root,'data'));fs.mkdirSync(path.join(root,'cache'));
 for(const name of fs.readdirSync(source))if(name.endsWith('.json'))fs.copyFileSync(path.join(source,name),path.join(root,'data',name));
 if(process.env.PAIN_EVAL_PROFILE_DIR)fs.cpSync(process.env.PAIN_EVAL_PROFILE_DIR,path.join(root,'profile'),{recursive:true});
 for(const name of fs.readdirSync(path.resolve(__dirname,'../cache')))if(name.endsWith('.mp3'))fs.linkSync(path.resolve(__dirname,'../cache',name),path.join(root,'cache',name));
 let app;
 try{
  const env={...process.env,PAIN_DATA_DIR:root,PAIN_USER_DATA_DIR:path.join(root,'profile'),PAIN_DISCOVERY:'false',PORT:'3198'};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:require('electron'),args:[path.resolve(__dirname,'..')],env});
  const page=await app.firstWindow(),errors=[],crashes=[];page.setDefaultTimeout(20000);
  page.on('console',msg=>{if(['error','warning'].includes(msg.type()))console.log('CONSOLE',msg.text());});page.on('pageerror',error=>errors.push(error.message));page.on('crash',()=>crashes.push('renderer crash'));
  await page.route('**/api/sync-*',route=>{
   if(new URL(route.request().url()).pathname==='/api/sync-phone')return route.fulfill({status:503,body:'{}'});
   const data=route.request().postDataJSON();return route.continue({postData:JSON.stringify({...data,phoneUrl:'http://127.0.0.1:9'})});
  });
  await page.addInitScript(()=>{
   localStorage.setItem('pain_phone_url','http://127.0.0.1:9');localStorage.setItem('pain_track_transition','0');
   window.longTasks=[];new PerformanceObserver(list=>window.longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});
   window.heartbeat={max:0};let last=performance.now();setInterval(()=>{const now=performance.now();window.heartbeat.max=Math.max(window.heartbeat.max,now-last-25);last=now;},25);
  });
  await app.evaluate(({BrowserWindow})=>{
   globalThis.playbackMetrics={mainDelay:0,unresponsive:0};let last=performance.now();
   setInterval(()=>{const now=performance.now();globalThis.playbackMetrics.mainDelay=Math.max(globalThis.playbackMetrics.mainDelay,now-last-25);last=now;},25).unref();
   BrowserWindow.getAllWindows()[0].on('unresponsive',()=>globalThis.playbackMetrics.unresponsive++);
  });
  await page.reload();await page.waitForFunction(n=>window.painQueue?.tracks.length===n,library.tracks.length);
  await page.evaluate(()=>location.hash='library');
  const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:Number(process.env.PAIN_CPU_SLOWDOWN)||4});
  await page.locator(`tr[data-track-id="${library.tracks.find(t=>t.mime==='audio/mpeg').id}"]`).click();
  try{await page.waitForFunction(()=>[...document.querySelectorAll('audio')].some(a=>!a.paused&&a.currentTime>1));}catch(e){console.log('PLAYBACK',await page.evaluate(()=>({audio:[...document.querySelectorAll('audio')].map(a=>({src:a.src,paused:a.paused,time:a.currentTime,ready:a.readyState,error:a.error?.message})),errors:window.longTasks,native:window.painQueue.getCurrentTrack()?.id})));throw e;}
  await page.evaluate(()=>window.painQueue.setShuffleMode('smart'));
  await cdp.send('Profiler.enable');await cdp.send('Profiler.start');
  const measurements=[];
  for(const view of ['library','player','home']){
   await page.evaluate(v=>{window.longTasks=[];window.heartbeat.max=0;location.hash=v;},view);
   console.log('VIEW',view);
   for(let i=0;i<6;i++){
    const before=await page.evaluate(()=>window.painQueue.getCurrentTrack()?.id);
    await page.click('#bottomNextBtn',{force:true});
    await page.waitForFunction(id=>window.painQueue.getCurrentTrack()?.id!==id,before);
    await page.waitForTimeout(300);
   }
   console.log('VIEW DONE',view);
   measurements.push({view,...await page.evaluate(()=>({maxTask:Math.max(0,...window.longTasks.map(t=>t.duration)),maxHeartbeatDelay:window.heartbeat.max}))});
  }
  const profile=await cdp.send('Profiler.stop');fs.writeFileSync('/tmp/pain-native-renderer-profile.json',JSON.stringify(profile.profile));
  const native=await app.evaluate(()=>globalThis.playbackMetrics);
  console.log(JSON.stringify({tracks:library.tracks.length,measurements,native,errors,crashes}));
  assert.deepEqual(errors,[]);assert.deepEqual(crashes,[]);assert.equal(native.unresponsive,0);
  assert.ok(measurements.every(m=>m.maxTask<2000),'renderer blocked for multiple seconds');
 }finally{if(app)await app.close();fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
