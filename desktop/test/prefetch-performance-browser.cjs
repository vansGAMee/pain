// Synthetic library and intercepted APIs only; never reads or writes user data.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {wave}=require('./together-fixture.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
 try{
  const page=await browser.newPage(),errors=[],requests=[],body=wave(60),root=path.resolve(__dirname,'../src');
  const tracks=Array.from({length:800},(_,i)=>({id:String(i),title:'Test song '+i,artist:'Test artist '+i%40,album:'Test',duration:60000,bytes:body.length,mime:'audio/wav'}));
  const plays=Array.from({length:20000},(_,i)=>({id:'play'+i,track:String(i%800),started:Date.now()-86400000-i*180000,heard:60000,duration:60000,finished:1}));
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   localStorage.setItem('pain_lang','ru');localStorage.setItem('pain_shuffle_mode','off');localStorage.setItem('pain_track_transition','1');localStorage.setItem('pain_performance_mode','balanced');
   window.longTasks=[];new PerformanceObserver(list=>window.longTasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask',buffered:true});
  });
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());if(url.origin!=='http://localhost')return route.abort();
   if(url.pathname.startsWith('/api/cached-track/')){
    const id=url.pathname.split('/').at(-1);requests.push({id,kind:route.request().resourceType(),at:Date.now()});
    if(id==='1')await sleep(1400);
    const range=/bytes=(\d+)-(\d*)/.exec(route.request().headers().range||''),start=range?Number(range[1]):0,end=range&&range[2]?Math.min(Number(range[2]),body.length-1):body.length-1;
    return route.fulfill({status:range?206:200,contentType:'audio/wav',headers:{'Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${start}-${end}/${body.length}`}:{})},body:body.subarray(start,end+1)}).catch(()=>{});
   }
   if(url.pathname.startsWith('/api/')){
    if(url.pathname.startsWith('/api/transition-audio/'))await sleep(3000);
    if(url.pathname.startsWith('/api/preload-track/')){requests.push({kind:'full-download',at:Date.now()});await sleep(2000);}
    let data={};
    if(url.pathname==='/api/saved-library')data={tracks};
    else if(url.pathname==='/api/saved-stats')data={plays,slices:[]};
    else if(url.pathname==='/api/cached-tracks')data={cached:[]};
    else if(url.pathname.startsWith('/api/transition-audio/'))data=null;
    else if(['/api/playlists','/api/devices'].includes(url.pathname))data=[];
    return route.fulfill({contentType:'application/json',body:JSON.stringify(data)}).catch(()=>{});
   }
   const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));if(!file.startsWith(root+path.sep))return route.abort();
   try{return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html',body:await fs.readFile(process.env.PAIN_BASELINE_APP&&file.endsWith('/app.js')?process.env.PAIN_BASELINE_APP:file)});}
   catch(_){return route.fulfill({status:404,body:''});}
  });
  await page.goto('http://localhost/#library');await page.locator('.nav-item[data-view="library"]').click();
  await page.locator('tr[data-track-id="0"]').click();await page.waitForFunction(()=>!PainPlayer.getAudio().paused&&PainPlayer.getAudio().currentTime>.1);
  await sleep(2400);
  const prepared=await page.evaluate(()=>[...document.querySelectorAll('audio')].some(a=>a!==PainPlayer.getAudio()&&a.src.includes('/1?')&&a.readyState>=3));
  const switchMs=await page.evaluate(()=>new Promise(resolve=>{
   const at=performance.now();for(const a of document.querySelectorAll('audio'))a.addEventListener('playing',()=>{if(a===PainPlayer.getAudio())resolve(performance.now()-at);},{once:true});
   document.querySelector('#bottomNextBtn').click();
  }));
  assert.equal(await page.evaluate(()=>PainPlayer.getTrack().id),'1');
  if(!process.env.PAIN_BASELINE_APP){assert.ok(prepared,'next decoder must be ready while transition analysis is still pending');assert.ok(switchMs<600,`prepared switch took ${switchMs} ms`);assert.ok(!requests.some(r=>r.kind==='full-download'),'do not download the same track before loading its decoder');}
  const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:6});await cdp.send('Profiler.enable');await cdp.send('Profiler.start');
  await page.evaluate(()=>window.longTasks=[]);
  const localSwitchMs=[];
  for(const id of ['20','40','60','80','100','120']){
   localSwitchMs.push(await page.evaluate(id=>new Promise(resolve=>{
    const at=performance.now();for(const a of document.querySelectorAll('audio'))a.addEventListener('playing',()=>{if(a===PainPlayer.getAudio())resolve(performance.now()-at);},{once:true});
    document.querySelector(`tr[data-track-id="${id}"]`).click();
   }),id));await sleep(1200);
  }
  const {profile}=await cdp.send('Profiler.stop');await fs.writeFile(process.env.PAIN_BASELINE_APP?'/tmp/pain-switch-baseline.cpuprofile':'/tmp/pain-switch-optimized.cpuprofile',JSON.stringify(profile));
  const top=profile.nodes.filter(n=>n.hitCount).sort((a,b)=>b.hitCount-a.hitCount).slice(0,12).map(n=>({fn:n.callFrame.functionName,source:n.callFrame.url.split('/').at(-1),line:n.callFrame.lineNumber,hits:n.hitCount}));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({prepared,remoteSwitchMs:switchMs,localSwitchMs,maxLongTask:await page.evaluate(()=>Math.max(0,...window.longTasks)),top,requests:requests.filter(r=>r.id==='1'||r.kind==='full-download'),errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
