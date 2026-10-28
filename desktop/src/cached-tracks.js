'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
// Fresh disk state on every scan; overlapping callers share the same work.
module.exports=function createScanner({cacheDir,downloadsDir,getTracks,io=fs}){
 let pending;
 const list=dir=>io.readdir(dir).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
 async function scan(){
  const [cached,downloads]=await Promise.all([list(cacheDir),list(downloadsDir)]),names=new Set(downloads),candidates=new Map();
  for(const file of cached)if(file.endsWith('.mp3'))candidates.set(file.slice(0,-4),[path.join(cacheDir,file)]);
  for(const t of getTracks()){
   const id=String(t.id).replace(/[/\\?%*:|"<>]/g,'_');
   const ext=t.path?String(t.path).split('.').pop():'mp3',name=`${t.artist} - ${t.title}.${ext}`.replace(/[/\\?%*:|"<>]/g,'_').trim();
   if(names.has(name))candidates.set(id,[...(candidates.get(id)||[]),path.join(downloadsDir,name)]);
  }
  const entries=[...candidates],valid=new Array(entries.length);let cursor=0;
  await Promise.all(Array.from({length:Math.min(8,entries.length)},async()=>{
   while(cursor<entries.length){const i=cursor++,[id,files]=entries[i];for(const file of files)try{const stat=await io.stat(file);if(stat.isFile()&&stat.size>=4096){valid[i]=id;break;}}catch(_){} }
  }));return valid.filter(id=>id!==undefined);
 }
 return ()=>pending||(pending=scan().finally(()=>{pending=null;}));
};
