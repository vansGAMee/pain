/* Portable acoustic evidence; paths and signatures still belong to the actual file. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./audio-profile'));else root.DjState=factory(root.AudioProfile);})(globalThis,Audio=>{
 function vibes(data){
  if(!data||!Array.isArray(data.items)||!Number.isSafeInteger(data.updatedAt)||data.updatedAt<0||data.updatedAt>Date.now()+300000)return null;
  const ids=new Set(),items=[];
  for(const v of data.items.slice(0,8)){
   const profile=Audio.restore(JSON.stringify({v:v?.profile})).v;
   if(!Audio.texture(profile)||typeof v.id!=='string'||v.id.length>100||ids.has(v.id)||typeof v.name!=='string'||!v.name.trim())continue;
   ids.add(v.id);items.push({id:v.id,name:v.name.trim().slice(0,80),source:String(v.source||'').slice(0,300),...(typeof v.trackId==='string'?{trackId:v.trackId.slice(0,300)}:{}),profile,...(Array.isArray(v.embedding)&&v.embedding.length===512&&v.embedding.every(n=>Number.isFinite(n)&&Math.abs(n)<=1.001)?{embedding:[...v.embedding]}:{})});
  }
  return {items,activeId:ids.has(data.activeId)?data.activeId:null,updatedAt:data.updatedAt};
 }
 function merge(a={},b={}){
  const result=Audio.restore(a.profiles||{});
  for(const [id,p] of Object.entries(Audio.restore(b.profiles||{}))){
   const old=result[id];
   const full=x=>x?.analysis?.method==='stratified-pcm-v1'&&!!Audio.texture(x)&&!!Audio.detail(x);
   const incomingFull=full(p),oldFull=full(old);
   // A complete-file measurement supersedes an intro snapshot even when the
   // snapshot contains more frames. Re-analysis must also replace stale PCM
   // evidence with the same frame count; frame count is not a freshness clock.
   const sameFile=old&&old.signature===p.signature;
   const newerFull=sameFile&&incomingFull&&(!oldFull||p.updatedAt>old.updatedAt);
   const morePartial=sameFile&&!incomingFull&&!oldFull&&(p.frames>old.frames||p.frames===old.frames&&Audio.detailFrames(p)>Audio.detailFrames(old));
   if(!old||old.signature!==p.signature&&p.updatedAt>old.updatedAt||newerFull||morePartial)
    Object.defineProperty(result,id,{value:p,enumerable:true,writable:true,configurable:true});
  }
  const av=vibes(a.vibes),bv=vibes(b.vibes),chosen=bv&&(!av||bv.updatedAt>av.updatedAt)?bv:av;
  return {version:1,profiles:Audio.restore(result),...(chosen?{vibes:chosen}:{})};
 }
 return {merge};
});
