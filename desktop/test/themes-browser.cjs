// Theme regression: saved settings, real playback, dark favorites and Home.
// All application data lives in the fixture's disposable directory.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),{fixture}=require('./together-fixture.cjs');
(async()=>{
 const f=await fixture(),browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--autoplay-policy=no-user-gesture-required']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('pain_theme','noir');localStorage.setItem('pain_lang','ru');localStorage.setItem('pain_online_covers','false');localStorage.setItem('pain_reduced_motion','true');});
  await page.goto(f.bases[0]);await page.waitForSelector('#view-home.active .home-turntable');
  const themes=await page.locator('input[name="appearanceTheme"]').evaluateAll(nodes=>nodes.map(n=>n.value));
  assert.deepEqual(themes.slice(-2),['noir','carbon']);
  const homeThemes=['form','form-night','sakura','noir','carbon'];
  for(const theme of themes){
   await page.setViewportSize({width:1440,height:960});
   if(await page.locator('#trackInfoClose').isVisible())await page.click('#trackInfoClose');
   await page.click('#settingsToggleBtn');await page.locator(`input[name="appearanceTheme"][value="${theme}"]`).locator('..').click();await page.click('#settingsDoneBtn');
   assert.equal(await page.evaluate(()=>localStorage.getItem('pain_theme')),theme);
   for(const width of [1440,800,390]){
    await page.setViewportSize({width,height:960});
    for(const view of [...(homeThemes.includes(theme)?['home']:[]),'library','favorites','player']){
     const nav=page.locator(`.sidebar .nav-item[data-view="${view}"]`);
     if(await nav.isVisible())await nav.click();
     else {await page.locator('#formNavigation summary').click();await page.locator(`[data-form-view="${view}"]`).click();}
     await page.waitForSelector(`#view-${view}.active`);
     if(['noir','carbon'].includes(theme))assert.ok(await page.locator('.views-viewport').evaluate(e=>e.scrollWidth<=e.clientWidth+1),`${theme}/${view}/${width} overflow`);
     if(view==='favorites'&&['noir','carbon'].includes(theme)){
      const color=await page.locator('#view-favorites .tracks-table-wrapper').evaluate(e=>getComputedStyle(e).backgroundColor);
      const rgb=color.match(/[\d.]+/g).map(Number);
      assert.ok(rgb[3]===0||Math.max(...rgb.slice(0,3))<65,`${theme}: favorites must stay dark: ${color}`);
     }
    }
   }
  }
  await page.setViewportSize({width:1440,height:960});
  await page.click('#settingsToggleBtn');await page.locator('input[value="noir"][name="appearanceTheme"]').locator('..').click();await page.click('#settingsDoneBtn');
  await page.click('.sidebar [data-view="home"]');await page.reload();await page.waitForSelector('#view-home.active .home-turntable');
  assert.equal(await page.locator('html').getAttribute('data-theme'),'noir');
  await page.click('.sidebar [data-view="library"]');await page.click('#homeBrand');await page.waitForSelector('#view-home.active');
  await page.locator('.home-turntable').click();await page.waitForFunction(()=>!PainPlayer.getAudio().paused&&PainPlayer.getAudio().currentTime>0);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({themes:themes.length,widths:[1440,800,390],darkFavorites:true,homeAndBrand:true,savedTheme:true,realPlayback:true,errors}));
 }finally{await browser.close();await f.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
