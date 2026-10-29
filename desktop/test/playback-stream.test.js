const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const download=require('../src/audio-download'),stream=require('../src/playback-stream');
async function listen(t,handler){
 const server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>{server.closeAllConnections();return new Promise(r=>server.close(r));});
 return 'http://127.0.0.1:'+server.address().port;
}
async function setup(t,{ambiguous=false,unreadable=false,slow=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pain-playback-stream-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const bytes=Buffer.alloc(16384);for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
 const track={id:'old',title:'Any Artist — Any song (English Version)',artist:'Неизвестный исполнитель',duration:123456,bytes:bytes.length};
 const original=JSON.stringify(track),requests=[];
 const phone=await listen(t,(req,res)=>{
  requests.push({url:req.url,range:req.headers.range,method:req.method});
  if(req.url==='/api/library')return res.end(JSON.stringify({tracks:[{...track,id:'new',title:'Any song (English Version)',artist:'Any Artist'},...(ambiguous?[{...track,id:'duplicate'}]:[])]}));
  if(req.url!=='/api/track/new'||unreadable){res.writeHead(404);res.end(unreadable?'File unreadable':'Track not found');return;}
  const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||''),start=range?Number(range[1]):0,end=range&&range[2]?Number(range[2]):bytes.length-1;
  res.writeHead(range?206:200,{'Content-Type':'audio/mpeg','Content-Length':end-start+1,'Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${start}-${end}/${bytes.length}`}:{})});
  if(req.method==='HEAD')return res.end();
  if(slow){res.write(bytes.subarray(start,start+1));const timer=setTimeout(()=>res.end(bytes.subarray(start+1,end+1)),2000);res.on('close',()=>clearTimeout(timer));}
  else res.end(bytes.subarray(start,end+1));
 });
 const cached=path.join(root,'old.mp3'),ensure=download({cacheDir:root,resolveAudio:()=>null,phoneBase:()=>phone,getTrack:()=>track});
 const handler=stream({cacheDir:root,resolveFile:()=>fs.existsSync(cached)?cached:null,mimeFor:()=> 'audio/mpeg',openRemote:ensure.openRemote,
  streamFile:(file,req,res)=>{res.writeHead(200,{'Content-Length':fs.statSync(file).size});if(req.method==='HEAD')res.end();else fs.createReadStream(file).pipe(res);}});
 const base=await listen(t,(req,res)=>handler(req,res,'old',{refresh:new URL(req.url,'http://localhost').searchParams.has('refresh')}));
 t.after(()=>assert.equal(JSON.stringify(track),original,'recovery never changes the saved track ID or its metadata'));
 return {root,bytes,phone,base,cached,requests,ensure};
}
test('playback recovers a changed phone ID, preserves byte ranges and HEAD, and caches only complete files',async t=>{
 const s=await setup(t);
 let response=await fetch(s.base,{headers:{Range:'bytes=120-511'}});assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),`bytes 120-511/${s.bytes.length}`);
 assert.deepEqual(Buffer.from(await response.arrayBuffer()),s.bytes.subarray(120,512));assert.equal(fs.existsSync(s.cached),false);
 response=await fetch(s.base,{method:'HEAD'});assert.equal(response.status,200);assert.equal(Number(response.headers.get('content-length')),s.bytes.length);assert.equal((await response.arrayBuffer()).byteLength,0);
 response=await fetch(s.base);assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),s.bytes);
 for(let i=0;i<30&&!fs.existsSync(s.cached);i++)await new Promise(r=>setTimeout(r,10));
 assert.deepEqual(fs.readFileSync(s.cached),s.bytes);const before=s.requests.length;
 assert.deepEqual(Buffer.from(await(await fetch(s.base)).arrayBuffer()),s.bytes);assert.equal(s.requests.length,before,'cached playback works without the phone');
 assert.equal(s.requests.filter(r=>r.url==='/api/library').length,1,'shared catalogue recovery is cached');
 assert.ok(s.requests.some(r=>r.url==='/api/track/new'&&r.method==='HEAD'));
 assert.ok(s.requests.some(r=>r.url==='/api/track/new'&&r.range==='bytes=120-511'));
});
test('ambiguous recordings and unreadable files remain explicit failures instead of playing another song',async t=>{
 for(const options of [{ambiguous:true},{unreadable:true}]){
  const s=await setup(t,options),response=await fetch(s.base);assert.equal(response.status,404);
  const code=options.unreadable?'AUDIO_PHONE_UNREADABLE':'AUDIO_NOT_ON_PHONE';assert.equal(response.headers.get('x-pain-audio-error'),code);assert.equal(await response.text(),code);
  assert.equal(s.ensure.getStatus('old').code,code);assert.equal(fs.existsSync(s.cached),false);
 }
});
test('a fresh retry bypasses a bad derived cache and atomically replaces it without deleting the old file first',async t=>{
 const s=await setup(t);fs.writeFileSync(s.cached,Buffer.alloc(8192));
 const response=await fetch(s.base+'?refresh=1');assert.deepEqual(Buffer.from(await response.arrayBuffer()),s.bytes);
 for(let i=0;i<30;i++){if(fs.readFileSync(s.cached).equals(s.bytes))break;await new Promise(r=>setTimeout(r,10));}
 assert.deepEqual(fs.readFileSync(s.cached),s.bytes);
});
test('cancelling playback aborts its transfer and removes incomplete cache files',async t=>{
 const s=await setup(t,{slow:true}),controller=new AbortController();
 const response=await fetch(s.base,{signal:controller.signal});const reader=response.body.getReader();await reader.read();controller.abort();
 for(let i=0;i<30;i++){if(fs.readdirSync(s.root).length===0)break;await new Promise(r=>setTimeout(r,10));}
 assert.deepEqual(fs.readdirSync(s.root),[]);assert.equal(s.ensure.getStatus('old'),null,'a user cancellation is not a phone failure');
});
