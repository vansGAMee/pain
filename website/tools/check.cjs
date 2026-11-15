const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});try{
 for(const width of [320,390,768,1440])for(const route of ['/','/inside.html','/guide.html']){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto((process.env.PAIN_SITE_URL||'http://127.0.0.1:4173')+route);await page.waitForTimeout(180);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${route} overflows at ${width}`);
  if(route==='/'&&width===390){await page.click('.menu-toggle');assert.equal(await page.locator('#navigation').evaluate(e=>e.classList.contains('open')),true);await page.click('.menu-toggle');for(const name of ['library','together','insights','karaoke','sound','player']){await page.locator(`[data-screen="${name}"]`).click();await page.waitForFunction(()=>document.querySelector('#screen-panel').getAttribute('aria-busy')==='false');}await page.locator('#desktop-preview').click();await page.keyboard.press('Escape');}
  if(route==='/'&&[390,1440].includes(width)){
   assert.equal(await page.locator('#themes').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(16, 17, 16)');
   assert.ok(await page.locator('[data-preview-theme="noir"]').evaluate(e=>e.getBoundingClientRect().height>=44));
   await page.locator('#theme-preview').scrollIntoViewIfNeeded();await page.locator('#theme-preview').evaluate(e=>e.decode());
   await page.locator('#themes').evaluate(e=>window.scrollTo(0,e.getBoundingClientRect().top+scrollY-80));
   if(process.env.PAIN_SITE_SHOTS)await page.locator('#themes').screenshot({path:process.env.PAIN_SITE_SHOTS+`/themes-${width}.png`});
  }
  if(route==='/'&&width===1440){
   for(const theme of ['noir','carbon','sakura','form-night','paper','dark','studio','spotify','stereo','form']){
    await page.locator(`[data-preview-theme="${theme}"]`).click();
    await page.waitForFunction(t=>document.querySelector('.theme-gallery').dataset.currentTheme===t&&document.querySelector('.theme-gallery').getAttribute('aria-busy')==='false'&&document.getElementById('theme-preview').complete,theme);
    assert.ok(await page.locator('#theme-preview').evaluate(e=>e.complete&&e.naturalWidth>0));
   }
   await page.locator('.theme-screen').click();assert.ok(await page.locator('.lightbox').evaluate(e=>e.open));await page.keyboard.press('Escape');
   for(const screen of ['overview','charts','patterns']){
    await page.locator(`[data-statistics-screen="${screen}"]`).click();
    await page.waitForFunction(value=>document.querySelector('.statistics-frame').dataset.currentScreen===value&&document.querySelector('.statistics-frame').getAttribute('aria-busy')==='false'&&document.getElementById('statistics-preview').complete,screen);
    assert.ok(await page.locator('#statistics-preview').evaluate(e=>e.complete&&e.naturalWidth>0));
   }
  }
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('Website: 12 viewport/page checks, mobile menu, six gallery screens and zoom passed.');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
