const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../src/dj-worker-client'),'utf8');
function fixture(){
 const workers=[],timers=new Map();let id=0;
 class Worker{constructor(){workers.push(this);this.sent=[];}postMessage(x){this.sent.push(x);}terminate(){this.stopped=true;}}
 const context={Worker,setTimeout:f=>{timers.set(++id,f);return id;},clearTimeout:id=>timers.delete(id),addEventListener(){}};
 vm.runInNewContext(source,context);
 return {request:context.DJWorker.request,workers,timers};
}
test('Home cannot block playback; superseded queued payloads never enter the worker',async()=>{
 const {request,workers}=fixture();
 const home=request({action:'mix'}),play=request({action:'next'});
 assert.equal(workers.length,2);
 const stale=request({action:'next'});const staleCheck=assert.rejects(stale,/superseded/);
 const latest=request({action:'next'});
 assert.equal(workers[1].sent.length,1);
 const answer=(worker,result)=>worker.onmessage({data:{id:worker.sent.at(-1).id,result}});
 answer(workers[1],'play');assert.equal(await play,'play');assert.equal(workers[1].sent.length,2);
 answer(workers[1],'latest');answer(workers[0],'home');
 assert.equal(await latest,'latest');assert.equal(await home,'home');await staleCheck;
});
test('timeout terminates work and rejects both active and waiting requests',async()=>{
 const {request,workers,timers}=fixture();
 const a=assert.rejects(request({action:'next'}),/timed out/),b=assert.rejects(request({action:'next'}),/timed out/);
 [...timers.values()][0]();await Promise.all([a,b]);assert.equal(workers[0].stopped,true);
 assert.equal(timers.size,0);
});
