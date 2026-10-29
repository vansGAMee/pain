// Real Web Audio sources during a crossfade; API routes are isolated fixtures.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
function tone(frequency){
 const rate=44100,samples=rate*30,wav=Buffer.alloc(44+samples*2);
 wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);
 wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);
 wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
 for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(8000*Math.sin(2*Math.PI*frequency*i/rate)),44+i*2);
 return wav;
}
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
 try{
  const page=await browser.newPage(),errors=[],waves={a:tone(110),b:tone(6000),c:tone(440)};let failB=false,analysisDuringBuffering=0;
  const tracks=['a','b','c'].map(id=>({id,title:id,artist:id,duration:30000}));
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
    if(failB&&url.pathname.endsWith('/b')&&route.request().resourceType()==='media')return route.fulfill({status:503,body:'Temporarily unavailable'});
    const id=url.pathname.split('/').at(-1);if(id==='b'||id==='c')await new Promise(resolve=>setTimeout(resolve,id==='b'?1500:1000));
    const body=waves[url.pathname.split('/').at(-1)],range=/bytes=(\d+)-(\d*)/.exec(route.request().headers().range||'');
    if(range){const start=Number(range[1]),end=range[2]?Math.min(Number(range[2]),body.length-1):body.length-1;return route.fulfill({status:206,contentType:'audio/wav',headers:{'Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${body.length}`},body:body.subarray(start,end+1)});}
    return route.fulfill({contentType:'audio/wav',headers:{'Accept-Ranges':'bytes'},body});
   }
   if(url.pathname.startsWith('/api/')){
    if(url.pathname.startsWith('/api/transition-audio/')){
     const id=url.pathname.split('/').at(-1);if(await page.evaluate(id=>PainPlayer.getTrack()?.id===id&&PainPlayer.getAudio().readyState<3,id))analysisDuringBuffering++;
    }
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
  await page.locator('tr[data-track-id="a"]').click();await page.waitForFunction(()=>!PainPlayer.getAudio().paused&&PainPlayer.getAudio().currentTime>.1);
  await page.locator('tr[data-track-id="b"]').click();await page.waitForTimeout(40);await page.locator('tr[data-track-id="c"]').click();
  await page.waitForTimeout(200);
  assert.ok(await page.evaluate(()=>[...document.querySelectorAll('audio')].some(a=>a.src.includes('/a?')&&!a.paused&&!a.ended&&a.currentTime>0)), 'the audible outgoing track must keep playing through rapid Next while replacements buffer');
  await page.waitForFunction(()=>PainPlayer.getTrack()?.id==='c'&&!PainPlayer.getAudio().paused&&PainPlayer.getAudio().currentTime>.1);
  assert.deepEqual(errors,[]);console.log('PASS: rapid switches during slow buffering preserve the outgoing music and recover the selected track');
  await page.waitForTimeout(1600);
  failB=true;await page.locator('tr[data-track-id="b"]').click();
  await page.waitForFunction(()=>PainPlayer.getTrack()?.id==='b'&&PainPlayer.getAudio().error);
  failB=false;await page.click('#bottomPlayBtn');
  await page.waitForFunction(()=>PainPlayer.getTrack()?.id==='b'&&!PainPlayer.getAudio().error&&!PainPlayer.getAudio().paused&&PainPlayer.getAudio().currentTime>.1);
  console.log('PASS: Play retries a failed track after a temporary source error');
  assert.equal(analysisDuringBuffering,0,'analysis must not compete with the selected track while its decoder is buffering');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
