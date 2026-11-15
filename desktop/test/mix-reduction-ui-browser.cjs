const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),{fixture}=require('./together-fixture.cjs');
(async()=>{
 const f=await fixture(),browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--autoplay-policy=no-user-gesture-required']});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   localStorage.setItem('pain_theme','noir');localStorage.setItem('pain_lang','ru');localStorage.setItem('pain_online_covers','false');localStorage.setItem('pain_track_transition','0');
   const connect=AudioNode.prototype.connect;window.testMeters=[];
   AudioNode.prototype.connect=function(target,...args){
    const result=connect.call(this,target,...args);
    if(target===this.context.destination){const meter=this.context.createAnalyser(),silent=this.context.createGain();silent.gain.value=0;connect.call(this,meter);connect.call(meter,silent);connect.call(silent,target);testMeters.push(meter);}
    return result;
   };
  });
  await page.goto(f.bases[0]+'/#library');await page.waitForSelector('#tracksTableBody tr');
  const toolbarButtons=await page.locator('.top-bar button').count();
  await page.locator('#tracksTableBody tr[data-track-id="host0"] .col-title').click();await page.waitForFunction(()=>!PainPlayer.getAudio().paused&&PainPlayer.getAudio().currentTime>.1);
  if(await page.locator('#trackInfoClose').isVisible())await page.click('#trackInfoClose');
  await page.click('#eqToggleBtn');assert.equal(await page.locator('.mix-reduction').getAttribute('open'),null);
  await page.locator('.mix-reduction summary').click();
  const level=()=>page.evaluate(()=>{const m=testMeters.at(-1),x=new Float32Array(m.fftSize);m.getFloatTimeDomainData(x);return Math.sqrt(x.reduce((s,v)=>s+v*v,0)/x.length);});
  await page.waitForTimeout(250);const before=await level();assert.ok(before>1e-5,'zero settings retain real audio');
  await page.locator('#mixVocal').fill('100');await page.locator('#mixVocal').dispatchEvent('input');await page.waitForTimeout(650);
  assert.ok(await level()<before*.12,'slider attenuates the actual app output');
  assert.equal(await page.locator('[data-mix-value="vocal"]').textContent(),'100%');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('pain_mix_reduction_v1')).vocal),100);
  await page.locator('.eq-toggle-switch .switch-label').click();await page.waitForTimeout(800);assert.ok(await level()>before*.9,'EQ power bypass restores real audio');
  assert.ok(await page.locator('#mixVocal').isDisabled());await page.locator('.eq-toggle-switch .switch-label').click();
  await page.locator('[data-preset="flat"]').click();assert.equal(await page.locator('#mixVocal').inputValue(),'0');
  await page.locator('#mixBass').fill('45');await page.locator('#mixBass').dispatchEvent('input');await page.reload();
  await page.click('#eqToggleBtn');await page.locator('.mix-reduction summary').click();assert.equal(await page.locator('#mixBass').inputValue(),'45');
  assert.equal(await page.locator('.top-bar button').count(),toolbarButtons);assert.equal(await page.locator('.mix-reduction button').count(),0);
  const shots=process.env.PAIN_MIX_SHOTS;if(shots)await fs.mkdir(shots,{recursive:true});
  for(const [width,height] of [[1280,900],[800,600],[390,844]]){
   await page.setViewportSize({width,height});
   const fits=await page.locator('.eq-modal-card').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1&&e.scrollWidth<=e.clientWidth+1;});
   assert.ok(fits,'EQ drawer fits '+width);
   await page.locator('#mixVocal').focus();await page.keyboard.press('Tab');
   assert.ok(await page.locator('#mixBass').evaluate(e=>document.activeElement===e&&getComputedStyle(e).outlineStyle!=='none'));
   if(shots)await page.screenshot({path:shots+'/'+width+'.png'});
  }
  await page.setViewportSize({width:1280,height:900});
  for(const theme of ['carbon','paper','sakura']){
   await page.click('#eqCloseBtn');await page.click('#settingsToggleBtn');
   await page.locator('input[name="appearanceTheme"][value="'+theme+'"]').locator('..').click();
   await page.click('#settingsDoneBtn');await page.click('#eqToggleBtn');
   assert.equal(await page.locator('#mixBass').inputValue(),'45');
   if(shots)await page.screenshot({path:shots+'/'+theme+'.png'});
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({actualAudio:true,zeroRetainsSound:true,powerBypass:true,flatReset:true,persistence:true,noToolbarButtonsAdded:true,widths:[1280,800,390],themes:['noir','carbon','paper','sakura'],errors}));
 }finally{await browser.close();await f.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
