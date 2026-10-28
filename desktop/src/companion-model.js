// Three-way reconciliation against the last acknowledged exchange. The phone
// additionally checks its revision before applying, so concurrent edits retry.
const crypto=require('node:crypto');
const normalize=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/ё/g,'е').replace(/[^\p{L}\p{N}]/gu,'');
const pack=t=>({id:String(t.id),title:String(t.title||''),artist:String(t.artist||''),album:String(t.album||''),duration:Number(t.duration)||0,bytes:Number(t.bytes)||0});
const trackKey=t=>crypto.createHash('sha256').update([normalize(t.title),normalize(t.artist),Number(t.duration)||0,Number(t.bytes)||0].join('\0')).digest('hex');
function canonical(value){
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).filter(k=>!(k==='id'&&'title'in value&&'artist'in value&&'duration'in value)).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
const same=(a,b)=>canonical(a)===canonical(b);
function merge(base={},local={},remote={}){
 const entities=Object.create(null),conflicts=[];
 for(const key of new Set([...Object.keys(base),...Object.keys(local),...Object.keys(remote)])){
  const b=base[key],l=local[key],r=remote[key];let next;
  if(same(l,r))next=l;
  else if(same(l,b))next=r;
  else if(same(r,b))next=l;
  else if(l?.kind==='playlist'&&r?.kind==='playlist'){
   const old=new Set((b?.tracks||[]).map(trackKey)),left=new Map(l.tracks.map(t=>[trackKey(t),t])),right=new Map(r.tracks.map(t=>[trackKey(t),t]));
   const kept=new Set([...left.keys(),...right.keys()].filter(id=>!old.has(id)||(left.has(id)&&right.has(id))));
   const tracks=[...left,...right].filter(([id],i,all)=>kept.has(id)&&all.findIndex(([k])=>k===id)===i).map(([,t])=>t);
   const name=l.name===b?.name?r.name:l.name;
   next={...r,...l,name,tracks};if(l.name!==r.name&&l.name!==b?.name&&r.name!==b?.name)conflicts.push({key,local:l,remote:r});
  }else{
   // Keep an edit over a concurrent deletion, and retain both conflicting
   // lyric/metadata versions in the durable conflict archive.
   next=l||r;conflicts.push({key,local:l,remote:r});
  }
  if(next!==undefined)entities[key]=next;
 }
 return {entities,conflicts};
}
function index(tracks){const byId=new Map(),byKey=new Map();for(const t of tracks){byId.set(String(t.id),t);const key=trackKey(t),items=byKey.get(key)||[];items.push(t);byKey.set(key,items);}return {byId,byKey};}
function resolve(portable,tracks){
 const source=Array.isArray(tracks)?index(tracks):tracks,key=trackKey(portable),exact=source.byId.get(String(portable.id));
 if(exact&&trackKey(exact)===key)return exact;
 const matches=source.byKey.get(key)||[];return matches.length===1?matches[0]:null;
}
function validate(entities){
 if(!entities||typeof entities!=='object'||Array.isArray(entities)||Object.keys(entities).length>12000)throw Error('Invalid shared collections');
 for(const [key,v]of Object.entries(entities)){
  if(!key||key.length>256||!v||!['playlist','lyrics','genres','excluded','moment'].includes(v.kind))throw Error('Invalid shared item');
  if(v.kind==='playlist'&&(typeof v.name!=='string'||v.name.length>300||!Array.isArray(v.tracks)||v.tracks.length>10000))throw Error('Invalid shared playlist');
  if(v.kind==='lyrics'&&(typeof v.body!=='string'||v.body.length>200000||!Number.isFinite(v.offset||0)))throw Error('Invalid shared lyrics');
  if(v.kind==='moment'&&(!Number.isFinite(v.seconds)||v.seconds<0||v.seconds>=86400))throw Error('Invalid shared moment');
  const songs=v.kind==='playlist'?v.tracks:[v.track];
  if(songs.some(t=>!t||typeof t.title!=='string'||typeof t.artist!=='string'||t.title.length>2000||t.artist.length>2000||!Number.isFinite(t.duration)||!Number.isFinite(t.bytes)||t.duration<0||t.bytes<0))throw Error('Invalid shared recording');
 }
 return entities;
}
module.exports={pack,trackKey,index,resolve,canonical,merge,validate};
