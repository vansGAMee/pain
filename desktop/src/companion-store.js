const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Model=require('./companion-model'),{safeWrite}=require('./data-guard'),OnlineLyrics=require('./lyrics-online');
const read=(file,fallback)=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
const hash=id=>crypto.createHash('sha256').update(id).digest('hex');
const lrc=lines=>lines.map(l=>l.time===null?l.text:`[${String(Math.floor(l.time/60)).padStart(2,'0')}:${(l.time%60).toFixed(2).padStart(5,'0')}]${l.text}`).join('\n');
function parseBody(body){
 const offset=body.match(/\[offset:\s*[+-]?\d+\]/i)?.[0]||'',lines=[];
 for(const row of body.split(/\r?\n/)){
  const timed=OnlineLyrics.parseLrc(offset+'\n'+row,{allowEmpty:true});
  if(timed.length)lines.push(...timed);
  else if(row.trim()&&!/^\[(?:offset|ar|al|ti|by|length|re):/i.test(row.trim()))lines.push({text:row,time:null});
 }
 return lines;
}
module.exports=class CompanionStore{
 constructor(dir){this.dir=dir;}
 file(name){return path.join(this.dir,name);}
 tracks(){return read(this.file('library.json'),{tracks:[]}).tracks;}
 capture(){
  const tracks=this.tracks(),indexed=Model.index(tracks),entities=Object.create(null),retained=read(this.file('companion-retained.json'),{});
  for(const pl of read(this.file('playlists.json'),[])){
   const portable=pl.companionTracks||pl.sharedTracks||[],known=new Set(),songs=[];
   for(const id of pl.trackIds||[]){const t=tracks.find(t=>String(t.id)===String(id));if(t){songs.push(Model.pack(t));known.add(Model.trackKey(t));}}
   const gaps=new Map(),anchors=new Set(known),previous=new Set(pl.companionResolved||portable.filter(p=>Model.resolve(p,indexed)).map(Model.trackKey));let anchor='';
   for(let i=portable.length-1;i>=0;i--){const p=Model.pack(portable[i]),key=Model.trackKey(p);
    if(anchors.has(key))anchor=key;
    else if(!known.has(key)){const arrived=Model.resolve(p,indexed);if(!arrived||!previous.has(key)){const group=gaps.get(anchor)||[];group.push(arrived?Model.pack(arrived):p);gaps.set(anchor,group);known.add(key);}}
   }
   const ordered=[];for(const song of songs){ordered.push(...(gaps.get(Model.trackKey(song))||[]).reverse(),song);}ordered.push(...(gaps.get('')||[]).reverse());
   entities[pl.companionKey||'playlist:'+pl.id]={kind:'playlist',name:pl.name,tracks:ordered};
  }
  let manualFiles=new Set(),onlineFiles=new Set();try{manualFiles=new Set(fs.readdirSync(this.file('lyrics')));}catch(_){}try{onlineFiles=new Set(fs.readdirSync(this.file('lyrics-online')));}catch(_){}
  const genres=read(this.file('genres.json'),{entries:{}}).entries||{},excluded=new Set(read(this.file('excluded-tracks.json'),[])),moments=read(this.file('favorite-moments.json'),{});
  for(const t of tracks){
   const key=Model.trackKey(t),track=Model.pack(t),manual=hash(String(t.id))+'.json';let lyric;
   if(manualFiles.has(manual))lyric=read(this.file('lyrics/'+manual),null);
   else{const file=hash(String(t.id)+JSON.stringify([t.title,t.artist,t.album,t.duration]))+'.json';if(onlineFiles.has(file))lyric=read(this.file('lyrics-online/'+file),null);}
   if(lyric?.lines?.length)entities['lyrics:'+key]={kind:'lyrics',track,body:lrc(lyric.lines),offset:0};
   if(genres[t.id]?.names?.length){const g=genres[t.id];entities['genres:'+key]={kind:'genres',track,data:{names:g.names,tags:g.tags||[],source:g.source||null,tagSource:g.tagSource||null,scope:g.scope||'recording',genreSources:g.genreSources||[]}};}
   if(excluded.has(String(t.id)))entities['excluded:'+key]={kind:'excluded',track};
   if(Number.isFinite(moments[t.id]))entities['moment:'+key]={kind:'moment',track,seconds:moments[t.id]};
  }
  // A song unavailable on this device remains portable and can resolve later.
  for(const[key,v]of Object.entries(retained))if(!entities[key]){const t=Model.resolve(v.track||{},indexed);if(v.kind!=='lyrics'||!t||!manualFiles.has(hash(String(t.id))+'.json'))entities[key]=v;}
  return Model.validate(entities);
 }
 apply(entities){
  Model.validate(entities);const tracks=this.tracks(),indexed=Model.index(tracks),old=read(this.file('playlists.json'),[]),oldEntities=this.capture(),playlists=[],retained=Object.create(null),excluded=new Set(read(this.file('excluded-tracks.json'),[])),moments=read(this.file('favorite-moments.json'),{});
  for(const[key,v]of Object.entries(entities)){
   if(v.kind==='playlist'){
    const existing=old.find(p=>(p.companionKey||'playlist:'+p.id)===key),id=existing?.id||'shared_'+hash(key).slice(0,24),resolved=v.tracks.map(p=>Model.resolve(p,indexed)).filter(Boolean);
    playlists.push({...existing,id,name:v.name,companionKey:key,companionTracks:v.tracks,companionResolved:resolved.map(Model.trackKey),trackIds:[...new Set(resolved.map(t=>t.id))],...(existing?.duo?{sharedTracks:v.tracks}: {})});continue;
   }
   const t=Model.resolve(v.track,indexed);if(!t){retained[key]=v;continue;}
   if(v.kind==='lyrics'){
    const file=this.file('lyrics/'+hash(String(t.id))+'.json'),before=read(file,null),lines=parseBody(v.body).map(l=>l.time===null?l:{...l,time:Math.max(0,l.time-(v.offset||0)/1000)});
    if(!before||Model.canonical(before.lines)!==Model.canonical(lines)){
     if(before)this.archive([{key,local:before,remote:v}]);
     fs.mkdirSync(path.dirname(file),{recursive:true});safeWrite(file,{lines,updatedAt:Date.now(),synced:true});
    }
   }else if(v.kind==='excluded')excluded.add(String(t.id));
   else if(v.kind==='moment'&&Number.isFinite(v.seconds))moments[t.id]=v.seconds;
   else if(v.kind==='genres')retained[key]=v;
  }
  for(const[key,v]of Object.entries(oldEntities))if(!entities[key]){
   const t=v.track&&Model.resolve(v.track,indexed);if(!t)continue;
   if(v.kind==='lyrics'){const file=this.file('lyrics/'+hash(String(t.id))+'.json');const oldLyrics=read(file,null);this.archive([{key,local:oldLyrics||v,deleted:true}]);fs.mkdirSync(path.dirname(file),{recursive:true});safeWrite(file,{lines:[],updatedAt:Date.now(),companionDeleted:true});}
   if(v.kind==='excluded')excluded.delete(String(t.id));if(v.kind==='moment')delete moments[t.id];
  }
  safeWrite(this.file('playlists.json'),playlists);safeWrite(this.file('excluded-tracks.json'),[...excluded]);safeWrite(this.file('favorite-moments.json'),moments);safeWrite(this.file('companion-retained.json'),retained);
 }
 archive(conflicts){if(!conflicts.length)return;const dir=this.file('companion-conflicts');fs.mkdirSync(dir,{recursive:true});safeWrite(path.join(dir,Date.now()+'-'+crypto.randomUUID()+'.json'),conflicts);}
 base(peer){return read(this.file('companion-peer-'+hash(peer)+'.json'),{});}
 acknowledge(peer,entities){safeWrite(this.file('companion-peer-'+hash(peer)+'.json'),entities);}
};
