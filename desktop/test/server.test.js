const test=require('node:test'),assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const parseRange=require('../src/range');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('proxy honors seek ranges; complete cache supports suffix ranges; snapshots retain PC history',async t=>{
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'pain-test-'));const bytes=Buffer.alloc(4096);for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
 let phoneLibrary={tracks:[{id:'трек 🎵',title:'Ночная волна',favorite:0}]},phoneStats={plays:[],slices:[]};
 const phone=http.createServer((req,res)=>{
  if(req.url==='/api/library'||req.url==='/api/stats'){
   const send=value=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
   if(req.method==='GET'){send(req.url==='/api/library'?phoneLibrary:phoneStats);return;}
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

});
