// Real library metadata, read only. All API writes stay in this in-memory fixture.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=path.resolve(__dirname,'../src'),data=process.env.PAIN_EVAL_DATA_DIR||path.resolve(__dirname,'../data');
const library=JSON.parse(fs.readFileSync(path.join(data,'library.json'),'utf8'));
const stats=JSON.parse(fs.readFileSync(path.join(data,'stats.json'),'utf8'));
let playlists=[{id:'scroll-test',name:'Проверка прокрутки',trackIds:library.tracks.map(t=>t.id)},
 ...Array.from({length:50},(_,i)=>({id:'scroll-extra-'+i,name:'Плейлист '+i,trackIds:[library.tracks[i].id]}))];
const cover='<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#887b99"/></svg>';
const wav=require('./together-fixture.cjs').wave(60);
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   localStorage.setItem('pain_theme','form-night');localStorage.setItem('pain_lang','ru');
   localStorage.setItem('pain_performance_mode','maximum');localStorage.setItem('pain_online_covers','false');
   localStorage.setItem('pain_discord_presence','false');
   localStorage.setItem('pain_save_history','false');localStorage.setItem('pain_track_transition','0');
  });
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());if(url.origin!=='http://pain.test')return route.abort();
   if(url.pathname.startsWith('/api/cached-track/')){
    const range=require('../src/range')(route.request().headers().range,wav.length);
    return route.fulfill({status:range?206:200,contentType:'audio/wav',headers:{'Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${range.start}-${range.end}/${wav.length}`}:{})},body:range?wav.subarray(range.start,range.end+1):wav});
   }
   if(url.pathname.startsWith('/api/cover/'))return route.fulfill({contentType:'image/svg+xml',body:cover});
   if(url.pathname.startsWith('/api/')){
    if(url.pathname==='/api/library/events')return route.fulfill({contentType:'text/event-stream',body:'data: 1\n\n'});
    if(url.pathname==='/api/playlists'&&route.request().method()==='POST')playlists=route.request().postDataJSON();
    if(url.pathname==='/api/sync-like'){const update=route.request().postDataJSON();library.tracks.find(t=>t.id===update.trackId).favorite=update.favorite;}
    const result=url.pathname==='/api/saved-library'?library:url.pathname==='/api/saved-stats'?stats:url.pathname==='/api/playlists'?playlists:url.pathname==='/api/cached-tracks'?{cached:[]}:[];
    return route.fulfill({json:result});
   }
   const file=path.resolve(url.pathname.startsWith('/assets/')?path.join(__dirname,'..'):source,'.'+(url.pathname==='/'?'/index.html':url.pathname));
   if(!fs.existsSync(file))return route.fulfill({status:404,body:''});
   const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.ttf':'font/ttf','.png':'image/png'};
   return route.fulfill({contentType:mime[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
  });
  await page.goto('http://pain.test/#favorites');
  const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  const favorites=library.tracks.filter(t=>t.favorite).length;
  await page.waitForFunction(n=>document.querySelectorAll('#favoritesTableBody tr[data-track-id]').length===n,favorites);
  async function scrollList(selector,fraction=.7){
   await page.locator('.views-viewport').evaluate((e,f)=>{e.scrollTop=(e.scrollHeight-e.clientHeight)*f;},fraction);
   await page.waitForTimeout(150);
   return page.evaluate(selector=>{
    const viewport=document.querySelector('.views-viewport'),top=viewport.getBoundingClientRect().top;
    const rows=[...document.querySelectorAll(selector)];const row=rows.find(e=>e.getBoundingClientRect().top>=top&&e.getBoundingClientRect().bottom<top+viewport.clientHeight)
     ||rows.find(e=>e.getBoundingClientRect().bottom>top&&e.getBoundingClientRect().top<top+viewport.clientHeight);
    window.scrollReference=row;return {id:row?.dataset.trackId,offset:row?.getBoundingClientRect().top-top,scroll:viewport.scrollTop};
   },selector);
  }
  async function monitor(action,reference,label,retain=true){
   await page.evaluate(()=>{window.scrollSamples=[];window.scrollWatching=true;function sample(){scrollSamples.push(document.querySelector('.views-viewport').scrollTop);if(scrollWatching)requestAnimationFrame(sample);}sample();});
   await action();await page.waitForTimeout(700);
   const result=await page.evaluate(()=>{scrollWatching=false;return {min:Math.min(...scrollSamples),max:Math.max(...scrollSamples),final:document.querySelector('.views-viewport').scrollTop,retained:scrollReference?.isConnected};});
   console.log(label,JSON.stringify({before:reference.scroll,...result}));
   assert.ok(Math.abs(result.min-reference.scroll)<=2&&Math.abs(result.max-reference.scroll)<=2,label+' must never jump, even for one frame');
   if(retain)assert.ok(result.retained,label+' keeps unchanged rows');
  }
  const reference=await scrollList('#favoritesTableBody tr[data-track-id]');
  assert.ok(reference.scroll>500);
  await monitor(()=>page.evaluate(async()=>{window.dispatchEvent(new Event('focus'));await new Promise(r=>setTimeout(r,100));await PainPlayer.reloadLibrary();}),reference,'favorites: focus and delayed library refresh');
  await monitor(()=>page.click('.nav-item[data-view="favorites"]'),reference,'favorites: reopening current view');
  async function anchorIsStable(ref,selector,label){
   await page.waitForFunction(selector=>!document.querySelector(selector)._renderFrame,selector);
   const offset=await page.evaluate(({id,selector})=>{
    const row=[...document.querySelector(selector).children].find(e=>e.dataset.trackId===id);
    return row?.getBoundingClientRect().top-document.querySelector('.views-viewport').getBoundingClientRect().top;
   },{id:ref.id,selector});
   assert.ok(Math.abs(offset-ref.offset)<=2,`${label}: anchor moved ${offset-ref.offset}px`);
  }
  // A favourite removed above the viewport must not displace the songs being read.
  const firstFavorite=library.tracks.find(t=>t.favorite);
  firstFavorite.favorite=0;
  await page.evaluate(()=>PainPlayer.reloadLibrary());
  await page.waitForFunction(n=>document.querySelectorAll('#favoritesTableBody tr[data-track-id]').length===n,favorites-1);
  await anchorIsStable(reference,'#favoritesTableBody','remove favourite above viewport');
  // Remove the visible row via the real heart button, keeping its next neighbour visible.
  await page.locator(`#favoritesTableBody tr[data-track-id="${reference.id}"] .row-fav-btn`).click();
  await page.waitForFunction(n=>document.querySelectorAll('#favoritesTableBody tr[data-track-id]').length===n,favorites-2);
  // The removed first visible song leaves room for the next surviving row, without a jump to the header.
  assert.ok(await page.locator('.views-viewport').evaluate(e=>e.scrollTop>1000));
  await page.click('.custom-playlist-item[data-id="scroll-test"]');
  await page.waitForFunction(n=>document.querySelectorAll('#playlistTableBody tr[data-track-id]').length===n,library.tracks.length);
  const plRef=await scrollList('#playlistTableBody tr[data-track-id]');
  await monitor(()=>page.evaluate(()=>PainPlayer.reloadLibrary()),plRef,'playlist: reload');
  // Delayed source metadata arrives while the listener continues scrolling.
  const changed=library.tracks[0];changed.title+=' · updated';
  await page.evaluate(()=>PainPlayer.reloadLibrary());
  await page.waitForFunction(()=>document.querySelector('#playlistTableBody .track-row-title').textContent.endsWith(' · updated'));
  await anchorIsStable(plRef,'#playlistTableBody','metadata refresh');
  await page.locator(`#playlistTableBody tr[data-track-id="${plRef.id}"] .col-title`).click();
  await page.waitForFunction(()=>!PainPlayer.getAudio().paused&&PainPlayer.getAudio().currentTime>0);
  const playingRef=await scrollList('#playlistTableBody tr[data-track-id]',.45);
  await monitor(async()=>{await page.click('#bottomNextBtn');await page.waitForFunction(()=>!PainPlayer.getAudio().paused&&PainPlayer.getAudio().currentTime>0);},playingRef,'track change during browsing');
  await monitor(async()=>{await page.click('#settingsToggleBtn');await page.click('#settingsDoneBtn');},playingRef,'settings open/close');
  // A real removal in the lower half of a custom playlist keeps neighbouring rows.
  await page.locator(`#playlistTableBody tr[data-track-id="${playingRef.id}"] .row-playlist-remove`).click();
  await page.waitForFunction(n=>document.querySelectorAll('#playlistTableBody tr[data-track-id]').length===n,library.tracks.length-1);
  assert.ok(await page.locator('.views-viewport').evaluate(e=>e.scrollTop>5000));
  // Opening the picker is explicit; selecting all must not rebuild its scrolled list.
  await page.locator('#addPlaylistTracksBtn').click();
  await page.waitForFunction(n=>document.querySelectorAll('#playlistPickerList input').length===n,library.tracks.length);
  await page.locator('#playlistPickerList').evaluate(e=>e.scrollTop=e.scrollHeight/2);
  const pickerTop=await page.locator('#playlistPickerList').evaluate(e=>e.scrollTop);
  await page.click('#playlistPickerSelect');
  assert.equal(await page.locator('#playlistPickerList').evaluate(e=>e.scrollTop),pickerTop,'select all keeps picker scroll');
  await page.click('#playlistPickerCancel');
  await page.click('.nav-item[data-view="library"]');
  await page.waitForFunction(n=>document.querySelectorAll('#tracksTableBody tr[data-track-id]').length===n,library.tracks.length);
  const libRef=await scrollList('#tracksTableBody tr[data-track-id]');
  await monitor(()=>page.evaluate(()=>PainPlayer.reloadLibrary()),libRef,'library: reload');
  await page.click('#viewModeGridBtn');
  await page.waitForFunction(n=>document.querySelectorAll('#tracksGrid .track-card').length===n,library.tracks.length);
  const gridRef=await scrollList('#tracksGrid .track-card');
  await monitor(()=>page.evaluate(()=>PainPlayer.reloadLibrary()),gridRef,'grid: reload');
  // Replacing all metadata takes several animation frames on a slow CPU. A
  // scroll made during that work wins over the position at request start.
  for(const track of library.tracks)track.album+=' · refreshed';
  const during=await page.evaluate(async()=>{await PainPlayer.reloadLibrary();const viewport=document.querySelector('.views-viewport');viewport.scrollTop+=300;return viewport.scrollTop;});
  await page.waitForFunction(()=>document.querySelector('#tracksGrid')._renderFrame==null);
  assert.equal(await page.locator('.views-viewport').evaluate(e=>e.scrollTop),during,'scroll during deferred rendering is preserved');
  await page.fill('#searchInput','__no_such_song__');await page.waitForFunction(()=>document.querySelectorAll('#tracksGrid .track-card').length===0);
  assert.ok(await page.locator('.views-viewport').evaluate(e=>e.scrollTop<500),'empty search clamps naturally');
  await page.fill('#searchInput','');
  await page.waitForFunction(n=>document.querySelectorAll('#tracksGrid .track-card').length===n,library.tracks.length);
  await page.click('#viewModeListBtn');
  await page.locator('#sidebarPlaylistsList').evaluate(e=>e.scrollTop=e.scrollHeight/2);
  const sideTop=await page.locator('#sidebarPlaylistsList').evaluate(e=>e.scrollTop);
  await page.evaluate(()=>PainPlayer.reloadLibrary());
  assert.equal(await page.locator('#sidebarPlaylistsList').evaluate(e=>e.scrollTop),sideTop,'sidebar scroll survives refresh');
  await page.click('.nav-item[data-view="home"]');await page.waitForSelector('.home-mix[aria-busy="false"]');
  const homeRef=await scrollList('#homeContent .home-section',.6);
  await monitor(()=>page.evaluate(()=>PainPlayer.reloadLibrary()),homeRef,'home: background refresh',false);
  await page.click('.nav-item[data-view="insights"]');
  await page.waitForFunction(()=>document.querySelectorAll('#topTracksList .leaderboard-item').length===50);
  await page.locator('#topTracksList').evaluate(e=>e.scrollTop=e.scrollHeight/2);
  const topScroll=await page.locator('#topTracksList').evaluate(e=>e.scrollTop);
  await page.evaluate(()=>PainPlayer.reloadLibrary());
  assert.equal(await page.locator('#topTracksList').evaluate(e=>e.scrollTop),topScroll,'insights: nested top-50 scroll survives refresh');
  await page.click('.nav-item[data-view="library"]');
  // Classic themes use the same list implementation and must keep position too.
  await page.evaluate(()=>localStorage.setItem('pain_theme','paper'));await page.reload();
  await page.waitForFunction(n=>document.querySelectorAll('#tracksTableBody tr[data-track-id]').length===n,library.tracks.length);
  const paperRef=await scrollList('#tracksTableBody tr[data-track-id]');
  await monitor(()=>page.evaluate(()=>PainPlayer.reloadLibrary()),paperRef,'paper theme: reload');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({tracks:library.tracks.length,favorites,cpuSlowdown:4,errors}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
