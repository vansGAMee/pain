// Actual Electron playback and the user's running desktop Discord, isolated PAIN data.
const {_electron}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const root=fs.mkdtempSync(path.resolve(__dirname,'../.discord-browser-')),source=path.resolve(__dirname,'../data'),library=JSON.parse(fs.readFileSync(path.join(source,'library.json')));
 for(const dir of ['data','cache','covers'])fs.mkdirSync(path.join(root,dir));
 for(const name of fs.readdirSync(source))if(name.endsWith('.json'))fs.copyFileSync(path.join(source,name),path.join(root,'data',name));
 for(const kind of ['cache','covers'])for(const name of fs.readdirSync(path.resolve(__dirname,'..',kind)))if(fs.statSync(path.resolve(__dirname,'..',kind,name)).isFile())fs.linkSync(path.resolve(__dirname,'..',kind,name),path.join(root,kind,name));
 for(const name of ['genre-preferences','lyrics-preferences','discord-presence'])fs.writeFileSync(path.join(root,'data',name+'.json'),JSON.stringify({enabled:false}));
 let app;const errors=[];
 try{
  const env={...process.env,PAIN_DATA_DIR:root,PAIN_USER_DATA_DIR:path.join(root,'profile'),PAIN_DISCOVERY:'false',PAIN_PULSEFLOW_AUTO_INDEX:'false',PAIN_RPC_DEBUG:'true',PORT:'3199'};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:require('electron'),args:[path.resolve(__dirname,'..')],env});const page=await app.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
  async function waitStatus(predicate){const end=Date.now()+25000;let status;while(Date.now()<end){status=await page.evaluate(()=>fetch('/api/discord-presence').then(r=>r.json()));if(status.error)throw Error(status.error);if(predicate(status))return status;await page.waitForTimeout(100);}throw Error('Discord state timed out: '+JSON.stringify(status));}
  app.process().stdout.on('data',b=>{for(const line of b.toString().split('\n'))if(line.includes('[DiscordRPC]'))console.log(line);});
  await app.evaluate(({BrowserWindow})=>{globalThis.testUnresponsive=0;BrowserWindow.getAllWindows()[0].webContents.setAudioMuted(true);BrowserWindow.getAllWindows()[0].on('unresponsive',()=>globalThis.testUnresponsive++);});
  await page.addInitScript(()=>{localStorage.setItem('pain_theme','form-night');localStorage.setItem('pain_lang','ru');localStorage.setItem('pain_phone_url','http://127.0.0.1:9');});
  await page.route('**/api/sync-*',route=>{if(new URL(route.request().url()).pathname==='/api/sync-phone')return route.fulfill({status:503,json:{}});const data=route.request().postDataJSON();return route.continue({postData:JSON.stringify({...data,phoneUrl:'http://127.0.0.1:9'})});});
  await page.route('**/api/track-info/**',r=>r.fulfill({json:{articles:[],cards:[],plays:0}}));await page.route('**/api/track-rating/**',r=>r.fulfill({json:{rating:null,reason:'unrated'}}));
  await page.reload();await page.waitForFunction(n=>window.painQueue?.tracks.length===n,library.tracks.length);
  await page.click('.nav-item[data-view="library"]');const song=library.tracks.find(t=>t.title==='Everlong');await page.locator(`tr[data-track-id="${song.id}"]`).click();await page.waitForFunction(()=>window.PainPlayer.getAudio().currentTime>1&&!window.PainPlayer.getAudio().paused);
  await page.click('#settingsToggleBtn');await page.locator('#discordPresenceSwitch').locator('..').scrollIntoViewIfNeeded();await page.locator('#discordPresenceSwitch').locator('..').click();assert.equal(await page.locator('#discordPresenceSwitch').isChecked(),true);
  const live=await waitStatus(s=>s.connected&&s.published&&s.publishedTrack===song.title);
  assert.equal(live.applicationId,'1565047962818838568');assert.equal(live.published,true);await page.screenshot({path:'/tmp/pain-discord-settings.png'});await page.click('#settingsDoneBtn');
  assert.equal(live.publishedTrack,song.title);
  const switched=[];
  for(const title of ['Jigsaw Falling Into Place','Тоска']){
   const selected=library.tracks.find(t=>t.title===title);assert.ok(selected);
   await page.locator(`tr[data-track-id="${selected.id}"]`).click();
   await page.waitForFunction(id=>window.PainPlayer.getTrack()?.id===id,selected.id);
   await waitStatus(s=>s.publishedTrack===title);
   switched.push(title);
  }
  await page.click('#bottomPlayBtn');await page.waitForFunction(()=>window.PainPlayer.getAudio().paused);await waitStatus(s=>s.publishedState?.startsWith('⏸')&&!s.publishedTimestamps);
  await page.click('#bottomPlayBtn');await page.evaluate(()=>window.PainPlayer.getAudio().currentTime=45);await waitStatus(s=>s.publishedTimestamps&&Math.abs(s.publishedTimestamps.start-(Date.now()/1000-45))<2);
  await page.click('#settingsToggleBtn');await page.locator('#discordPresenceSwitch').locator('..').click();await waitStatus(s=>!s.enabled&&!s.published);await page.click('#settingsDoneBtn');
  const before=page.url();await page.evaluate(()=>location.href='file:///tmp/pain-navigation-test');await page.waitForTimeout(200);assert.equal(page.url(),before);
  assert.ok(await page.evaluate(()=>!window.PainPlayer.getAudio().paused),'external pages cannot replace or stop the player');
  const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  for(const view of ['home','insights','favorites','library']){await page.click(`.nav-item[data-view="${view}"]`);assert.ok(await page.locator('#view-'+view).isVisible());}
  await page.waitForSelector('#view-library.active');assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'form-night');assert.deepEqual(errors,[]);assert.equal(await app.evaluate(()=>globalThis.testUnresponsive),0);
  console.log(JSON.stringify({tracks:library.tracks.length,discord:live,switched,pausedAndSeek:'accepted',disabled:'cleared',audio:'uninterrupted except intentional pause',navigation:'external pages denied',cpuSlowdown:4,unresponsive:0,errors}));
 }catch(e){if(app){const page=await app.firstWindow();console.log('DISCORD DEBUG',await page.evaluate(()=>fetch('/api/discord-presence').then(r=>r.json())).catch(()=>null));console.log('ERRORS',errors);await page.screenshot({path:'/tmp/pain-discord-failure.png'}).catch(()=>{});}throw e;}
 finally{if(app)await app.close();fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
