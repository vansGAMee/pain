// Read-only real-library playback fixture. API writes stay inside intercepted routes.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
(async()=>{
 const root=path.resolve(__dirname,'..'),data=process.env.PAIN_AUDIT_DATA;
 assert.ok(data&&path.resolve(data)!==path.join(root,'data'),'use a copied library');
 const stats=JSON.parse(await fs.readFile(path.join(data,'stats.json'))),library=JSON.parse(await fs.readFile(path.join(data,'library.json'))),dj=JSON.parse(await fs.readFile(path.join(data,'dj-state.json')));
 const service=require('../src/personal-service')(data);
 const before=await Promise.all(['library.json','stats.json','dj-state.json'].map(n=>fs.readFile(path.join(data,n),'utf8')));
 const coldStart=performance.now();const initial=await service.request({eligible:library.tracks.slice(0,3).map(t=>t.id),length:1,kind:'mix',seed:0,now:Date.now(),offset:-240});const firstResponseMs=Math.round(performance.now()-coldStart);assert.equal(initial.preparing,true,'cold analysis must return a quick fallback signal');
 const browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required','--mute-audio']});
 try{
  const page=await browser.newPage({viewport:{width:1100,height:800},timezoneId:'Europe/Saratov'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   localStorage.setItem('pain_theme','form-night');localStorage.setItem('pain_lang','ru');localStorage.setItem('pain_phone_url','http://127.0.0.1:9');localStorage.setItem('pain_track_transition','1');
   window.personalReadyCount=0;window.addEventListener('pain:personal-ready',()=>window.personalReadyCount++);
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
   if(u.pathname==='/api/personal/recommend'){
    try{const input=JSON.parse(route.request().postData());return route.fulfill({json:input.action==='status'?service.status():await service.request(input)});}catch(e){return route.fulfill({status:503,json:{error:e.message}});}
   }
   if(u.pathname.startsWith('/api/')){
    if(u.pathname.startsWith('/api/cover/'))return route.fulfill({status:404,body:''});
    const payload={
     '/api/saved-library':library,'/api/dj-state':dj,'/api/saved-stats':stats,
     '/api/cached-tracks':{cached:library.tracks.map(t=>t.id)},'/api/discord-presence':{enabled:false},
     '/api/genre-preferences':{enabled:false},'/api/lyrics-preferences':{enabled:false},'/api/desktop-preferences':{},
    }[u.pathname]||[];
    return route.fulfill({json:payload});
   }
   const file=u.pathname.startsWith('/assets/')?path.join(root,u.pathname):path.join(root,'src',u.pathname==='/'?'index.html':u.pathname);
   try{return route.fulfill({contentType:{'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.ttf':'font/ttf'}[path.extname(file)]||'application/octet-stream',body:await fs.readFile(file)});}catch(_){return route.fulfill({status:404,body:''});}
  });
  await page.goto('http://pain.test');await page.waitForFunction(n=>window.painQueue?.tracks.length===n,library.tracks.length);
  await page.click('#settingsToggleBtn');await page.selectOption('#pulseflowPolicy','taste');await page.click('#settingsCloseBtn');
  await page.click('.nav-item[data-view="library"]');await page.fill('#searchInput','Everlong');
  const song=library.tracks.find(t=>t.title==='Everlong');await page.locator(`tr[data-track-id="${song.id}"]`).click();
  await page.waitForFunction(()=>!PainPlayer.getAudio().paused&&PainPlayer.getAudio().currentTime>.2);
  await page.click('#bottomShuffleBtn');await page.click('#bottomShuffleBtn');
  await page.waitForFunction(()=>painQueue.getShuffleMode()==='smart');
  await page.click('#bottomNextBtn');
  await page.waitForFunction(id=>painQueue.getCurrentTrack()?.id!==id&&painQueue.getLastTransition()?.explanation?.method&&!PainPlayer.getAudio().paused&&PainPlayer.getAudio().currentTime>.1,song.id);
  const firstMethod=await page.evaluate(()=>painQueue.getLastTransition()?.explanation?.method);
  if(firstMethod!=='personal-taste'){
    assert.equal(firstMethod,'frequency-fallback','the live baseline must play while training');
    await page.waitForFunction(()=>window.personalReadyCount>0,null,{timeout:60000});
    await page.click('#bottomNextBtn');
  }
  await page.waitForFunction(()=>painQueue.getLastTransition()?.explanation?.method==='personal-taste'&&!PainPlayer.getAudio().paused,null,{timeout:40000});
  await page.click('#bottomTrackContext');await page.waitForFunction(()=>document.getElementById('djReason').textContent.includes('Вся история'));await page.click('#djWhySummary');
  assert.match(await page.locator('#djWhyFull').textContent(),/Частотная основа сохранена/);
  await page.fill('#djVibeName','Audit vibe');await page.click('#djSave');
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('pain_dj_vibes_v1'))?.items.some(v=>v.name==='Audit vibe'&&v.embedding?.length===512),null,{timeout:10000});
  await page.screenshot({path:'/tmp/pain-personal-details.png'});await page.click('#djWhySummary');await page.evaluate(()=>document.getElementById('djDialog').scrollTop=0);await page.screenshot({path:'/tmp/pain-personal-mode.png'});
  const decision=await page.evaluate(()=>painQueue.getLastTransition().explanation);
  assert.ok(decision.historyEvents>1000,'model must use the entire saved history');
  assert.ok(await page.evaluate(()=>!PainPlayer.getAudio().paused),'saving the vibe must preserve real playback');
  await page.click('#djRelease');await page.click('#djClose');
  await page.reload();await page.click('#settingsToggleBtn');assert.equal(await page.locator('#pulseflowPolicy').inputValue(),'taste');await page.click('#settingsCloseBtn');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('pain_dj_vibes_v1')).items.find(v=>v.name==='Audit vibe').embedding.length),512);
  await page.click('.nav-item[data-view="home"]');await page.waitForSelector('.home-mix[aria-busy="false"]');
  const homeIds=()=>page.locator('.home-mix [data-home-action="mix"]').evaluateAll(rows=>rows.map(row=>row.dataset.id));
  const displayed=await homeIds();assert.equal(displayed.length,6,'real library must produce a Home preview');
  await page.click('[data-home-action="mix-play"]');
  for(let i=0;i<displayed.length;i++){
    if(i)await page.click('#bottomNextBtn');
    await page.waitForFunction(id=>painQueue.getCurrentTrack()?.id===id&&!PainPlayer.getAudio().paused&&PainPlayer.getAudio().currentTime>.05,displayed[i]);
    assert.deepEqual(await homeIds(),displayed,'the real-library Home sequence must stay visible and play in order');
  }
  await page.click('#bottomNextBtn');
  await page.waitForFunction(id=>painQueue.getCurrentTrack()?.id!==id&&!PainPlayer.getAudio().paused,displayed.at(-1));
  assert.deepEqual(await homeIds(),displayed);await page.screenshot({path:'/tmp/pain-home-real.png'});
  const after=await Promise.all(['library.json','stats.json','dj-state.json'].map(n=>fs.readFile(path.join(data,n),'utf8')));assert.deepEqual(after,before);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({mode:'taste',firstResponseMs,firstMethod,realPlayback:true,historyEvents:decision.historyEvents,savedEmbedding:512,explanation:true,persistence:true,homeSequential:6,homeContinued:true,copyUnchanged:true,errors}));
 }finally{await browser.close();service.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
