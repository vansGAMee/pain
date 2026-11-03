const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const create=require('../src/companion-control');
test('local media bridge waits for renderer acknowledgement and preserves exact volume',async t=>{
 const controls=create(),server=http.createServer((req,res)=>controls.route(req,res,new URL(req.url,'http://localhost').pathname));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 let stream,audio={playing:true,volume:.713},events=0;
 t.after(async()=>{stream?.destroy();controls.close();await new Promise(resolve=>server.close(resolve));});
 await new Promise((resolve,reject)=>{
  stream=http.get(base+'/api/companion-control/events',res=>{
   let buffer='';res.setEncoding('utf8');res.on('data',chunk=>{
    buffer+=chunk;
    while(buffer.includes('\n\n')){
     const index=buffer.indexOf('\n\n'),frame=buffer.slice(0,index);buffer=buffer.slice(index+2);
     if(frame.startsWith('event: ready'))resolve();
     if(frame.startsWith('event: control')){
      const data=JSON.parse(frame.split('data: ')[1]);events++;
      if(data.command==='volume')audio.volume=data.value;if(data.command==='pause')audio.playing=false;if(data.command==='play')audio.playing=true;
      fetch(base+'/api/companion-control/result',{method:'POST',body:JSON.stringify({id:data.id,ok:true,...audio})}).catch(reject);
     }
    }
   });
  });stream.on('error',reject);
 });
 const command=async value=>{const result=await fetch(base+'/api/companion-control/command',{method:'POST',body:JSON.stringify(value)});return {status:result.status,data:await result.json()};};
 assert.equal(events,0,'connecting never produces a playback command');
 let result=await command({command:'volume',value:.4});assert.equal(result.status,200);assert.equal(result.data.volume,.4);
 result=await command({command:'volume',value:.713});assert.equal(result.data.volume,.713);assert.equal(audio.volume,.713);
 result=await command({command:'pause'});assert.equal(result.data.playing,false);
 result=await command({command:'play'});assert.equal(result.data.playing,true);
 result=await command({command:'volume',value:2});assert.equal(result.status,400);
 result=await command({command:'shell',value:'anything'});assert.equal(result.status,400);assert.equal(events,4);
});
test('missing renderer is an explicit error instead of falsely reporting a changed player',async t=>{
 const controls=create(),server=http.createServer((req,res)=>controls.route(req,res,new URL(req.url,'http://localhost').pathname));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{controls.close();await new Promise(resolve=>server.close(resolve));});
 const result=await fetch(`http://127.0.0.1:${server.address().port}/api/companion-control/command`,{method:'POST',body:JSON.stringify({command:'pause'})});
 assert.equal(result.status,503);assert.ok((await result.json()).error.includes('not connected'));
});
