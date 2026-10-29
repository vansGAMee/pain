// Real application server + HTTP phone + decoded Web Audio, isolated data only.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),{spawn}=require('node:child_process'),assert=require('node:assert/strict');
function tone(){
 const rate=44100,n=rate*8,b=Buffer.alloc(44+n*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);
 b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);
 for(let i=0;i<n;i++)b.writeInt16LE(Math.round(8000*Math.sin(2*Math.PI*440*i/rate)),44+i*2);return b;
}
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pain-phone-browser-')),data=path.join(root,'data'),wav=tone(),requests=[];fs.mkdirSync(data);
 const track={id:'old',title:'Any Artist — Any song (English Version)',artist:'Неизвестный исполнитель',duration:8000,bytes:wav.length,mime:'audio/wav'};
 const tracks=[track,{...track,id:'missing',title:'Absent song',artist:'Any Artist'}],library=JSON.stringify({tracks});fs.writeFileSync(path.join(data,'library.json'),library);
 for(const name of ['lyrics-preferences','genre-preferences','discord-presence'])fs.writeFileSync(path.join(data,name+'.json'),'{"enabled":false}');
 fs.writeFileSync(path.join(data,'performance-mode.json'),'{"mode":"maximum"}');
 const phone=http.createServer((req,res)=>{
  requests.push(req.url);if(req.url==='/api/library')return res.end(JSON.stringify({tracks:[{...track,id:'new',title:'Any song (English Version)',artist:'Any Artist'}]}));
  if(req.url!=='/api/track/new'){res.writeHead(404);res.end('Track not found');return;}
  const timer=setTimeout(()=>{
   const range=/bytes=(\d+)-(\d*)/.exec(req.headers.range||''),start=range?Number(range[1]):0,end=range&&range[2]?Math.min(Number(range[2]),wav.length-1):wav.length-1;
   res.writeHead(range?206:200,{'Content-Type':'audio/wav','Content-Length':end-start+1,'Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${start}-${end}/${wav.length}`}:{})});res.end(wav.subarray(start,end+1));
  },900);res.on('close',()=>clearTimeout(timer));
 });await new Promise(r=>phone.listen(0,'127.0.0.1',r));
 const phoneUrl='http://127.0.0.1:'+phone.address().port;fs.writeFileSync(path.join(data,'last_phone_ip.txt'),'127.0.0.1:'+phone.address().port);
 const portServer=http.createServer();await new Promise(r=>portServer.listen(0,'127.0.0.1',r));const port=portServer.address().port;await new Promise(r=>portServer.close(r));
 const baseline=process.argv.includes('--baseline');
 const args=baseline?['-e',`const M=require('module'),p=require('path'),f=p.resolve('src/server.js'),m=new M(f);m.filename=f;m.paths=M._nodeModulePaths(p.dirname(f));m._compile(require('child_process').execFileSync('git',['show','v1.8.7:desktop/src/server.js'],{encoding:'utf8'}),f);`]:['src/server.js'];
 const child=spawn(process.execPath,args,{cwd:path.resolve(__dirname,'..'),env:{...process.env,PORT:String(port),PAIN_DATA_DIR:root,OPEN_BROWSER:'false',PAIN_DISCOVERY:'false',PAIN_PULSEFLOW_AUTO_INDEX:'false'},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
 let browser;
 try{
  for(let i=0;i<100&&!log.includes('Web UI:');i++){if(child.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,50));}
  assert.ok(log.includes('Web UI:'),log);browser=await chromium.launch({headless:true,args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(phoneUrl=>{
   localStorage.setItem('pain_phone_url',phoneUrl);localStorage.setItem('pain_lang','ru');localStorage.setItem('pain_theme','form-night');localStorage.setItem('pain_track_transition','1');localStorage.setItem('pain_shuffle_mode','off');localStorage.setItem('pain_performance_mode','maximum');
   const connect=AudioNode.prototype.connect;AudioNode.prototype.connect=function(destination,...args){if(destination instanceof AudioDestinationNode){const meter=this.context.createAnalyser();meter.fftSize=2048;window.outputMeter=meter;connect.call(this,meter);return connect.call(meter,destination,...args);}return connect.call(this,destination,...args);};
  },phoneUrl);
  await page.goto('http://localhost:'+port);await page.locator('.nav-item[data-view="library"]').click();await page.locator('tr[data-track-id="old"]').click();
  if(baseline){await page.waitForFunction(()=>PainPlayer.getAudio().error);console.log('REPRODUCED v1.8.7: stale phone ID cannot play, despite an exact recording under its new ID');return;}
  await page.waitForFunction(()=>document.querySelector('#bottomPlayBtn').getAttribute('aria-busy')==='true');
  assert.match(await page.locator('#bottomPlayBtn').getAttribute('title'),/Загрузка/);await page.screenshot({path:'/tmp/pain-188-loading.png'});
  await page.click('#bottomPlayBtn');assert.equal(await page.evaluate(()=>PainPlayer.getAudio().paused),true);assert.equal(await page.locator('#bottomPlayBtn').getAttribute('aria-busy'),'false');
  await page.click('#bottomPlayBtn');await page.waitForFunction(()=>!PainPlayer.getAudio().paused&&PainPlayer.getAudio().currentTime>.1);
  await page.waitForFunction(()=>{const m=window.outputMeter;if(!m)return false;const b=new Float32Array(m.fftSize);m.getFloatTimeDomainData(b);return Math.sqrt(b.reduce((n,x)=>n+x*x,0)/b.length)>.01;});
  assert.equal(await page.locator('#bottomPlayBtn').getAttribute('aria-busy'),'false');assert.ok(requests.includes('/api/track/new'));assert.equal(await page.evaluate(()=>PainPlayer.getTrack().id),'old');
  await page.locator('tr[data-track-id="missing"]').click();await page.waitForFunction(()=>[...document.querySelectorAll('.toast')].some(e=>e.textContent.includes('Файл трека не найден')));
  assert.equal(await page.locator('#bottomPlayBtn').getAttribute('aria-busy'),'false');assert.ok(await page.evaluate(()=>[...document.querySelectorAll('audio')].every(a=>a.paused)),'a failed selection must not leave an unrelated outgoing deck audible');
  await page.screenshot({path:'/tmp/pain-188-playback-error.png'});assert.deepEqual(errors,[]);assert.equal(fs.readFileSync(path.join(data,'library.json'),'utf8'),library);
  console.log(JSON.stringify({changedPhoneIdRecovered:true,actualAudioOutput:true,loadingVisible:true,cancelResume:true,missingFileExplained:true,libraryUnchanged:true,errors}));
 }finally{
  if(browser)await browser.close();child.kill();await new Promise(r=>child.exitCode===null?child.once('exit',r):r());phone.closeAllConnections();await new Promise(r=>phone.close(r));fs.rmSync(root,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
