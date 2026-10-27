const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const create=require('../src/deezer-genres');
test('published genres belong to the verified song release, keep multiple values and survive offline',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pain-deezer-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));let calls=0;
 const service=create(dir,{spacing:0,fetcher:async url=>{calls++;return {ok:true,json:async()=>url.includes('/search?')?{data:[{id:1,title:'Song',duration:123,artist:{name:'Other'},album:{id:4}},{id:2,title:'Song',duration:123,artist:{name:'Artist'},album:{id:5}}]}:{id:5,title:'Album',genres:{data:[{name:'Alternative'},{name:'Rock'}]}}};}});
 const track={artist:'Artist',title:'Song',duration:123000},data=await service.lookup(track);
 assert.deepEqual(data.names,['Alternative','Rock']);assert.equal(data.scope,'album');assert.ok(data.source.endsWith('/album/5'));assert.ok(data.recordingSource.endsWith('/track/2'));assert.equal(calls,2);
 const restored=create(dir,{fetcher:async()=>{throw Error('offline');}});await restored.ready;
 assert.deepEqual(await restored.lookup(track),data);
});
test('an unidentified file needs an exact title and unique artist at the saved duration',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pain-deezer-unknown-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const service=create(dir,{spacing:0,fetcher:async()=>({ok:true,json:async()=>({data:[{id:1,title:'Song',duration:123,artist:{name:'One'}},{id:2,title:'Song',duration:123,artist:{name:'Two'}}]})})});
 assert.equal(await service.lookup({title:'Song',artist:'<unknown>',duration:123000}),null);
});
