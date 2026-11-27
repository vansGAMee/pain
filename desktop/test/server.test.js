const test=require('node:test'),assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const parseRange=require('../src/range');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('proxy honors seek ranges; complete cache supports suffix ranges; snapshots retain PC history',async t=>{
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'pain-test-'));const bytes=Buffer.alloc(4096);for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
 let phoneLibrary={tracks:[{id:'трек 🎵',title:'Ночная волна',favorite:0}]},phoneStats={plays:[],slices:[]},unsupported=false,appName='Pain',libraryReads=0;
 const phone=http.createServer((req,res)=>{
  if(unsupported){res.writeHead(404,{'Content-Type':'application/json'});res.end('{}');return;}
  if(req.url==='/api/status'){res.end(JSON.stringify({appName,status:'ok',device:'Android',tracks:1}));return;}
  if(req.url==='/api/library'||req.url==='/api/stats'){
   const send=value=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
   if(req.method==='GET'){if(req.url==='/api/library')libraryReads++;send(req.url==='/api/library'?phoneLibrary:phoneStats);return;}
   let body='';req.setEncoding('utf8');req.on('data',c=>body+=c);req.on('end',()=>{
    const value=JSON.parse(body);
    if(req.url==='/api/library')phoneLibrary.tracks[0].favorite=value.tracks[0].favorite;
    else phoneStats=require('../src/stats-store')(phoneStats,value);
    send({status:'ok'});
   });return;
  }
  const range=req.headers.range&&parseRange(req.headers.range,bytes.length);if(range){res.writeHead(206,{'Content-Length':range.end-range.start+1,'Content-Range':`bytes ${range.start}-${range.end}/${bytes.length}`});res.end(bytes.subarray(range.start,range.end+1));}else{res.writeHead(200,{'Content-Length':bytes.length});res.end(bytes);}});
 await new Promise(r=>phone.listen(0,'127.0.0.1',r));
 const reserve=http.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const child=spawn(process.execPath,[path.join(__dirname,'../src/server.js')],{env:{...process.env,PAIN_DATA_DIR:data,PAIN_DISCOVERY:'false',OPEN_BROWSER:'false',PORT:String(port)},stdio:['ignore','pipe','pipe']});
 t.after(async()=>{child.kill();await new Promise(r=>child.once('exit',r));await new Promise(r=>phone.close(r));fs.rmSync(data,{recursive:true,force:true});});
 await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error('Server startup timeout')),5000);child.stdout.on('data',b=>{output+=b;if(output.includes('Web UI:')){clearTimeout(timer);resolve();}});child.once('error',reject);});
 const root=`http://127.0.0.1:${port}`;
 const url=`${root}/api/cached-track/test?phoneUrl=${encodeURIComponent('http://127.0.0.1:'+phone.address().port)}`;
 let r=await fetch(url,{headers:{Range:'bytes=500-799'}});assert.equal(r.status,206);assert.equal(r.headers.get('content-range'),'bytes 500-799/4096');assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes.subarray(500,800));
 assert.equal(fs.existsSync(path.join(data,'cache/test.mp3')),false);
 r=await fetch(url);assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes);
 for(let i=0;i<30&&!fs.existsSync(path.join(data,'cache/test.mp3'));i++)await delay(20);
 assert.equal(fs.statSync(path.join(data,'cache/test.mp3')).size,4096);
 r=await fetch(url,{headers:{Range:'bytes=-32'}});assert.equal(r.status,206);assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes.subarray(-32));
 r=await fetch(url,{headers:{Range:'bytes=5000-'}});assert.equal(r.status,416);
 fs.writeFileSync(path.join(data,'data/stats.json'),JSON.stringify({plays:[{id:'pc1',track:'a',started:1}],slices:[]}));
 r=await fetch(root+'/api/save-stats',{method:'POST',body:JSON.stringify({plays:[{id:'phone1',track:'b',started:2}],slices:[]})});assert.equal(r.status,200);
 assert.equal((await (await fetch(root+'/api/saved-stats')).json()).plays.length,2);
 const post=(route,body)=>fetch(root+route,{method:'POST',body:JSON.stringify(body)});
 const phoneUrl='http://127.0.0.1:'+phone.address().port;
 r=await post('/api/phone-status',{phoneUrl:phoneUrl.slice(7)});assert.equal(r.status,200);assert.equal((await r.json()).url,phoneUrl);
 appName='Other app';r=await post('/api/phone-status',{phoneUrl});assert.equal(r.status,502);assert.equal((await r.json()).code,'device');appName='Pain';
 r=await post('/api/phone-status',{phoneUrl:'wrong address'});assert.equal(r.status,400);
 assert.equal(fs.readFileSync(path.join(data,'data/last_phone_ip.txt'),'utf8'),phoneUrl.slice(7));
 r=await post('/api/preload-track/cache-check?phoneUrl='+encodeURIComponent(phoneUrl),{});assert.equal(r.status,200);
 assert.deepEqual(fs.readFileSync(path.join(data,'cache/cache-check.mp3')),bytes);
 await post('/api/save-library',phoneLibrary);
 r=await post('/api/sync-like',{phoneUrl:'invalid address',trackId:'трек 🎵',favorite:1});
 assert.equal((await r.json()).syncedToPhone,false);
 assert.equal((await (await fetch(root+'/api/saved-library')).json()).tracks[0].favorite,1);
 r=await post('/api/sync-phone',{phoneUrl});assert.equal(r.status,200);
 assert.equal((await r.json()).library.tracks[0].favorite,1);assert.equal(phoneLibrary.tracks[0].favorite,1);
 const play={id:'pc_test',track:'трек 🎵',started:1000,heard:50000,media_heard:20000,duration:180000,skipped:1,finished:0};
 for(let i=0;i<2;i++){
  r=await post('/api/sync-stats',{phoneUrl,play});assert.equal(r.status,200);assert.equal((await r.json()).syncedToPhone,true);
 }
 assert.equal(phoneStats.plays.length,1);assert.equal(phoneStats.plays[0].media_heard,20000);assert.equal(phoneStats.plays[0].skipped,1);
 r=await post('/api/sync-phone',{phoneUrl});const synced=await r.json();
 assert.equal(synced.stats.plays.length,3,'PC, phone and the new play survive round trip');
 unsupported=true;
 r=await post('/api/sync-phone',{phoneUrl});assert.equal(r.status,500);assert.equal((await r.json()).code,'update');
 assert.equal((await(await fetch(root+'/api/sync-status')).json()).state,'error');
 assert.equal((await(await fetch(root+'/api/saved-library')).json()).tracks[0].title,'Ночная волна');
 unsupported=false;libraryReads=0;await post('/api/sync-phone',{phoneUrl});
 assert.equal(libraryReads,1,'unchanged likes do not require a second library snapshot');
 assert.equal((await(await fetch(root+'/api/sync-status')).json()).state,'ok');
 r=await post('/api/network-preferences',{sync:'manual',autoUpdateDownloads:false});assert.equal((await r.json()).sync,'manual');
 r=await post('/api/sync-like',{phoneUrl,trackId:'трек 🎵',favorite:0});assert.equal((await r.json()).syncedToPhone,false);
 assert.equal(phoneLibrary.tracks[0].favorite,1,'manual mode leaves local changes in the outbox');
 assert.equal((await(await fetch(root+'/api/saved-library')).json()).tracks[0].favorite,0);
 await post('/api/sync-phone',{phoneUrl});assert.equal(phoneLibrary.tracks[0].favorite,0,'a manual exchange flushes saved local changes');
 assert.equal(JSON.parse(fs.readFileSync(path.join(data,'data/network-preferences.json'),'utf8')).sync,'manual');

});

