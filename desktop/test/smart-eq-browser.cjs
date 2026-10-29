// Read-only real-library playback fixture. API writes stay inside intercepted routes.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
(async()=>{
 const root=path.resolve(__dirname,'..'),library=JSON.parse(await fs.readFile(path.join(root,'data/library.json'))),dj=JSON.parse(await fs.readFile(path.join(root,'data/dj-state.json')));
 const browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required','--mute-audio']});
 try{
  const page=await browser.newPage({viewport:{width:1100,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   localStorage.setItem('pain_theme','form-night');localStorage.setItem('pain_lang','ru');localStorage.setItem('pain_phone_url','http://127.0.0.1:9');localStorage.setItem('pain_track_transition','1');
   window.eqScheduled=0;window.eqFilters=[];
   const create=AudioContext.prototype.createBiquadFilter;
   AudioContext.prototype.createBiquadFilter=function(){const node=create.call(this),connect=node.connect;node.connect=function(...args){node.inGraph=true;return connect.apply(this,args);};window.eqFilters.push(node);return node;};
   const set=AudioParam.prototype.setTargetAtTime;
   AudioParam.prototype.setTargetAtTime=function(...args){window.eqScheduled++;return set.apply(this,args);};
  });
  const files=await fs.readdir(path.join(root,'cache'));
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());if(u.origin!=='http://pain.test')return route.abort();
   if(u.pathname.startsWith('/api/cached-track/')){
    const id=decodeURIComponent(u.pathname.split('/').pop()).replace(/[^a-zA-Z0-9_-]/g,'_'),name=files.find(n=>n.startsWith(id+'.'));
    assert.ok(name,'real cached audio missing: '+id);return route.fulfill({contentType:'audio/mpeg',body:await fs.readFile(path.join(root,'cache',name))});
   }
   if(u.pathname.startsWith('/api/')){
    if(u.pathname.startsWith('/api/cover/'))return route.fulfill({status:404,body:''});
    const payload={
     '/api/saved-library':library,'/api/dj-state':dj,'/api/saved-stats':{plays:[],slices:[]},
     '/api/cached-tracks':{cached:library.tracks.map(t=>t.id)},'/api/discord-presence':{enabled:false},
     '/api/genre-preferences':{enabled:false},'/api/lyrics-preferences':{enabled:false},'/api/desktop-preferences':{},
    }[u.pathname]||[];
    return route.fulfill({json:payload});
   }
   const file=u.pathname.startsWith('/assets/')?path.join(root,u.pathname):path.join(root,'src',u.pathname==='/'?'index.html':u.pathname);
   try{return route.fulfill({contentType:{'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.ttf':'font/ttf'}[path.extname(file)]||'application/octet-stream',body:await fs.readFile(file)});}catch(_){return route.fulfill({status:404,body:''});}
  });
  await page.goto('http://pain.test');await page.waitForFunction(n=>window.painQueue?.tracks.length===n,library.tracks.length);
  const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  // Full real-library validation and timing, using native biquad responses.
  const audit=await page.evaluate(({tracks,profiles})=>{
   const start=performance.now(),entries=tracks.map(t=>({id:t.id,profile:AudioProfile.get(profiles,t)})),reference=AutoEqualizer.createReference(entries),buildMs=performance.now()-start;
   const ctx=new AudioContext(),measure=AutoEqualizer.createHeadroom(ctx,[60,170,310,600,1000,3000,6000,12000]);
   let adjusted=0,worstMs=0,minDb=0,maxBoost=0;const at=performance.now();
   for(let i=0;i<tracks.length;i++){
    const begin=performance.now(),r=AutoEqualizer.recommend(tracks[i],entries[i].profile,measure,reference);worstMs=Math.max(worstMs,performance.now()-begin);
    if(!r.ready)throw Error('Saved real profile not usable: '+tracks[i].id);
    if(r.adjusted)adjusted++;if(r.bands.some(v=>!Number.isFinite(v)||Math.abs(v)>1))throw Error('Unsafe automatic curve');
    if(r.adjusted){const response=measure.response(r.bands);minDb=Math.min(minDb,-response.attenuation);maxBoost=Math.max(maxBoost,20*Math.log10(response.peak));}
   }
   const allMs=performance.now()-at;ctx.close();return {tracks:tracks.length,reference:reference.count,buildMs,allMs,worstMs,adjusted,minDb,maxBoost};
  },{tracks:library.tracks,profiles:dj.profiles});
  assert.ok(audit.minDb>=-3.05);assert.ok(audit.maxBoost<=3.05);assert.ok(audit.adjusted>2,'measured differences must produce real adaptation');assert.ok(audit.worstMs<50,'one switch must fit inside a UI frame budget under 4× CPU slowdown');
  await page.click('.nav-item[data-view="library"]');await page.click('#eqToggleBtn');if(await page.locator('#eqPowerSwitch').isChecked())await page.locator('#eqPowerSwitch').evaluate(s=>s.click());await page.click('[data-preset="bass"]');assert.equal(await page.locator('#eqPowerSwitch').isChecked(),true,'choosing Bass Boost must activate it even after power was off');
  const manual=await page.evaluate(()=>JSON.parse(localStorage.getItem('pain_eq_config')));
  await page.click('#eqAutoToggleBtn');assert.equal(await page.locator('#eqAutoToggleBtn').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#eqSliderPreamp').isDisabled(),true);await page.click('#eqCloseBtn');
  const curves=[];
  for(const title of ['Never Forgive Me, Never Forget Me','Everlong','Jigsaw Falling Into Place']){
   const song=library.tracks.find(t=>t.title===title);assert.ok(song);await page.fill('#searchInput',title);
   await page.locator(`tr[data-track-id="${song.id}"]`).click();await page.waitForFunction(id=>PainPlayer.getTrack()?.id===id&&!PainPlayer.getAudio().paused&&PainPlayer.getAudio().currentTime>.2,song.id);
   await page.click('#eqToggleBtn');const caption=await page.locator('#eqAutoExplanation').textContent();assert.match(caption,/измеренными треками/);
   const values=await page.locator('.eq-v-slider[data-band]').evaluateAll(sliders=>sliders.map(s=>Number(s.value)));
   assert.ok(values[0]>0,'Bass Boost must stay active');curves.push({title,values,caption});
   await page.waitForFunction(expected=>{
    const nodes=window.eqFilters.filter(n=>n.inGraph);return nodes.length===8&&nodes.every((n,i)=>Math.abs(n.gain.value-expected[i])<.06);
   },values,{timeout:10000});
   await page.click('#eqCloseBtn');
  }
  assert.notDeepEqual(curves[0].values,curves[1].values,'different saved evidence must change actual slider values');
  const before=await page.evaluate(()=>PainPlayer.getAudio().currentTime);
  await page.click('#eqToggleBtn');await page.screenshot({path:'/tmp/pain-smart-eq.png'});
  // No new audio scheduling while the cached recommendation is unchanged.
  const scheduled=await page.evaluate(()=>window.eqScheduled);await page.waitForTimeout(1100);assert.equal(await page.evaluate(()=>window.eqScheduled),scheduled);
  await page.waitForFunction(()=>document.getElementById('eqAutoExplanation').textContent.includes('текущий участок'),null,{timeout:20000});
  assert.ok(await page.evaluate(()=>!PainPlayer.getAudio().paused),'current-section adaptation must preserve playback');
  await page.click('[data-preset="flat"]');assert.equal(await page.locator('#eqAutoToggleBtn').getAttribute('aria-pressed'),'true');
  await page.click('[data-preset="bass"]');
  await page.locator('.eq-v-slider[data-band="0"]').evaluate(s=>{s.value=5;s.dispatchEvent(new Event('input',{bubbles:true}));});
  const customized=await page.evaluate(()=>JSON.parse(localStorage.getItem('pain_eq_config')));
  assert.equal(customized.auto,true);assert.equal(customized.bands[0],5);assert.equal(customized.manual.preset,'custom');
  await page.click('#eqAutoToggleBtn');const restored=await page.evaluate(()=>JSON.parse(localStorage.getItem('pain_eq_config')));
  assert.equal(restored.auto,false);assert.deepEqual(restored.bands,customized.manual.bands);assert.equal(restored.preamp,customized.manual.preamp);
  assert.ok(await page.evaluate(t=>!PainPlayer.getAudio().paused&&PainPlayer.getAudio().currentTime>t,before),'automatic/manual toggle must not interrupt music');
  await page.click('#eqAutoToggleBtn');await page.locator('#eqPowerSwitch').evaluate(input=>input.click());assert.equal(await page.locator('#eqAutoToggleBtn').getAttribute('aria-pressed'),'false');
  await page.reload();await page.click('#eqToggleBtn');assert.equal(await page.locator('#eqPowerSwitch').isChecked(),false);assert.equal(await page.locator('#eqAutoToggleBtn').isDisabled(),false);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({audit,curves,cpuSlowdown:4,realAudio:'3 tracks, switching and manual restoration passed',errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
