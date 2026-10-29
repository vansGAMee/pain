// Real Web Audio sources during a crossfade; API routes are isolated fixtures.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
function tone(frequency){
 const rate=44100,samples=rate*8,wav=Buffer.alloc(44+samples*2);
 wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);
 wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);
 wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
 for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(8000*Math.sin(2*Math.PI*frequency*i/rate)),44+i*2);
 return wav;
}
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
 try{
  const page=await browser.newPage(),errors=[],waves={a:tone(110),b:tone(6000),c:tone(440)};
  const posts=[],tracks=['a','b','c'].map(id=>({id,title:id,artist:id,duration:8000}));
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='warning'&&m.text().startsWith('Transition recovered'))errors.push(m.text());});
  await page.addInitScript(()=>{
   localStorage.setItem('pain_track_transition','1');localStorage.setItem('pain_lang','ru');localStorage.setItem('pain_shuffle_mode','off');
   window.transitionCurves=[];window.sourceAssignments=[];
   const native=AudioParam.prototype.setValueCurveAtTime;AudioParam.prototype.setValueCurveAtTime=function(curve,time,duration){window.transitionCurves.push({curve:[...curve],duration});return native.call(this,curve,time,duration);};
   const desc=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'src');Object.defineProperty(HTMLMediaElement.prototype,'src',{...desc,set(value){window.sourceAssignments.push(value);desc.set.call(this,value);}});
  });
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());if(url.origin!=='http://localhost')return route.abort();
   if(url.pathname.startsWith('/api/cached-track/')){
    const body=waves[url.pathname.split('/').at(-1)],range=/bytes=(\d+)-(\d*)/.exec(route.request().headers().range||'');
    if(range){const start=Number(range[1]),end=range[2]?Math.min(Number(range[2]),body.length-1):body.length-1;return route.fulfill({status:206,contentType:'audio/wav',headers:{'Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${body.length}`},body:body.subarray(start,end+1)});}
    return route.fulfill({contentType:'audio/wav',headers:{'Accept-Ranges':'bytes'},body});
   }
   if(url.pathname==='/api/sync-stats'){posts.push(JSON.parse(route.request().postData()).play);return route.fulfill({json:{status:'ok'}});}
   if(url.pathname.startsWith('/api/')){
    let data={};
    if(url.pathname==='/api/saved-library')data={tracks};
    else if(url.pathname==='/api/saved-stats')data={plays:[],slices:[]};
    else if(url.pathname==='/api/cached-tracks')data={cached:[]};
    else if(['/api/playlists','/api/devices'].includes(url.pathname))data=[];
    return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
   }
   const root=path.resolve(__dirname,'../src'),file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
   if(!file.startsWith(root+path.sep))return route.abort();
   try{return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html',body:await fs.readFile(file)});}
   catch(_){return route.fulfill({status:404,body:''});}
  });
  page.setDefaultTimeout(15000);await page.goto('http://localhost');
  await page.locator('tr[data-track-id="a"]').click();
  await page.waitForFunction(()=>!PainPlayer.getAudio().paused&&PainPlayer.getAudio().currentTime>4.2);
  await page.evaluate(()=>PainPlayer.flushListening());await page.evaluate(()=>PainPlayer.flushListening());
  await page.click('#bottomPlayBtn');await page.click('#bottomPlayBtn');
  await page.waitForFunction(()=>!PainPlayer.getAudio().paused&&PainPlayer.getAudio().currentTime>4.6);
  await page.click('#bottomNextBtn');
  await page.waitForFunction(()=>PainPlayer.getTrack()?.id==='b'&&!PainPlayer.getAudio().paused);
  const rows=posts.filter(p=>p.track==='a');assert.ok(rows.length>=3,'actual checkpoints and finish were relayed');
  assert.equal(new Set(rows.map(p=>p.id)).size,1,'checkpoints, buffering and pause must preserve one play identity');
  const saved=require('../src/stats-store')({},{plays:rows});assert.equal(saved.plays.length,1);
  assert.ok(saved.plays[0].media_heard>=4200&&saved.plays[0].media_heard<=8000);
  const text=await page.locator('tr[data-track-id="a"] .col-plays').textContent();assert.equal(text.trim(),'1','the real library counter must show one listening');
  assert.deepEqual(errors,[]);console.log(JSON.stringify({nativePlayback:true,checkpointRelays:rows.length,savedPlays:1,displayedPlays:1,pauseResume:true,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
