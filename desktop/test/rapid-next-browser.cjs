// Isolated navigation regression: delayed worker and media, no user data.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {wave}=require('./together-fixture.cjs');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
 try{
  const page=await browser.newPage(),errors=[],body=wave(30),tracks=['a','b','c','d'].map(id=>({id,title:id,artist:id,duration:30000}));page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('pain_shuffle_mode','off');localStorage.setItem('pain_track_transition','1');localStorage.setItem('pain_pulseflow_policy','taste');});
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());if(url.origin!=='http://localhost')return route.abort();
   if(url.pathname.startsWith('/api/cached-track/')){
    if(url.pathname.endsWith('/b'))await new Promise(r=>setTimeout(r,900));
    const range=/bytes=(\d+)-(\d*)/.exec(route.request().headers().range||''),start=range?Number(range[1]):0,end=range?.[2]?Math.min(Number(range[2]),body.length-1):body.length-1;
    return route.fulfill({status:range?206:200,contentType:'audio/wav',headers:{'Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${start}-${end}/${body.length}`}:{})},body:body.subarray(start,end+1)}).catch(()=>{});
   }
   if(url.pathname.startsWith('/api/'))return route.fulfill({json:url.pathname==='/api/saved-library'?{tracks}:url.pathname==='/api/saved-stats'?{plays:[]}:['/api/devices','/api/playlists'].includes(url.pathname)?[]:{}});
   const root=path.resolve(__dirname,'../src'),file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));if(!file.startsWith(root+path.sep))return route.abort();
   try{return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html',body:await fs.readFile(process.env.PAIN_BASELINE_APP&&file.endsWith('/app.js')?process.env.PAIN_BASELINE_APP:file)});}catch(_){return route.fulfill({status:404,body:''});}
  });
  await page.goto('http://localhost/#library');await page.locator('tr[data-track-id="a"]').click();await page.waitForFunction(()=>PainPlayer.getAudio().currentTime>.1);
  await page.evaluate(()=>{
   const q=window.painQueue;window.nextCalls=0;const next=q.nextAsync.bind(q);q.nextAsync=()=>{window.nextCalls++;return next();};
   q.selectInWorker=async({snapshot})=>{await new Promise(r=>setTimeout(r,700));const copy=QueueEngine.fromWorkerSnapshot(snapshot);copy.shuffleMode='off';const track=copy.next();return {trackId:track.id,navigation:copy.navigationSnapshot()};};
   q.setShuffleMode('smart');
   for(let i=0;i<12;i++)document.querySelector('#bottomNextBtn').click();
  });
  await page.waitForFunction(()=>PainPlayer.getTrack()?.id==='b'&&PainPlayer.getAudio().readyState<3);
  await page.evaluate(()=>{for(let i=0;i<12;i++)document.querySelector('#bottomNextBtn').click();});
  await page.waitForFunction(()=>PainPlayer.getTrack()?.id==='b'&&PainPlayer.getAudio().currentTime>.1);
  await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(()=>window.nextCalls),1,'24 impatient clicks must cause one Next, without a delayed backlog');
  assert.equal(await page.evaluate(()=>PainPlayer.getTrack()?.id),'b');
  await page.click('#bottomNextBtn');await page.waitForFunction(()=>PainPlayer.getTrack()?.id==='c'&&PainPlayer.getAudio().currentTime>.1);
  assert.equal(await page.evaluate(()=>window.nextCalls),2,'a fresh click after playback starts is accepted');
  // Manual selection supersedes a delayed Next; its completion cannot change the chosen song.
  await page.evaluate(()=>{painQueue.cancelPendingSelection();document.querySelector('#bottomNextBtn').click();document.querySelector('tr[data-track-id="a"]').click();});
  await page.waitForFunction(()=>PainPlayer.getTrack()?.id==='a'&&PainPlayer.getAudio().currentTime>.1);await page.waitForTimeout(1000);
  assert.equal(await page.evaluate(()=>PainPlayer.getTrack()?.id),'a');assert.equal(await page.evaluate(()=>localStorage.getItem('pain_pulseflow_policy')),'taste');assert.deepEqual(errors,[]);
  console.log('PASS: click bursts coalesce during selection and buffering; fresh Next and manual override work; taste setting is unchanged');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
