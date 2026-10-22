/* Portable acoustic evidence; paths and signatures still belong to the actual file. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./audio-profile'));else root.DjState=factory(root.AudioProfile);})(globalThis,Audio=>{
 function vibes(data){
  if(!data||!Array.isArray(data.items)||!Number.isSafeInteger(data.updatedAt)||data.updatedAt<0||data.updatedAt>Date.now()+300000)return null;
  const ids=new Set(),items=[];
  for(const v of data.items.slice(0,8)){
   const profile=Audio.restore(JSON.stringify({v:v?.profile})).v;
   if(!Audio.texture(profile)||typeof v.id!=='string'||v.id.length>100||ids.has(v.id)||typeof v.name!=='string'||!v.name.trim())continue;
   ids.add(v.id);items.push({id:v.id,name:v.name.trim().slice(0,80),source:String(v.source||'').slice(0,300),profile});
  }
  return {items,activeId:ids.has(data.activeId)?data.activeId:null,updatedAt:data.updatedAt};
 }
 function merge(a={},b={}){
  const result=Audio.restore(JSON.stringify(a.profiles||{}));
  for(const [id,p] of Object.entries(Audio.restore(JSON.stringify(b.profiles||{})))){
   const old=result[id];
   if(!old||old.signature!==p.signature&&p.updatedAt>old.updatedAt||old.signature===p.signature&&(p.frames>old.frames||p.frames===old.frames&&(p.detail?.frames||0)>(old.detail?.frames||0)))
    Object.defineProperty(result,id,{value:p,enumerable:true,writable:true,configurable:true});
  }
  const av=vibes(a.vibes),bv=vibes(b.vibes),chosen=bv&&(!av||bv.updatedAt>av.updatedAt)?bv:av;
  return {version:1,profiles:Audio.restore(JSON.stringify(result)),...(chosen?{vibes:chosen}:{})};
 }
 return {merge};
});
