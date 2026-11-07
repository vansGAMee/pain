/* Playlist covers: local SVGs, track collages and user-selected images. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(root);else root.PlaylistArtwork=factory(root);})(globalThis,host=>{
 'use strict';
 const KEY='pain_playlist_artwork_v1',cache=new Map();let preferences=Object.create(null);
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 try{const raw=host.document&&host.localStorage?.getItem(KEY);if(raw&&raw.length<200000){const value=JSON.parse(raw);if(value&&typeof value==='object'&&!Array.isArray(value))for(const [id,p] of Object.entries(value).slice(0,1000))if(id.length<256&&p&&['tracks','generated','custom'].includes(p.mode))preferences[id]={mode:p.mode,variant:Math.max(0,Number(p.variant)||0)>>>0,...(/^[a-f0-9]{16}$/.test(p.version)?{version:p.version}:{})};}}catch(_){}
 function getPreference(id){return Object.hasOwn(preferences,String(id))?preferences[String(id)]:{mode:'tracks',variant:0};}
 function save(id,value){preferences={...preferences,[String(id)]:value};try{host.localStorage?.setItem(KEY,JSON.stringify(preferences));}catch(_){}return value;}
 function createArtwork(id,variant=0){
  const key=String(id)+':'+variant;if(cache.has(key))return cache.get(key);
  let seed=2166136261;for(const char of key)seed=Math.imul(seed^char.codePointAt(0),16777619)>>>0;
  const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;};
  const hue=263+Math.floor(random()*25),angle=Math.floor(random()*360),x=45+Math.floor(random()*110),y=45+Math.floor(random()*110);
  let curves='';for(let i=0;i<7;i++){const d=28+i*14;curves+=`<ellipse cx="${x}" cy="${y}" rx="${d}" ry="${Math.round(d*(.35+random()*.3))}" fill="none" stroke="hsl(${hue+12} 85% ${70+i*3}%)" stroke-opacity="${.16+i*.05}" stroke-width="${i===3?7:1.5}"/>`;}
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="hsl(${hue} 65% 16%)"/><stop offset=".5" stop-color="hsl(${hue} 65% 32%)"/><stop offset="1" stop-color="hsl(${hue+14} 70% 53%)"/></linearGradient><radialGradient id="light"><stop stop-color="#e7c6ff" stop-opacity=".85"/><stop offset="1" stop-color="#c78cff" stop-opacity="0"/></radialGradient></defs><path fill="url(#bg)" d="M0 0h200v200H0z"/><circle cx="${200-x}" cy="${200-y}" r="115" fill="url(#light)"/><g transform="rotate(${angle} 100 100)">${curves}<path d="M-10 155Q80 ${20+Math.round(random()*100)} 210 85" fill="none" stroke="#f3e4ff" stroke-opacity=".55" stroke-width="2"/></g><circle cx="${x}" cy="${y}" r="5" fill="#f3e4ff" fill-opacity=".8"/></svg>`;
  const uri='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);if(cache.size>=64)cache.delete(cache.keys().next().value);cache.set(key,uri);return uri;
 }
 function render(playlist,tracks=[],cover){
  const preference=getPreference(playlist.id);
  if(preference.mode==='custom'&&preference.version)return `<span class="playlist-artwork"><img src="/api/playlist-artwork/${escape(encodeURIComponent(playlist.id))}/image?v=${preference.version}" data-playlist-id="${escape(playlist.id)}" alt="" loading="lazy" decoding="async"></span>`;
  const unique=[...new Map(tracks.slice(0,8).filter(Boolean).map(t=>[String(t.id),t])).values()].slice(0,4);
  if(preference.mode==='generated'||!unique.length||!cover)return `<span class="playlist-artwork"><img src="${escape(createArtwork(playlist.id,preference.variant))}" alt="" loading="lazy" decoding="async"></span>`;
  return `<span class="playlist-artwork playlist-artwork-tracks" data-count="${unique.length}">${unique.map(track=>`<img src="${escape(cover(track))}" data-playlist-id="${escape(playlist.id)}" alt="" loading="lazy" decoding="async">`).join('')}</span>`;
 }
 function bind({getPlaylist,getTracks,cover,getLang=()=> 'ru',onChange=()=>{}}){
  const button=host.document?.getElementById('playlistArtworkBtn');if(!button||button.dataset.bound)return;button.dataset.bound='true';let dialog,activeId;
  host.document.addEventListener('error',event=>{const img=event.target,id=img.dataset?.playlistId;if(id!==undefined){delete img.dataset.playlistId;img.src=createArtwork(id,getPreference(id).variant);}},true);
  button.addEventListener('click',()=>{
   const playlist=getPlaylist();if(!playlist)return;activeId=String(playlist.id);
   if(!dialog){
    dialog=host.document.createElement('dialog');dialog.className='playlist-artwork-dialog';dialog.setAttribute('aria-labelledby','playlistArtworkTitle');
    dialog.innerHTML='<header><h3 id="playlistArtworkTitle"></h3><button type="button" class="ctrl-btn-subtle" data-close aria-label="Close">×</button></header><div class="playlist-artwork-preview"></div><fieldset><legend class="sr-only">Cover style</legend><label><input type="radio" name="playlistArtworkMode" value="tracks"><span data-label="tracks"></span></label><label><input type="radio" name="playlistArtworkMode" value="generated"><span data-label="generated"></span></label><label><input type="radio" name="playlistArtworkMode" value="custom"><span data-label="custom"></span></label></fieldset><div class="playlist-artwork-actions"><button type="button" class="btn-minimal playlist-artwork-upload"></button><button type="button" class="btn-minimal playlist-artwork-refresh"></button></div><input type="file" class="playlist-artwork-file" accept="image/png,image/jpeg,image/webp,image/gif" hidden><p class="playlist-artwork-status" role="status"></p>';
    host.document.body.appendChild(dialog);
    const update=()=>{const pl=getPlaylist();if(!pl||String(pl.id)!==activeId){dialog.close();return;}dialog.querySelector('.playlist-artwork-preview').innerHTML=render(pl,getTracks(pl),cover);const preference=getPreference(activeId);for(const input of dialog.querySelectorAll('input[type="radio"]'))input.checked=input.value===preference.mode;dialog.querySelector('input[value="custom"]').disabled=!preference.version;dialog.querySelector('.playlist-artwork-refresh').hidden=preference.mode!=='generated';};
    dialog.querySelector('[data-close]').onclick=()=>dialog.close();
    dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}});
    dialog.addEventListener('change',event=>{if(event.target.name!=='playlistArtworkMode')return;save(activeId,{...getPreference(activeId),mode:event.target.value});update();onChange();});
    dialog.querySelector('.playlist-artwork-refresh').onclick=()=>{const p=getPreference(activeId);save(activeId,{...p,mode:'generated',variant:(p.variant+1)>>>0});update();onChange();};
    const fileInput=dialog.querySelector('.playlist-artwork-file'),upload=dialog.querySelector('.playlist-artwork-upload'),status=dialog.querySelector('.playlist-artwork-status');
    upload.onclick=()=>fileInput.click();
    fileInput.onchange=async()=>{
     const file=fileInput.files[0],id=activeId,ru=getLang()==='ru';if(!file)return;
     dialog.querySelector('fieldset').disabled=upload.disabled=dialog.querySelector('.playlist-artwork-refresh').disabled=true;status.textContent=ru?'Сохраняю обложку…':'Saving cover…';
     let bitmap;
     try{
      if(file.size>20*1024*1024)throw Error(ru?'Выберите картинку до 20 МБ':'Choose an image up to 20 MB');
      bitmap=await host.createImageBitmap(file);
      if(bitmap.width<16||bitmap.height<16||bitmap.width*bitmap.height>24000000)throw Error(ru?'Выберите картинку от 16 пикселей до 24 мегапикселей':'Choose an image from 16 pixels up to 24 megapixels');
      const canvas=host.document.createElement('canvas'),side=Math.min(bitmap.width,bitmap.height);canvas.width=canvas.height=Math.min(1024,side);
      canvas.getContext('2d').drawImage(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side,0,0,canvas.width,canvas.height);bitmap.close();bitmap=null;
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.92));if(!blob)throw Error(ru?'Не удалось прочитать картинку':'Could not read the image');
      const dataUrl=await new Promise((resolve,reject)=>{const reader=new host.FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error(ru?'Не удалось прочитать файл':'Could not read the file'));reader.readAsDataURL(blob);});
      const response=await host.fetch('/api/playlist-artwork/'+encodeURIComponent(id),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dataUrl})}),result=await response.json();
      if(!response.ok||!/^[a-f0-9]{16}$/.test(result.version))throw Error(result.error||(ru?'Не удалось сохранить обложку. Попробуйте ещё раз.':'Could not save the cover. Try again.'));
      save(id,{...getPreference(id),mode:'custom',version:result.version});if(activeId===id){update();status.textContent='';}onChange();
     }catch(error){if(activeId===id)status.textContent=error.message;}
     finally{bitmap?.close();fileInput.value='';dialog.querySelector('fieldset').disabled=upload.disabled=dialog.querySelector('.playlist-artwork-refresh').disabled=false;}
    };
    dialog.addEventListener('close',()=>button.focus({preventScroll:true}));dialog.updatePreview=update;
   }
   const ru=getLang()==='ru';dialog.querySelector('h3').textContent=ru?'Обложка плейлиста':'Playlist cover';dialog.querySelector('[data-close]').setAttribute('aria-label',ru?'Закрыть':'Close');dialog.querySelector('[data-label="tracks"]').textContent=ru?'Обложки треков':'Track covers';dialog.querySelector('[data-label="generated"]').textContent=ru?'Фиолетовая генерация':'Purple artwork';dialog.querySelector('[data-label="custom"]').textContent=ru?'Моя картинка':'My image';dialog.querySelector('.playlist-artwork-upload').textContent=ru?'Выбрать картинку…':'Choose image…';dialog.querySelector('.playlist-artwork-status').textContent='';dialog.querySelector('.playlist-artwork-refresh').textContent=ru?'Другой узор':'Another pattern';dialog.updatePreview();dialog.showModal();
  });
 }
 return {createArtwork,getMode:id=>getPreference(id).mode,getPreference,render,bind};
});
