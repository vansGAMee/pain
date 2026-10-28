'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {parseDocument,DomUtils:D}=require('htmlparser2'),match=require('./cover-matching');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const nodes=(doc,name)=>D.getElementsByTagName(name,doc.children),clean=node=>D.textContent(node).trim();
const score=(value,votes,max,source,name)=>Number.isFinite(value)&&value>=0&&value<=max&&Number.isSafeInteger(votes)&&votes>0?{value:value*10/max,original:value,votes,source,name,fetchedAt:Date.now()}:null;
const valid=data=>data?.rating&&Number.isFinite(data.rating.value)&&data.rating.value>=0&&data.rating.value<=10&&Number.isSafeInteger(data.rating.votes)&&data.rating.votes>0&&typeof data.rating.source==='string';
function beaScore(html,track,url){
 const doc=parseDocument(html);let recording;
 for(const script of nodes(doc,'script'))if(script.attribs?.type==='application/ld+json')try{
  const data=JSON.parse(D.textContent(script));recording=(data['@graph']||[data]).find(r=>r['@type']==='MusicRecording'&&match.norm(r.name)===match.norm(track.title)&&match.norm(r.byArtist?.name)===match.norm(track.artist));if(recording)break;
 }catch(_){}
 if(!recording)return null;
 const own=D.findOne(n=>n.attribs?.itemprop==='track'&&/MusicRecording$/.test(n.attribs?.itemtype||''),doc.children,true);if(!own)return null;
 const fields={};for(const meta of D.getElementsByTagName('meta',own.children))fields[meta.attribs.itemprop]=meta.attribs.content;
 if(match.norm(fields.name)!==match.norm(track.title)||Number(fields.bestRating)!==100)return null;
 const rating=score(Number(fields.ratingValue),Number(fields.ratingCount),100,url,'BestEverAlbums');return rating?{...rating,edition:recording.inAlbum?.name||null}:null;
}
module.exports=function createRatings(dir,{catalog,fetcher=fetch}={}){
 const pending=new Map(),sourceFetch=require('./source-fetch')({fetcher});let tail=Promise.resolve(),next=0;
 async function page(url,{signal,body}={}){
  const file=path.join(dir,'rating-pages',hash(url+(body||''))+'.json');let saved;
  try{saved=JSON.parse(await fs.readFile(file,'utf8'));if(Date.now()-saved.at<86400000)return saved.text;}catch(_){}
  const task=tail.then(async()=>{
   await require('node:timers/promises').setTimeout(Math.max(0,next-Date.now()),undefined,{signal});signal?.throwIfAborted();next=Date.now()+1100;
   const response=await sourceFetch(url,{method:body?'POST':'GET',body,headers:{'User-Agent':`PAIN/${require('../package.json').version} (https://github.com/vansGAMee/pain)`,...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{})},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(7000)]):AbortSignal.timeout(7000)});
   if(!response.ok)throw Error('Rating source unavailable');let size=0;const chunks=[];for await(const b of response.body){size+=b.length;if(size>8*1024*1024)throw Error('Rating page too large');chunks.push(Buffer.from(b));}
   const text=Buffer.concat(chunks).toString('utf8');if(/cf-chl-|<title>\s*Just a moment/i.test(text))throw Error('Rating source requires browser verification');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify({at:Date.now(),text})).catch(()=>{});return text;
  });tail=task.catch(()=>{});return task;
 }
 async function bea(track,signal){
  if(match.unknown(track.artist)||!track.title)return null;
  const search=await page('https://www.besteveralbums.com/search.php?'+new URLSearchParams({s_o:'band',s_q:track.artist}),{signal});
  const artists=new Set(nodes(parseDocument(search),'a').filter(a=>match.norm(clean(a))===match.norm(track.artist)).map(a=>a.attribs.href).filter(h=>/^\/thechart\.php\?b=\d+$/.test(h||'')));
  if(artists.size!==1)return null;const artist=[...artists][0],id=new URL(artist,'https://www.besteveralbums.com').searchParams.get('b');
  const artistPage=await page('https://www.besteveralbums.com'+artist,{signal});
  const links=html=>nodes(parseDocument(html),'a').filter(a=>match.norm(clean(a))===match.norm(track.title)).map(a=>a.attribs.href).filter(h=>/^\/thechart\.php\?t=\d+$/.test(h||''));
  let found=links(artistPage);
  if(!found.length){const all=await page('https://www.besteveralbums.com/AJAXProxy.php?'+new URLSearchParams({obj:'CTrack',func:'renderTrackList',rendertype:'band',objectid:id,orderby:'TrackNumber',sortdir:'asc',showcompilation:'0',showall:'1'}),{signal});found=links(all);}
  const urls=[...new Set(found)];if(urls.length!==1)return null;const url='https://www.besteveralbums.com'+urls[0];return beaScore(await page(url,{signal}),track,url);
 }
 async function critique(track,signal){
  const record=await catalog.lookup(track,{signal,official:true});if(!record||record.possible||record.relatedVersion)return null;
  const url='https://critiquebrainz.org/ws/1/review/?'+new URLSearchParams({entity_id:record.id,entity_type:'recording',limit:'1'}),data=JSON.parse(await page(url,{signal})),r=data.average_rating;
  return score(r?.rating,r?.count,5,'https://critiquebrainz.org/recording/'+record.id,'CritiqueBrainz');
 }
 return function get(track,{signal}={}){
  const key=hash(JSON.stringify([track.title,track.artist,track.album,track.duration])),file=path.join(dir,'track-ratings',key+'.json');if(pending.has(key))return pending.get(key);
  const task=(async()=>{
   let saved;try{saved=JSON.parse(await fs.readFile(file,'utf8'));if(!valid(saved))saved=null;if(saved&&Date.now()>=saved.at&&Date.now()-saved.at<86400000)return saved;}catch(_){}
   let primary,stale=saved?{...saved,offline:true}:null;try{primary=await catalog.rating(track,{signal});if(valid(primary)){const data={...primary,rating:{...primary.rating,name:'MusicBrainz'},at:Date.now()};if(primary.offline)stale=data;else{await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(data)).catch(()=>{});return data;}}}catch(_){signal?.throwIfAborted();}
   // Independent published aggregates; never substitute album or artist scores.
   for(const provider of [bea,critique])try{const rating=await provider(track,signal);if(rating){const data={rating,at:Date.now()};await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(data)).catch(()=>{});return data;}}catch(_){signal?.throwIfAborted();}
   return stale||primary||{rating:null,reason:'unavailable'};
  })().finally(()=>pending.delete(key));pending.set(key,task);return task;
 };
};
module.exports.beaScore=beaScore;
