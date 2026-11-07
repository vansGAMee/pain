// Synthetic collection only: opening, scrolling and refreshing a large library.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--autoplay-policy=no-user-gesture-required']});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];
  const root=path.resolve(__dirname,'../src'),tracks=Array.from({length:2000},(_,i)=>({id:String(i),title:'Песня '+i,artist:'Исполнитель '+i%70,album:'Альбом '+i%100,duration:180000,favorite:i%3===0,added:1700000000000+i*1000}));
  tracks.at(-1).title='Янтарный архипелаг';
  const wav=require('./together-fixture.cjs').wave(60);let savedOrder;
  page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
  await page.addInitScript(()=>{
   localStorage.setItem('pain_theme','form-night');localStorage.setItem('pain_lang','ru');
   localStorage.setItem('pain_performance_mode','balanced');localStorage.setItem('pain_save_history','false');
   localStorage.setItem('pain_track_transition','0');localStorage.setItem('pain_online_covers','false');
   window.longTasks=[];new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask',buffered:true});
  });
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());if(url.origin!=='http://pain.test')return route.abort();
   if(url.pathname.startsWith('/api/cached-track/')){
    const range=require('../src/range')(route.request().headers().range,wav.length);
    return route.fulfill({status:range?206:200,contentType:'audio/wav',headers:{'Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${range.start}-${range.end}/${wav.length}`}:{})},body:range?wav.subarray(range.start,range.end+1):wav});
   }
   if(url.pathname.startsWith('/api/cover/'))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><path fill="#8979ab" d="M0 0h200v200H0z"/></svg>'});
   if(url.pathname.startsWith('/api/')){
    const p=url.pathname;
    if(p==='/api/save-library')savedOrder=route.request().postDataJSON().tracks.map(t=>t.id);
    if(p==='/api/library/events')return route.fulfill({contentType:'text/event-stream',body:'retry: 600000\ndata: 1\n\n'});
    return route.fulfill({json:p==='/api/saved-library'?{tracks}:p==='/api/saved-stats'?{plays:[],slices:[]}:p==='/api/cached-tracks'?{cached:[]}:[]});
   }
   const file=path.resolve(url.pathname.startsWith('/assets/')?path.dirname(root):root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
   const baseline=process.env.PAIN_PERF_BASELINE&&['app.js','form-night-theme.css','styles.css','list-view.js'].includes(path.basename(file))?path.join(process.env.PAIN_PERF_BASELINE,path.basename(file)):null;
   const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.png':'image/png','.svg':'image/svg+xml','.json':'application/json'};
   try{return route.fulfill({contentType:mime[path.extname(file)]||'application/octet-stream',body:await fs.readFile(baseline||file)});}catch(_){return route.fulfill({status:404,body:''});}
  });
  const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  await cdp.send('Performance.enable');
  const start=Date.now();await page.goto('http://pain.test/?mode=list#library',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.painQueue?.tracks.length===2000);
  await page.locator('.nav-item[data-view="library"]').click();
  await page.waitForFunction(()=>document.querySelector('#tracksTableBody tr[data-track-id]'));
  const firstRowsMs=Date.now()-start;
  await page.waitForFunction(({n,baseline})=>{const body=document.querySelector('#tracksTableBody');return body._currentTrackList?.length===n && body._renderFrame==null && (!baseline || body.querySelectorAll('tr[data-track-id]').length===n);},{n:tracks.length,baseline:!!process.env.PAIN_PERF_BASELINE},{timeout:60000});
  const readyMs=Date.now()-start;
  const mountedRows=await page.locator('#tracksTableBody tr[data-track-id]').count();
  if(!process.env.PAIN_PERF_BASELINE)assert.ok(mountedRows<100,`mounted ${mountedRows} rows for one viewport`);
  await page.locator('.views-viewport').evaluate(e=>e.scrollTop=e.scrollHeight*.7);
  await page.waitForTimeout(200);
  const before=await page.locator('.views-viewport').evaluate(e=>e.scrollTop);
  const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
  const initial=await metrics();
  const refreshStart=Date.now();await page.evaluate(()=>PainPlayer.reloadLibrary());
  await page.waitForFunction(()=>document.querySelector('#tracksTableBody')._renderFrame==null);
  const refreshMs=Date.now()-refreshStart,after=await page.locator('.views-viewport').evaluate(e=>e.scrollTop);
  assert.ok(Math.abs(after-before)<2,'refresh preserves scroll');
  if(process.env.PAIN_PERF_PROFILE){await cdp.send('Profiler.enable');await cdp.send('Profiler.start');}
  await page.evaluate(()=>{longTasks=[];window.frames=[];let last=performance.now();function tick(now){frames.push(now-last);last=now;if(frames.length<60){document.querySelector('.views-viewport').scrollTop-=60;requestAnimationFrame(tick);}}requestAnimationFrame(tick);});
  await page.waitForFunction(()=>frames.length>=60,{},{timeout:60000});
  const final=await metrics(),result=await page.evaluate(()=>({maxScrollTask:Math.max(0,...longTasks),slowFrames:frames.filter(ms=>ms>50).length}));
  if(process.env.PAIN_PERF_PROFILE){const {profile}=await cdp.send('Profiler.stop');await fs.writeFile(process.env.PAIN_PERF_PROFILE,JSON.stringify(profile));console.log(profile.nodes.filter(n=>n.hitCount).sort((a,b)=>b.hitCount-a.hitCount).slice(0,10).map(n=>({fn:n.callFrame.functionName,file:n.callFrame.url.split('/').at(-1),line:n.callFrame.lineNumber,hits:n.hitCount})));}
  assert.deepEqual(errors,[]);
  const layoutMs=1000*(final.LayoutDuration-initial.LayoutDuration);
  if(!process.env.PAIN_PERF_BASELINE)assert.ok(layoutMs<1000,`scrolling spent ${layoutMs} ms rebuilding layout`);
  console.log(JSON.stringify({tracks:tracks.length,mountedRows,cpuSlowdown:4,firstRowsMs,readyMs,refreshMs,...result,layoutMs,styleMs:1000*(final.RecalcStyleDuration-initial.RecalcStyleDuration),errors}));
  if(!process.env.PAIN_PERF_BASELINE){
   assert.ok(result.slowFrames<=3,`scroll dropped ${result.slowFrames}/60 frames longer than 50ms`);
   const viewport=page.locator('.views-viewport');
   const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   // Jumping through a large list must render the actual songs, not empty spacers.
   async function jump(fraction,selector='#tracksTableBody > tr[data-track-id]'){
    await viewport.evaluate((e,f)=>e.scrollTop=(e.scrollHeight-e.clientHeight)*f,fraction);await settle();
    const status=await page.evaluate(selector=>{
     const v=document.querySelector('.views-viewport').getBoundingClientRect(),nodes=[...document.querySelectorAll(selector)];
     const shown=nodes.filter(n=>{const r=n.getBoundingClientRect();return r.bottom>v.top&&r.top<v.bottom;});
     return {count:nodes.length,visible:shown.length,first:shown[0]?.dataset.trackId,last:shown.at(-1)?.dataset.trackId,
      top:shown[0]?.getBoundingClientRect().top-v.top,bottom:shown.at(-1)?.getBoundingClientRect().bottom-v.bottom};
    },selector);
    assert.ok(status.count<100&&status.visible>0,JSON.stringify(status));
    if(fraction>0&&fraction<1)assert.ok(status.top<=1&&status.bottom>=-1,'the window covers the viewport');
    return status;
   }
   for(const fraction of[.1,.95,.4])await jump(fraction);
   assert.equal((await jump(1)).last,'1999','the end of the collection is reachable');
   await page.locator('#tracksTableBody tr[data-track-id="1998"] .col-title').click();
   await page.waitForFunction(()=>PainPlayer.getTrack()?.id==='1998'&&!PainPlayer.getAudio().paused&&PainPlayer.getAudio().currentTime>0);
   assert.equal(await page.evaluate(()=>painQueue.getTracks().length),2000,'playback uses the entire collection');
   await page.click('#bottomNextBtn');await page.waitForFunction(()=>PainPlayer.getTrack()?.id==='1999'&&!PainPlayer.getAudio().paused);
   await jump(0);assert.equal(await page.locator('#tracksTableBody tr[data-track-id="1999"]').count(),0);
   await jump(1);assert.ok(await page.locator('#tracksTableBody tr[data-track-id="1999"]').evaluate(n=>n.classList.contains('playing-row')),'returning to the playing song restores its indicator');
   // A focused button remains connected across distant scrolling. Tab visits
   // the next actual song, even if that song has not been mounted yet.
   await jump(0);
   const focusedId=await page.locator('#tracksTableBody > tr[data-track-id]').last().getAttribute('data-track-id');
   await page.locator(`#tracksTableBody tr[data-track-id="${focusedId}"] button`).last().focus();
   await jump(.8);
   assert.equal(await page.evaluate(()=>document.activeElement.closest('tr')?.dataset.trackId),focusedId);
   await page.keyboard.press('Tab');await settle();
   assert.equal(await page.evaluate(()=>document.activeElement.closest('tr')?.dataset.trackId),String(Number(focusedId)+1));
   await page.keyboard.press('Shift+Tab');await settle();
   assert.equal(await page.evaluate(()=>document.activeElement.closest('tr')?.dataset.trackId),focusedId);
   await page.locator('#searchInput').fill('Янтарный архипелаг');
   await page.waitForFunction(()=>document.querySelector('#tracksTableBody')._currentTrackList?.length===1);
   assert.equal(await page.locator('#tracksTableBody > tr[data-track-id]').getAttribute('data-track-id'),'1999');
   await page.fill('#searchInput','');await page.waitForFunction(()=>document.querySelector('#tracksTableBody')._currentTrackList?.length===2000);
   await page.selectOption('#sortSelect','added-desc');await jump(0);
   assert.equal(await page.locator('#tracksTableBody > tr[data-track-id]').first().getAttribute('data-track-id'),'1999');
   await page.selectOption('#sortSelect','default');await jump(0);
   // Drag events use the app's delegated handlers; only the synthetic HTTP
   // fixture receives the reordered collection. Pin the source while scrolling.
   const transfer=await page.evaluateHandle(()=>new DataTransfer());
   await page.locator('#tracksTableBody tr[data-track-id="0"]').dispatchEvent('dragstart',{dataTransfer:transfer});
   const target=(await jump(.5)).first;
   assert.equal(await page.locator('#tracksTableBody tr[data-track-id="0"]').count(),1,'drag source survives scroll');
   const drop=page.locator(`#tracksTableBody tr[data-track-id="${target}"]`),box=await drop.boundingBox();
   const persisted=page.waitForResponse(r=>r.url().endsWith('/api/save-library'));
   await drop.dispatchEvent('drop',{dataTransfer:transfer,clientY:box.y+1});
   await page.locator('#tracksTableBody tr[data-track-id="0"]').dispatchEvent('dragend',{dataTransfer:transfer});
   await persisted;
   assert.ok(savedOrder?.length===2000&&savedOrder.indexOf('0')===savedOrder.indexOf(target)-1,'dragging reorders the full collection');
   await transfer.dispose();
   await page.click('#viewModeGridBtn');
   for(const fraction of[0,.5,1])await jump(fraction,'#tracksGrid > .track-card');
   // Resizing changes the number of columns. Keep the same song on screen.
   const gridBefore=await jump(.5,'#tracksGrid > .track-card');
   await page.setViewportSize({width:1100,height:800});await settle();
   const gridOffset=await page.locator(`#tracksGrid > .track-card[data-track-id="${gridBefore.first}"]`).evaluate(n=>n.getBoundingClientRect().top-document.querySelector('.views-viewport').getBoundingClientRect().top);
   assert.ok(Math.abs(gridOffset-gridBefore.top)<2,'grid resize preserves the visible song');
   const appearanceBefore=await jump(.9,'#tracksGrid > .track-card');
   await page.click('#settingsToggleBtn');await page.selectOption('#appFontSelect','system');
   await page.check('input[name="appearanceTheme"][value="paper"]');
   await page.click('#settingsDoneBtn');await settle();
   const appearanceOffset=await page.locator(`#tracksGrid > .track-card[data-track-id="${appearanceBefore.first}"]`).evaluate(n=>n.getBoundingClientRect().top-document.querySelector('.views-viewport').getBoundingClientRect().top);
   assert.ok(Math.abs(appearanceOffset-appearanceBefore.top)<2,'theme/font changes preserve the visible song');
   await page.evaluate(()=>{longTasks=[];window.frames=[];let last=performance.now();function tick(now){frames.push(now-last);last=now;if(frames.length<60){document.querySelector('.views-viewport').scrollTop-=60;requestAnimationFrame(tick);}}requestAnimationFrame(tick);});
   await page.waitForFunction(()=>frames.length>=60);
   const gridPerformance=await page.evaluate(()=>({maxScrollTask:Math.max(0,...longTasks),slowFrames:frames.filter(ms=>ms>50).length,mountedCards:document.querySelectorAll('#tracksGrid > .track-card').length}));
   assert.ok(gridPerformance.slowFrames<=3,JSON.stringify(gridPerformance));
   console.log('Grid: '+JSON.stringify(gridPerformance));
   assert.deepEqual(errors,[]);
   console.log('PASS: bounded DOM, fast scroll, full playback queue, end of library, playing indicator, keyboard focus, distant search, recent sort, dragging across windows, responsive grid, font/theme changes.');
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
