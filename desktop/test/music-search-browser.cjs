// Real metadata is read only; playback checkpoints and edited lyrics use a
// disposable directory and an isolated HTTP server. No user data is changed.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const source=path.resolve(__dirname,'../src'),root=path.resolve(__dirname,'..');
const lyricsRoute=require('../src/lyrics-store'),{key,read}=require('../src/lyrics-search');
const {wave}=require('./together-fixture.cjs');
(async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pain-search-browser-'));
 const library=JSON.parse(await fs.readFile(path.join(root,'data/library.json'),'utf8'));
 const genreData=JSON.parse(await fs.readFile(path.join(root,'data/genres.json'),'utf8'));
 const fixture={id:'search-lyric-fixture',title:'A hidden name',artist:'Fictional Singer',genre:['Shoegaze','Indie Rock'],duration:60000,bytes:1};
 library.tracks.push(fixture);const tracks=library.tracks;
 const checkpoint=require('../src/playback-checkpoint')(dir,{getTracks:()=>tracks});
 let playlists=[{id:'search-playlist',name:'Search test',trackIds:[]}];
 await fs.mkdir(path.join(dir,'lyrics'));
 await fs.writeFile(path.join(dir,'lyrics',key(fixture.id)+'.json'),JSON.stringify({lines:[{time:null,text:'The quiet room waits beneath the winter sky'},{time:null,text:'I love you'}]}));
 const cached={cached:async id=>{
   const t=tracks.find(t=>String(t.id)===id);if(!t)return null;
   const signature=JSON.stringify([t.title,t.artist,t.album,t.duration]);return read(path.join(root,'data/lyrics-online',key(id+signature)+'.json'));
 }};
 const wav=wave(60);let writes=0,checkpointDelay=0;
 const server=http.createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://localhost');
   if(url.pathname==='/api/playback-checkpoint'&&req.method==='GET'&&checkpointDelay)await new Promise(r=>setTimeout(r,checkpointDelay));
   if(checkpoint(req,res,url))return;
   if(url.pathname==='/api/lyrics/search-index'||url.pathname==='/api/lyrics'&&req.method==='PUT'){if(lyricsRoute(req,res,url,dir,cached))return;}
   if(url.pathname.startsWith('/api/cached-track/')){
    const range=require('../src/range')(req.headers.range,wav.length);res.writeHead(range?206:200,{'Content-Type':'audio/wav','Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${range.start}-${range.end}/${wav.length}`}:{})});res.end(range?wav.subarray(range.start,range.end+1):wav);return;
   }
   if(url.pathname.startsWith('/api/cover/')){res.writeHead(200,{'Content-Type':'image/svg+xml'});res.end('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#887b99"/></svg>');return;}
   if(url.pathname.startsWith('/api/')){
    if(url.pathname==='/api/library/events'){res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: 1\n\n');return;}
    if(url.pathname==='/api/playlists'&&req.method==='POST'){let b='';for await(const chunk of req)b+=chunk;playlists=JSON.parse(b);writes++;}
    const value=url.pathname==='/api/saved-library'?library:url.pathname==='/api/saved-stats'?{plays:[],slices:[]}:url.pathname==='/api/playlists'?playlists:
      url.pathname==='/api/cached-tracks'?{cached:[]}:url.pathname==='/api/genres/snapshot'?{entries:{...Object.fromEntries(Object.entries(genreData).map(([id,row])=>[id,row.names||[]])),[fixture.id]:fixture.genre}}:{};
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value));return;
   }
   const file=path.resolve(url.pathname.startsWith('/assets/')?root:source,'.'+(url.pathname==='/'?'/index.html':url.pathname));
   if(!file.startsWith(source+path.sep)&&!file.startsWith(path.join(root,'assets')+path.sep)){res.writeHead(403);res.end();return;}
   const type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.ttf':'font/ttf','.png':'image/png'}[path.extname(file)]||'application/octet-stream';
   const body=await fs.readFile(file);res.writeHead(200,{'Content-Type':type});res.end(body);
  }catch(_){if(!res.headersSent)res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--autoplay-policy=no-user-gesture-required','--mute-audio']});
 try{
  const context=await browser.newContext({viewport:{width:1280,height:860}}),page=await context.newPage(),errors=[];
  await context.addInitScript(()=>{localStorage.setItem('pain_theme','form-night');localStorage.setItem('pain_lang','ru');localStorage.setItem('pain_performance_mode','maximum');localStorage.setItem('pain_online_covers','false');localStorage.setItem('pain_discord_presence','false');localStorage.setItem('pain_track_transition','0');localStorage.setItem('pain_save_history','false');});
  await context.route('**/*',route=>new URL(route.request().url()).port===String(server.address().port)?route.continue():route.abort());
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/#library');
  await page.waitForFunction(n=>document.querySelectorAll('#tracksTableBody tr[data-track-id]').length===n,tracks.length);
  const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  await page.evaluate(id=>{const t=PainPlayer.getTracks().find(t=>t.id===id);PainPlayer.playTrackInContext(t,PainPlayer.getTracks(),{type:'library',title:'Search validation',allowNew:false});},fixture.id);
  await page.waitForFunction(()=>!PainPlayer.getAudio().paused&&PainPlayer.getAudio().currentTime>0);
  await page.evaluate(()=>{window.searchAllFrames=[];window.searchAllWatching=true;let previous=performance.now();function sample(now){searchAllFrames.push(now-previous);previous=now;if(searchAllWatching)requestAnimationFrame(sample);}requestAnimationFrame(sample);});
  const muse=tracks.find(t=>t.artist==='Muse'&&t.title==='Space Dementia');assert.ok(muse);
  const latency=[];
  async function query(value,expected){
    const start=Date.now();await page.fill('#searchInput',value);
    await page.waitForFunction(id=>document.querySelector('#searchInput').getAttribute('aria-busy')!=='true'&&!document.querySelector('#tracksTableBody')._renderFrame&&document.querySelector('#tracksTableBody tr[data-track-id]')?.dataset.trackId===id,String(expected),{timeout:20000});
    latency.push({query:value,ms:Date.now()-start});
  }
  await query('msue space dementai',muse.id);
  await query('space demen tia',muse.id);
  await query('genre:шугейз',fixture.id);
  await query('quiet room waits',fixture.id);
  assert.ok((await page.locator(`#tracksTableBody tr[data-track-id="${fixture.id}"] .search-lyric-match`).textContent()).includes('quiet room'));
  await query('artist:Fictional ай лав ю',fixture.id);
  assert.ok((await page.locator('#musicSearchHint').textContent()).includes('созвучию'));
  await query('та песня где quiet room waits',fixture.id);
  const allFrames=await page.evaluate(()=>{searchAllWatching=false;return {max:Math.max(...searchAllFrames),count:searchAllFrames.length,position:PainPlayer.getAudio().currentTime};});
  assert.ok(allFrames.max<200,'full index/lyrics search must leave audio controls responsive under 4x CPU throttling: '+JSON.stringify(allFrames));
  assert.ok(allFrames.position>1);assert.equal(await page.evaluate(()=>PainPlayer.getTrack().id),fixture.id,'search never changes the playing queue');
  await page.locator('#searchInput').evaluate(input=>{
    window.frameGaps=[];let previous=performance.now();window.watchSearch=true;function sample(now){frameGaps.push(now-previous);previous=now;if(watchSearch)requestAnimationFrame(sample);}requestAnimationFrame(sample);
    for(const query of ['m','molc','zzzznothing','жанр:джаз','dementia','msue space dementai']){input.value=query;input.dispatchEvent(new Event('input',{bubbles:true}));}
  });
  await page.waitForFunction(id=>document.querySelector('#searchInput').getAttribute('aria-busy')!=='true'&&document.querySelector('#tracksTableBody tr[data-track-id]')?.dataset.trackId===id,String(muse.id));
  const frames=await page.evaluate(()=>{watchSearch=false;return {max:Math.max(...frameGaps),count:frameGaps.length};});assert.ok(frames.max<200,'search must keep the UI responsive under 4x CPU throttling: '+JSON.stringify(frames));
  await page.screenshot({path:'/tmp/pain-smart-search.png'});
  await page.click('#searchClearBtn');await page.waitForFunction(n=>document.querySelectorAll('#tracksTableBody tr[data-track-id]').length===n,tracks.length);
  await page.click('.custom-playlist-item[data-id="search-playlist"]');await page.click('#addPlaylistTracksBtn');
  await page.fill('#playlistPickerSearch','artist:Fictional quiet room waits');await page.waitForFunction(()=>document.querySelector('#playlistPickerList').getAttribute('aria-busy')==='false'&&document.querySelectorAll('#playlistPickerList input').length===1);
  await page.locator('#playlistPickerList input').check();await page.click('#playlistPickerConfirm');await page.waitForFunction(()=>document.querySelectorAll('#playlistTableBody tr[data-track-id]').length===1);
  assert.deepEqual(playlists[0].trackIds,[fixture.id]);assert.equal(writes,1);
  // Checkpoint survives unavailable localStorage and a changed UI origin.
  await page.click('#playlistTableBody .col-title');await page.waitForFunction(()=>!PainPlayer.getAudio().paused&&PainPlayer.getAudio().readyState>=2);
  await page.evaluate(async()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='pain_last_playback')throw new DOMException('full','QuotaExceededError');return original.call(this,k,v);};const audio=PainPlayer.getAudio();audio.currentTime=14.25;audio.pause();await PainPlayer.flushListening();});
  let saved=JSON.parse(await fs.readFile(path.join(dir,'last-playback.json'),'utf8'));assert.equal(saved.id,fixture.id);assert.ok(saved.position>=14.2);
  await page.evaluate(()=>localStorage.removeItem('pain_last_playback'));
  checkpointDelay=800;const checkpointRequested=page.waitForRequest(req=>req.url().endsWith('/api/playback-checkpoint')&&req.method()==='GET');await page.reload();await checkpointRequested;
  await page.evaluate(()=>PainPlayer.reloadLibrary());
  assert.equal(await page.evaluate(()=>PainPlayer.getTrack()?.id),tracks[0].id,'reproduce a background queue refresh before checkpoint restoration');
  await page.waitForFunction(id=>PainPlayer.getTrack()?.id===id,fixture.id);assert.equal(await page.locator('#currentTime').textContent(),'0:14');assert.ok(await page.evaluate(()=>PainPlayer.getAudio().paused));
  checkpointDelay=0;await page.evaluate(()=>PainPlayer.reloadLibrary());await page.waitForTimeout(700);assert.equal(await page.evaluate(()=>PainPlayer.getTrack()?.id),fixture.id,'later refresh cannot replace the restored song');
  // localhost and 127.0.0.1 have separate browser storage, same disk checkpoint.
  await page.goto(base.replace('127.0.0.1','localhost')+'/#library');await page.waitForFunction(id=>PainPlayer.getTrack()?.id===id,fixture.id);
  assert.equal(await page.locator('#currentTime').textContent(),'0:14');assert.ok(await page.evaluate(()=>PainPlayer.getAudio().paused));
  await page.click('#bottomPlayBtn');await page.waitForFunction(()=>!PainPlayer.getAudio().paused&&PainPlayer.getAudio().currentTime>=14.2);
  await page.evaluate(()=>{PainPlayer.getAudio().currentTime=21.5;});await page.waitForTimeout(100);await page.close();
  const reopened=await context.newPage();reopened.on('pageerror',error=>errors.push(error.message));await reopened.goto(base+'/#library');await reopened.waitForFunction(id=>PainPlayer.getTrack()?.id===id,fixture.id);
  assert.equal(await reopened.locator('#currentTime').textContent(),'0:21');assert.ok(await reopened.evaluate(()=>PainPlayer.getAudio().paused));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({tracks:tracks.length,latency,cpuSlowdown:4,frames,allFrames,lyricSearch:true,genreSearch:true,phoneticSearch:true,playlistSearch:true,checkpointAcrossOrigins:true,checkpointWithFullStorage:true,closeReopen:true,errors}));
 }finally{await browser.close();await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
