const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const create=require('../src/wiki-track-genres');
test('only published song or album genres with a matching credited artist are accepted',()=>{
 const song='{{Infobox song\n| name = Song\n| artist = [[Artist]]\n| genre = {{hlist|[[Shoegaze]]|[[Dream pop]]}}\n| album = Album\n}}';
 assert.deepEqual(create.parse(song,{artist:'Artist'}),['shoegaze','dream pop']);
 assert.deepEqual(create.parse(song,{artist:'Other'}),[]);
 assert.deepEqual(create.parse(song,{artist:'Art'}),[],'an artist name substring cannot establish recording identity');
 assert.deepEqual(create.parse('{{Infobox musical artist\n| artist = Artist\n| genre = [[Rock]]\n}}',{artist:'Artist'}),[]);
 assert.deepEqual(create.parse(song.replace('Infobox song','Infobox album'),{artist:'Artist'}),[]);
});
test('batch song lookup keeps sources and never transfers genres to another artist or title',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pain-song-genres-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));let calls=0;
 const wiki=create(dir,{fetcher:async()=>{calls++;return {ok:true,json:async()=>({query:{pages:[{title:'Song',revisions:[{slots:{main:{content:'{{Infobox song\n|artist=[[Artist]]\n|genre=[[Shoegaze]]\n}}'}}}]}]}})};}});
 await wiki.warm([{title:'Song',artist:'Artist'},{title:'Song',artist:'Other'}]);
 assert.deepEqual(wiki.get({title:'Song',artist:'Artist'}).names,['shoegaze']);
 assert.equal(wiki.get({title:'Song',artist:'Other'}),null);
 assert.equal(wiki.get({title:'Other song',artist:'Artist'}),null);
 const restored=create(dir,{fetcher:async()=>{throw Error('offline');}});await restored.ready;
 assert.deepEqual(restored.get({title:'Song',artist:'Artist'}).names,['shoegaze']);
});
