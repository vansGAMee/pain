const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',route=>{
   const path=new URL(route.request().url()).pathname;
   const data=path==='/api/saved-library'?{tracks:[]}:path==='/api/saved-stats'?{plays:[],slices:[]}:path==='/api/cached-tracks'?{cached:[]}:[];
   return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto(process.env.PAIN_TEST_URL||'http://localhost:3099');
  await page.click('#settingsToggleBtn');
  assert.equal(await page.isChecked('#smartVolumeSwitch'),false);
  assert.equal(await page.isDisabled('#backgroundDuckSwitch'),true);
  await page.locator('label[for="smartVolumeSwitch"]').click();await page.locator('label[for="backgroundDuckSwitch"]').click();
  await page.reload();await page.click('#settingsToggleBtn');
  assert.equal(await page.isChecked('#smartVolumeSwitch'),true);
  assert.equal(await page.isChecked('#backgroundDuckSwitch'),false);
  await page.setViewportSize({width:1000,height:650});
  const bounds=await page.locator('#settingsDoneBtn').boundingBox();
  assert.ok(bounds.y>=0&&bounds.y+bounds.height<=650,'settings remain inside the viewport');
  const result=await page.evaluate(async()=>{
   async function measure(enabled,background=false,duck=true){
    const rate=44100,ctx=new OfflineAudioContext(1,rate*4,rate),src=ctx.createBufferSource();
    const buffer=ctx.createBuffer(1,rate*4,rate),data=buffer.getChannelData(0);
    for(let i=0;i<data.length;i++)data[i]=(i<rate*1.5?.04:.6)*Math.sin(2*Math.PI*440*i/rate);
    src.buffer=buffer;const volume=SmartVolume.create(ctx);volume.update(enabled,duck,background);
    src.connect(volume.input);volume.output.connect(ctx.destination);src.start();
    const rendered=(await ctx.startRendering()).getChannelData(0);
    const rms=(a,b)=>{let energy=0;for(let i=a*rate;i<b*rate;i++)energy+=rendered[i]**2;return Math.sqrt(energy/((b-a)*rate));};
    return {quiet:rms(.8,1.2),loud:rms(2.5,3)};
   }
   return {off:await measure(false),on:await measure(true),ducked:await measure(true,true),unducked:await measure(true,true,false)};
  });
  assert.ok(Math.abs(result.off.loud-.6/Math.sqrt(2))<.005,'disabled mode preserves level');
  assert.ok(result.on.loud/result.on.quiet<result.off.loud/result.off.quiet*.5,'loudness gap is reduced');
  assert.ok(result.ducked.loud/result.on.loud>.29&&result.ducked.loud/result.on.loud<.31,'background duck level');
  assert.ok(Math.abs(result.unducked.loud-result.on.loud)<.001,'optional duck can be disabled');
  assert.deepEqual(errors,[]);
  console.log('PASS: real audio compression, unity when disabled, optional background duck, settings persistence');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
