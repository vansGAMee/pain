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
test('same-title recordings prefer the known album, then closest duration',()=>{
 const live={...recording('Artist',300000),releases:[{title:'Live album'}]},studio={...recording('Artist',123000),releases:[{title:'Album'}]};
 assert.equal(choose([live,studio],{title:'Song',artist:'Artist',album:'Album'}),studio);
 assert.equal(choose([live,studio],{title:'Song',artist:'Artist',album:'Download',duration:123100}),studio);
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
test('genres use canonical positive genre votes, then the verified album; arbitrary tags stay out',async t=>{
 const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),dir=await fs.mkdtemp(path.join(os.tmpdir(),'pain-genre-catalog-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const rid='12345678-1234-1234-1234-123456789012',gid='12345678-1234-1234-1234-123456789013';
 const catalog=require('../src/music-catalog')(dir,{fetcher:async url=>({ok:true,json:async()=>url.includes('query=')?{recordings:[{...recording('Artist'),id:rid,releases:[{title:'Album','release-group':{id:gid}}]}]}:url.includes('release-group/')?{genres:[{name:'post-punk',count:2},{name:'pop',count:-1}],tags:[{name:'seen live',count:50}]}:{genres:[]}})});
 const result=await catalog.genres({title:'Song',artist:'Artist',album:'Album'});
 assert.deepEqual(result.names,['post-punk']);assert.equal(result.scope,'album');assert.ok(result.source.endsWith(gid));
 assert.deepEqual(result.tags,['seen live'],'community tags are available separately from the canonical genres');
});