test('a phone reached by address syncs automatically without UDP discovery', async t => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pain-address-sync-'));
 const data=path.join(dir,'data');
 fs.mkdirSync(data);
 fs.writeFileSync(path.join(data,'performance-mode.json'),'{"mode":"maximum"}');
 fs.writeFileSync(path.join(data,'network-preferences.json'),'{"autoUpdates":false}');
 const track={id:'phone-track',title:'New phone track',favorite:0};
 const phone=http.createServer((req,res)=>{
  const responses={
   '/api/status':{appName:'PAIN',status:'ok',device:'Test phone',tracks:1},
   '/api/library':{tracks:[track]},
   '/api/stats':{plays:[],slices:[]}
  };
  res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify(responses[req.url]||{}));
 });
 await new Promise(resolve=>phone.listen(0,'127.0.0.1',resolve));
 const phoneUrl='http://127.0.0.1:'+phone.address().port;
 const isolatedDiscovery=`
  const dgram=require('node:dgram'),create=dgram.createSocket;
  dgram.createSocket=(...args)=>{
   const socket=create(...args),bind=socket.bind.bind(socket);
   socket.bind=(_port,ready)=>bind(0,'127.0.0.1',ready);
   return socket;
  };
  require(process.argv[1]);
 `;
 const child=spawn(process.execPath,['-e',isolatedDiscovery,path.join(__dirname,'../src/server.js')],{
  env:{...process.env,PAIN_DATA_DIR:dir,PAIN_DISCOVERY:'true',OPEN_BROWSER:'false',PAIN_PULSEFLOW_AUTO_INDEX:'false',PORT:'3000'},
  stdio:['ignore','pipe','ignore']
 });
 t.after(async()=>{
  if(child.exitCode===null&&child.signalCode===null)await new Promise(resolve=>{child.once('exit',resolve);child.kill();});
  await new Promise(resolve=>phone.close(resolve));
  fs.rmSync(dir,{recursive:true,force:true});
 });
 const root=await new Promise((resolve,reject)=>{
  let output='';
  const timer=setTimeout(()=>reject(Error('Desktop server did not start')),5000);
  child.stdout.on('data',chunk=>{
   output+=chunk;
   const port=output.match(/Web UI: http:\/\/localhost:(\d+)/)?.[1];
   if(port){clearTimeout(timer);resolve('http://127.0.0.1:'+port);}
  });
 });
 const checked=await fetch(root+'/api/phone-status',{method:'POST',body:JSON.stringify({phoneUrl})});
 assert.equal(checked.status,200);
 let library;
 for(let i=0;i<28;i++){
  library=await fetch(root+'/api/saved-library').then(response=>response.json());
  if(library.tracks.length)break;
  await delay(80);
 }
 assert.deepEqual(library.tracks,[track]);
});
