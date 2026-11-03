/* Artist bookmarks are local presentation preferences, separate from DJ taste. */
(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory(null,null);
 else root.FavoriteArtists=factory(root.localStorage,root);
})(globalThis,(storage,host)=>{
 'use strict';
 const KEY='pain_favorite_artists_v1',VISIBLE='pain_home_artists_enabled';
 const key=name=>String(name||'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let names=new Map(),visible=true,indexTracks,index=new Map();
 try{const raw=storage?.getItem(KEY);if(raw&&raw.length<65536)for(const name of JSON.parse(raw).slice(0,256))if(typeof name==='string'&&name.trim()&&name.length<=256)names.set(key(name),name.trim());visible=storage?.getItem(VISIBLE)!=='false';}catch(_){}
 function emit(){host?.dispatchEvent(new CustomEvent('pain:favorite-artists'));}
 function has(name){return names.has(key(name));}
 function toggle(name){
  name=String(name||'').trim().slice(0,256);if(!name)return false;
  const id=key(name);if(names.has(id))names.delete(id);else if(names.size<256)names.set(id,name);
  try{storage?.setItem(KEY,JSON.stringify([...names.values()]));}catch(_){}
  emit();return has(name);
 }
 function setEnabled(value){visible=Boolean(value);try{storage?.setItem(VISIBLE,String(visible));}catch(_){}emit();}
 function initSettings(){const input=host?.document.getElementById('homeArtistsSwitch');if(!input||input.dataset.bound)return;input.dataset.bound='true';input.checked=visible;input.addEventListener('change',()=>setEnabled(input.checked));}
 function renderHome(tracks=[],cover,lang='ru'){
  if(!visible||!names.size)return '';
  if(indexTracks!==tracks){
   indexTracks=tracks;index=new Map();
   for(const track of tracks){
    const artists=String(track.artist||'').split(/\s+(?:feat\.?|ft\.?|featuring)\s+|\s*[;,]\s*|\s+&\s+/i).filter(Boolean);
    for(const artist of artists){const id=key(artist);if(!index.has(id))index.set(id,{track,count:0});index.get(id).count++;}
   }
  }
  const ru=lang==='ru';
  return `<section class="home-section home-artists"><header class="home-section-head"><h2>${ru?'Любимые артисты':'Favourite artists'}</h2></header><div class="home-favorite-grid">${[...names.values()].slice(0,12).map(name=>{
   const found=index.get(key(name)),n=found?.count||0;
   const label=ru?(n?`${n} ${n%100>=11&&n%100<=14?'треков':n%10===1?'трек':n%10>=2&&n%10<=4?'трека':'треков'}`:'Артист'):(n?`${n} ${n===1?'track':'tracks'}`:'Artist');
   return `<button type="button" class="home-favorite home-artist" data-home-action="artist" data-id="${escape(name)}"><span class="home-artist-avatar">${found&&cover?`<img src="${escape(cover(found.track))}" alt="" loading="lazy" decoding="async">`:`<span aria-hidden="true">${escape(Array.from(name)[0]?.toUpperCase())}</span>`}</span><strong>${escape(name)}</strong><span>${label}</span></button>`;
  }).join('')}</div></section>`;
 }
 return {list:()=>[...names.values()],has,toggle,enabled:()=>visible,setEnabled,initSettings,renderHome,key};
});
