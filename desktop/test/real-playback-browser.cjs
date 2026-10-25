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
   localStorage.setItem('pain_lang','ru');localStorage.setItem('pain_track_transition','0');
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
   return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html',body:fs.readFileSync(file)});
  });
  await page.goto('http://localhost');
  await page.waitForFunction(n=>window.painQueue?.tracks.length===n,library.tracks.length);
  await page.waitForFunction(()=>Object.keys(window.painQueue.audioProfiles).length>0);
  await page.locator(`tr[data-track-id="${library.tracks[0].id}"]`).click();
  await page.waitForFunction(()=>!document.querySelector('#audioEngine').paused);
  await page.evaluate(()=>{window.painQueue.setShuffleMode('smart');window.longTasks=[];});
  // Slower CPU exposes stalls on modest devices without changing the data.
  const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  const changes=[];
  for(let i=0;i<12;i++){
   const before=await page.evaluate(()=>window.painQueue.getCurrentTrack()?.id);
   await page.click('#bottomNextBtn');
   await page.waitForFunction(id=>window.painQueue.getCurrentTrack()?.id!==id,before);
   changes.push(await page.evaluate(()=>window.painQueue.getCurrentTrack()?.id));
  }
  const maxLongTask=await page.evaluate(()=>Math.max(0,...window.longTasks));
  assert.equal(new Set(changes).size,changes.length);assert.deepEqual(errors,[]);
  assert.ok(maxLongTask<2000,`UI blocked for ${maxLongTask} ms`);
  console.log(JSON.stringify({tracks:library.tracks.length,rapidSmartDjChanges:changes.length,cpuSlowdown:4,maxLongTaskMilliseconds:maxLongTask,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
