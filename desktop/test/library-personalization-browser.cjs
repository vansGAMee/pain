// Functional checks on an isolated library. Every API route is intercepted.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const tracks=[
 {id:'a',title:'Artist_-_Song_(SkySound.cc)',artist:'Test Artist',duration:180000,favorite:1},
 {id:'b',title:'Another Song',artist:'Other Artist',duration:180000},
 {id:'c',title:'Live Song (Live)',artist:'Test Artist',duration:180000}
];
const playlists=[{id:'mix-a',name:'Мой плейлист',trackIds:['a','b','c']}];
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
  let libraryReads=0;
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
   if(!localStorage.getItem('personalization_test_started')){
    localStorage.setItem('pain_theme','sakura');localStorage.setItem('pain_lang','ru');
    localStorage.setItem('pain_online_artist_info','false');localStorage.setItem('personalization_test_started','true');
   }
  });
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());if(url.origin!=='http://personal.test')return route.abort();
   if(url.pathname.startsWith('/api/')){
    if(url.pathname==='/api/saved-library')libraryReads++;
    if(url.pathname.startsWith('/api/cover/'))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><path fill="#7452ae" d="M0 0h40v40H0z"/></svg>'});
    const value=url.pathname==='/api/saved-library'?{tracks}:url.pathname==='/api/saved-stats'?{plays:[],slices:[]}:url.pathname==='/api/playlists'?playlists:url.pathname==='/api/devices'?[]:{};
    return route.fulfill({contentType:'application/json',body:JSON.stringify(value)});
   }
   const file=url.pathname.startsWith('/assets/')?path.join(__dirname,'..',url.pathname):path.join(__dirname,'../src',url.pathname==='/'?'index.html':url.pathname);
   const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.ttf':'font/ttf','.woff2':'font/woff2'};
   try{return await route.fulfill({contentType:types[path.extname(file)]||'application/octet-stream',body:await fs.readFile(file)});}catch(_){return route.fulfill({status:404,body:''});}
  });
  await page.goto('http://personal.test');await page.waitForSelector('.home-mix[aria-busy="false"]');
  if(await page.locator('#trackInfoClose').isVisible())await page.click('#trackInfoClose');
  const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  await page.evaluate(()=>{window.savedHomeRecord=document.querySelector('.home-record');window.savedHomeIntro=document.querySelector('.home-intro');window.savedHomeTitle=document.querySelector('.home-intro h1');});
  const beforeReads=libraryReads;
  await page.evaluate(()=>{for(let i=0;i<10;i++){window.dispatchEvent(new Event('focus'));window.dispatchEvent(new CustomEvent('pain:queue-ui'));}});
  await page.waitForTimeout(200);
  assert.equal(libraryReads,beforeReads,'refocusing a connected window does not reload the library');
  assert.ok(await page.evaluate(()=>savedHomeRecord===document.querySelector('.home-record')&&savedHomeIntro===document.querySelector('.home-intro')&&savedHomeTitle===document.querySelector('.home-intro h1')),'Home nodes survive background redraws');
  assert.equal(await page.locator('.home-intro').evaluate(el=>getComputedStyle(el).animationName),'none');
  await page.click('.sidebar [data-view="library"]');
  await page.locator('tr[data-track-id="a"] .track-row-sub').click();
  await page.click('#artistFavoriteBtn');assert.equal(await page.locator('#artistFavoriteBtn').getAttribute('aria-pressed'),'true');
  await page.click('#artistModalCloseBtn');await page.click('#homeBrand');
  assert.equal(await page.locator('.home-artists [data-home-action="artist"]').count(),1);
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
  await page.click('#settingsToggleBtn');await page.locator('label:has(> #homeArtistsSwitch) .switch-slider').click();
  await page.click('.title-cleanup-configure');await page.click('.title-cleanup-apply');
  assert.equal(await page.locator('#cleanTitlesSwitch').isChecked(),true);
  await page.click('#settingsDoneBtn');assert.equal(await page.locator('.home-artists').count(),0);
  await page.click('.sidebar [data-view="library"]');
  assert.match(await page.locator('tr[data-track-id="a"]').textContent(),/Artist - Song/);
  assert.doesNotMatch(await page.locator('tr[data-track-id="a"]').textContent(),/SkySound|_/);
  assert.equal(await page.evaluate(()=>PainPlayer.getTracks()[0].title),tracks[0].title,'original metadata remains intact');
  await page.locator('.custom-playlist-item[data-id="mix-a"]').click();
  assert.equal(await page.locator('#view-playlist .playlist-artwork-tracks img').count(),3);
  await page.click('#playlistArtworkBtn');await page.check('input[name="playlistArtworkMode"][value="generated"]');
  const first=await page.locator('.playlist-artwork-preview img').getAttribute('src');assert.match(first,/^data:image\/svg\+xml/);
  await page.click('.playlist-artwork-refresh');const second=await page.locator('.playlist-artwork-preview img').getAttribute('src');assert.notEqual(first,second);
  await page.click('.playlist-artwork-dialog [data-close]');
  assert.equal(await page.locator('#view-playlist .playlist-artwork img').getAttribute('src'),second);
  await page.locator('#homeBrand').focus();await page.keyboard.press('Enter');await page.waitForSelector('#view-home.active');
  assert.equal(await page.locator('#continueOnPhoneBtn').textContent(),'');
  assert.ok((await page.locator('#continueOnPhoneBtn').boundingBox()).width<=36);
  await page.click('.sidebar [data-view="sync"]');
  for(const id of ['syncAllBtn','downloadAllAudioBtn','clearAllCacheBtn'])assert.ok(await page.locator('#'+id+' .sync-action-title').evaluate(el=>{const a=el.querySelector('svg').getBoundingClientRect(),b=el.querySelector('span').getBoundingClientRect();return b.left-a.right>=7;}),'device action icon and label have spacing');
  await page.reload();await page.click('#homeBrand');await page.waitForSelector('.home-mix[aria-busy="false"]');
  assert.equal(await page.evaluate(()=>FavoriteArtists.has('test artist')),true);
  assert.equal(await page.evaluate(()=>FavoriteArtists.enabled()),false);
  assert.equal(await page.evaluate(()=>PlaylistArtwork.getMode('mix-a')),'generated');
  assert.equal(await page.evaluate(()=>PlaylistArtwork.createArtwork('mix-a',1)),second);
  assert.equal(await page.evaluate(()=>localStorage.getItem('pain_clean_titles')),'true');
  assert.deepEqual(errors,[]);
  console.log('PASS: stable Home DOM/focus at 4x CPU, artist likes and visibility, configurable title cleanup without metadata mutation, cover modes/variation/persistence, logo keyboard navigation, phone icon and device button spacing.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
