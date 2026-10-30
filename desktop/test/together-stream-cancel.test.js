const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),{once}=require('node:events'),WebSocket=require('ws'),{createRelay}=require('../src/listen/relay');
test('cancelling a live transfer closes the source before the file is sent and releases the bounded relay slot',async()=>{
 let relay;const server=http.createServer((req,res)=>relay.route(req,res));relay=createRelay(server);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,ws=new WebSocket(base.replace('http','ws'));
 const messages=[],wait=async predicate=>{const until=Date.now()+5000;while(Date.now()<until){const found=messages.find(predicate);if(found)return found;await new Promise(r=>setTimeout(r,5));}throw Error('Message timeout');};ws.on('message',raw=>messages.push(JSON.parse(raw)));
 let upload,download,sent=0,sourceClosed=false;
 try{
  await once(ws,'open');ws.send(JSON.stringify({type:'create'}));await wait(m=>m.type==='welcome');ws.send(JSON.stringify({type:'add',track:{id:'offered',title:'Long recording',artist:'Source',duration:12000,bytes:100*1024*1024}}));const state=await wait(m=>m.type==='state'&&m.queue.length===1);
  ws.send(JSON.stringify({type:'stream',uid:state.queue[0].uid,request:'cancel-test'}));const offer=await wait(m=>m.type==='serve'),ready=await wait(m=>m.type==='stream-ready');
  upload=http.request(base+'/stream/'+offer.ticket,{method:'POST',headers:{'X-Pain-Upload':offer.upload,'X-Pain-Audio-Status':'200','Content-Type':'audio/mpeg'}},response=>response.resume());
  upload.on('error',()=>sourceClosed=true);upload.on('close',()=>sourceClosed=true);
  const block=Buffer.alloc(16384,9),source=(async()=>{try{for(let i=0;i<6400&&!sourceClosed;i++){sent+=block.length;if(!upload.write(block))await once(upload,'drain');await new Promise(r=>setTimeout(r,2));}}catch(_){}finally{upload.end();}})();
  await new Promise((resolve,reject)=>{download=http.get(base+'/stream/'+ready.ticket,response=>{response.once('data',()=>{response.destroy();resolve();});response.on('error',()=>{});});download.on('error',reject);});
  const until=Date.now()+3000;while(!sourceClosed&&Date.now()<until)await new Promise(r=>setTimeout(r,10));
  assert.equal(sourceClosed,true);assert.ok(sent<100*1024*1024,'the relay must not buffer the entire file before cancellation');assert.equal(relay.transfers.size,0);await source;
 }finally{download?.destroy();upload?.destroy();ws.terminate();relay.close();await new Promise(r=>server.close(r));}
});
