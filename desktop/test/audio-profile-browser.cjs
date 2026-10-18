const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:800}});
 const records=[];
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('pain_lang','ru'));
 const tracks=[{id:'a',title:'Очень длинное название трека для проверки полноэкранного режима и адаптивности',artist:'Исполнитель',album:'Альбом',duration:25000,bytes:10000},{id:'b',title:'Второй трек',artist:'Исполнитель',album:'Альбом',duration:25000,bytes:10000}];
 // Opposite-polarity channels cancel when downmixed: analyse them separately.
 const samples=44100*25;const wav=Buffer.alloc(44+samples*4);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(2,22);wav.writeUInt32LE(44100,24);wav.writeUInt32LE(176400,28);wav.writeUInt16LE(4,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*4,40);
 for(let i=0;i<samples;i++){const value=Math.round(8000*Math.sin(2*Math.PI*330*i/44100));wav.writeInt16LE(value,44+i*4);wav.writeInt16LE(-value,46+i*4);}
 await page.route('**/api/**',async route=>{
  const u=new URL(route.request().url());
  if(u.pathname.startsWith('/api/cached-track/'))return route.fulfill({contentType:'audio/wav',body:wav});
  if(u.pathname==='/api/sync-stats')records.push(route.request().postDataJSON());
  let data={};if(u.pathname==='/api/saved-library')data={tracks};else if(u.pathname==='/api/playlists'||u.pathname==='/api/devices')data=[];else if(u.pathname==='/api/saved-stats')data={plays:[],slices:[]};else if(u.pathname==='/api/cached-tracks')data={cached:[]};
  await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto(process.env.PAIN_TEST_URL||'http://localhost:3099');await page.waitForSelector('tr[data-track-id="a"]');
 await page.click('#bottomPlayBtn');
 await page.waitForFunction(()=>{const profiles=window.painQueue?.audioProfiles;return profiles?.a?.seconds>=10;},{},{timeout:25000});
 const result=await page.evaluate(()=>({profile:window.painQueue.audioProfiles.a,stored:JSON.parse(localStorage.getItem('pain_audio_profiles_v2'))?.a}));
 assert.ok(result.profile.frames>=20);assert.equal(result.profile.vector.length,6);assert.deepEqual(result.profile,result.stored);assert.deepEqual(errors,[]);
 await page.click('#bottomPlayBtn');const frames=await page.evaluate(()=>window.painQueue.audioProfiles.a.frames);await page.waitForTimeout(1000);assert.equal(await page.evaluate(()=>window.painQueue.audioProfiles.a.frames),frames);
 console.log('PASS: live antiphase stereo analysis, local persistence, pause handling, no JS errors');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
