/* Portable track lists only: no paths, local IDs, listening history or network. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.DuoPlaylist=factory();})(globalThis,()=>{
 const text=v=>typeof v==='string'?v.trim().slice(0,500):'';
 const norm=v=>text(v).normalize('NFKC').toLowerCase().replace(/\s+/g,' ');
 const key=t=>JSON.stringify([norm(t.artist),norm(t.title)]);
 function clean(rows){
  if(!Array.isArray(rows)||rows.length>10000)throw Error('Invalid track list');
  const seen=new Set(),out=[];
  for(const row of rows){
   if(!row||typeof row!=='object')throw Error('Invalid track');
   const track={title:text(row.title),artist:text(row.artist),album:text(row.album)};
   if(!track.title)throw Error('Missing title');
   const id=key(track);if(!seen.has(id)){seen.add(id);out.push(track);}
  }
  return out;
 }
 function pack(tracks,kind='selection',name=''){return {format:'pain-duo',version:1,kind,name:text(name),tracks:clean(tracks)};}
 function parse(raw){
  if(typeof raw!=='string'||raw.length>4*1024*1024)throw Error('File too large');
  const value=JSON.parse(raw);
  if(value?.format!=='pain-duo'||value.version!==1||!['selection','playlist'].includes(value.kind))throw Error('Not a PAIN duo file');
  return pack(value.tracks,value.kind,value.name);
 }
 function combine(a,b){
  a=clean(a);b=clean(b);
  // Start with music both people selected, then give each their own turn.
  const other=new Set(b.map(key)),rows=a.filter(t=>other.has(key(t)));
  const shared=new Set(rows.map(key));
  a=a.filter(t=>!shared.has(key(t)));b=b.filter(t=>!shared.has(key(t)));
  for(let i=0;i<Math.max(a.length,b.length);i++){if(a[i])rows.push(a[i]);if(b[i])rows.push(b[i]);}
  if(rows.length>10000)throw Error('Combined list too large');
  return clean(rows);
 }
 function select(library,scope,counts=new Map()){
  if(scope==='all')return library;
  if(scope==='history')return library.filter(t=>(counts.get(String(t.id))||0)>0)
    .sort((a,b)=>(counts.get(String(b.id))||0)-(counts.get(String(a.id))||0));
  return library.filter(t=>t.favorite);
 }
 function resolve(rows,library){
  const available=new Map();for(const track of library)if(!available.has(key(track)))available.set(key(track),track.id);
  const ids=[],missing=[];
  for(const track of rows){const id=available.get(key(track));if(id!=null)ids.push(id);else missing.push(track);}
  return {ids,missing};
 }
 function download(value){
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download=value.kind==='playlist'?'together.pain-duo.json':'my-music.pain-duo.json';
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 return {pack,parse,combine,select,resolve,download};
});
