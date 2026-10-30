// Built Linux Electron app, including its real backend worker and ASAR assets.
const {_electron}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{fixture}=require('./together-fixture.cjs');
(async()=>{
 const f=await fixture(),root=path.join(f.root,'native');let app;
 try{
  await fs.cp(path.join(f.root,'host/data'),path.join(root,'data'),{recursive:true});await fs.cp(path.join(f.root,'host/cache'),path.join(root,'cache'),{recursive:true});
  const reserve=http.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));const base='http://127.0.0.1:'+port;
  const env={...process.env,PORT:String(port),PAIN_DATA_DIR:root,PAIN_USER_DATA_DIR:path.join(root,'profile'),PAIN_DISCOVERY:'false',PAIN_PULSEFLOW_AUTO_INDEX:'false'};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:path.resolve(__dirname,'../dist/native/linux-unpacked/pain'),args:['--ozone-platform=headless','--disable-gpu','--no-sandbox'],env});
  const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(20000);
  await page.addInitScript(()=>{localStorage.setItem('pain_theme','form-night');localStorage.setItem('pain_lang','ru');});await page.goto(base);await page.waitForFunction(()=>PainPlayer.getTracks().length===3);
  const r=await fetch(base+'/api/listen/control',{method:'POST',headers:{'Content-Type':'application/json','X-Pain-Update':'listen'},body:JSON.stringify({action:'settings',server:f.relayURL,name:'Native Linux'})});assert.equal(r.status,200);
  await page.click('.nav-item[data-view="home"]');await page.click('#togetherOpen');await page.click('#togetherCreate');await page.waitForFunction(()=>PainTogether.snapshot().connected);
  await page.click('#togetherCopy');await page.waitForFunction(()=>document.getElementById('togetherInviteOutput').value.startsWith('pain-listen:'));const invite=await page.locator('#togetherInviteOutput').inputValue();await f.call(1,'join',{invite});await f.wait(1,s=>s.connected);
  await page.locator('[data-together-add="host0"]').click();await page.locator('#togetherQueue [data-together-action="play"]').click();await page.waitForFunction(()=>!PainPlayer.getAudio().paused&&PainPlayer.getAudio().currentTime>.5);
  const s=await f.wait(1,s=>s.state.playback.uid),response=await fetch(f.bases[1]+'/api/listen/audio/'+s.state.playback.uid,{headers:{Range:'bytes=500-1999'}});assert.equal(response.status,206);assert.deepEqual(Buffer.from(await response.arrayBuffer()),f.body.subarray(500,2000));
  await page.click('#togetherLeave');await page.waitForFunction(()=>!PainTogether.active);await page.click('#togetherClose');await page.click('.nav-item[data-view="insights"]');await page.waitForSelector('.insight-figure');assert.equal(await page.locator('.insight-figure').count(),20);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({builtLinuxElectron:true,backendWorker:true,packagedAssets:true,roomControls:true,realPlayback:true,streamedToOtherApp:true,charts:20,errors}));
 }finally{await app?.close();await f.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
