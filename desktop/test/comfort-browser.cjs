// Runs against fixtures only: no user files, server or listening history.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1000,height:700}}),errors=[],records=[];
  page.on('pageerror',e=>errors.push(e.message));
  const tracks=['a','b'].map(id=>({id,title:'Трек '+id,artist:'Исполнитель',duration:30000}));
  const wav=Buffer.alloc(44+16000*30*2);
  wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);
  wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);
  wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
  for(let i=0;i<16000*30;i++)wav.writeInt16LE(Math.round(1000*Math.sin(i*2*Math.PI*440/16000)),44+i*2);
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.pathname.startsWith('/api/cached-track/'))return route.fulfill({contentType:'audio/wav',body:wav});
   if(u.pathname.startsWith('/api/')){
    if(u.pathname==='/api/sync-stats')records.push(route.request().postDataJSON().play);
    const data=u.pathname==='/api/saved-library'?{tracks}:u.pathname==='/api/saved-stats'?{plays:[],slices:[]}:u.pathname==='/api/cached-tracks'?{cached:[]}:[];
    return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
   }
   if(u.origin!=='http://pain.test')return route.abort();
   const file=u.pathname.startsWith('/assets/')?path.join(__dirname,'..',u.pathname):path.join(__dirname,'../src',u.pathname==='/'?'index.html':u.pathname);
   const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.ttf':'font/ttf'};
   try{await route.fulfill({contentType:mime[path.extname(file)]||'application/octet-stream',body:await fs.readFile(file)});}catch(_){await route.fulfill({status:404,body:''});}
  });
  await page.addInitScript(()=>localStorage.setItem('pain_lang','ru'));
  await page.goto('http://pain.test');await page.waitForFunction(()=>painQueue?.tracks.length===2);
  await page.click('#settingsToggleBtn');
  assert.equal(await page.isChecked('#saveHistorySwitch'),true);
  await page.locator('#volumeLimitSlider').fill('55');
  await page.locator('label[for="reducedMotionSwitch"]').click();
  await page.locator('label[for="saveHistorySwitch"]').click();
  await page.click('#settingsDoneBtn');
  await page.click('#bottomMuteBtn');await page.click('#bottomMuteBtn');
  assert.equal(await page.locator('audio').evaluate(a=>a.volume),.55,'unmute respects ceiling');
  await page.reload();await page.waitForFunction(()=>painQueue?.tracks.length===2);
  assert.equal(await page.locator('audio').evaluate(a=>a.volume),.55,'ceiling survives restart');
  assert.equal(await page.locator('html').getAttribute('data-reduced-motion'),'');
  await page.click('#bottomPlayBtn');await page.waitForFunction(()=>document.querySelector('audio').currentTime>1.5);
  await page.click('#bottomNextBtn');await page.waitForFunction(()=>document.querySelector('audio').currentTime>1.5);
  assert.equal(records.length,0,'private listening and skips stay out of history');
  assert.equal(await page.evaluate(()=>localStorage.getItem('pain_taste_skips')),null);
  await page.click('#settingsToggleBtn');await page.locator('label[for="saveHistorySwitch"]').click();await page.click('#settingsDoneBtn');
  const resumedAt=await page.locator('audio').evaluate(a=>a.currentTime);
  await page.waitForFunction(start=>document.querySelector('audio').currentTime>start+1.5,resumedAt);
  await Promise.all([page.waitForResponse(r=>r.url().includes('/api/sync-stats')),page.click('#bottomNextBtn')]);
  assert.equal(records.length,1);assert.ok(records[0].heard>=1000&&records[0].heard<2500,'private part is not backfilled');
  await page.locator('audio').evaluate(a=>a.pause());
  await page.click('#settingsToggleBtn');
  for(const [width,height,theme] of [[1000,700,'paper'],[390,640,'dark']]){
   await page.setViewportSize({width,height});await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme);
   await page.locator('#saveHistorySwitch').scrollIntoViewIfNeeded();
   assert.equal(await page.locator('.settings-modal-card').evaluate(e=>e.scrollWidth<=e.clientWidth),true);
   const bounds=await page.locator('#settingsDoneBtn').boundingBox();assert.ok(bounds.y>=0&&bounds.y+bounds.height<=height);
   if(process.env.PAIN_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.PAIN_SCREENSHOT_DIR,`comfort-${theme}.png`)});
  }
  assert.deepEqual(errors,[]);console.log('PASS: volume ceiling, unmute/reload, reduced motion, private history, resume without backfill, responsive settings');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
