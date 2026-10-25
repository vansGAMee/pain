// Real Web Audio sources during a crossfade; API routes are isolated fixtures.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
function tone(frequency){
 const rate=44100,samples=rate*30,wav=Buffer.alloc(44+samples*2);
 wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);
 wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);
 wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
 for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(8000*Math.sin(2*Math.PI*frequency*i/rate)),44+i*2);
 return wav;
}
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage(),errors=[],waves={a:tone(110),b:tone(6000)};
  const tracks=['a','b'].map(id=>({id,title:id,artist:id,duration:30000}));
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('pain_track_transition','4');localStorage.setItem('pain_lang','ru');});
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());if(url.origin!=='http://localhost')return route.abort();
   if(url.pathname.startsWith('/api/cached-track/'))return route.fulfill({contentType:'audio/wav',body:waves[url.pathname.split('/').at(-1)]});
   if(url.pathname.startsWith('/api/')){
    let data={};
    if(url.pathname==='/api/saved-library')data={tracks};
    else if(url.pathname==='/api/saved-stats')data={plays:[],slices:[]};
    else if(url.pathname==='/api/cached-tracks')data={cached:[]};
    else if(['/api/playlists','/api/devices'].includes(url.pathname))data=[];
    return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
   }
   const root=path.resolve(__dirname,'../src'),file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
   if(!file.startsWith(root+path.sep))return route.abort();
   try{return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html',body:await fs.readFile(file)});}
   catch(_){return route.fulfill({status:404,body:''});}
  });
  await page.goto('http://localhost');
  await page.locator('tr[data-track-id="a"]').click();
  await page.waitForFunction(()=>window.painQueue.audioProfiles.a?.frames>=5);
  await page.locator('tr[data-track-id="b"]').click();
  await page.waitForFunction(()=>window.painQueue.audioProfiles.b?.frames>=4);
  const during=await page.evaluate(()=>({a:window.painQueue.audioProfiles.a,b:window.painQueue.audioProfiles.b,
   playing:[...document.querySelectorAll('audio')].filter(a=>!a.paused).length}));
  assert.equal(during.playing,2,'measure while both crossfade sources are playing');
  assert.ok(during.a.vector[1]>.99,'outgoing bass remains bass');
  assert.ok(during.b.vector[3]>.99,'incoming high tone must not contain outgoing bass');
  await page.waitForFunction(()=>window.painQueue.audioProfiles.b?.seconds>=10);
  const saved=await page.evaluate(()=>({p:window.painQueue.audioProfiles.b,stored:JSON.parse(localStorage.getItem('pain_audio_profiles_v4')).b}));
  assert.deepEqual(saved.p,saved.stored);
  assert.ok(saved.p.vector[3]>.99);assert.deepEqual(errors,[]);
  console.log('PASS: overlapping decks keep separate acoustic identities; full profiles persist without browser errors');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
