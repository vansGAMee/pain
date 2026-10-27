'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const match=require('./cover-matching'),wait=require('node:timers/promises').setTimeout;
module.exports=function createDeezerGenres(dir,{fetcher=fetch,spacing=150}={}){
 const file=path.join(dir,'deezer-track-genres.json'),request=require('./source-fetch')({fetcher});
 let entries={},revision=0,next=0,gate=Promise.resolve(),saving=Promise.resolve();const pending=new Map();
 const key=t=>JSON.stringify([match.norm(t.artist),match.norm(t.rawTitle||t.title),t.duration]);
 const ready=fs.readFile(file,'utf8').then(JSON.parse).then(data=>{entries=data;}).catch(()=>{});
 const get=t=>entries[key(t)]?.value?{...entries[key(t)].value,metadataVersion:1}:null;
 const persist=()=>{saving=saving.catch(()=>{}).then(async()=>{await fs.mkdir(dir,{recursive:true});await fs.writeFile(file+'.tmp',JSON.stringify(entries));await fs.rename(file+'.tmp',file);});return saving;};
 async function call(route,signal){
  const name=createHash('sha256').update(route).digest('hex'),cache=path.join(dir,'deezer-cache',name+'.json');
  if(pending.has(name))return pending.get(name);
  const job=(async()=>{
   try{const old=JSON.parse(await fs.readFile(cache,'utf8'));if(Date.now()-old.at<30*86400000)return old.value;}catch(_){}
   const slot=gate.then(async()=>{await wait(Math.max(0,next-Date.now()),undefined,{signal});next=Date.now()+spacing;});gate=slot.catch(()=>{});await slot;
   const response=await request('https://api.deezer.com/'+route,{headers:{'User-Agent':'PAIN/1.8 (local music player)'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(7000)]):AbortSignal.timeout(7000)});
   if(!response.ok)throw Error('Deezer unavailable');const data=await response.json();if(data.error)throw Error('Deezer: '+data.error.message);
   const value=route.startsWith('search?')?{data:(data.data||[]).map(t=>({id:t.id,title:t.title,duration:t.duration,artist:t.artist?{name:t.artist.name}:null,album:t.album?{id:t.album.id,title:t.album.title}:null}))}:{id:data.id,title:data.title,genres:data.genres};
   await fs.mkdir(path.dirname(cache),{recursive:true});await fs.writeFile(cache,JSON.stringify({at:Date.now(),value}));return value;
  })().finally(()=>pending.delete(name));pending.set(name,job);return job;
 }
 async function lookup(track,{signal}={}){
  await ready;const k=key(track),cached=entries[k],filename=!match.metadata(track)&&/_/.test(track.title||'');
  if(cached&&Date.now()-cached.at<(cached.value?30:1)*86400000&&(!filename||cached.value||cached.schema===2))return get(track);
  const meta=match.metadata(track),title=meta?.title||match.title(track.title);
  if(!title||!/[\p{L}]/u.test(title))return null;
  const owners=meta?match.artists(meta.artist):[''];let chosen;
  for(const owner of owners){
   const data=await call('search?'+new URLSearchParams({q:[owner,title].filter(Boolean).join(' '),limit:'50'}),signal);
   const rows=(data.data||[]).filter(r=>meta?match.matches({artistName:r.artist?.name,trackName:r.title},meta):[r.title,r.title+' '+r.artist?.name,r.artist?.name+' '+r.title].some(s=>match.norm(s)===match.norm(title))&&track.duration>0&&Math.round(track.duration/1000)===r.duration);
   if(!meta&&new Set(rows.map(r=>match.norm(r.artist?.name))).size!==1)continue;
   chosen=rows.find(r=>match.norm(r.title)===match.norm(track.rawTitle||track.title))||rows.find(r=>match.norm(r.title)===match.norm(title))||(!meta?rows[0]:null);
   if(chosen)break;
  }
  let result=null;
  if(chosen?.album?.id){
   const album=await call('album/'+chosen.album.id,signal),names=[...new Set((album.genres?.data||[]).map(g=>g.name).filter(Boolean))];
   if(names.length)result={names,tags:[],scope:'album',source:`https://www.deezer.com/album/${chosen.album.id}`,recordingSource:`https://www.deezer.com/track/${chosen.id}`,albumTitle:album.title,at:Date.now(),metadataVersion:1};
  }
  entries[k]={at:Date.now(),value:result,schema:2};revision++;await persist();return result;
 }
 async function prefetch(tracks,{signal}={}){
  const list=[...new Map(tracks.map(t=>[key(t),t])).values()];let cursor=0;
  await Promise.all([0,1].map(async()=>{while(cursor<list.length){signal?.throwIfAborted();const track=list[cursor++];try{await lookup(track,{signal});}catch(e){if(signal?.aborted)throw e;}}}));
 }
 return {ready,get,lookup,prefetch,revision:()=>revision};
};
