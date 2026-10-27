const test=require('node:test'),assert=require('node:assert/strict');
const {choose}=require('../src/music-catalog');
const recording=(artist,length=123000)=>({title:'Song',length,'artist-credit':[{name:artist}]});
test('unknown title requires duration and unambiguous artist; known artist rejects namesakes',()=>{
 assert.equal(choose([recording('Other')],{title:'Song',artist:'Artist'}),null);
 assert.equal(choose([recording('Artist')],{title:'Song',duration:120000}),null);
 assert.equal(choose([recording('Artist'),recording('Other')],{title:'Song',duration:123000}),null);
 assert.equal(choose([recording('Artist')],{title:'Song',duration:123000})['artist-credit'][0].name,'Artist');
});
test('a matching slowed edition wins over the first sped-up result and the original',()=>{
 const sped={...recording('6arelyhuman',115200),title:'Faster n Harder (Sped Up)'};
 const slow={...recording('6arelyhuman',142222),title:'Faster n Harder (Slowed & Reverbed)'};
 const original={...recording('6arelyhuman',123428),title:'Faster n Harder'};
 const track={title:'Faster n Harder - Slowed & Reverbed',artist:'Sassy Scene, 6arelyhuman',duration:142292};
 assert.equal(choose([sped,original,slow],track),slow);
 assert.equal(choose([sped,original],track),original);
});
test('catalog caches metadata for offline reuse',async t=>{
 const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pain-catalog-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 let requests=0;const create=require('../src/music-catalog');
 const catalog=create(dir,{fetcher:async()=>{requests++;return {ok:true,json:async()=>({recordings:[{...recording('Artist'),id:'id'}]})};}});
 const track={title:'Song',artist:'Artist'};
 const first=await catalog.lookup(track);assert.equal(first.artist,'Artist');
 assert.deepEqual(await catalog.lookup(track),first);assert.equal(requests,1);
 const offline=create(dir,{fetcher:async()=>{throw Error('offline');}});
 assert.deepEqual(await offline.lookup(track),first);
});
