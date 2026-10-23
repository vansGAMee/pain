// Isolated fixtures: no server, actual library, playback files or account state.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const Audio=require('../src/audio-profile');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 try {
  const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const tracks=['a','b','c'].map(id=>({id,title:'Трек '+id,artist:'Исполнитель '+id,duration:180000}));
  const profiles=Object.fromEntries(tracks.map(t=>[t.id,{version:4,signature:Audio.signature(t),frames:48,seconds:24,
   positions:Array.from({length:48},(_,i)=>i),vector:[.4,.1,.7,.2,.25,.1],variance:Array(6).fill(.01),
   timbre:Array(12).fill(.2+(t.id.charCodeAt(0)-97)*.01),timbreVariance:Array(12).fill(.001)}]));
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.pathname.startsWith('/api/')){
    const data=u.pathname==='/api/saved-library'?{tracks}:u.pathname==='/api/saved-stats'?{plays:[],slices:[]}:u.pathname==='/api/cached-tracks'?{cached:[]}:u.pathname==='/api/playlists'||u.pathname==='/api/devices'?[]:{};
    return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
   }
   if(u.origin!=='http://pain.test')return route.abort();
   const file=u.pathname.startsWith('/assets/')?path.join(__dirname,'..',u.pathname):path.join(__dirname,'../src',u.pathname==='/'?'index.html':u.pathname);
   const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.ttf':'font/ttf'};
   try {await route.fulfill({contentType:mime[path.extname(file)]||'application/octet-stream',body:await fs.readFile(file)});}
   catch (_) {await route.fulfill({status:404,body:''});}
  });
  await page.addInitScript(profiles=>{
   if(!localStorage.getItem('test_initialized')){
    localStorage.setItem('test_initialized','1');localStorage.setItem('pain_lang','ru');
    localStorage.setItem('pain_shuffle_mode','smart');localStorage.setItem('pain_audio_profiles_v4',JSON.stringify(profiles));
   }
  },profiles);
  await page.goto('http://pain.test');
  await page.waitForFunction(()=>window.painQueue?.getCurrentTrack());
  await page.click('#bottomTrackContext');
  assert.equal(await page.locator('#djSave').isEnabled(),true);
  assert.match(await page.locator('#djReason').textContent(),/из очереди/);
  await page.fill('#djVibeName','Ночной маршрут');
  const draftSource=await page.locator('#djTrack').textContent();
  await page.evaluate(()=>painQueue.next());
  assert.match(await page.locator('#djVibeHint').textContent(),/Трек a/);
  assert.equal(await page.locator('#djVibeName').inputValue(),'Ночной маршрут');
  const beforeSave=await page.evaluate(()=>({id:painQueue.getCurrentTrack().id,history:[...painQueue.playedHistory]}));
  await page.click('#djSave');
  await page.click('#djSave');
  assert.equal(await page.locator('.dj-vibe-select[aria-pressed="true"]').count(),1);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('pain_dj_vibes_v1')).items.length),1);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('pain_dj_vibes_v1')).items[0].source),draftSource);
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('pain_dj_vibes_v1')).items[0].profile),profiles.a);
  assert.deepEqual(await page.evaluate(()=>({id:painQueue.getCurrentTrack().id,history:[...painQueue.playedHistory]})),beforeSave);
  await page.locator('.dj-vibe-select').focus();
  await page.evaluate(()=>painQueue.setLoopMode('all'));
  assert.equal(await page.locator('.dj-vibe-select').evaluate(b=>b===document.activeElement),true);
  await page.keyboard.press('Escape');assert.equal(await page.locator('#djDialog').evaluate(d=>d.open),false);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'bottomTrackContext');
  await page.reload();await page.waitForFunction(()=>window.painQueue?.getCurrentTrack());
  assert.equal(await page.evaluate(()=>!!painQueue.vibeProfile),true);
  await page.evaluate(()=>painQueue.setShuffleMode('off'));
  await page.click('#bottomTrackContext');
  assert.match(await page.locator('#djActive').textContent(),/На паузе/);
  await page.click('#djClose');
  await page.evaluate(()=>{window.fixtureTracks=painQueue.tracks;painQueue.refreshLibrary([],false);});
  await page.click('#bottomTrackContext');
  assert.equal(await page.locator('#djRelease').isVisible(),true);
  assert.equal(await page.locator('#djSave').isDisabled(),true);
  assert.equal(await page.locator('#djReason').textContent(),'Нет текущего трека.');
  await page.click('#djClose');
  await page.evaluate(()=>painQueue.setContext('library',window.fixtureTracks));
  await page.evaluate(()=>painQueue.setShuffleMode('smart'));
  await page.evaluate(()=>painQueue.next());
  await page.click('#bottomTrackContext');
  assert.match(await page.locator('#djReason').textContent(),/сохранённому вайбу/);
  for(const [width,height,theme] of [[1280,800,'paper'],[900,700,'dark'],[380,620,'paper']]){
   await page.setViewportSize({width,height});await page.evaluate(theme=>document.documentElement.setAttribute('data-theme',theme),theme);
   const bounds=await page.locator('#djDialog').boundingBox();assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=width&&bounds.y+bounds.height<=height);
   assert.equal(await page.locator('#djDialog').evaluate(d=>d.scrollWidth<=d.clientWidth),true);
   if(process.env.PAIN_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.PAIN_SCREENSHOT_DIR,`pain-vibe-${width}-${theme}.png`)});
  }
  await page.setViewportSize({width:1280,height:800});
  await page.evaluate(()=>{window.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='pain_dj_vibes_v1')throw new Error('Quota');return window.originalSetItem.call(this,k,v);};});
  await page.click('#djRelease');assert.match(await page.locator('#djStatus').textContent(),/Не удалось/);
  assert.equal(await page.evaluate(()=>!!painQueue.vibeProfile),true);
  await page.evaluate(()=>Storage.prototype.setItem=window.originalSetItem);
  await page.click('#djRelease');assert.equal(await page.evaluate(()=>painQueue.vibeProfile),null);
  await page.click('.dj-vibe-select');assert.equal(await page.evaluate(()=>!!painQueue.vibeProfile),true);
  await page.click('.dj-vibe-row .dj-text-button');assert.equal(await page.evaluate(()=>painQueue.vibeProfile),null);
  await page.evaluate(()=>{delete painQueue.audioProfiles[painQueue.getCurrentTrack().id];document.querySelector('audio').dispatchEvent(new Event('timeupdate'));});
  assert.equal(await page.locator('#djSave').isEnabled(),true,'the captured draft survives cache eviction');
  await page.click('#djClose');await page.click('#bottomTrackContext');
  assert.equal(await page.locator('#djSave').isDisabled(),true);
  await page.click('#djClose');await page.click('#langToggle');await page.click('#bottomTrackContext');
  assert.equal(await page.locator('#djWhyLabel').textContent(),'Why this track');
  assert.doesNotMatch(await page.locator('#djReason').textContent(),/[А-Яа-я]/);
  // Names containing the label are data, not delimiters to parse.
  await page.evaluate(()=>painQueue.setContext('playlist',painQueue.tracks,0,'Mix · Smart DJ / evening'));
  assert.match(await page.locator('#bottomTrackContext').textContent(),/^Mix · Smart DJ \/ evening/);
  await page.evaluate(()=>localStorage.setItem('pain_dj_vibes_v1','{broken'));
  await page.reload();await page.waitForFunction(()=>window.painQueue?.getCurrentTrack());
  assert.equal(await page.evaluate(()=>painQueue.vibeProfile),null);
  assert.deepEqual(errors,[]);
  console.log('PASS: saved vibe, reload, truthful reasons, release, delete, quota failure, missing sound, RU/EN, Escape/focus, responsive paper/dark dialog');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
