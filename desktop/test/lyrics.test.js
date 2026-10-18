const test=require('node:test'),assert=require('node:assert/strict'),http=require('http'),fs=require('fs'),os=require('os'),path=require('path');
const route=require('../src/lyrics-store');
test('lyrics persist per track, reject invalid timing, and preserve saved text after errors',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pain-lyrics-'));
 const server=http.createServer((req,res)=>route(req,res,new URL(req.url,'http://localhost'),dir));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}/api/lyrics?track=`;
 const save=(id,lines)=>fetch(base+encodeURIComponent(id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({lines})});
 try{
  const lines=[{text:'Первая <строка>',time:1.25},{text:'Вторая',time:null}];
  assert.equal((await save('../../song',lines)).status,200);
  assert.deepEqual((await(await fetch(base+encodeURIComponent('../../song'))).json()).lines,lines);
  assert.deepEqual((await(await fetch(base+'other')).json()).lines,[]);
  assert.equal((await save('../../song',[{text:'a',time:3},{text:'b',time:1}])).status,400);
  assert.equal((await save('../../song',[{text:'a',time:-1}])).status,400);
  assert.deepEqual((await(await fetch(base+encodeURIComponent('../../song'))).json()).lines,lines);
  assert.equal(fs.readdirSync(path.join(dir,'lyrics')).length,1);
 }finally{await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
