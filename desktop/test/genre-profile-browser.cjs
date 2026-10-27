// Real saved history, real cached genre sources, real playback; isolated writes.
const {_electron}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const root=fs.mkdtempSync(path.resolve(__dirname,'../.genre-browser-')),source=path.resolve(__dirname,'../data');
 const library=JSON.parse(fs.readFileSync(path.join(source,'library.json')));
 fs.mkdirSync(path.join(root,'data'));fs.mkdirSync(path.join(root,'cache'));
 for(const name of fs.readdirSync(source))if(name.endsWith('.json'))fs.copyFileSync(path.join(source,name),path.join(root,'data',name));
 const storeGenres=path.join(source,'cover-search','song-genres.json');
 if(fs.existsSync(storeGenres)){fs.mkdirSync(path.join(root,'data','cover-search'));fs.copyFileSync(storeGenres,path.join(root,'data','cover-search','song-genres.json'));}
 for(const name of fs.readdirSync(path.resolve(__dirname,'../cache')))if(name.endsWith('.mp3'))fs.linkSync(path.resolve(__dirname,'../cache',name),path.join(root,'cache',name));
 let app;
 try{
  const env={...process.env,PAIN_DATA_DIR:root,PAIN_USER_DATA_DIR:path.join(root,'profile'),PAIN_DISCOVERY:'false',PAIN_PULSEFLOW_AUTO_INDEX:'false',PORT:'3197'};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:require('electron'),args:[path.resolve(__dirname,'..')],env});
  const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   localStorage.setItem('pain_theme','form');localStorage.setItem('pain_lang','ru');
   window.genreTasks=[];new PerformanceObserver(list=>window.genreTasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask',buffered:true});
  });
  await app.evaluate(({BrowserWindow})=>{globalThis.genreUnresponsive=0;BrowserWindow.getAllWindows()[0].on('unresponsive',()=>globalThis.genreUnresponsive++);});
  await page.reload();await page.waitForFunction(n=>window.painQueue?.tracks.length===n,library.tracks.length);
  await page.evaluate(()=>location.hash='library');
  const playable=library.tracks.find(t=>t.mime==='audio/mpeg');await page.locator(`tr[data-track-id="${playable.id}"]`).click();
  await page.waitForFunction(()=>[...document.querySelectorAll('audio')].some(a=>!a.paused&&a.currentTime>1));
  await page.click('.nav-item[data-view="insights"]');
  await page.waitForSelector('.genre-orbit [data-genre-index]');
  assert.equal(await page.locator('.genre-week').count(),4);
  const report=await page.evaluate(()=>fetch('/api/taste-profile').then(r=>r.json()));
  assert.ok(report.total>0);assert.ok(report.known>0,'real catalog results are present');
  assert.ok(Math.abs(report.genres.reduce((s,g)=>s+g.ms,0)-report.total)<1,'time is conserved');
  assert.equal(await page.locator('#genreOrbitValue').innerText(),Math.round(report.identified/report.total*100)+'%','default center describes coverage');
  await page.click('.genre-legend button >> nth=0');assert.ok((await page.locator('#genreOrbitValue').innerText()).endsWith('%'));
  assert.equal(await page.locator('.genre-orbit .is-selected').count(),1,'the center value highlights its own sector');
  await page.click('.genre-legend button >> nth=0');assert.equal(await page.locator('.genre-orbit .is-selected').count(),0);
  await page.click('[data-genre-range="28"]');await page.waitForFunction(()=>document.getElementById('genreProfileBody').getAttribute('aria-busy')==='false');
  assert.equal(await page.locator('[data-genre-range="28"]').getAttribute('aria-pressed'),'true');
  await page.setViewportSize({width:1440,height:1200});await page.locator('#genreProfile').evaluate(e=>e.scrollIntoView({block:'start'}));
  await page.screenshot({path:'/tmp/pain-genre-profile.png'});
  await page.locator('#genreProfile').screenshot({path:'/tmp/pain-genre-profile-detail.png'});
  await page.setViewportSize({width:1000,height:800});
  assert.equal(await page.locator('#genreProfile').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true,'profile fits the available column');
  assert.ok(await page.locator('.genre-spectrum').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'legend never overflows a narrow content column');
  const tagged=library.tracks.find(t=>t.id==='media:24');
  if(tagged){
   await page.click('.nav-item[data-view="library"]');await page.locator(`tr[data-track-id="${tagged.id}"]`).click();
   await page.waitForFunction(()=>document.querySelector('#trackInfoGenres .track-info-story summary')?.textContent.includes('Теги'));
   assert.ok(await page.locator('#trackInfoGenres .track-genres span').count()>=3,'all published tags and genres are visible');
   await page.evaluate(()=>{const e=document.getElementById('showTrackGenresSwitch');e.checked=false;e.dispatchEvent(new Event('change'));});
   assert.equal(await page.locator('#trackInfoGenres').isVisible(),false);
   await page.evaluate(()=>{const e=document.getElementById('showTrackGenresSwitch');e.checked=true;e.dispatchEvent(new Event('change'));});
   assert.equal(await page.locator('#trackInfoGenres').isVisible(),true);
  }
  const beforeToggle=await page.evaluate(()=>[...document.querySelectorAll('audio')].find(a=>!a.paused)?.currentTime);assert.ok(Number.isFinite(beforeToggle));
  await page.evaluate(()=>{const e=document.getElementById('onlineGenresSwitch');e.checked=false;e.dispatchEvent(new Event('change'));});
  await page.waitForFunction(async()=>!(await fetch('/api/genres').then(r=>r.json())).enabled);
  await page.waitForFunction(before=>[...document.querySelectorAll('audio')].some(a=>!a.paused&&a.currentTime>before+.2),beforeToggle,{timeout:5000});
  const after=await page.evaluate(()=>fetch('/api/taste-profile').then(r=>r.json()));assert.ok(after.known>=report.known,'disabling preserves saved genres');
  const maxTaskBeforeReload=await page.evaluate(()=>Math.max(0,...window.genreTasks));
  await page.reload();await page.waitForFunction(async()=>!(await fetch('/api/genres').then(r=>r.json())).enabled);
  assert.equal(await page.locator('#onlineGenresSwitch').isChecked(),false);
  const metrics={maxTask:Math.max(maxTaskBeforeReload,await page.evaluate(()=>Math.max(0,...window.genreTasks))),unresponsive:await app.evaluate(()=>globalThis.genreUnresponsive),errors};
  assert.deepEqual(errors,[]);assert.equal(metrics.unresponsive,0);assert.ok(metrics.maxTask<1000);
  console.log(JSON.stringify({tracks:library.tracks.length,profileKnown:report.known,listened:report.listened,coverage:Math.round(report.identified/report.total*100),graphs:2,disableAndPlayback:'passed',...metrics}));
 }finally{if(app)await app.close();fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
