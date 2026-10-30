const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{fixture}=require('./together-fixture.cjs');
(async()=>{
 const f=await fixture(),browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required','--mute-audio']});
 try{
  const pages=[],errors=[];
  for(let i=0;i<2;i++){
   const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();pages.push(page);page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
   await page.addInitScript(()=>{localStorage.setItem('pain_theme','form-night');localStorage.setItem('pain_lang','ru');localStorage.setItem('pain_track_transition','1');localStorage.setItem('pain_shuffle_mode','smart');
    const connect=AudioNode.prototype.connect;AudioNode.prototype.connect=function(destination,...args){if(destination instanceof AudioDestinationNode){const meter=this.context.createAnalyser();meter.fftSize=1024;window.sessionMeter=meter;connect.call(this,meter);return connect.call(meter,destination,...args);}return connect.call(this,destination,...args);};
   });
   await page.goto(f.bases[i]);await page.click('.nav-item[data-view="home"]');await page.click('#togetherOpen');
  }
  const [host,guest]=pages;
  await host.click('#togetherCreate');await host.waitForFunction(()=>PainTogether.snapshot().connected);await host.click('#togetherCopy');await host.waitForFunction(()=>document.getElementById('togetherInviteOutput').value.startsWith('pain-listen:'));const invite=await host.locator('#togetherInviteOutput').inputValue();
  await guest.fill('#togetherInviteInput',invite);await guest.click('#togetherJoin');await guest.waitForFunction(()=>PainTogether.snapshot().connected);
  await host.locator('[data-together-add="host0"]').click();await host.locator('[data-together-add="host1"]').click();await guest.locator('[data-together-add="guest0"]').click();await host.waitForSelector('#togetherProposals [data-together-action="accept"]');await host.locator('#togetherProposals [data-together-action="accept"]').click();
  await host.locator('#togetherQueue [data-together-action="play"]').first().click();
  for(const page of pages)await page.waitForFunction(()=>!PainPlayer.getAudio().paused&&PainPlayer.getAudio().currentTime>.5);
  for(const page of pages)await page.waitForFunction(()=>{const meter=window.sessionMeter;if(!meter)return false;const samples=new Float32Array(meter.fftSize);meter.getFloatTimeDomainData(samples);return Math.sqrt(samples.reduce((s,v)=>s+v*v,0)/samples.length)>.005;});
  const drift=async()=>{const times=await Promise.all(pages.map(page=>page.evaluate(()=>PainPlayer.getAudio().currentTime)));return Math.abs(times[0]-times[1]);};
  assert.ok(await drift()<.5,'independent decoders must share a playhead after buffering');
  await host.click('#togetherClose');await guest.click('#togetherClose');
  await host.click('#bottomPlayBtn');for(const page of pages)await page.waitForFunction(()=>PainPlayer.getAudio().paused);
  await host.click('#bottomPlayBtn');for(const page of pages)await page.waitForFunction(()=>!PainPlayer.getAudio().paused);
  await host.evaluate(()=>PainTogether.seek(3));await host.waitForTimeout(500);assert.ok(await drift()<.5);
  await host.click('#togetherOpen');await host.selectOption('#togetherMode','equal');await guest.waitForFunction(()=>PainTogether.snapshot().state.mode==='equal');
  await guest.click('#bottomPlayBtn');for(const page of pages)await page.waitForFunction(()=>PainPlayer.getAudio().paused);
  await guest.click('#bottomPlayBtn');for(const page of pages)await page.waitForFunction(()=>!PainPlayer.getAudio().paused);
  await host.screenshot({path:'/tmp/pain-together-host.png'});
  const first=await host.evaluate(()=>PainTogether.snapshot().state.playback.uid);
  await host.evaluate(()=>PainTogether.seek(11.5));
  for(const page of pages)await page.waitForFunction(first=>PainTogether.snapshot().state.playback.uid!==first&&!PainPlayer.getAudio().paused,first);
  assert.equal(await host.evaluate(()=>PainTogether.snapshot().state.playback.uid),await guest.evaluate(()=>PainTogether.snapshot().state.playback.uid));
  const identity=await host.evaluate(()=>PainTogether.snapshot().identity),room=[...f.relay.rooms.values()][0];room.members.get(identity).ws.terminate();
  await host.waitForFunction(()=>!PainTogether.snapshot().connected);await host.waitForFunction(()=>PainTogether.snapshot().connected,null,{timeout:15000});
  assert.equal(await host.evaluate(()=>PainTogether.snapshot().identity),identity,'reconnection preserves the host and its room');
  await host.click('#togetherClose');await host.click('#bottomPlayBtn');for(const page of pages)await page.waitForFunction(()=>!PainPlayer.getAudio().paused&&PainPlayer.getAudio().currentTime>.1);
  await host.click('#togetherOpen');
  await host.click('#togetherLeave');for(const page of pages)await page.waitForFunction(()=>!PainTogether.active);
  // The worker must build all 20 charts from a copy of actual saved events.
  for(const name of ['library.json','stats.json'])await fs.copyFile(path.resolve(__dirname,'../data',name),path.join(f.root,'host/data',name));
  await host.bringToFront();await host.reload();await host.waitForFunction(()=>PainPlayer.getTracks().length>100);await host.click('.nav-item[data-view="insights"]');
  try{await host.waitForSelector('.insight-figure');}catch(error){console.log('Chart diagnostic',await host.locator('#insightGalleryStatus').textContent(),errors,await host.evaluate(()=>new Promise(resolve=>{const worker=new Worker('insight-charts-worker.js');worker.onmessage=event=>{resolve(event.data.error||event.data.result?.cards?.length);worker.terminate();};worker.onerror=event=>{resolve(event.message);worker.terminate();};worker.postMessage({id:1,range:'all'});})));throw error;}
  assert.equal(await host.locator('.insight-figure').count(),20);
  for(const period of ['28','90','all']){await host.click(`[data-insight-range="${period}"]`);await host.waitForFunction(()=>document.getElementById('insightGallery').getAttribute('aria-busy')==='false');assert.equal(await host.locator('.insight-figure').count(),20);}
  for(const figure of await host.locator('.insight-figure').all()){await figure.scrollIntoViewIfNeeded();await figure.locator('svg').waitFor();assert.ok(!/NaN|Infinity/.test(await figure.locator('svg').innerHTML()));}
  await host.locator('#insightGallery').evaluate(node=>node.scrollIntoView({block:'start'}));await host.screenshot({path:'/tmp/pain-restored-insights.png'});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({independentPlayers:2,actualAudioOutput:true,hostAndProposals:true,equalRights:true,pauseSeekResume:true,naturalAdvance:true,reconnectPreservesHost:true,chartsFromRealHistory:20,periods:3,errors}));
 }finally{await browser.close();await f.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
