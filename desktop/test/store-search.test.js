const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
test('genre fallback verifies performer and song and shares the cover cache',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pain-store-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const original=global.fetch;t.after(()=>global.fetch=original);let requests=0;
 global.fetch=async()=>{requests++;return new Response(JSON.stringify({results:[{artistName:'Namesake',trackName:'Song',primaryGenreName:'Jazz'},{artistName:'Artist',trackName:'Song',primaryGenreName:'Alternative',trackViewUrl:'https://music.apple.com/us/song/123',artworkUrl100:'https://is1-ssl.mzstatic.com/example.jpg'}]}));};
 const store=require('../src/store-search');store.configure(dir);
 const result=await store.genres({artist:'Artist',title:'Song - Slowed & Reverbed'});
 assert.deepEqual(result.names,['Alternative']);assert.equal(result.scope,'store');
 const covers=await store.search({term:'Artist Song',entity:'song'});assert.ok(covers[1].artworkUrl100);assert.equal(requests,1);
 delete require.cache[require.resolve('../src/store-search')];const restored=require('../src/store-search');restored.configure(dir);
 global.fetch=async()=>{throw Error('offline');};
 assert.deepEqual(await restored.genres({artist:'Artist',title:'Song'}),result);
});
