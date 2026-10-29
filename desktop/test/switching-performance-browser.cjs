// Read-only user snapshot; every API write is intercepted, media is read locally.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const data=process.env.PAIN_EVAL_DATA_DIR||path.resolve(__dirname,'../data');
const read=name=>JSON.parse(fs.readFileSync(path.join(data,name),'utf8'));
const library=read('library.json'),stats=read('stats.json'),dj=read('dj-state.json');
const excluded=read('excluded-tracks.json'),root=path.resolve(__dirname,'../src');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   localStorage.setItem('pain_lang','ru');localStorage.setItem('pain_theme','form-night');localStorage.setItem('pain_track_transition','1');
   window.longTasks=[];new PerformanceObserver(list=>window.longTasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask',buffered:true});
  });
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());if(url.origin!=='http://localhost')return route.abort();
   if(url.pathname.startsWith('/api/cached-track/')){
    const id=decodeURIComponent(url.pathname.split('/').at(-1)),safe=id.replace(/[/\\?%*:|"<>]/g,'_');
    const file=path.resolve(__dirname,'../cache',safe+'.mp3');
    if(!fs.existsSync(file))return route.fulfill({status:404,body:''});
    const bytes=fs.readFileSync(file),range=/bytes=(\d+)-(\d*)/.exec(route.request().headers().range||'');
    if(range){const start=Number(range[1]),end=Math.min(bytes.length-1,range[2]?Number(range[2]):bytes.length-1);
     return route.fulfill({status:206,contentType:'audio/mpeg',headers:{'Content-Range':`bytes ${start}-${end}/${bytes.length}`,'Accept-Ranges':'bytes'},body:bytes.subarray(start,end+1)});}
    return route.fulfill({contentType:'audio/mpeg',body:bytes});
   }
   if(url.pathname.startsWith('/api/')){
    let result={};
    if(url.pathname==='/api/saved-library')result=library;
    else if(url.pathname==='/api/saved-stats')result=stats;
    else if(url.pathname==='/api/dj-state')result=dj;
    else if(url.pathname==='/api/excluded-tracks')result=excluded;
    else if(url.pathname==='/api/cached-tracks')result={cached:[]};
    else if(['/api/playlists','/api/devices'].includes(url.pathname))result=[];
    return route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
   }
   const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
   if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
   return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html',body:fs.readFileSync(process.env.PAIN_BASELINE_APP && file.endsWith('/app.js') ? process.env.PAIN_BASELINE_APP : file)});
  });
  await page.goto('http://localhost');
  await page.waitForFunction(n=>window.painQueue?.tracks.length===n,library.tracks.length);
  await page.click('.nav-item[data-view="library"]');
  await page.waitForFunction(n=>document.querySelector('#tracksTableBody').children.length===n,library.tracks.length);
  const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:6});
  const cached=library.tracks.filter(t=>t.mime==='audio/mpeg'&&fs.existsSync(path.resolve(__dirname,'../cache',String(t.id).replace(/[/\\?%*:|"<>]/g,'_')+'.mp3'))).slice(0,8);
  assert.ok(cached.length>=6,'needs six actual cached tracks');
  await page.locator(`tr[data-track-id="${cached.at(-1).id}"]`).click();await page.waitForFunction(()=>!PainPlayer.getAudio().paused&&PainPlayer.getAudio().currentTime>.15);
  await cdp.send('Profiler.enable');await cdp.send('Profiler.start');
  await page.evaluate(()=>{window.longTasks=[];window.switchTimes=[];window.falsePausePaints=0;new MutationObserver(()=>{if(document.documentElement.dataset.playing==='false'&&[...document.querySelectorAll('audio')].some(a=>!a.paused&&!a.ended&&a.currentTime>0))window.falsePausePaints++;}).observe(document.documentElement,{attributes:true,attributeFilter:['data-playing']});document.addEventListener('click',e=>{const tr=e.target.closest('tr[data-track-id]');if(tr)window.switchStarted=performance.now();},true);for(const a of document.querySelectorAll('audio'))a.addEventListener('playing',()=>{if(a===PainPlayer.getAudio()&&window.switchStarted){window.switchTimes.push(performance.now()-window.switchStarted);window.switchStarted=0;}});});
  for(const track of cached){await page.locator(`tr[data-track-id="${track.id}"]`).evaluate(el=>el.click());await page.waitForFunction(id=>PainPlayer.getTrack()?.id===id&&!PainPlayer.getAudio().paused&&PainPlayer.getAudio().currentTime>.15,track.id);}
  const {profile}=await cdp.send('Profiler.stop');fs.writeFileSync('/tmp/pain-187-switching.cpuprofile',JSON.stringify(profile));
  const top=profile.nodes.filter(n=>n.hitCount).sort((a,b)=>b.hitCount-a.hitCount).slice(0,12).map(n=>({fn:n.callFrame.functionName,source:n.callFrame.url.split('/').at(-1),line:n.callFrame.lineNumber,hits:n.hitCount}));
  const result=await page.evaluate(()=>({maxLongTask:Math.max(0,...window.longTasks),switchTimes:window.switchTimes,falsePausePaints:window.falsePausePaints}));
  if(!process.env.PAIN_BASELINE_APP)assert.equal(result.falsePausePaints,0,'the UI must not repaint paused while the outgoing song is audible');
  if(!process.env.PAIN_BASELINE_APP){
   await page.click('#bottomPlayBtn');await page.waitForTimeout(5500);
   const persisted=await page.evaluate(()=>({saved:JSON.parse(localStorage.getItem('pain_audio_profiles_v4')),current:JSON.parse(JSON.stringify(painQueue.audioProfiles))}));
   assert.deepEqual(persisted.saved,persisted.current,'deferred persistence must preserve every acoustic profile');
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({tracks:library.tracks.length,cpuSlowdown:6,...result,top,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
