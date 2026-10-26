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
 if(process.env.PAIN_TEST_PULSEFLOW==='true'){
  const target=path.join(root,'data','pulseflow');fs.mkdirSync(target);
  for(const name of ['catalog.npz','status.json'])fs.copyFileSync(path.join(source,'pulseflow',name),path.join(target,name));
 }
 let app;
 try{
  const env={...process.env,PAIN_DATA_DIR:root,PAIN_USER_DATA_DIR:path.join(root,'profile'),PAIN_DISCOVERY:'false',PAIN_PULSEFLOW_AUTO_INDEX:'false',PORT:'3198'};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:require('electron'),args:[path.resolve(__dirname,'..')],env});
  const page=await app.firstWindow(),errors=[],crashes=[];page.setDefaultTimeout(20000);
  page.on('console',msg=>{if(['error','warning'].includes(msg.type()))console.log('CONSOLE',msg.text());});page.on('pageerror',error=>errors.push(error.message));page.on('crash',()=>crashes.push('renderer crash'));
  await page.route('**/api/sync-*',route=>{
   if(new URL(route.request().url()).pathname==='/api/sync-phone')return route.fulfill({status:503,body:'{}'});
   const data=route.request().postDataJSON();return route.continue({postData:JSON.stringify({...data,phoneUrl:'http://127.0.0.1:9'})});
  });
  await page.addInitScript(()=>{
   localStorage.setItem('pain_theme','form');
   localStorage.setItem('pain_phone_url','http://127.0.0.1:9');localStorage.setItem('pain_track_transition','3');
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
  for(const view of process.env.PAIN_TEST_VIEWS?.split(',')||['library','player','home']){
   await page.evaluate(v=>{window.longTasks=[];window.heartbeat.max=0;location.hash=v;},view);
   if(process.env.PAIN_TEST_PULSEFLOW==='true')await page.evaluate(v=>{
    const q=window.painQueue;q.pulseflowPolicy=v==='home'?'personal':v==='player'?'contrast':'smooth';q.pulseflowPlan=null;q.cancelPendingSelection();
   },view);
   console.log('VIEW',view);
   if(view==='home'&&process.env.PAIN_TEST_PULSEFLOW==='true'){
    await page.waitForSelector('.home-mix[aria-busy="false"] [data-home-action="mix"]');
    const oldIds=await page.locator('[data-home-action="mix"]').evaluateAll(rows=>rows.map(r=>r.dataset.id));
    await page.click('[data-home-action="refresh"]');
    await page.waitForFunction(ids=>document.querySelector('.home-mix')?.getAttribute('aria-busy')==='false'&&
      [...document.querySelectorAll('[data-home-action="mix"]')].every(r=>!ids.includes(r.dataset.id)),oldIds);
    const selectedIds=await page.locator('[data-home-action="mix"]').evaluateAll(rows=>rows.map(r=>r.dataset.id));
    await page.click('[data-home-action="mix-play"]');
    await page.waitForFunction(id=>window.painQueue.getCurrentTrack()?.id===id,selectedIds[0]);
    await page.waitForTimeout(300);
    assert.deepEqual(await page.locator('[data-home-action="mix"]').evaluateAll(rows=>rows.map(r=>r.dataset.id)),selectedIds,'starting the mix preserves its displayed order');
    assert.equal(await page.evaluate(()=>window.painQueue.tracks.length),library.tracks.length,'Home must continue beyond six preview tracks');
   }
   for(let i=0;i<6;i++){
    let beforeMix;
    if(view==='home'&&process.env.PAIN_TEST_PULSEFLOW==='true'){
     await page.waitForSelector('.home-mix[aria-busy="false"] [data-home-action="mix"]');
     beforeMix=await page.locator('[data-home-action="mix"]').evaluateAll(rows=>rows.map(r=>r.dataset.id).join(','));
    }
    const before=await page.evaluate(()=>window.painQueue.getCurrentTrack()?.id);
    await page.click('#bottomNextBtn',{force:true});
    await page.waitForFunction(id=>window.painQueue.getCurrentTrack()?.id!==id,before);
    if(beforeMix!==undefined)await page.waitForFunction(ids=>document.querySelector('.home-mix')?.getAttribute('aria-busy')==='false'&&
      [...document.querySelectorAll('[data-home-action="mix"]')].map(r=>r.dataset.id).join(',')!==ids,beforeMix);
    await page.waitForTimeout(300);
   }
   if(process.env.PAIN_TEST_PULSEFLOW==='true'){
    const method=await page.evaluate(()=>window.painQueue.getLastTransition()?.explanation?.method);
    const expected=view==='home'?'frequency-pulseflow-ties':'pulseflow-clap-faiss';
    if(method!==expected){
      console.log('PULSEFLOW STATUS',await page.evaluate(()=>fetch('/api/pulseflow/status').then(r=>r.json())));
      console.log('PULSEFLOW LOG',fs.existsSync(path.join(root,'data/pulseflow/serve.log'))?fs.readFileSync(path.join(root,'data/pulseflow/serve.log'),'utf8'):'not started');
    }
    assert.equal(method,expected);
   }
   console.log('VIEW DONE',view);
   measurements.push({view,...await page.evaluate(()=>({maxTask:Math.max(0,...window.longTasks.map(t=>t.duration)),maxHeartbeatDelay:window.heartbeat.max}))});
  }
  // Crash injection must keep both Next and end-of-song callbacks responsive.
  await page.evaluate(()=>{
   const q=window.painQueue;q.cancelPendingSelection();
   q.selectInWorker=async()=>{throw Error('Injected worker failure');};
   q.smartChoose=()=>{throw Error('Heavy scoring escaped into the renderer');};
  });
  const beforeFailure=await page.evaluate(()=>window.painQueue.getCurrentTrack().id);
  await page.click('#bottomNextBtn',{force:true});
  await page.waitForFunction(id=>window.painQueue.getCurrentTrack().id!==id,beforeFailure);
  const fallback=await page.evaluate(()=>window.painQueue.getLastTransition()?.explanation?.method);
  assert.equal(fallback,'frequency-fallback');
  // Start known supported audio, then exercise crossfade/timeupdate near its end.
  await page.evaluate(()=>location.hash='library');
  await page.locator(`tr[data-track-id="${library.tracks.find(t=>t.mime==='audio/mpeg').id}"]`).click({force:true});
  await page.waitForFunction(()=>[...document.querySelectorAll('audio')].some(a=>a.src.includes('/'+encodeURIComponent(window.painQueue.getCurrentTrack().id)+'?')&&!a.paused&&a.currentTime>1));
  const beforeEnd=await page.evaluate(()=>{
   const active=[...document.querySelectorAll('audio')].find(a=>a.src.includes('/'+encodeURIComponent(window.painQueue.getCurrentTrack().id)+'?')&&!a.paused&&a.currentTime>1);
   active.currentTime=active.duration-1;return window.painQueue.getCurrentTrack().id;
  });
  await page.waitForFunction(id=>window.painQueue.getCurrentTrack().id!==id,beforeEnd);
  // Analyze a real file while the native main-loop heartbeat is running.
  const analysis=await page.evaluate(async id=>{
   const response=await fetch('/api/analyze-track/'+encodeURIComponent(id)+'?force=1',{method:'POST'});
   return {status:response.status,...await response.json()};
  },library.tracks.find(t=>t.mime==='audio/mpeg').id);
  assert.equal(analysis.status,200);assert.equal(analysis.profile.analysis.method,'stratified-pcm-v1');
  const profile=await cdp.send('Profiler.stop');fs.writeFileSync('/tmp/pain-native-renderer-profile.json',JSON.stringify(profile.profile));
  const native=await app.evaluate(()=>globalThis.playbackMetrics);
  console.log(JSON.stringify({tracks:library.tracks.length,measurements,native,errors,crashes}));
  assert.deepEqual(errors,[]);assert.deepEqual(crashes,[]);assert.equal(native.unresponsive,0);
  assert.ok(measurements.every(m=>m.maxTask<2000),'renderer blocked for multiple seconds');
 }catch(error){
  if(app)console.log('FAILURE STATE',await (await app.firstWindow()).evaluate(()=>({hash:location.hash,active:document.querySelector('.view.active')?.id,
   mix:document.querySelector('.home-mix')?.outerHTML,current:window.painQueue?.getCurrentTrack()?.id,policy:window.painQueue?.pulseflowPolicy})).catch(()=>null));
  throw error;
 }finally{if(app)await app.close();fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
