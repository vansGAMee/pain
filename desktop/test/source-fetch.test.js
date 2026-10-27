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
