// Visual/interaction acceptance on an isolated copy of the saved music library.
const {_electron}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const root=fs.mkdtempSync(path.resolve(__dirname,'../.night-browser-')),source=path.resolve(__dirname,'../data'),library=JSON.parse(fs.readFileSync(path.join(source,'library.json')));
 fs.mkdirSync(path.join(root,'data'));fs.mkdirSync(path.join(root,'cache'));fs.mkdirSync(path.join(root,'covers'));fs.mkdirSync(path.join(root,'data/pulseflow'));
 for(const name of fs.readdirSync(source))if(name.endsWith('.json'))fs.copyFileSync(path.join(source,name),path.join(root,'data',name));
 for(const name of ['catalog.npz','status.json','input.json','errors.json'])if(fs.existsSync(path.join(source,'pulseflow',name)))fs.copyFileSync(path.join(source,'pulseflow',name),path.join(root,'data/pulseflow',name));
 for(const type of ['cache','covers'])for(const name of fs.readdirSync(path.resolve(__dirname,'..',type)))if(fs.statSync(path.resolve(__dirname,'..',type,name)).isFile())fs.linkSync(path.resolve(__dirname,'..',type,name),path.join(root,type,name));
 for(const name of ['genre-preferences','lyrics-preferences','discord-presence'])fs.writeFileSync(path.join(root,'data',name+'.json'),JSON.stringify({enabled:false}));
 let app,errors=[];
 try{
  const env={...process.env,PAIN_DATA_DIR:root,PAIN_USER_DATA_DIR:path.join(root,'profile'),PAIN_DISCOVERY:'false',PAIN_PULSEFLOW_AUTO_INDEX:'false',PORT:'3193'};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:require('electron'),args:[path.resolve(__dirname,'..'),...(process.env.PAIN_HEADLESS?['--ozone-platform=headless','--disable-gpu','--no-sandbox']:[])],env});const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
  await page.addInitScript(()=>{localStorage.setItem('pain_theme','form-night');localStorage.setItem('pain_lang','ru');localStorage.setItem('pain_performance_mode','balanced');window.nightTasks=[];window.nightTaskDetails=[];window.nightAction='start';new PerformanceObserver(l=>{for(const e of l.getEntries()){window.nightTasks.push(e.duration);window.nightTaskDetails.push({duration:e.duration,action:window.nightAction});}}).observe({type:'longtask',buffered:true});});
  await app.evaluate(({BrowserWindow})=>{globalThis.nightUnresponsive=0;const win=BrowserWindow.getAllWindows()[0];win.webContents.setAudioMuted(true);win.on('unresponsive',()=>globalThis.nightUnresponsive++);});
  await page.setViewportSize({width:1440,height:1000});await page.reload();await page.waitForFunction(n=>window.painQueue?.tracks.length===n,library.tracks.length);
  await page.waitForSelector('#view-home.active .home-turntable');assert.equal(await page.locator('html').getAttribute('data-theme'),'form-night');
  const colors=await page.evaluate(()=>{const s=getComputedStyle(document.documentElement),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');const rgb=color=>{ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3);};const lum=color=>rgb(color).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);const contrast=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};const bg=s.getPropertyValue('--form-surface');return {text:contrast(s.getPropertyValue('--ink'),bg),muted:contrast(s.getPropertyValue('--ink-muted'),bg),primary:contrast(s.getPropertyValue('--accent'),s.getPropertyValue('--night-accent-ink')),scheme:s.colorScheme};});
  assert.equal(colors.scheme,'dark');assert.ok(colors.muted>=4.5&&colors.primary>=4.5&&colors.text>=7,JSON.stringify(colors));
  await page.screenshot({path:'/tmp/pain-form-night-home.png'});
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('pain:theme')));await page.waitForSelector('.night-metal-glint',{timeout:20000});assert.equal(await page.locator('.night-metal-glint').evaluate(e=>getComputedStyle(e,'::after').animationName),'night-metal');await page.screenshot({path:'/tmp/pain-form-night-metal.png'});
  await page.waitForFunction(()=>!document.querySelector('.night-metal-glint'));
  await page.click('.nav-item[data-view="library"]');const track=library.tracks.find(t=>t.mime==='audio/mpeg'&&t.duration>180000);
  await page.locator(`tr[data-track-id="${track.id}"]`).click();await page.waitForFunction(()=>!window.PainPlayer.getAudio().paused&&window.PainPlayer.getAudio().currentTime>1);
  assert.equal(await page.locator('.playing-row .row-playback-mark i').first().evaluate(e=>getComputedStyle(e).animationName),'night-playing');
  await page.click('#bottomPlayBtn');await page.waitForFunction(()=>document.documentElement.dataset.playing==='false');assert.equal(await page.locator('.playing-row .row-playback-mark i').first().evaluate(e=>getComputedStyle(e).animationPlayState),'paused');await page.click('#bottomPlayBtn');
  await page.click('#karaokeBtn');await page.waitForSelector('#karaoke:not([hidden])');
  assert.ok(await page.evaluate(()=>document.getElementById('karaoke').getBoundingClientRect().bottom<=document.getElementById('bottomPlayerBar').getBoundingClientRect().top),'karaoke never overlaps the transport');
  assert.equal(await page.locator('#bottomPlayerBar').evaluate(e=>getComputedStyle(e).backgroundImage),'none');await page.screenshot({path:'/tmp/pain-form-night-karaoke.png'});await page.click('#karaokeClose');
  const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});await page.evaluate(()=>window.nightTasks=[]);
  await page.screenshot({path:'/tmp/pain-form-night-library.png'});
  await page.evaluate(()=>window.nightAction='settings and themes');
  await page.click('#settingsToggleBtn');await page.locator('input[name="appearanceTheme"][value="form-night"]').locator('..').scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/pain-form-night-settings.png'});
  await page.locator('input[name="appearanceTheme"][value="form"]').locator('..').click();assert.equal(await page.locator('html').getAttribute('data-theme'),'form');
  await page.locator('input[name="appearanceTheme"][value="form-night"]').locator('..').click();assert.equal(await page.locator('html').getAttribute('data-theme'),'form-night');
  assert.equal(await page.evaluate(()=>localStorage.getItem('pain_theme')),'form-night');assert.ok(await page.evaluate(()=>!window.PainPlayer.getAudio().paused),'theme switching keeps music playing');
  await page.selectOption('#performanceMode','maximum');await page.click('#settingsDoneBtn');await page.hover('#bottomPlayBtn');
  assert.equal(await page.locator('#bottomPlayBtn').evaluate(e=>getComputedStyle(e).transitionDuration),'0s');
  await page.click('#settingsToggleBtn');await page.selectOption('#performanceMode','balanced');await page.click('#settingsDoneBtn');
  await page.evaluate(()=>window.nightAction='insights');await page.emulateMedia({reducedMotion:'reduce'});await page.click('.nav-item[data-view="insights"]');assert.equal(await page.locator('#view-insights').evaluate(e=>getComputedStyle(e).animationName),'none');
  await page.emulateMedia({reducedMotion:'no-preference'});await page.waitForSelector('.genre-orbit svg');await page.screenshot({path:'/tmp/pain-form-night-insights.png'});
  assert.equal(await page.locator('#topTracksList .leaderboard-item').count(),50);assert.equal(await page.locator('#topArtistsList .leaderboard-item').count(),50);
  await page.selectOption('#topTracksPeriod','7');assert.equal(await page.locator('#topArtistsPeriod').inputValue(),'7');
  await page.selectOption('#topArtistsPeriod','all');assert.equal(await page.locator('#topTracksPeriod').inputValue(),'all');
  await page.locator('#topTracksList').evaluate(e=>e.scrollTop=e.scrollHeight);await page.waitForFunction(()=>document.querySelector('#topTracksList .leaderboard-item:last-child .leaderboard-rank')?.textContent==='50');
  await page.locator('#insightGallery').evaluate(e=>e.scrollIntoView({block:'start'}));await page.waitForSelector('.insight-figure[data-mounted] svg');await page.waitForTimeout(900);await page.screenshot({path:'/tmp/pain-form-night-charts.png'});
  await page.evaluate(()=>window.nightAction='player');await page.click('.nav-item[data-view="player"]');await page.screenshot({path:'/tmp/pain-form-night-player.png'});
  await cdp.send('Performance.enable');
  for(const view of ['sync','favorites','library','home']){await page.evaluate(view=>window.nightAction=view,view);const before=view==='library'?await cdp.send('Performance.getMetrics'):null;await page.click(`.nav-item[data-view="${view}"]`);assert.ok(await page.locator('#view-'+view).isVisible());if(before){const after=await cdp.send('Performance.getMetrics');console.log('LIBRARY TIMING',Object.fromEntries(after.metrics.filter(m=>['ScriptDuration','LayoutDuration','RecalcStyleDuration','TaskDuration'].includes(m.name)).map(m=>[m.name,Math.round((m.value-before.metrics.find(x=>x.name===m.name).value)*1000)])));}}
  await page.evaluate(()=>window.nightAction='responsive');for(const [width,height] of [[1000,800],[390,844]]){
   await page.setViewportSize({width,height});await page.waitForTimeout(300);
   assert.ok(await page.locator('.app-layout').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'shell fits '+width);
   assert.ok(await page.locator('.views-viewport').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'content fits '+width);
   await page.screenshot({path:`/tmp/pain-form-night-${width}.png`});
  }
  await page.evaluate(()=>window.nightAction='quick theme toggle');await page.setViewportSize({width:1440,height:1000});await page.click('#themeToggle');assert.equal(await page.locator('html').getAttribute('data-theme'),'form');await page.click('#themeToggle');assert.equal(await page.locator('html').getAttribute('data-theme'),'form-night');
  const maxTask=await page.evaluate(()=>Math.max(0,...window.nightTasks));assert.ok(maxTask<1000,'long task '+maxTask);assert.deepEqual(errors,[]);assert.equal(await app.evaluate(()=>globalThis.nightUnresponsive),0);
  await page.reload();await page.waitForFunction(n=>window.painQueue?.tracks.length===n,library.tracks.length);assert.equal(await page.locator('html').getAttribute('data-theme'),'form-night');
  console.log(JSON.stringify({tracks:library.tracks.length,theme:'form-night',contrast:colors,views:6,widths:[1440,1000,390],cpuSlowdown:4,maxTask,unresponsive:0,audio:'uninterrupted during theme switching',errors}));
 }catch(error){if(app){const page=await app.firstWindow();console.log('LONG TASKS',await page.evaluate(()=>window.nightTaskDetails.sort((a,b)=>b.duration-a.duration).slice(0,8)));console.log('MOTION',await page.evaluate(()=>({timers:window.nightTimers,hidden:document.hidden,flags:{...document.documentElement.dataset},media:matchMedia('(prefers-reduced-motion: reduce)').matches,headings:[...document.querySelectorAll('.view-pane.active h1')].map(e=>({text:e.textContent,r:e.getBoundingClientRect().toJSON()}))})));console.log('ERRORS',errors);await page.screenshot({path:'/tmp/pain-form-night-failure.png'}).catch(()=>{});}throw error;}
 finally{if(app)await app.close();fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
