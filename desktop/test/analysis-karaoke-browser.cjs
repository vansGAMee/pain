// Saved library and real local audio in an isolated desktop profile.
const {_electron}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const root=fs.mkdtempSync(path.resolve(__dirname,'../.karaoke-browser-')),source=path.resolve(__dirname,'../data'),library=JSON.parse(fs.readFileSync(path.join(source,'library.json')));
 library.tracks.push({id:'test-missing-audio',title:'Unavailable test song',artist:'Test fixture',duration:180000,bytes:123456});
 fs.mkdirSync(path.join(root,'data'));fs.mkdirSync(path.join(root,'cache'));fs.mkdirSync(path.join(root,'data/pulseflow'));
 for(const name of ['library.json','stats.json','dj-state.json','performance-mode.json'])fs.copyFileSync(path.join(source,name),path.join(root,'data',name));
 fs.writeFileSync(path.join(root,'data/library.json'),JSON.stringify(library));
 for(const name of ['status.json','input.json','errors.json'])fs.copyFileSync(path.join(source,'pulseflow',name),path.join(root,'data/pulseflow',name));
 fs.writeFileSync(path.join(root,'data/genre-preferences.json'),JSON.stringify({enabled:false}));
 fs.writeFileSync(path.join(root,'data/lyrics-preferences.json'),JSON.stringify({enabled:false}));
 for(const name of fs.readdirSync(path.resolve(__dirname,'../cache')))if(name.endsWith('.mp3'))fs.linkSync(path.resolve(__dirname,'../cache',name),path.join(root,'cache',name));
 const [a,b]=library.tracks.filter(t=>t.mime==='audio/mpeg'&&fs.existsSync(path.join(root,'cache',t.id.replace(/[/\\?%*:|"<>]/g,'_')+'.mp3')));
 let app;
 try{
  const env={...process.env,PAIN_DATA_DIR:root,PAIN_USER_DATA_DIR:path.join(root,'profile'),PAIN_DISCOVERY:'false',PAIN_PULSEFLOW_AUTO_INDEX:'false',PORT:'3194'};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:require('electron'),args:[path.resolve(__dirname,'..')],env});const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
  await page.addInitScript(()=>{localStorage.setItem('pain_theme','form');localStorage.setItem('pain_lang','ru');localStorage.setItem('pain_track_transition','0');window.karaokeTasks=[];new PerformanceObserver(l=>window.karaokeTasks.push(...l.getEntries().map(e=>e.duration))).observe({type:'longtask',buffered:true});});
  await page.reload();await page.waitForFunction(n=>window.painQueue?.tracks.length===n,library.tracks.length);
  await app.evaluate(({BrowserWindow})=>{globalThis.karaokeUnresponsive=0;BrowserWindow.getAllWindows()[0].on('unresponsive',()=>globalThis.karaokeUnresponsive++);});
  await page.click('#settingsToggleBtn');await page.waitForFunction(()=>document.getElementById('pulseflowStatus').textContent.includes('771'));
  const pf=await page.evaluate(()=>fetch('/api/pulseflow/status').then(r=>r.json()));assert.equal(pf.total,library.tracks.length);assert.ok(pf.unavailable.length>0);assert.ok((await page.locator('#pulseflowMissing').innerText()).includes(pf.unavailable[0].title));
  assert.equal(await page.locator('#audioAnalysisSettingsSection').getAttribute('open'),null);await page.click('#audioAnalysisSettingsSection > summary');
  assert.ok((await page.locator('#audioAnalysisCountLabel').innerText()).includes('99%'),'partial coverage never displays 100%');
  await page.route('**/api/analyze-track/**',route=>route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({code:'AUDIO_NOT_ON_PHONE',error:'Track not found'})}));
  await page.click('#startAudioAnalysisBtn');await page.waitForFunction(()=>document.getElementById('audioAnalysisCurrentTrack').textContent.includes('телефон ответил 404'));
  await page.click('#settingsDoneBtn');await page.click('.nav-item[data-view="library"]');
  await page.route('**/api/lyrics?**',route=>{if(route.request().method()!=='GET')return route.continue();const id=new URL(route.request().url()).searchParams.get('track');return route.fulfill({contentType:'application/json',body:JSON.stringify({lines:[{text:id===a.id?'Первая песня':'Вторая песня',time:0},{text:'Следующая строка <без HTML>',time:2}],synced:true,source:{name:'LRCLIB',id:42}})});});
  await page.locator(`tr[data-track-id="${a.id}"]`).click();await page.waitForFunction(()=>[...document.querySelectorAll('audio')].some(a=>!a.paused&&a.currentTime>.5));
  await page.click('#karaokeBtn');await page.waitForSelector('.karaoke-line.is-current');assert.equal(await page.locator('.karaoke-line').first().innerText(),'Первая песня');
  await page.locator('.karaoke-line').nth(1).click();await page.waitForFunction(()=>document.querySelector('.karaoke-line.is-current')?.textContent.includes('Следующая строка'));
  await page.click('#karaokeClose');await page.locator(`tr[data-track-id="${b.id}"]`).click();
  await page.waitForFunction(id=>window.PainPlayer.getTrack()?.id===id,b.id);await page.click('#karaokeBtn');await page.waitForFunction(()=>document.querySelector('.karaoke-line')?.textContent==='Вторая песня');
  await page.click('#karaokeEdit');await page.fill('#karaokeText','[00:00.00]Мой текст');await page.click('#karaokeApply');await page.click('#karaokeSave');await page.waitForFunction(()=>document.getElementById('karaokeStatus').textContent.includes('Сохранено'));
  assert.ok(await page.evaluate(()=>!window.PainPlayer.getAudio().paused),'karaoke never interrupts audio');
  await page.unroute('**/api/lyrics?**');await page.click('#karaokeClose');await page.click('#settingsToggleBtn');
  assert.equal(await page.locator('#onlineLyricsSwitch').isChecked(),false);await page.locator('#onlineLyricsSwitch').locator('..').click();await page.waitForFunction(()=>!document.getElementById('onlineLyricsSwitch').disabled);
  assert.equal((await page.evaluate(()=>fetch('/api/lyrics/settings').then(r=>r.json()))).enabled,true);
  await page.locator('#onlineLyricsSwitch').locator('..').click();await page.waitForFunction(()=>!document.getElementById('onlineLyricsSwitch').disabled);await page.click('#settingsDoneBtn');
  await page.click('#karaokeBtn');await page.waitForFunction(()=>document.querySelector('.karaoke-line')?.textContent==='Мой текст');
  await page.screenshot({path:'/tmp/pain-karaoke.png'});const maxTask=await page.evaluate(()=>Math.max(0,...window.karaokeTasks));await page.click('#karaokeClose');await page.reload();await page.waitForFunction(n=>window.painQueue?.tracks.length===n,library.tracks.length);
  const saved=await page.evaluate(id=>fetch('/api/lyrics?track='+encodeURIComponent(id)).then(r=>r.json()),b.id);assert.equal(saved.lines[0].text,'Мой текст');assert.ok(saved.manual);
  assert.equal(await page.locator('#onlineLyricsSwitch').isChecked(),false);assert.deepEqual(errors,[]);assert.equal(await app.evaluate(()=>globalThis.karaokeUnresponsive),0);
  assert.ok(maxTask<1000);console.log(JSON.stringify({tracks:library.tracks.length,indexed:pf.indexed,unavailable:pf.unavailable.length,analysisFailure:'explained',karaoke:'sync, seek, track switch, manual override, reload passed',settings:'persisted',audio:'uninterrupted',maxTask,errors}));
 }finally{if(app)await app.close();fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
