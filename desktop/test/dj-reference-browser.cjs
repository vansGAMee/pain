// Isolated UI regression: no application backend, phone or user data is accessed.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const Audio=require('../src/audio-profile');
(async()=>{
 const root=path.resolve(__dirname,'../src');
 const server=http.createServer((req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname;
  const file=path.resolve(root,'.'+(name==='/'?'/index.html':name));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');
  res.end(fs.readFileSync(file));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try{
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const tracks=['a','b','c'].map(id=>({id,title:id,artist:id,duration:180000}));
  const profiles=Object.fromEntries(tracks.map((t,i)=>[t.id,{version:4,signature:Audio.signature(t),frames:72,seconds:36,
   positions:Array.from({length:72},(_,j)=>j),vector:[.4,.1,.7,.2,.25,.1],variance:Array(6).fill(.01),
   timbre:Array(12).fill(i===2?.9:.2),timbreVariance:Array(12).fill(.001)}]));
  const stats={plays:[{track:'a',started:Date.now()-86400000,duration:180000,heard:5000,skipped:1}]};
  const samples=44100*12,wav=Buffer.alloc(44+samples*2);
  wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);
  wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(44100,24);wav.writeUInt32LE(88200,28);
  wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
  await page.addInitScript(p=>{
   localStorage.setItem('pain_audio_profiles_v4',JSON.stringify(p));localStorage.setItem('pain_lang','ru');
  },profiles);
  await page.route('**/api/**',async route=>{
   const pathname=new URL(route.request().url()).pathname;
   if(pathname.startsWith('/api/cached-track/'))return route.fulfill({contentType:'audio/wav',body:wav});
   let data={};
   if(pathname==='/api/saved-library')data={tracks};
   else if(pathname==='/api/saved-stats')data=stats;
   else if(['/api/playlists','/api/devices'].includes(pathname))data=[];
   else if(pathname==='/api/cached-tracks')data={cached:[]};
   await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('tr[data-track-id="a"]').click();
  await page.waitForFunction(()=>window.painQueue?.currentStartedAt>0&&!document.querySelector('audio').paused);
  const started=await page.evaluate(()=>{
   const q=window.painQueue;q.setShuffleMode('smart');
   return q.currentStartedAt;
  });
  // Enabling Smart DJ during playback must preserve the active visit as well.
  assert.ok(started>0,'changing shuffle must not erase the real playback visit');
  assert.equal(await page.evaluate(()=>{const q=window.painQueue;return q.smartScore(q.getCurrentTrack(),q.tracks.find(t=>t.id==='b'),{}).soundSimilarity;}),1);
  await page.waitForFunction(()=>document.querySelector('audio').currentTime>=2.2);await page.click('#bottomNextBtn');
  await page.waitForFunction(()=>window.painQueue.getCurrentTrack()?.id!=='a');
  const feedback=await page.evaluate(started=>{
   const q=window.painQueue;return {canReference:q._taste.canReference({id:'a'},started),last:q._taste.lastFeedback.get('a'),rows:q.stats.plays.filter(p=>p.track==='a')};
  },started);
  assert.equal(feedback.canReference,false,JSON.stringify({started,...feedback}));
  await page.locator('tr[data-track-id="a"]').click();
  await page.waitForFunction(old=>window.painQueue.getCurrentTrack()?.id==='a'&&window.painQueue.currentStartedAt>old,started);
  assert.equal(await page.evaluate(()=>{const q=window.painQueue;return q.smartScore(q.getCurrentTrack(),q.tracks.find(t=>t.id==='b'),{}).soundSimilarity;}),1);
  assert.deepEqual(errors,[]);console.log('PASS: old skip, live skip, manual reselection and shuffle toggle preserve the correct acoustic reference');
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
