// Actual audio endings and the full Home -> queue -> worker flow; isolated API fixtures.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
function wave(){
 const rate=22050,count=rate,body=Buffer.alloc(44+count*2);
 body.write('RIFF');body.writeUInt32LE(body.length-8,4);body.write('WAVEfmt ',8);body.writeUInt32LE(16,16);
 body.writeUInt16LE(1,20);body.writeUInt16LE(1,22);body.writeUInt32LE(rate,24);body.writeUInt32LE(rate*2,28);
 body.writeUInt16LE(2,32);body.writeUInt16LE(16,34);body.write('data',36);body.writeUInt32LE(count*2,40);
 for(let i=0;i<count;i++)body.writeInt16LE(Math.round(1500*Math.sin(2*Math.PI*440*i/rate)),44+i*2);
 return body;
}
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
 try{
  for(const [policy,unavailable] of [['taste',false],['personal',false],['taste',true]]){
   const context=await browser.newContext(),page=await context.newPage(),errors=[],body=wave();let calls=0;
   const tracks=Array.from({length:24},(_,i)=>({id:'h'+i,title:'Home song '+i,artist:'Artist '+i,duration:1000}));
   const stats={plays:tracks.map((t,i)=>({id:'p'+i,track:t.id,started:Date.now()-100000-i*2000,heard:1000,media_heard:1000,duration:1000,finished:1})),slices:[]};
   page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(policy=>{localStorage.setItem('pain_theme','form-night');localStorage.setItem('pain_pulseflow_policy',policy);localStorage.setItem('pain_lang','ru');localStorage.setItem('pain_shuffle_mode','off');localStorage.setItem('pain_track_transition','0');},policy);
   await page.route('**/*',async route=>{
    const u=new URL(route.request().url());if(u.origin!=='http://home.test')return route.abort();
    if(u.pathname==='/api/personal/recommend'||u.pathname==='/api/pulseflow/recommend'){
     const p=JSON.parse(route.request().postData());if(p.action)return route.fulfill({json:{state:'ready'}});calls++;
     if(unavailable)return route.fulfill({status:503,json:{error:'Unavailable fixture'}});
     return route.fulfill({json:{tracks:[...p.eligible].reverse().slice(0,p.length).map(id=>({id,score:.5,reasons:['Весь ваш вкус'],explanation:{method:'personal-taste',historyEvents:24}}))}});
    }
    if(u.pathname.startsWith('/api/cached-track/'))return route.fulfill({contentType:'audio/wav',body});
    if(u.pathname.startsWith('/api/'))return route.fulfill({json:{'/api/saved-library':{tracks},'/api/saved-stats':stats,'/api/cached-tracks':{cached:tracks.map(t=>t.id)}}[u.pathname]||[]});
    const file=u.pathname.startsWith('/assets/')?path.join(__dirname,'..',u.pathname):path.join(__dirname,'../src',u.pathname==='/'?'index.html':u.pathname);
    try{return route.fulfill({contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.ttf':'font/ttf'}[path.extname(file)]||'application/octet-stream',body:await fs.readFile(file)});}catch(_){return route.fulfill({status:404,body:''});}
   });
   const ids=()=>page.locator('.home-mix [data-home-action="mix"]').evaluateAll(rows=>rows.map(r=>r.dataset.id));
   await page.goto('http://home.test');await page.click('.nav-item[data-view="home"]');await page.waitForFunction(()=>document.querySelector('.home-explored')?.textContent.includes('24'));
   await page.waitForSelector('.home-mix[aria-busy="false"]');
   // Home's catalog is larger than the currently selected Favorites queue.
   await page.evaluate(track=>painQueue.setContext('favorites',[track],0),tracks[0]);
   await page.click('[data-home-action="refresh"]');await page.waitForSelector('.home-mix[aria-busy="false"]');
   const displayed=await ids();assert.equal(displayed.length,6,'Home must work from a smaller queue and when the backend is unavailable');
   const generated=calls;
   await page.click('[data-home-action="mix-play"]');
   for(let i=0;i<displayed.length;i++){
    await page.waitForFunction(id=>PainPlayer.getTrack()?.id===id&&!PainPlayer.getAudio().paused&&PainPlayer.getAudio().currentTime>.05,displayed[i]);
    assert.deepEqual(await ids(),displayed,'playback must never regenerate the displayed list');
    if(i===0&&!unavailable)assert.notEqual(await page.evaluate(()=>painQueue.getLastTransition()?.explanation?.method),'frequency-fallback','a healthy model must really serve the Home mix');
    if(i===1)await page.evaluate(()=>painQueue.refreshLibrary(painQueue.tracks.map(t=>({...t,album:'Refreshed metadata'}))));
    if(i<displayed.length-1)assert.equal(calls,generated,'all scheduled rows must play without requesting a replacement');
   }
   await page.waitForFunction(id=>PainPlayer.getTrack()?.id!==id&&!PainPlayer.getAudio().paused,displayed.at(-1));
   assert.ok(calls>generated,'ordinary recommendations resume after the shown sequence');assert.deepEqual(await ids(),displayed);
   await page.click('[data-home-action="refresh"]');await page.waitForSelector('.home-mix[aria-busy="false"]');
   const refreshed=await ids();assert.equal(refreshed.length,6);assert.notDeepEqual(refreshed,displayed);
   await page.locator('.home-mix [data-home-action="mix"]').nth(1).click();
   await page.waitForFunction(id=>PainPlayer.getTrack()?.id===id&&!PainPlayer.getAudio().paused,refreshed[1]);
   await page.waitForFunction(id=>PainPlayer.getTrack()?.id===id&&!PainPlayer.getAudio().paused,refreshed[2]);
   assert.deepEqual(await ids(),refreshed);assert.deepEqual(errors,[]);
   console.log(JSON.stringify({policy,unavailable,orderedActualEndings:6,syncPreserved:true,normalRecommendationsAfter:true,manualRefresh:true,clickedRowContinues:true,errors}));
   await context.close();
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
