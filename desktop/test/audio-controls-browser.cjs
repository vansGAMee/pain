const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs/promises');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addScriptTag({path:path.join(__dirname,'../src/smart-volume.js')});
  await page.addScriptTag({path:path.join(__dirname,'../src/auto-eq.js')});
  const result=await page.evaluate(async()=>{
   const frequencies=[60,170,310,600,1000,3000,6000,12000];
   const sourceProfile={vector:[.35,.04,.92,.04,.2,.2],frames:20,seconds:10,variance:Array(6).fill(0)};
   const reference=AutoEqualizer.createReference(Array.from({length:32},(_,i)=>({id:String(i),profile:{...sourceProfile,vector:[.35,.25+i*.003,.55-i*.002,.2-i*.001,.2,.25]}})));
   async function render({enabled=true,eq=false,volume=1,background=false,antiphase=false,mono=false,constant=false}={}){
    const rate=44100,seconds=16,ctx=new OfflineAudioContext(2,rate*seconds,rate),gains=[];
    const timers=new Map(),oldSet=window.setInterval,oldClear=window.clearInterval;let serial=0;
    window.setInterval=fn=>{timers.set(++serial,fn);return serial;};window.clearInterval=id=>timers.delete(id);
    const audio=Object.assign(new EventTarget(),{paused:false,seeking:false,readyState:4,volume,muted:false});
    // Advance the actual native graph with the same quarter-second detector ticks,
    // without spending wall-clock time playing each fixture.
    const context={get currentTime(){return ctx.currentTime;},state:'running',
     createGain(){const n=ctx.createGain();gains.push(n);return n;},
     createDynamicsCompressor:()=>ctx.createDynamicsCompressor(),createChannelSplitter:n=>ctx.createChannelSplitter(n),createAnalyser:()=>ctx.createAnalyser()};
    const control=SmartVolume.create(context,audio);
    try{
     control.update(enabled,true,background);const active=timers.size;
     control.update(enabled,true,background);if(timers.size!==active)throw new Error('duplicate meter');
     audio.paused=true;audio.dispatchEvent(new Event('pause'));if(timers.size)throw new Error('meter runs while paused');
     audio.paused=false;audio.dispatchEvent(new Event('playing'));
     const source=ctx.createBufferSource(),buffer=ctx.createBuffer(mono?1:2,rate*seconds,rate);
     for(let channel=0;channel<buffer.numberOfChannels;channel++){
      const values=buffer.getChannelData(channel),sign=antiphase&&channel===1?-1:1;
      for(let i=0;i<values.length;i++)values[i]=volume*sign*(constant?.4:i<rate*6?.04:.6)*Math.sin(2*Math.PI*440*i/rate);
     }
     source.buffer=buffer;let last=source,recommendation=null;
     if(eq){
      recommendation=AutoEqualizer.recommend({},sourceProfile,AutoEqualizer.createHeadroom(ctx,frequencies),reference);
      const preamp=ctx.createGain();preamp.gain.value=10**(recommendation.preamp/20);last.connect(preamp);last=preamp;
      frequencies.forEach((frequency,i)=>{
       const node=ctx.createBiquadFilter();node.type=i===0?'lowshelf':i===7?'highshelf':'peaking';node.frequency.value=frequency;node.Q.value=1.2;node.gain.value=recommendation.bands[i];last.connect(node);last=node;
      });
     }
     last.connect(control.input);control.output.connect(ctx.destination);source.start();
     const pending=[];
     for(let t=.25;t<seconds;t+=.25)pending.push(ctx.suspend(t).then(()=>{for(const fn of timers.values())fn();return ctx.resume();}));
     const rendered=(await ctx.startRendering()).getChannelData(0);await Promise.all(pending);
     const rms=(a,b)=>{let energy=0;for(let i=a*rate;i<b*rate;i++)energy+=rendered[i]**2;return Math.sqrt(energy/((b-a)*rate));};
     let peak=0;for(const value of rendered)peak=Math.max(peak,Math.abs(value));
     const out={quiet:rms(4,5),loud:rms(14,15),peak,gain:gains[1].gain.value,recommendation};
     control.update(false,true,background);if(timers.size)throw new Error('disabled meter still running');
     return out;
    }finally{control.destroy();window.setInterval=oldSet;window.clearInterval=oldClear;}
   }
   const off=await render({enabled:false}),on=await render(),ducked=await render({background:true});
   const plain=await render({constant:true}),eq=await render({eq:true,constant:true});
   const quieter=await render({constant:true,volume:.2}),wide=await render({constant:true,antiphase:true}),mono=await render({constant:true,mono:true});
   // Validate actual combined filter peaks over a denser grid than production.
   const peaks=[];
   for(const rate of [44100,48000]){
    const ctx=new OfflineAudioContext(1,128,rate),measure=AutoEqualizer.createHeadroom(ctx,frequencies);
    for(const vector of [[.35,.04,.92,.04,.2,.2],[.35,.7,.2,.1,.1,.2],[.35,.05,.35,.6,.4,.2]]){
     const eq=AutoEqualizer.recommend({},{...sourceProfile,vector},measure,reference),f=Float32Array.from({length:4096},(_,i)=>20*(20000/20)**(i/4095));
     const response=new Float64Array(f.length).fill(10**(eq.preamp/20)),mag=new Float32Array(f.length),phase=new Float32Array(f.length);
     frequencies.forEach((frequency,i)=>{
      const node=ctx.createBiquadFilter();node.type=i===0?'lowshelf':i===7?'highshelf':'peaking';node.frequency.value=frequency;node.Q.value=1.2;node.gain.value=eq.bands[i];node.getFrequencyResponse(f,mag,phase);
      for(let j=0;j<f.length;j++)response[j]*=mag[j];
     });
     peaks.push(Math.max(...response));
    }
   }
   return {off,on,ducked,plain,eq,quieter,wide,mono,peaks};
  });
  assert.ok(Math.abs(result.off.loud-.6/Math.sqrt(2))<.005,'disabled audio stays unchanged');
  assert.ok(result.on.loud/result.on.quiet<result.off.loud/result.off.quiet*.5,'quiet/loud transitions improve');
  assert.ok(Math.abs(result.ducked.loud/result.on.loud-.3)<.002,'normalization must not fight ducking');
  assert.ok(Math.abs(20*Math.log10(result.eq.loud/result.plain.loud))<1,'both modes keep EQ output level consistent');
  assert.ok(Math.abs(result.quieter.gain-result.plain.gain)<.005,'manual fader must not change automatic gain');
  assert.ok(Math.abs(result.wide.gain-result.plain.gain)<.005,'antiphase stereo must not look like silence');
  assert.ok(Math.abs(result.mono.gain-result.plain.gain)<.005,'mono must not acquire an extra 3 dB of normalization');
  assert.ok(result.peaks.every(p=>p<=1.001),'combined EQ curves retain peak headroom');
  assert.ok(result.eq.recommendation.adjusted,'level matching test must exercise actual tonal correction');
  assert.ok(result.on.peak<1&&result.eq.peak<1);
  console.log('PASS: native audio level matching, EQ tandem, mono/stereo, manual volume, ducking, headroom and meter lifecycle');

  const faderRatio=await page.evaluate(async()=>{
   // Confirm the real MediaElementSource fader semantics used by the detector.
   const rate=44100,length=rate*3,bytes=new ArrayBuffer(44+length*2),view=new DataView(bytes);
   const text=(offset,value)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
   text(0,'RIFF');view.setUint32(4,36+length*2,true);text(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
   view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,length*2,true);
   for(let i=0;i<length;i++)view.setInt16(44+i*2,10000*Math.sin(2*Math.PI*440*i/rate),true);
   const audio=new Audio(URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}))),ctx=new AudioContext();
   const source=ctx.createMediaElementSource(audio),meter=ctx.createAnalyser(),muted=ctx.createGain();muted.gain.value=0;
   source.connect(meter);meter.connect(muted);muted.connect(ctx.destination);
   try{
    await ctx.resume();await audio.play();
    const rms=async()=>{await new Promise(resolve=>setTimeout(resolve,150));const data=new Float32Array(meter.fftSize);meter.getFloatTimeDomainData(data);return Math.sqrt(data.reduce((sum,v)=>sum+v*v,0)/data.length);};
    const a=await rms();audio.volume=.2;return await rms()/a;
   }finally{audio.pause();URL.revokeObjectURL(audio.src);await ctx.close();}
  });
  assert.ok(Math.abs(faderRatio-.2)<.01,'the actual media fader must be divided out of the measured level');

  const protectedPeaks=await page.evaluate(async()=>{
   const rate=44100,ctx=new OfflineAudioContext(2,rate*4,rate),source=ctx.createBufferSource(),buffer=ctx.createBuffer(2,rate*4,rate);
   for(let ch=0;ch<2;ch++){
    const data=buffer.getChannelData(ch);for(let i=0;i<data.length;i++)data[i]=(ch?-1:1)*(i<rate*2?.1:1.25)*Math.sin(2*Math.PI*440*i/rate);
   }
   source.buffer=buffer;const control=SmartVolume.create(ctx);control.update(false,false,false,true);source.connect(control.input);control.output.connect(ctx.destination);source.start();
   try{
    const result=await ctx.startRendering(),a=result.getChannelData(0),b=result.getChannelData(1);let peak=0,quiet=0,phaseError=0;
    for(let i=0;i<a.length;i++){
     if(i>rate*2.5)peak=Math.max(peak,Math.abs(a[i]));
     if(i>rate&&i<rate*1.5)quiet=Math.max(quiet,Math.abs(a[i]));
     phaseError=Math.max(phaseError,Math.abs(a[i]+b[i]));
    }
    return {peak,quiet,phaseError};
   }finally{control.destroy();}
  });
  assert.ok(protectedPeaks.peak<1&&protectedPeaks.peak>.8,'peak-only protection catches overloaded crossfades');
  assert.ok(Math.abs(protectedPeaks.quiet-.1)<.001,'peak-only mode must preserve quiet material without leveling');
  assert.ok(protectedPeaks.phaseError<1e-6,'stereo image must remain linked');
  console.log('PASS: native Smart EQ peak protection preserves quiet dynamics and antiphase stereo');

  // Isolated UI fixture: no server or access to the user library.
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.pathname.startsWith('/api/')){
    const data=u.pathname==='/api/saved-library'?{tracks:[]}:u.pathname==='/api/saved-stats'?{plays:[],slices:[]}:u.pathname==='/api/cached-tracks'?{cached:[]}:[];
    return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
   }
   if(u.origin!=='http://pain.test')return route.abort();
   const file=u.pathname.startsWith('/assets/')?path.join(__dirname,'..',u.pathname):path.join(__dirname,'../src',u.pathname==='/'?'index.html':u.pathname);
   const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.ttf':'font/ttf'};
   try{await route.fulfill({contentType:mime[path.extname(file)]||'application/octet-stream',body:await fs.readFile(file)});}catch(_){await route.fulfill({status:404,body:''});}
  });
  await page.goto('http://pain.test');
  await page.click('#eqToggleBtn');await page.click('[data-preset="bass"]');
  const manual=await page.evaluate(()=>JSON.parse(localStorage.getItem('pain_eq_config')));await page.click('#eqCloseBtn');
  await page.click('#sidebarSettingsBtn');await page.locator('label[for="smartVolumeSwitch"]').click();await page.locator('label[for="autoEqSwitch"]').click();
  await page.click('#settingsDoneBtn');await page.click('#eqToggleBtn');
  assert.equal(await page.locator('#eqSliderPreamp').isDisabled(),true);
  assert.equal(await page.locator('#eqSliderPreamp').getAttribute('step'),'0.25');
  await page.locator('#eqPowerSwitch').evaluate(input=>input.click());
  const restored=await page.evaluate(()=>JSON.parse(localStorage.getItem('pain_eq_config')));
  assert.equal(restored.auto,false);assert.equal(restored.enabled,false);assert.deepEqual(restored.bands,manual.bands);assert.equal(restored.preamp,manual.preamp);
  assert.equal(await page.locator('#eqSliderPreamp').getAttribute('step'),'0.5');
  await page.reload();await page.click('#sidebarSettingsBtn');assert.equal(await page.locator('#smartVolumeSwitch').isChecked(),true);
  assert.equal(await page.locator('#autoEqSwitch').isChecked(),false);assert.deepEqual(errors,[]);
  console.log('PASS: simultaneous settings, precision, manual EQ restoration, persistence and no page errors');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
