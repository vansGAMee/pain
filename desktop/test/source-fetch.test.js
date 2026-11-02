const test=require('node:test'),assert=require('node:assert/strict');
const create=require('../src/source-fetch');
test('cooldown honours Retry-After without blocking other sources',async()=>{
 let time=1000,calls=0;
 const request=create({now:()=>time,fetcher:async()=>{calls++;return {status:429,headers:new Headers({'retry-after':'30'})};}});
 await request('https://a.test/search');
 await assert.rejects(request('https://a.test/another'),/cooling/);
 await request('https://b.test/search');assert.equal(calls,2);
 time+=30000;await request('https://a.test/search');assert.equal(calls,3);
});
test('aborting one track does not mark the source unavailable',async()=>{
 let calls=0;const controller=new AbortController();
 const request=create({fetcher:async(url,{signal}={})=>{calls++;if(signal){controller.abort();signal.throwIfAborted();}return {status:200};}});
 await assert.rejects(request('https://a.test',{signal:controller.signal}));
 assert.equal((await request('https://a.test')).status,200);assert.equal(calls,2);
});
test('timeouts and access restrictions cool down their own host, not alternate sources',async()=>{
 let time=1000,calls=0;
 const request=create({now:()=>time,fetcher:async(url,{signal}={})=>{calls++;if(signal)throw signal.reason;return {status:url.includes('blocked')?403:200};}});
 const signal=AbortSignal.abort(new DOMException('Deadline','TimeoutError'));
 // A signal already cancelled before dispatch is never counted as a request.
 await assert.rejects(request('https://slow.test',{signal}));assert.equal(calls,0);
 await request('https://blocked.test');await assert.rejects(request('https://blocked.test/path'),/cooling/);
 assert.equal((await request('https://backup.test')).status,200);
 time+=3000;await request('https://blocked.test');assert.equal(calls,3);
});
test('a timeout during an actual request cools the failed host while a different host remains usable',async()=>{
 let calls=0;const request=create({fetcher:async url=>{calls++;if(url.includes('slow'))throw new DOMException('Deadline','TimeoutError');return {status:200};}});
 await assert.rejects(request('https://slow.test/lyrics'),{name:'TimeoutError'});
 await assert.rejects(request('https://slow.test/another'),/cooling/);assert.equal(calls,1);
 assert.equal((await request('https://backup.test/lyrics')).status,200);assert.equal(calls,2);
});
