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
  const page=await browser.newPage(),errors=[],waves={a:tone(110),b:tone(6000),c:tone(440)};
  const tracks=['a','b','c'].map(id=>({id,title:id,artist:id,duration:30000}));
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='warning'&&m.text().startsWith('Transition recovered'))errors.push(m.text());});
  await page.addInitScript(()=>{
   localStorage.setItem('pain_track_transition','1');localStorage.setItem('pain_lang','ru');localStorage.setItem('pain_shuffle_mode','off');
   window.transitionCurves=[];window.sourceAssignments=[];
   const AC=window.AudioContext;window.AudioContext=new Proxy(AC,{construct(Type,args){const ctx=new Type(...args);window.testAudioContext=ctx;return ctx;}});
   const connect=AudioNode.prototype.connect;AudioNode.prototype.connect=function(destination,...args){if(destination instanceof AudioDestinationNode){const meter=this.context.createAnalyser();meter.fftSize=2048;window.outputMeter=meter;connect.call(this,meter);return connect.call(meter,destination,...args);}return connect.call(this,destination,...args);};
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
  page.setDefaultTimeout(10000);await page.goto('http://localhost');
  const play=async id=>{await page.locator(`tr[data-track-id="${id}"]`).click();await page.waitForFunction(id=>PainPlayer.getTrack()?.id===id&&!PainPlayer.getAudio().paused&&PainPlayer.getAudio().currentTime>.1,id);};
  const prepared=async id=>page.waitForFunction(id=>[...document.querySelectorAll('audio')].some(a=>a!==PainPlayer.getAudio()&&a.src.includes('/'+id+'?')&&a.readyState>=3),id);
  const audible=async()=>page.waitForFunction(()=>{const meter=window.outputMeter;if(!meter)return false;const data=new Float32Array(meter.fftSize);meter.getFloatTimeDomainData(data);return Math.sqrt(data.reduce((n,x)=>n+x*x,0)/data.length)>.01;});
  await play('a');await prepared('b');
  // Natural succession, including reusing the already buffered source.
  const assigned=await page.evaluate(()=>window.sourceAssignments.filter(s=>s.includes('/b?')).length);
  await page.evaluate(()=>{PainPlayer.getAudio().currentTime=29.1;});
  await page.waitForFunction(()=>PainPlayer.getTrack()?.id==='b'&&!PainPlayer.getAudio().paused);
  await page.waitForFunction(()=>window.transitionCurves.length>=2);
  assert.equal(await page.evaluate(()=>window.sourceAssignments.filter(s=>s.includes('/b?')).length),assigned,'warm decoder must not reload');
  await prepared('c');
  await page.evaluate(()=>{PainPlayer.getAudio().playbackRate=2;PainPlayer.getAudio().currentTime=28.2;});
  await page.waitForFunction(()=>PainPlayer.getTrack()?.id==='c'&&!PainPlayer.getAudio().paused);
  await page.waitForFunction(()=>window.transitionCurves.length>=4);
  await page.waitForTimeout(1200);
  await audible();
  // Background/device interruptions can suspend Web Audio after a transition.
  // Play must resume the processing graph, not merely toggle the media element.
  await page.click('#bottomPlayBtn');await page.evaluate(()=>window.testAudioContext.suspend());
  await page.click('#bottomPlayBtn');await page.waitForFunction(()=>window.testAudioContext.state==='running');await audible();
  assert.equal(await page.evaluate(()=>[...document.querySelectorAll('audio')].filter(a=>!a.paused).length),1);
  // Repeated manual selections while fading, then pause and resume.
  await play('a');await play('b');await play('c');await play('a');
  await page.click('#bottomPlayBtn');
  assert.equal(await page.evaluate(()=>[...document.querySelectorAll('audio')].every(a=>a.paused)),true);
  await page.waitForTimeout(1100);assert.equal(await page.evaluate(()=>PainPlayer.getAudio().paused),true,'old completion must not resume playback');
  await page.click('#bottomPlayBtn');await page.waitForFunction(()=>!PainPlayer.getAudio().paused);
  await play('b');
  // Use the actual UI seek handler while overlapping, then continue the queue.
  await page.locator('#progressTrack').click({position:{x:30,y:3}});
  await page.waitForFunction(()=>[...document.querySelectorAll('audio')].filter(a=>!a.paused).length===1);
  await prepared('c');
  await page.evaluate(()=>{PainPlayer.getAudio().currentTime=29.1;});
  await page.waitForFunction(()=>PainPlayer.getTrack()?.id==='c'&&!PainPlayer.getAudio().paused);
  await page.waitForTimeout(1200);
  const curves=await page.evaluate(()=>window.transitionCurves);
  assert.ok(curves.every(c=>c.duration>0&&c.duration<=4&&c.curve.every(Number.isFinite)));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({naturalSequence:'a → b → c',warmSourceReused:true,curves:curves.length,rapidSwitches:true,pauseResume:true,suspendedContextResumed:true,audibleOutput:true,seekRecovery:true,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
