const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});try{
 for(const width of [320,390,768,1440])for(const route of ['/','/inside.html','/guide.html']){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto((process.env.PAIN_SITE_URL||'http://127.0.0.1:4173')+route);await page.waitForTimeout(180);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${route} overflows at ${width}`);
  if(route==='/'&&width===390){await page.click('.menu-toggle');assert.equal(await page.locator('#navigation').evaluate(e=>e.classList.contains('open')),true);await page.click('.menu-toggle');for(const name of ['library','together','insights','karaoke','sound','player']){await page.locator(`[data-screen="${name}"]`).click();await page.waitForFunction(()=>document.querySelector('#screen-panel').getAttribute('aria-busy')==='false');}await page.locator('#desktop-preview').click();await page.keyboard.press('Escape');}
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('Website: 12 viewport/page checks, mobile menu, six gallery screens and zoom passed.');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
