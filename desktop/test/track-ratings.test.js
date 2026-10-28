const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const create=require('../src/track-ratings'),track={title:'Song',artist:'Artist',duration:180000},id='12345678-1234-1234-1234-123456789012';
function html(artist='Artist',value=92){return `<script type="application/ld+json">${JSON.stringify({'@type':'MusicRecording',name:'Song',byArtist:{name:artist}})}</script><span itemprop="track" itemscope itemtype="http://schema.org/MusicRecording"><meta itemprop="name" content="Song"><span itemprop="aggregateRating"><meta itemprop="ratingValue" content="${value}"><meta itemprop="bestRating" content="100"><meta itemprop="ratingCount" content="42"></span></span>`;}
async function directory(t){const d=await fs.mkdtemp(path.join(os.tmpdir(),'pain-rating-test-'));t.after(()=>fs.rm(d,{recursive:true,force:true}));return d;}
test('a track aggregate cannot be substituted by another artist, album, empty votes or malformed score',()=>{
 assert.equal(create.beaScore(html(),track,'source').value,9.2);assert.equal(create.beaScore(html('Namesake'),track,'source'),null);assert.equal(create.beaScore(html('Artist',101),track,'source'),null);assert.equal(create.beaScore(html().replace('content="42"','content="0"'),track,'source'),null);
});
test('BestEverAlbums finds the song via its artist and converts the published aggregate; offline cache survives failures',async t=>{
 const dir=await directory(t);let requests=0;const catalog={rating:async()=>({rating:null,reason:'unrated'}),lookup:async()=>null};
 const get=create(dir,{catalog,fetcher:async value=>{requests++;const url=new URL(value);return new Response(url.pathname==='/search.php'?'<a href="/thechart.php?b=1">Artist</a>':url.searchParams.has('b')?'<a href="/thechart.php?t=2">Song</a>':html());}});
 const [a,b]=await Promise.all([get(track),get(track)]);assert.deepEqual(a,b);assert.equal(a.rating.name,'BestEverAlbums');assert.equal(a.rating.value,9.2);assert.equal(a.rating.votes,42);assert.equal(requests,3);assert.deepEqual(await get(track),a);assert.equal(requests,3);
 const files=await fs.readdir(path.join(dir,'track-ratings'));const file=path.join(dir,'track-ratings',files[0]),saved=JSON.parse(await fs.readFile(file));saved.at=0;await fs.writeFile(file,JSON.stringify(saved));
 for(const name of await fs.readdir(path.join(dir,'rating-pages'))){const p=path.join(dir,'rating-pages',name),data=JSON.parse(await fs.readFile(p));data.at=0;await fs.writeFile(p,JSON.stringify(data));}
 const offline=create(dir,{catalog,fetcher:async()=>{throw Error('Offline');}});const restored=await offline(track);assert.equal(restored.offline,true);assert.equal(restored.rating.value,9.2);
});
test('CritiqueBrainz is independent of a failed website; only recording reviews are accepted',async t=>{
 const get=create(await directory(t),{catalog:{rating:async()=>({rating:null,reason:'unavailable'}),lookup:async()=>({id})},fetcher:async value=>{
  const url=new URL(value);if(url.hostname==='www.besteveralbums.com')return new Response('',{status:503});assert.equal(url.hostname,'critiquebrainz.org');assert.equal(url.searchParams.get('entity_type'),'recording');assert.equal(url.searchParams.get('entity_id'),id);return Response.json({average_rating:{rating:3.75,count:4}});
 }});const result=await get(track);assert.equal(result.rating.name,'CritiqueBrainz');assert.equal(result.rating.value,7.5);assert.equal(result.rating.votes,4);
});
test('published MusicBrainz scores need no fallback requests',async t=>{
 const get=create(await directory(t),{catalog:{rating:async()=>({rating:{value:8.7,votes:22,source:'https://musicbrainz.org/recording/'+id}})},fetcher:async()=>{throw Error('Unexpected lookup');}});assert.equal((await get(track)).rating.name,'MusicBrainz');
});
