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
