const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{} )});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',route=>{
   const p=new URL(route.request().url()).pathname;
   const data=p==='/api/saved-library'?{tracks:[]}:p==='/api/saved-stats'?{plays:[],slices:[]}:p==='/api/cached-tracks'?{cached:[]}:[];
   return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  const config=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('pain_eq_config')));
  await page.goto(process.env.PAIN_TEST_URL||'http://localhost:3210');
  await page.click('#eqToggleBtn');await page.click('[data-preset="bass"]');
  const manual=await config();await page.click('#eqCloseBtn');
  await page.click('#sidebarSettingsBtn');await page.locator('label[for="autoEqSwitch"]').click();await page.click('#settingsDoneBtn');
  await page.click('#eqToggleBtn');
  assert.equal(await page.locator('#eqSliderPreamp').isDisabled(),true);
  // Disabling auto restores the old power state internally; OFF must still win.
  await page.locator('#eqPowerSwitch').evaluate(input=>input.click());
  let saved=await config();assert.equal(saved.auto,false);assert.equal(saved.enabled,false);
  assert.deepEqual(saved.bands,manual.bands);assert.equal(saved.preamp,manual.preamp);
  assert.equal(await page.locator('#eqPowerSwitch').isChecked(),false);
  assert.equal(await page.locator('#eqSliderPreamp').isDisabled(),false);
  await page.reload();await page.click('#eqToggleBtn');assert.equal(await page.locator('#eqPowerSwitch').isChecked(),false);
  await page.click('#eqCloseBtn');await page.click('#sidebarSettingsBtn');
  await page.locator('label[for="autoEqSwitch"]').click();await page.locator('label[for="autoEqSwitch"]').click();
  saved=await config();assert.equal(saved.enabled,false);assert.deepEqual(saved.bands,manual.bands);
  assert.deepEqual(errors,[]);
  console.log('PASS: EQ power off in auto mode, restored manual gains, persistence and repeated toggles');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
