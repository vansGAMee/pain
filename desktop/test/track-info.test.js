const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const create=require('../src/track-info-service');
test('interesting sections keep original paragraphs and leave track listings out',()=>{
 const paragraph='The song was written while the band was away from home. '.repeat(4);
 assert.deepEqual(create.stories('Intro\n== Background ==\n'+paragraph+'\n== Track listing ==\n'+paragraph),[{heading:'Background',text:paragraph.trim()}]);
});
test('only matching musical subjects are presented as facts; song requires its artist',()=>{
 assert.equal(create.matches({title:'Muse',extract:'A muse is a source of inspiration.'},'Muse'),false);
 assert.equal(create.matches({title:'Muse (band)',extract:'Muse are an English rock band.'},'Muse'),true);
 assert.equal(create.matches({title:'Hello (Adele song)',extract:'Hello is a song by Adele.'},'Hello','Lionel Richie'),false);
 assert.equal(create.matches({title:'Muse',extract:'A band.',pageprops:{disambiguation:''}},'Muse'),false);
});
test('untagged files are searched too, with uncertain identity clearly labelled',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pain-info-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));let queries=[];
 const get=create(dir,{fetcher:async url=>{queries.push(new URL(url).searchParams.get('gsrsearch'));return {ok:true,json:async()=>({query:{pages:[{title:'Idioteque',extract:'Idioteque is a song by the rock band Radiohead.',fullurl:'https://en.wikipedia.org/wiki/Idioteque'}]}})};}});
 const result=await get({title:'Idioteque_Radiohead',artist:'<unknown>'},'en');
 assert.ok(queries.includes('Idioteque Radiohead'));
 assert.equal(result.articles[0].kind,'possible-track');
});
test('cache survives offline use, concurrent lookups share requests and metadata never becomes HTML',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pain-info-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 let calls=0;
 const fetcher=async url=>{calls++;const name=new URL(url).searchParams.get('gsrsearch');return {ok:true,json:async()=>({query:{pages:name==='Muse'?[{title:'Muse (band)',extract:'Muse are a rock band. <script>example</script>',fullurl:'https://en.wikipedia.org/wiki/Muse_(band)'}]:[]}})};};
 const get=create(dir,{fetcher}),track={title:'No article',artist:'Muse'};
 const results=await Promise.all([get(track,'en'),get(track,'en')]);
 assert.equal(calls,3);assert.equal(results[0].articles.length,1);
 const offline=create(dir,{fetcher:async()=>{throw Error('offline');}});
 assert.deepEqual(await offline(track,'en'),results[0]);
 assert.equal((await offline({title:'Unknown',artist:'<unknown>'})).missingArtist,true);
});
