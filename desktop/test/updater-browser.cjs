// Entire UI flow with isolated HTTP fixtures; never starts an installer.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('pain_theme','form-night');localStorage.setItem('pain_performance_mode','balanced');localStorage.setItem('pain_lang','en');});
  let installs=0,polls=0,updated=false,finishInstall;
  const status=()=>({currentVersion:updated?'1.5.1':'1.5.0',latestVersion:'1.5.1',status:updated?'error':'ready',available:!updated,canInstall:!updated});
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.pathname==='/api/install-update'){
    installs++;
    await new Promise(resolve=>finishInstall=resolve);
    if(installs===1)return route.fulfill({status:500,json:{error:'Checksum mismatch'}});
    return route.fulfill({json:{...status(),status:'downloaded'}});
   }
   if(u.pathname==='/api/update-status'){
    if(installs===2&&!updated){polls++;if(polls===1)return route.abort();updated=true;}
    return route.fulfill({json:status()});
   }
   if(u.pathname.startsWith('/api/'))return route.fulfill({json:u.pathname==='/api/saved-library'?{tracks:[]}:u.pathname==='/api/saved-stats'?{plays:[],slices:[]}:u.pathname==='/api/cached-tracks'?{cached:[]}:[]});
   if(u.origin!=='http://pain.test')return route.abort();
   const file=u.pathname.startsWith('/assets/')?path.join(__dirname,'..',u.pathname):path.join(__dirname,'../src',u.pathname==='/'?'index.html':u.pathname);
   try{await route.fulfill({contentType:{'.html':'text/html','.js':'application/javascript','.css':'text/css','.ttf':'font/ttf','.png':'image/png'}[path.extname(file)]||'application/octet-stream',body:await fs.readFile(file)});}
   catch(_){await route.fulfill({status:404,body:''});}
  });
  await page.goto('http://pain.test');
  await page.evaluate(()=>localStorage.setItem('pain_favorite_moments','{"keep":42}'));
  await page.click('#sidebarSettingsBtn');await page.waitForFunction(()=>document.querySelector('#updateActionBtn').textContent==='Update');
  await page.click('#updateActionBtn');
  await page.waitForFunction(()=>document.querySelector('#updateScreen').open&&document.querySelector('#updateScreen').dataset.phase==='downloading');
  assert.equal(await page.locator('#updateScreenProgress').getAttribute('aria-valuenow'),null,'unknown progress must not show fake percentages');
  const orbit=page.locator('#updateScreen .update-orbit');
  const first=await orbit.evaluate(e=>getComputedStyle(e).transform);
  await page.waitForTimeout(150);
  assert.notEqual(await orbit.evaluate(e=>getComputedStyle(e).transform),first,'the update mark actually moves in balanced mode');
  await page.screenshot({path:'/tmp/pain-update-preview.png'});
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await orbit.evaluate(e=>e.getAnimations().length),0,'OS reduced motion disables the animation');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.locator('#updateActionBtn').evaluate(b=>b.click());assert.equal(installs,1,'duplicate update clicks do not start a second request');
  finishInstall();await page.waitForFunction(()=>document.querySelector('#updateScreen').dataset.phase==='error');
  assert.equal(await orbit.evaluate(e=>e.getAnimations().length),0,'failure stops the loading animation');
  await page.click('#updateScreenAction');await page.waitForFunction(()=>document.querySelector('#updateActionBtn').textContent==='Update');
  assert.equal(installs,1,'retry must recheck, not repeat a stale installation');
  const reloaded=page.waitForEvent('framenavigated',{predicate:f=>f===page.mainFrame()});
  await page.click('#updateScreenAction');
  await page.waitForFunction(()=>document.querySelector('#updateScreen').dataset.phase==='downloading');
  await page.waitForFunction(()=>document.querySelector('#updateActionBtn').disabled);
  await page.locator('#updateActionBtn').evaluate(b=>b.click());
  finishInstall();await page.waitForFunction(()=>document.querySelector('#updateScreen').dataset.phase==='restarting');
  await page.keyboard.press('Escape');assert.ok(await page.locator('#updateScreen').evaluate(e=>e.open),'Escape cannot cancel a restart already in progress');
  await reloaded;await page.waitForLoadState('domcontentloaded');
  assert.equal(installs,2);assert.equal(updated,true);
  assert.equal(await page.evaluate(()=>localStorage.getItem('pain_favorite_moments')),'{"keep":42}');
  assert.deepEqual(errors,[]);
  assert.equal(await page.locator('#updateScreen').evaluate(e=>e.open),false,'the new version does not reopen the update screen');
  console.log('PASS: animated update screen, reduced motion, failure/recheck, duplicate click blocked, restart disconnect, new-version reload, preferences preserved');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
