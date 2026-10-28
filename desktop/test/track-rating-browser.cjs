// Live MusicBrainz scores, actual saved songs and audio; isolated from user data.
const {_electron}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const root=fs.mkdtempSync(path.resolve(__dirname,'../.rating-browser-')),source=path.resolve(__dirname,'../data'),library=JSON.parse(fs.readFileSync(path.join(source,'library.json')));
 fs.mkdirSync(path.join(root,'data'));fs.mkdirSync(path.join(root,'cache'));fs.mkdirSync(path.join(root,'covers'));
 for(const name of fs.readdirSync(source))if(name.endsWith('.json'))fs.copyFileSync(path.join(source,name),path.join(root,'data',name));
 for(const kind of ['cache','covers'])for(const name of fs.readdirSync(path.resolve(__dirname,'..',kind)))if(fs.statSync(path.resolve(__dirname,'..',kind,name)).isFile())fs.linkSync(path.resolve(__dirname,'..',kind,name),path.join(root,kind,name));
 for(const name of ['genre-preferences','lyrics-preferences'])fs.writeFileSync(path.join(root,'data',name+'.json'),JSON.stringify({enabled:false}));
 let app;
 try{
  const env={...process.env,PAIN_DATA_DIR:root,PAIN_USER_DATA_DIR:path.join(root,'profile'),PAIN_DISCOVERY:'false',PAIN_PULSEFLOW_AUTO_INDEX:'false',PORT:'3198'};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:require('electron'),args:[path.resolve(__dirname,'..')],env});const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(30000);
  await page.addInitScript(()=>{localStorage.setItem('pain_theme','form-night');localStorage.setItem('pain_lang','ru');});
  // Wikipedia is unrelated to the score test and can otherwise take several queries.
  await page.route('**/api/track-info/**',route=>route.fulfill({json:{articles:[],plays:0,cards:[]}}));
  await page.reload();await page.waitForFunction(n=>window.painQueue?.tracks.length===n,library.tracks.length);await page.click('.nav-item[data-view="library"]');
  const scores=[];
  for(const title of ['Everlong','Jigsaw Falling Into Place']){
   const song=library.tracks.find(t=>t.title===title);assert.ok(song);await page.locator(`tr[data-track-id="${song.id}"]`).click();
   await page.waitForFunction(()=>!window.PainPlayer.getAudio().paused&&window.PainPlayer.getAudio().currentTime>.2);
   await page.waitForSelector('#trackInfoRating .track-rating-score strong');
   const result=await page.evaluate(id=>fetch('/api/track-rating/'+encodeURIComponent(id)).then(r=>r.json()),song.id);
   assert.ok(result.rating?.votes>0,JSON.stringify(result));const value=result.rating.value.toLocaleString('ru-RU',{minimumFractionDigits:1,maximumFractionDigits:1});
   assert.equal(await page.locator('#trackInfoRating strong').innerText(),value);assert.equal(await page.locator('#trackInfoRating a').getAttribute('href'),result.rating.source);
   assert.ok(await page.locator('#trackInfoRating small').innerText().then(s=>s.includes(String(result.rating.votes))));
   const time=await page.evaluate(()=>window.PainPlayer.getAudio().currentTime);await page.waitForFunction(before=>window.PainPlayer.getAudio().currentTime>before+.2,time);
   scores.push({title,value:result.rating.value,votes:result.rating.votes,source:result.rating.source});
  }
  await page.locator('#trackInfoPanel').screenshot({path:'/tmp/pain-track-rating.png'});await page.click('#trackInfoClose');assert.equal(await page.locator('#trackInfoPanel').isVisible(),false);await page.click('#trackInfoToggle');await page.waitForSelector('#trackInfoRating strong');assert.deepEqual(errors,[]);
  console.log(JSON.stringify({tracks:library.tracks.length,scores,audio:'continues while rating loads',errors}));
 }catch(error){if(app){const page=await app.firstWindow();console.log('RATING FAILURE',await page.evaluate(async()=>({track:window.PainPlayer?.getTrack(),text:document.getElementById('trackInfoRating')?.innerText,result:await fetch('/api/track-rating/'+encodeURIComponent(window.PainPlayer?.getTrack()?.id)).then(r=>r.json())})));await page.screenshot({path:'/tmp/pain-track-rating-failure.png'});}throw error;}
 finally{if(app)await app.close();fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
