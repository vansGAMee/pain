// Full UI and audio, using copied saved data and linked audio; no user writes.
const {_electron}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const root=fs.mkdtempSync(path.resolve(__dirname,'../.insight-browser-')),source=path.resolve(__dirname,'../data'),library=JSON.parse(fs.readFileSync(path.join(source,'library.json')));
 fs.mkdirSync(path.join(root,'data'));fs.mkdirSync(path.join(root,'cache'));
 for(const name of fs.readdirSync(source))if(name.endsWith('.json'))fs.copyFileSync(path.join(source,name),path.join(root,'data',name));
 fs.writeFileSync(path.join(root,'data','genre-preferences.json'),JSON.stringify({enabled:false}));
 for(const name of fs.readdirSync(path.resolve(__dirname,'../cache')))if(name.endsWith('.mp3'))fs.linkSync(path.resolve(__dirname,'../cache',name),path.join(root,'cache',name));
 let app;
 try{
  const env={...process.env,PAIN_DATA_DIR:root,PAIN_USER_DATA_DIR:path.join(root,'profile'),PAIN_DISCOVERY:'false',PAIN_PULSEFLOW_AUTO_INDEX:'false',PORT:'3196'};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:require('electron'),args:[path.resolve(__dirname,'..')],env});
  const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
  await page.addInitScript(()=>{localStorage.setItem('pain_theme','form');localStorage.setItem('pain_lang','ru');localStorage.setItem('pain_performance_mode','balanced');window.testGalleryTasks=[];new PerformanceObserver(list=>window.testGalleryTasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask',buffered:true});});
  await app.evaluate(({BrowserWindow})=>{globalThis.galleryUnresponsive=0;BrowserWindow.getAllWindows()[0].on('unresponsive',()=>globalThis.galleryUnresponsive++);});
  await page.reload();await page.waitForFunction(n=>window.painQueue?.tracks.length===n,library.tracks.length);
  await page.click('.nav-item[data-view="library"]');
  const audioTrack=library.tracks.find(t=>t.mime==='audio/mpeg'&&t.duration>120000)||library.tracks.find(t=>t.mime==='audio/mpeg');
  await page.locator(`tr[data-track-id="${audioTrack.id}"]`).click();await page.waitForFunction(()=>[...document.querySelectorAll('audio')].some(a=>!a.paused&&a.currentTime>1));
  const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  await page.click('.nav-item[data-view="insights"]');await page.waitForSelector('.insight-figure');
  assert.equal(await page.locator('.insight-figure').count(),20);
  assert.ok(await page.locator('.insight-figure[data-mounted]').count()<20,'off-screen charts are not drawn');
  const galleryTasks=await page.evaluate(()=>{window.testGalleryTasks=[];return true;});
  await page.setViewportSize({width:1680,height:1100});await page.locator('#insightGallery').evaluate(e=>e.scrollIntoView({block:'start'}));
  await page.waitForSelector('.insight-figure[data-mounted] svg');
  await page.locator('[data-insight-replay]').click();
  await page.waitForFunction(()=>document.getAnimations().some(a=>a.effect?.target?.closest?.('.insight-gallery')&&a.playState==='running'),null,{timeout:5000});
  await page.waitForTimeout(1000);await page.screenshot({path:'/tmp/pain-insight-gallery.png'});
  for(const card of await page.locator('.insight-figure').all()){
   await card.scrollIntoViewIfNeeded();await page.waitForFunction(id=>document.querySelector(`[data-chart="${id}"]`)?.dataset.mounted==='true',await card.getAttribute('data-chart'));
   assert.ok(!/NaN|Infinity/.test(await card.locator('svg').evaluate(e=>e.innerHTML)));
  }
  assert.equal(await page.locator('.insight-figure[data-mounted]').count(),20);
  await page.locator('.insight-figure[data-chart="sessions"] .ic-data summary').click();await page.waitForSelector('[data-chart="sessions"] .ic-data td');
  await page.locator('[data-insight-group="discovery"]').click();assert.equal(await page.locator('.insight-figure:visible').count(),4);
  await page.locator('[data-insight-group="all"]').click();
  await page.locator('[data-insight-range="all"]').click();await page.waitForFunction(()=>document.getElementById('insightGallery').getAttribute('aria-busy')==='false');
  await page.setViewportSize({width:1000,height:800});assert.ok(await page.locator('#insightGallery').evaluate(e=>e.scrollWidth<=e.clientWidth+1));
  // A newly created list immediately offers track selection, preserving click order.
  await page.click('#newPlaylistBtn');await page.fill('#newPlaylistNameInput','Графики и музыка');await page.click('#newPlaylistConfirmBtn');
  await page.waitForSelector('#playlistTrackPicker[open]');
  const [a,b,c]=library.tracks.filter(t=>t.available!==0).slice(0,3);
  const select=async track=>{await page.fill('#playlistPickerSearch',track.title);await page.waitForSelector(`#playlistPickerList input[value="${track.id}"]`);await page.locator(`#playlistPickerList input[value="${track.id}"]`).check();};
  await select(b);await select(a);await page.click('#playlistPickerConfirm');await page.waitForFunction(()=>!document.getElementById('playlistTrackPicker').open);
  let lists=await page.evaluate(()=>fetch('/api/playlists').then(r=>r.json())),playlist=lists.find(p=>p.name==='Графики и музыка');assert.deepEqual(playlist.trackIds,[b.id,a.id]);
  await page.click('#addPlaylistTracksBtn');await page.fill('#playlistPickerSearch',a.title);await page.waitForSelector(`#playlistPickerList input[value="${a.id}"]:disabled`);await select(c);
  let failed=false;await page.route('**/api/playlists',route=>{if(route.request().method()==='POST'&&!failed){failed=true;return route.fulfill({status:503,body:'{}'});}return route.continue();});
  await page.click('#playlistPickerConfirm');await page.waitForFunction(()=>!document.getElementById('playlistPickerConfirm').disabled);
  assert.equal(await page.locator('#playlistTrackPicker').getAttribute('open'),'');
  lists=await page.evaluate(()=>fetch('/api/playlists').then(r=>r.json()));assert.deepEqual(lists.find(p=>p.id===playlist.id).trackIds,[b.id,a.id],'failed save leaves the playlist unchanged');
  await page.click('#playlistPickerConfirm');await page.waitForFunction(()=>!document.getElementById('playlistTrackPicker').open);
  await page.locator(`#playlistTableBody tr[data-track-id="${b.id}"] .row-playlist-remove`).click();
  await page.waitForFunction(async({id,track})=>!(await fetch('/api/playlists').then(r=>r.json())).find(p=>p.id===id).trackIds.includes(track),{id:playlist.id,track:b.id});
  const playing=await page.evaluate(()=>[...document.querySelectorAll('audio')].some(a=>!a.paused&&a.currentTime>1));assert.ok(playing,'playlist edits do not stop audio');
  const maxTask=await page.evaluate(()=>Math.max(0,...window.testGalleryTasks));
  await page.reload();await page.waitForFunction(n=>window.painQueue?.tracks.length===n,library.tracks.length);await page.locator(`.custom-playlist-item[data-id="${playlist.id}"]`).click();
  await page.waitForSelector('#playlistTableBody tr[data-track-id]');assert.equal(await page.locator('#playlistTableBody tr[data-track-id]').count(),2);
  // The song menu reaches the same saved playlist; shared playlists keep portable metadata.
  await page.click('.nav-item[data-view="library"]');await page.locator(`#tracksTableBody tr[data-track-id="${b.id}"] .row-more-btn`).click();
  await page.locator('#addToPlaylistList button').filter({hasText:'Графики и музыка'}).click();
  await page.waitForFunction(async({id,track})=>(await fetch('/api/playlists').then(r=>r.json())).find(p=>p.id===id).trackIds.includes(track),{id:playlist.id,track:b.id});
  const duo={id:'test-duo-edit',name:'Вместе — проверка',duo:1,sharedTracks:[{title:a.title,artist:a.artist,album:a.album}],trackIds:[a.id]};
  await page.evaluate(async duo=>{const lists=await fetch('/api/playlists').then(r=>r.json());await fetch('/api/playlists',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify([...lists,duo])});},duo);
  await page.reload();await page.waitForFunction(n=>window.painQueue?.tracks.length===n,library.tracks.length);await page.locator('.custom-playlist-item[data-id="test-duo-edit"]').click();
  await page.click('#addPlaylistTracksBtn');await select(c);await page.click('#playlistPickerConfirm');await page.waitForFunction(()=>!document.getElementById('playlistTrackPicker').open);
  lists=await page.evaluate(()=>fetch('/api/playlists').then(r=>r.json()));assert.equal(lists.find(p=>p.id===duo.id).sharedTracks.length,2);
  await page.locator(`#playlistTableBody tr[data-track-id="${c.id}"] .row-playlist-remove`).click();
  await page.waitForFunction(async()=>(await fetch('/api/playlists').then(r=>r.json())).find(p=>p.id==='test-duo-edit').sharedTracks.length===1);
  assert.deepEqual(errors,[]);assert.equal(await app.evaluate(()=>globalThis.galleryUnresponsive),0);assert.ok(maxTask<1000,`long task ${maxTask}ms`);
  console.log(JSON.stringify({tracks:library.tracks.length,charts:20,chartTypes:15,cpuSlowdown:4,maxTask,unresponsive:0,playlistAddRemoveReload:'passed',songMenu:'passed',duoEditing:'passed',failedSave:'passed',audio:'playing during edits',errors}));
 }catch(error){if(app){const page=await app.firstWindow();await page.screenshot({path:'/tmp/pain-insight-failure.png'}).catch(()=>{});console.log('STATE',await page.evaluate(()=>{const p=document.querySelector('.insight-figure .ic-line');return {view:location.hash,errors:window.testGalleryTasks,dialog:document.querySelector('dialog[open]')?.id,charts:document.querySelectorAll('.insight-figure').length,status:document.getElementById('insightGalleryStatus')?.textContent,root:document.documentElement.outerHTML.slice(0,200),gallery:document.getElementById('insightGallery')?.className,animated:p?{card:p.closest('article').className,name:getComputedStyle(p).animationName,duration:getComputedStyle(p).animationDuration,playState:getComputedStyle(p).animationPlayState}:null};}).catch(()=>null));}throw error;}
 finally{if(app)await app.close();fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
