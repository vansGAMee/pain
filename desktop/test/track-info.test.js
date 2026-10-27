const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const create=require('../src/track-info-service');
test('interesting sections keep original paragraphs and leave track listings out',()=>{
 const paragraph='The song was written while the band was away from home. '.repeat(4);
 assert.deepEqual(create.stories('Intro\n== Background ==\n'+paragraph+'\n== Track listing ==\n'+paragraph),[{heading:'Background',text:paragraph.trim()}]);
});
test('artist context prioritizes paragraphs about the current song',()=>{
 const unrelated='An earlier release started the career and received attention from local venues before the artist began recording the next album.';
 const song='Faster n Harder was released as a single. This paragraph describes the release and its connection to the second album, including the subsequent remixes.';
 const result=create.stories('Intro\n== Career ==\n'+unrelated+'\n'+song+'\n== Discography ==\n'+song,'Faster n Harder');
 assert.equal(result.length,1);assert.ok(result[0].text.startsWith(song));
});
test('a credited second performer supplies a biography when the first has no article',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pain-info-collab-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const queries=[];
 const get=create(dir,{catalog:{lookup:async track=>{assert.equal(track.title,'Faster n Harder - Slowed & Reverbed');return null;}},fetcher:async url=>{
  const params=new URL(url).searchParams,name=params.get('gsrsearch');queries.push(name);
  const page={title:'6arelyhuman',pageid:123,extract:'6arelyhuman is an American singer and songwriter.',fullurl:'https://en.wikipedia.org/wiki/6arelyhuman'};
  return {ok:true,json:async()=>({query:{pages:params.has('pageids')?[{extract:page.extract+'\n== Career ==\nFaster n Harder was a single from the second album. This section describes the original recording and its release, followed by several alternate versions.'}]:name==='6arelyhuman'?[page]:[]}})};
 }});
 const result=await get({title:'Faster n Harder - Slowed & Reverbed',artist:'Sassy Scene, 6arelyhuman'},'en');
 assert.ok(queries.includes('6arelyhuman'));
 assert.equal(result.articles[0].title,'6arelyhuman');
 assert.equal(result.articles[0].kind,'artist');
 assert.ok(result.articles[0].stories[0].text.includes('Faster n Harder'));
 assert.equal(result.articles[0].fullText,undefined,'full article stays in the service cache');
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
test('alternate language is still searched after the preferred source fails',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pain-info-fallback-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const get=create(dir,{fetcher:async url=>{
  if(new URL(url).hostname==='ru.wikipedia.org')throw Error('Source unavailable');
  const name=new URL(url).searchParams.get('gsrsearch');
  return {ok:true,json:async()=>({query:{pages:name==='Muse'?[{title:'Muse (band)',extract:'Muse are an English rock band.',fullurl:'https://en.wikipedia.org/wiki/Muse_(band)'}]:[]}})};
 }});
 const result=await get({title:'No article',artist:'Muse'},'ru');
 assert.equal(result.articles[0].title,'Muse (band)');assert.equal(result.articles[0].language,'en');
});
