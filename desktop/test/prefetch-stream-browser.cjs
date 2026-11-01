// Real HTTP phone and app server, with all files confined to a temporary directory.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {wave}=require('./together-fixture.cjs');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process'),assert=require('node:assert/strict');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pain-prefetch-stream-')),data=path.join(root,'data'),body=wave(60),requests=[];
 fs.mkdirSync(data);fs.mkdirSync(path.join(root,'downloads'));
 const tracks=['a','b','c'].map(id=>({id,title:'Song '+id,artist:'Test',duration:60000,bytes:body.length,mime:'audio/wav',...(id==='a'?{path:'original.wav'}:{})}));
 const library=JSON.stringify({tracks});fs.writeFileSync(path.join(data,'library.json'),library);fs.writeFileSync(path.join(root,'downloads/original.wav'),body);
 for(const name of ['lyrics-preferences','genre-preferences','discord-presence'])fs.writeFileSync(path.join(data,name+'.json'),'{"enabled":false}');
 fs.writeFileSync(path.join(data,'performance-mode.json'),'{"mode":"maximum"}');
 const phone=http.createServer((req,res)=>{
  const id=req.url.split('/').at(-1);if(!['b','c'].includes(id)){res.writeHead(404);res.end();return;}
  const entry={id,range:req.headers.range,complete:false,closed:false};requests.push(entry);
  const range=/bytes=(\d+)-(\d*)/.exec(req.headers.range||''),start=range?Number(range[1]):0,end=range&&range[2]?Math.min(Number(range[2]),body.length-1):body.length-1;
  res.writeHead(range?206:200,{'Content-Type':'audio/wav','Content-Length':end-start+1,'Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${start}-${end}/${body.length}`}:{})});
  const initial=Math.min(end+1,start+1024*1024);res.write(body.subarray(start,initial));
  const timer=setTimeout(()=>{entry.complete=true;res.end(body.subarray(initial,end+1));},5000);
  res.on('close',()=>{entry.closed=true;clearTimeout(timer);});
 });await new Promise(r=>phone.listen(0,'127.0.0.1',r));
 const phoneUrl='http://127.0.0.1:'+phone.address().port;fs.writeFileSync(path.join(data,'last_phone_ip.txt'),'127.0.0.1:'+phone.address().port);
 const reservation=http.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const child=spawn(process.execPath,[path.resolve(__dirname,'../src/server.js')],{env:{...process.env,PORT:String(port),PAIN_DATA_DIR:root,OPEN_BROWSER:'false',PAIN_DISCOVERY:'false',PAIN_PULSEFLOW_AUTO_INDEX:'false'},stdio:['ignore','pipe','pipe']});
 let log='',browser;child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 try{
  for(let i=0;i<150&&!log.includes('Web UI:');i++){if(child.exitCode!==null)throw Error(log);await sleep(50);}assert.ok(log.includes('Web UI:'),log);
  browser=await chromium.launch({headless:true,args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});const page=await browser.newPage(),errors=[];
  page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
  // Isolate optional external information providers as well as application data.
  await page.route('**/*',route=>new URL(route.request().url()).origin===`http://localhost:${port}`?route.continue():route.abort());
  await page.addInitScript(phoneUrl=>{localStorage.setItem('pain_phone_url',phoneUrl);localStorage.setItem('pain_track_transition','0');localStorage.setItem('pain_shuffle_mode','off');localStorage.setItem('pain_performance_mode','maximum');},phoneUrl);
  await page.goto('http://localhost:'+port+'/#library');await page.locator('.nav-item[data-view="library"]').click();
  await page.locator('tr[data-track-id="a"]').click();await page.waitForFunction(()=>PainPlayer.getAudio().currentTime>.05);
  // Pause before the initial preparation timer, then resume: preparation must restart.
  await page.click('#bottomPlayBtn');await sleep(650);assert.equal(requests.length,0);
  await page.click('#bottomPlayBtn');await page.waitForFunction(()=>[...document.querySelectorAll('audio')].some(a=>a!==PainPlayer.getAudio()&&a.src.includes('/b?')&&a.readyState>=3));
  assert.equal(requests.filter(r=>r.id==='b').length,1);assert.equal(requests[0].complete,false,'decoder ready before the complete download');
  assert.equal(fs.existsSync(path.join(root,'cache/b.mp3')),false,'partial files never become complete cache entries');
  const switchMs=await page.evaluate(()=>new Promise(resolve=>{const at=performance.now();for(const a of document.querySelectorAll('audio'))a.addEventListener('playing',()=>{if(a===PainPlayer.getAudio())resolve(performance.now()-at);},{once:true});document.querySelector('#bottomNextBtn').click();}));
  await page.waitForFunction(()=>PainPlayer.getTrack()?.id==='b'&&PainPlayer.getAudio().currentTime>.1);
  assert.ok(switchMs<600,`prepared streaming switch took ${switchMs} ms`);assert.equal(requests.filter(r=>r.id==='b').length,1,'Next reuses the ongoing stream');
  // Let the next speculative transfer start, then replace it with a local selection.
  for(let i=0;i<60&&!requests.some(r=>r.id==='c');i++)await sleep(50);assert.ok(requests.some(r=>r.id==='c'));
  await page.locator('tr[data-track-id="a"]').click();await page.waitForFunction(()=>PainPlayer.getTrack()?.id==='a'&&PainPlayer.getAudio().currentTime>.05);await page.click('#bottomPlayBtn');
  for(let i=0;i<60&&requests.some(r=>!r.closed);i++)await sleep(50);
  assert.ok(requests.every(r=>r.closed),'discarded speculative streams are cancelled');
  assert.deepEqual(fs.readdirSync(path.join(root,'cache')),[],'no copies of imports or incomplete transfers left in the cache');
  assert.equal(fs.readFileSync(path.join(data,'library.json'),'utf8'),library);assert.deepEqual(fs.readFileSync(path.join(root,'downloads/original.wav')),body);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({switchMs,readyBeforeFullDownload:true,singlePhoneRequest:true,resumePreparation:true,cancelledTransfers:true,libraryUnchanged:true,importPlayedWithoutCopy:true,errors}));
 }finally{
  if(browser)await browser.close();child.kill();await new Promise(r=>child.exitCode===null?child.once('exit',r):r());phone.closeAllConnections();await new Promise(r=>phone.close(r));fs.rmSync(root,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
