// Real audio playback plus the automatic download status flow. No installer runs.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
function audio(){
 const rate=22050,size=rate*8,body=Buffer.alloc(44+size*2);
 body.write('RIFF');body.writeUInt32LE(body.length-8,4);body.write('WAVEfmt ',8);body.writeUInt32LE(16,16);
 body.writeUInt16LE(1,20);body.writeUInt16LE(1,22);body.writeUInt32LE(rate,24);body.writeUInt32LE(rate*2,28);
 body.writeUInt16LE(2,32);body.writeUInt16LE(16,34);body.write('data',36);body.writeUInt32LE(size*2,40);
 for(let i=0;i<size;i++)body.writeInt16LE(Math.round(1000*Math.sin(2*Math.PI*440*i/rate)),44+i*2);
 return body;
}
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
 try{
  const page=await browser.newPage(),errors=[],wave=audio();let polls=0,installs=0;
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('pain_lang','ru');localStorage.setItem('pain_shuffle_mode','off');});
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());if(u.origin!=='http://pain.test')return route.abort();
   if(u.pathname==='/api/install-update'){installs++;return route.fulfill({status:500,json:{error:'Automatic updates must not restart playback'}});}
   if(u.pathname==='/api/update-status')return route.fulfill({json:{currentVersion:'1.8.4',latestVersion:'1.8.5',available:true,canInstall:true,status:++polls===1?'downloading':'downloaded'}});
   if(u.pathname==='/api/cached-track/a')return route.fulfill({contentType:'audio/wav',body:wave});
   if(u.pathname.startsWith('/api/')){
    const data={'/api/saved-library':{tracks:[{id:'a',title:'Playing during update',artist:'Audio fixture',duration:8000}]},'/api/saved-stats':{plays:[],slices:[]},'/api/cached-tracks':{cached:['a']}}[u.pathname]||[];
    return route.fulfill({json:data});
   }
   const file=u.pathname.startsWith('/assets/')?path.join(__dirname,'..',u.pathname):path.join(__dirname,'../src',u.pathname==='/'?'index.html':u.pathname);
   try{return route.fulfill({contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css','.ttf':'font/ttf','.png':'image/png'}[path.extname(file)]||'application/octet-stream',body:await fs.readFile(file)});}catch(_){return route.fulfill({status:404,body:''});}
  });
  await page.goto('http://pain.test');await page.locator('tr[data-track-id="a"]').click();
  await page.waitForFunction(()=>!PainPlayer.getAudio().paused&&PainPlayer.getAudio().currentTime>.1);
  const before=await page.evaluate(()=>PainPlayer.getAudio().currentTime);
  await page.click('#settingsToggleBtn');
  await page.waitForFunction(()=>document.querySelector('#updateActionBtn').textContent==='Перезапустить сейчас');
  assert.match(await page.locator('#updateStatusText').textContent(),/установится при выходе/);
  assert.equal(await page.locator('#updateActionBtn').isEnabled(),true);
  const playing=await page.evaluate(()=>({id:PainPlayer.getTrack()?.id,paused:PainPlayer.getAudio().paused,time:PainPlayer.getAudio().currentTime}));
  assert.equal(playing.id,'a');assert.equal(playing.paused,false);assert.ok(playing.time>before+.5);
  assert.equal(installs,0);assert.ok(polls>=2,'background download must advance to ready in the UI');assert.deepEqual(errors,[]);
  console.log(JSON.stringify({automaticReady:true,nativePlaybackContinued:true,installerRequests:installs,statusPolls:polls,errors}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
