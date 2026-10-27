'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {normalize}=require('./genre-profile-model');
module.exports=function createGenres(dir,{localMedia,catalog,store,wiki,deezer,getTracks,loadStats,interval=3000}={}){
 const file=path.join(dir,'genres.json'),prefs=path.join(dir,'genre-preferences.json');
 let entries={},enabled=true,mode='balanced',timer,active,revision=0,queue=new Map(),saveTail=Promise.resolve(),stopped=false,seeding,warming;
 const match=require('./cover-matching');let identities=new Map(),recordings=new Map(),albums=new Map(),indexedTracks;
 const signature=t=>JSON.stringify([2,t.title,t.artist,t.album,t.duration]);
 const ready=Promise.all([
  fs.readFile(file,'utf8').then(JSON.parse).then(data=>{entries=data.entries||{};}).catch(()=>{}),
  fs.readFile(prefs,'utf8').then(JSON.parse).then(data=>{enabled=data.enabled!==false;}).catch(()=>{}),wiki?.ready,catalog?.bulkReady,deezer?.ready,store?.ready
 ]);
 const persist=()=>{saveTail=saveTail.catch(()=>{}).then(async()=>{await fs.mkdir(dir,{recursive:true});const temp=file+'.tmp';await fs.writeFile(temp,JSON.stringify({entries}));await fs.rename(temp,file);});return saveTail;};
 function exact(track){const saved=entries[String(track.id)];return saved?.signature===signature(track)?saved:null;}
 function identity(track){return identities.get(String(track.id))?.signature===signature(track)?identities.get(String(track.id)).meta:match.metadata(track);}
 const recordingKey=t=>JSON.stringify([match.norm(t.artist),match.norm(t.rawTitle||t.title)]);
 const albumKey=t=>t.album&&!match.unknown(t.album)?JSON.stringify([match.norm(t.artist),match.norm(t.album)]):'';
 function entry(track){
  const own=exact(track);
  const meta=identity(track);if(!meta)return own;
  const recording=recordings.get(recordingKey(meta)),related=recording||albums.get(albumKey(meta));
  const fromCatalog=catalog?.cachedGenres?.(meta),fromWiki=wiki?.get(meta);
  const shared=related?{...related,tags:related.scope==='album'&&related.tagSource!==related.source?[]:related.tags,metadataVersion:recording?related.metadataVersion:undefined,shared:true}:null;
  const prepared={...track,...meta,title:meta.rawTitle||meta.title};
  const rows=[own,fromCatalog,fromWiki,deezer?.get(prepared),store?.get?.(prepared),shared].filter(r=>r&&(r.names?.length||r.tags?.length));
  if(!rows.length)return own;
  const sources=[...new Map(rows.flatMap(r=>r.genreSources||[{names:r.names||[],scope:r.scope,source:r.source}]).map(r=>[JSON.stringify([r.names,r.scope,r.source]),r])).values()];
  const tagged=rows.find(r=>r.tags?.length);
  return {...rows[0],names:normalize(rows.flatMap(r=>r.names||[])),tags:[...new Set(rows.flatMap(r=>r.tags||[]))],tagSource:tagged?.tagSource||tagged?.source,genreSources:sources,metadataVersion:rows.some(r=>r.metadataVersion===2)?2:undefined};
 }
 function indexSources(){
  const tracks=getTracks();recordings=new Map();albums=new Map();
  if(tracks!==indexedTracks){
   indexedTracks=tracks;const known=tracks.map(t=>t.artist);identities=new Map();
   for(const track of tracks){const recovered=match.fromFilename(track,known),meta=match.metadata(recovered);if(meta)identities.set(String(track.id),{meta:{...meta,rawTitle:recovered.title},signature:signature(track)});}
  }
  for(const track of tracks){const row=exact(track),meta=identity(track);if(!row?.names?.length||!meta||row.scope==='artist')continue;
   recordings.set(recordingKey(meta),row);if(row.scope==='album'&&albumKey(meta)&&(!row.albumTitle||match.norm(row.albumTitle)===match.norm(meta.album)))albums.set(albumKey(meta),row);
  }
 }
 function schedule(){if(stopped||timer||active||!enabled||!queue.size)return;timer=setTimeout(()=>{timer=null;pump().catch(()=>{});},interval);timer.unref?.();}
 async function pump(){
  await ready;if(stopped||active||!enabled)return;
  const job=[...queue.values()].find(j=>j.priority)||queue.values().next().value;if(!job)return;
  queue.delete(String(job.track.id));const abort=new AbortController();active={...job,abort};
  try{
   const media=await localMedia.read(job.track);abort.signal.throwIfAborted();
   const local=normalize(media.metadata?.genre||media.track.genre);
   let result=local.length?{names:local,scope:'file',source:null}:null,failed;
   if(!result)try{result=await catalog.genres(media.track,{signal:abort.signal});}catch(error){failed=error;}
   abort.signal.throwIfAborted();
   const known=entry(job.track);
   if(!result?.names?.length&&known?.names?.length)result={...known,tags:result?.tags||known.tags||[],tagSource:result?.tagSource||result?.source||known.tagSource,...(failed?{failed:true}:{})};
   if(!result?.names?.length&&store)try{
    const fallback=await store.genres(media.track,{signal:abort.signal});
    if(fallback)result={...fallback,tags:result?.tags||[],tagSource:result?.tagSource||result?.source};
   }catch(error){failed=error;}
   if(!result?.names?.length&&deezer)try{
    const fallback=await deezer.lookup(media.track,{signal:abort.signal});
    if(fallback)result={...fallback,tags:result?.tags||[],tagSource:result?.tagSource||result?.source};
   }catch(error){failed=error;}
   if(!result&&failed)throw failed;
   abort.signal.throwIfAborted();
   result ||= entry(job.track)?.names.length?entry(job.track):{names:[]};
   entries[String(job.track.id)]={...result,names:normalize(result.names),metadataVersion:2,signature:signature(job.track),at:Date.now()};
   revision++;await persist();
   indexSources();
  }catch(error){
   if(!abort.signal.aborted){entries[String(job.track.id)]={...(entry(job.track)||{names:[]}),signature:signature(job.track),metadataVersion:2,at:Date.now(),failed:true};revision++;await persist();}
  }finally{active=null;schedule();}
 }
 async function enqueue(track,priority=false){
  await ready;if(!enabled||!track||stopped)return;
  const cached=entry(track);if(cached?.metadataVersion===2&&Date.now()-cached.at<(cached.failed?10*60000:cached.names.length?30*86400000:86400000))return;
  if(active?.track.id===track.id)return;
  const id=String(track.id);queue.set(id,{track,priority:priority||queue.get(id)?.priority||false});schedule();
 }
 async function seed(){
  if(seeding)return seeding;
  seeding=(async()=>{await ready;if(!enabled||stopped)return;indexSources();
  warming=new AbortController();const options={signal:warming.signal},metas=[...identities.values()].map(x=>x.meta);
  const prepared=getTracks().map(t=>{const meta=identity(t);return meta?{...t,...meta,title:meta.rawTitle||meta.title}:t;});
  const jobs=[];if(wiki)jobs.push(wiki.warm(metas,options));if(catalog?.prefetchGenres)jobs.push(catalog.prefetchGenres(metas,options));if(deezer)jobs.push(deezer.prefetch(prepared,options));
  const results=await Promise.allSettled(jobs);for(const result of results)if(result.status==='fulfilled')revision++;
  indexSources();
  const stats=await loadStats().catch(()=>({})),heard=new Map();
  for(const p of stats.plays||[])heard.set(String(p.track),(heard.get(String(p.track))||0)+Math.max(0,Number(p.heard)||0));
  for(const track of [...getTracks()].sort((a,b)=>(heard.get(String(b.id))||0)-(heard.get(String(a.id))||0)))await enqueue(track);
  })().finally(()=>{seeding=null;warming=null;});return seeding;
 }
 async function setEnabled(value){
  await ready;enabled=!!value;
  if(!enabled){clearTimeout(timer);timer=null;active?.abort.abort();warming?.abort();queue.clear();}
  await fs.mkdir(dir,{recursive:true});await fs.writeFile(prefs,JSON.stringify({enabled}));
  if(enabled)seed().catch(()=>{});return status();
 }
 function setMode(value){mode=value;schedule();}
 function status(){return {enabled,revision:revision+(wiki?.revision?.()||0)+(catalog?.genreRevision?.()||0)+(deezer?.revision?.()||0)+(store?.genreRevision?.()||0),queued:queue.size,active:!!active,scanning:!!seeding,mode};}
 async function snapshot(){await ready;indexSources();return Object.fromEntries(getTracks().map(t=>[String(t.id),entry(t)||{names:normalize(t.genre),scope:'file'}]));}
 function close(){stopped=true;clearTimeout(timer);active?.abort.abort();warming?.abort();queue.clear();}
 return {ready,seed,enqueue,setEnabled,setMode,status,snapshot,entry,close};
};
