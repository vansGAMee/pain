'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const wait=require('node:timers/promises').setTimeout,request=require('./source-fetch')();
let directory,tail=Promise.resolve(),next=0,genreCache={},genreReady=Promise.resolve(),genreRevision=0,genreSaving=Promise.resolve();const memory=new Map();
function configure(dataDir){const value=dataDir&&path.join(dataDir,'cover-search');if(value!==directory){directory=value;memory.clear();genreCache={};genreRevision=0;genreReady=value?fs.readFile(path.join(value,'song-genres.json'),'utf8').then(JSON.parse).then(data=>{genreCache=data;}).catch(()=>{}):Promise.resolve();}}
const genreKey=t=>{const m=require('./cover-matching'),meta=m.metadata(t);return JSON.stringify([m.norm(meta?.artist||t.artist),m.norm(meta?.title||m.title(t.title)),t.duration]);};
const get=t=>genreCache[genreKey(t)]||null;
async function remember(track,value){
 if(!value?.names?.length)return value;genreCache[genreKey(track)]={...value,at:Date.now(),metadataVersion:1};genreRevision++;
 if(directory){genreSaving=genreSaving.catch(()=>{}).then(async()=>{await fs.mkdir(directory,{recursive:true});const file=path.join(directory,'song-genres.json');await fs.writeFile(file+'.tmp',JSON.stringify(genreCache));await fs.rename(file+'.tmp',file);});await genreSaving;}
 return genreCache[genreKey(track)];
}
async function search(query,{signal,interval=3100,genres=false,cachedOnly=false}={}){
 const key=JSON.stringify(query),file=directory&&path.join(directory,createHash('sha256').update(key).digest('hex')+'.json');
 const job=tail.then(async()=>{
  signal?.throwIfAborted();let saved=memory.get(key);
  if(!saved&&file)try{saved=JSON.parse(await fs.readFile(file,'utf8'));}catch(_){}
  if(cachedOnly)return saved?.results||[];
  const fresh=saved&&Date.now()-saved.at<(saved.results.length?30:1)*86400000&&(!genres||saved.version===2);
  if(fresh)return saved.results;
  try{
   await wait(Math.max(0,next-Date.now()),undefined,{signal});signal?.throwIfAborted();
   next=Date.now()+Math.max(3100,interval); // Shared across artwork and genres: Apple's ~20 searches/minute.
   const response=await request('https://itunes.apple.com/search?'+new URLSearchParams({...query,limit:'50'}),{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(6000)]):AbortSignal.timeout(6000)});
   if(!response.ok)throw Error('Store unavailable');
   const results=((await response.json()).results||[]).map(({artistName,trackName,collectionName,artworkUrl100,primaryGenreName,trackViewUrl,collectionViewUrl,trackTimeMillis,artistLinkUrl,artistViewUrl})=>({artistName,trackName,collectionName,artworkUrl100,primaryGenreName,trackViewUrl,collectionViewUrl,trackTimeMillis,artistLinkUrl,artistViewUrl}));
   const data={at:Date.now(),version:2,results};if(memory.size>=512)memory.delete(memory.keys().next().value);memory.set(key,data);
   if(file){await fs.mkdir(directory,{recursive:true});await fs.writeFile(file,JSON.stringify(data)).catch(()=>{});}return results;
  }catch(error){if(saved?.results?.length)return saved.results;throw error;}
 });
 tail=job.catch(()=>{});return job;
}
async function genres(track,{signal}={}){
 await genreReady;const saved=get(track);if(saved&&Date.now()-saved.at<30*86400000)return saved;
 const match=require('./cover-matching'),meta=match.metadata(track);
 if(!meta){
  const title=match.title(track.title),rows=(await search({term:title,entity:'song'},{signal,genres:true})).filter(r=>r.primaryGenreName&&track.duration>0&&Math.round(r.trackTimeMillis/1000)===Math.round(track.duration/1000)&&[r.trackName,r.trackName+' '+r.artistName,r.artistName+' '+r.trackName].some(s=>match.norm(s)===match.norm(title)));
  if(new Set(rows.map(r=>match.norm(r.artistName))).size!==1)return null;
  return rows.length?remember(track,{names:[...new Set(rows.map(r=>r.primaryGenreName))],scope:'store',source:rows[0].trackViewUrl||null}):null;
 }
 for(const query of match.queries(meta).filter(q=>q.entity==='song')){
  const items=(await search(query,{signal,genres:true})).filter(r=>r.primaryGenreName&&match.matches(r,meta));
  let selected=items.filter(r=>match.norm(r.trackName)===match.norm(track.title));
  if(!selected.length)selected=items.filter(r=>match.norm(r.trackName)===match.norm(meta.title));
  if(selected.length)return remember(track,{names:[...new Set(selected.map(r=>r.primaryGenreName))],scope:'store',source:selected[0].trackViewUrl||null});
 }
 return null;
}
module.exports={configure,search,genres,get,genreRevision:()=>genreRevision,get ready(){return genreReady;}};
