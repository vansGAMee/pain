const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
test('personal RPC requires local same-origin POST and an explicit app header; status starts no model',async()=>{
 const service=require('../src/personal-service')('/unused-private-data'),server=http.createServer((req,res)=>service.route(req,res));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 try{
  assert.equal((await fetch(base)).status,403);
  assert.equal((await fetch(base,{method:'POST',body:'{}'})).status,403);
  assert.equal((await fetch(base,{method:'POST',headers:{'X-Pain-Update':'personal','Origin':'http://evil.invalid'},body:'{}'})).status,403);
  const response=await fetch(base,{method:'POST',headers:{'X-Pain-Update':'personal','Origin':base},body:JSON.stringify({action:'status'})});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{state:'idle'});
  const stopped=await fetch(base,{method:'POST',headers:{'X-Pain-Update':'personal'},body:JSON.stringify({action:'abandon'})});assert.deepEqual(await stopped.json(),{abandoned:true});
 }finally{service.close();await new Promise(resolve=>server.close(resolve));}
});
test('slow Python startup cannot block Next and coalesces cold requests into one training job',async t=>{
 const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
 const previous=process.env.PAIN_PULSEFLOW_PYTHON;process.env.PAIN_PULSEFLOW_PYTHON=process.execPath;
 const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
 let launches=0,writes='';child.stdin.on('data',b=>writes+=b.toString());
 const service=require('../src/personal-service')('/unused-data',{spawnImpl:()=>{launches++;return child;}});
 t.after(()=>{service.close();if(previous===undefined)delete process.env.PAIN_PULSEFLOW_PYTHON;else process.env.PAIN_PULSEFLOW_PYTHON=previous;});
 let result;service.request({eligible:['a','b'],length:1}).then(r=>result=r);await new Promise(setImmediate);
 assert.equal(result?.preparing,true,'playback must return before Python announces boot');
 await service.request({eligible:['b','c'],length:1});assert.equal(launches,1);assert.equal(writes.trim().split('\n').length,1);
 const first=JSON.parse(writes.trim());
 child.stdout.write(JSON.stringify({event:'booted'})+'\n');
 child.stdout.write(JSON.stringify({id:first.id,result:{preparing:true,tracks:[],diagnostics:{state:'training'}}})+'\n');
 child.stdout.write(JSON.stringify({event:'ready',diagnostics:{events:20}})+'\n');assert.equal(service.status().state,'ready');
 const warm=service.request({eligible:['a','b'],length:1}),last=JSON.parse(writes.trim().split('\n').at(-1));
 child.stdout.write(JSON.stringify({id:last.id,result:{updating:true,tracks:[{id:'b'}],diagnostics:{events:20}}})+'\n');
 assert.equal((await warm).tracks[0].id,'b');assert.equal(service.status().state,'updating');
 child.stdout.write(JSON.stringify({event:'error',error:'Unreadable update',diagnostics:{events:20}})+'\n');
 assert.equal(service.status().state,'ready');assert.equal(service.status().updateError,'Unreadable update');
});
