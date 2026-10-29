const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
function wave(){const rate=22050,n=rate*60,b=Buffer.alloc(44+n*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)b.writeInt16LE(Math.round(1000*Math.sin(2*Math.PI*440*i/rate)),44+i*2);return b;}
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
 try{
  const page=await browser.newPage({viewport:{width:1000,height:800}}),errors=[],audio=wave();let runtime={state:'missing',running:false,installed:false,supported:true},installs=0;
  const tracks=Array.from({length:477},(_,i)=>({id:'t'+i,title:'Track '+i,artist:'Artist '+i,duration:60000}));
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('pain_theme','form-night');localStorage.setItem('pain_lang','ru');localStorage.setItem('pain_pulseflow_policy','taste');localStorage.setItem('pain_shuffle_mode','off');});
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());if(u.origin!=='http://runtime.test')return route.abort();
   if(u.pathname==='/api/music-runtime'){
    if(JSON.parse(route.request().postData()).action==='install'){installs++;runtime={...runtime,state:'installing',phase:'packages',running:true};}
    return route.fulfill({json:runtime});
   }
   if(u.pathname==='/api/pulseflow/status')return route.fulfill({json:{installed:runtime.installed,runtime,state:runtime.installed?'no-audio':'not-installed',total:477,indexed:0,unavailable:tracks,lastError:'spawn C:\\Users\\user\\AppData\\Roaming\\Pain\\.pulseflow-venv\\Scripts\\python.exe ENOENT'}});
   if(u.pathname.startsWith('/api/cached-track/'))return route.fulfill({contentType:'audio/wav',body:audio});
   if(u.pathname.startsWith('/api/'))return route.fulfill({json:{'/api/saved-library':{tracks},'/api/saved-stats':{plays:[],slices:[]},'/api/cached-tracks':{cached:tracks.map(t=>t.id)}}[u.pathname]||[]});
   const file=u.pathname.startsWith('/assets/')?path.join(__dirname,'..',u.pathname):path.join(__dirname,'../src',u.pathname==='/'?'index.html':u.pathname);
   try{return route.fulfill({contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.ttf':'font/ttf'}[path.extname(file)]||'application/octet-stream',body:await fs.readFile(file)});}catch(_){return route.fulfill({status:404,body:''});}
  });
  await page.goto('http://runtime.test');await page.click('.nav-item[data-view="library"]');await page.locator('tr[data-track-id="t0"]').click();await page.waitForFunction(()=>!PainPlayer.getAudio().paused&&PainPlayer.getAudio().currentTime>.1);
  await page.click('#settingsToggleBtn');await page.waitForSelector('#pulseflowInstall:not([hidden])');
  assert.equal(await page.locator('#pulseflowInstall').isEnabled(),true);assert.equal(await page.locator('#pulseflowMissingDetails').isVisible(),false);
  assert.doesNotMatch(await page.locator('#pulseflowSettings').innerText(),/ENOENT|C:\\Users|Первый подбор обучит/);
  await page.click('#pulseflowInstall');await page.waitForFunction(()=>document.querySelector('#pulseflowStatus').textContent.includes('Установка компонентов'));
  assert.equal(installs,1);assert.equal(await page.locator('#pulseflowInstall').isDisabled(),true);assert.equal(await page.locator('#pulseflowIndex').isDisabled(),true);assert.equal(await page.evaluate(()=>PainPlayer.getAudio().paused),false);
  runtime={state:'ready',installed:true,running:false,supported:true};await page.waitForFunction(()=>document.querySelector('#pulseflowInstall').hidden);
  assert.equal(await page.locator('#pulseflowInstall').isVisible(),false);assert.equal(await page.locator('#pulseflowInstallCancel').isVisible(),false);assert.equal(await page.locator('#pulseflowCancel').isVisible(),false);
  assert.equal(await page.locator('#pulseflowIndex').isEnabled(),true);assert.match(await page.locator('#pulseflowMissingSummary').textContent(),/477/);assert.equal(await page.locator('#pulseflowMissingDetails').getAttribute('open'),null);
  await page.locator('#pulseflowMissingSummary').click();assert.ok((await page.locator('#pulseflowMissing').textContent()).split('\n').length<=11);
  assert.equal(await page.evaluate(()=>PainPlayer.getAudio().paused),false);assert.deepEqual(errors,[]);await page.screenshot({path:'/tmp/pain-runtime-settings.png'});
  console.log(JSON.stringify({cleanLibrary:477,oneClickInstall:true,noRawSpawnError:true,collapsedMissingFiles:true,nativePlaybackContinued:true,errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
