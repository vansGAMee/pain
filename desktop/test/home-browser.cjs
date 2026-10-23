// Isolated browser regression: all API routes are mocked. No live library access.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 try{
  for(const count of [0,1,100]){
   const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   const tracks=Array.from({length:count},(_,i)=>({id:String(i),title:'<img src=x onerror=alert(1)> '+('Длинноеназвание'.repeat(20)),artist:'Артист '+i,duration:180000,favorite:true}));
   await page.addInitScript(()=>{localStorage.setItem('pain_theme','form');localStorage.setItem('pain_lang','ru');localStorage.setItem('pain_reduced_motion','true');window.alert=()=>{throw Error('Unescaped metadata');};});
   await page.route('**/*',async route=>{
    const u=new URL(route.request().url());if(u.origin!=='http://home.test')return route.abort();
    if(u.pathname.startsWith('/api/')){
     const data=u.pathname==='/api/saved-library'?{tracks}:u.pathname==='/api/saved-stats'?{plays:[],slices:[]}:u.pathname==='/api/playlists'?[{id:'list',name:'<b>Мой плейлист</b>',trackIds:tracks.map(t=>t.id)}]:u.pathname==='/api/devices'?[]:{};
     if(u.pathname.startsWith('/api/cover/'))return route.fulfill({status:404,body:''});
     return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
    }
    const file=u.pathname.startsWith('/assets/')?path.join(__dirname,'..',u.pathname):path.join(__dirname,'../src',u.pathname==='/'?'index.html':u.pathname);
    const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.ttf':'font/ttf'};
    try{await route.fulfill({contentType:mime[path.extname(file)]||'application/octet-stream',body:await fs.readFile(file)});}catch(_){await route.fulfill({status:404,body:''});}
   });
   await page.goto('http://home.test');await page.waitForSelector('.home-mix[aria-busy="false"]');
   assert.equal(await page.locator('#view-home').evaluate(e=>getComputedStyle(e).opacity),'1','reduced motion must not freeze the view halfway');
   assert.equal(await page.locator('[data-home-action="mix-play"]').isDisabled(),count===0);
   assert.equal(await page.locator('.home-mix .home-track').count(),count?Math.min(count===1?1:count-1,6):0);
   assert.equal(await page.locator('#homeContent').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true,'long metadata fits the workspace');
   assert.equal(await page.locator('#homeContent [onerror]').count(),0);
   assert.equal(await page.locator('.home-playlist b').count(),0,'playlist names are escaped');
   assert.doesNotMatch(await page.locator('#homeContent').innerHTML(),/NaN|Infinity/);
   if(count===1){
    for(const view of ['insights','sync','joint-ai']){
     await page.evaluate(v=>location.hash=v,view);
     await page.waitForFunction(v=>document.querySelector('#view-'+v).classList.contains('active'),view);
     assert.equal(await page.locator('#view-'+view).evaluate(e=>e.scrollWidth<=e.clientWidth+2),true,view+' fits a narrow window');
    }
    await page.click('#eqToggleBtn');
    const bounds=await page.locator('.eq-modal-card').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=391);
    assert.equal(await page.locator('.eq-modal-card').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);
    await page.click('#eqCloseBtn');
    await page.evaluate(()=>location.hash='home');await page.waitForSelector('#view-home.active');
   }
   await page.fill('#searchInput','Артист');await page.waitForFunction(()=>document.querySelector('#view-library').classList.contains('active'));
   await page.locator('#formNavigation summary').click();await page.click('[data-form-view="home"]');
   assert.equal(await page.locator('#formNavigation').evaluate(e=>e.open),false);
   assert.equal(await page.locator('.views-viewport').evaluate(e=>e.scrollTop),0);
   await page.locator('#formNavigation summary').click();await page.click('[data-form-view="language"]');
   assert.match(await page.locator('.home-intro h1').textContent(),/Good/);
   await page.setViewportSize({width:1440,height:900});await page.locator('.sidebar [data-view="library"]').click();await page.goBack();
   await page.waitForFunction(()=>document.querySelector('#view-home').classList.contains('active'));
   // System reduced motion works independently of the app preference.
   await page.evaluate(()=>document.documentElement.removeAttribute('data-reduced-motion'));
   await page.emulateMedia({reducedMotion:'reduce'});
   assert.equal(await page.locator('#view-home').evaluate(e=>getComputedStyle(e).animationName),'none');
   assert.deepEqual(errors,[]);await context.close();
  }
  console.log('PASS: empty/one/100 songs, long and hostile metadata, covers, search, drawer, language, history navigation, reduced motion, narrow statistics/devices/Joint AI/EQ.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
