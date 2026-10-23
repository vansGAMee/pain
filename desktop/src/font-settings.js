/* Appearance only. A custom font stays on this computer, never in sync data. */
(() => {
  'use strict';
  const el=id=>document.getElementById(id),select=el('appFontSelect'),root=document.documentElement;
  if(!select)return;
  const key='pain_interface_font_v1',text=(ru,en)=>localStorage.getItem('pain_lang')==='ru'?ru:en;
  let generation=0,activeFace=null,lastStatus=null;
  const status=(ru,en)=>{lastStatus=[ru,en];el('appFontStatus').textContent=text(ru,en);};
  el('langToggle')?.addEventListener('click',()=>queueMicrotask(()=>{if(lastStatus)status(...lastStatus);}));
  function controls(){el('installedFontControls').hidden=select.value!=='installed';el('fontFileControls').hidden=select.value!=='file';}
  function fontFile(value){return new Promise((resolve,reject)=>{
    const request=indexedDB.open('pain-appearance',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('fonts');
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(new Error('Font storage blocked'));
    request.onsuccess=()=>{
      const db=request.result,tx=db.transaction('fonts',value?'readwrite':'readonly'),store=tx.objectStore('fonts');
      const read=value?store.put(value,'custom'):store.get('custom');let result;
      read.onsuccess=()=>{result=read.result;};
      tx.oncomplete=()=>{db.close();resolve(value||result);};
      tx.onerror=tx.onabort=()=>{db.close();reject(tx.error||new Error('Font storage unavailable'));};
    };
  });}
  async function apply(pref,save=true,uploaded=null){
    const ticket=++generation;let family='',face=null;
    try {
      if(!['default','geist-bold','manrope','system','installed','file'].includes(pref.id))pref={id:'default'};
      if(pref.id==='geist-bold')family='Geist';
      if(pref.id==='system')family='system-ui';
      if(pref.id==='manrope'){await document.fonts.load('400 16px Manrope');family='Manrope';}
      if(pref.id==='installed'){
        const name=String(pref.name||'').trim().slice(0,80);if(!name)throw new Error('Empty font name');
        face=await new FontFace('PAIN Custom '+ticket,'local('+JSON.stringify(name)+')').load();
        family=JSON.stringify(face.family);pref={id:'installed',name};
      }
      if(pref.id==='file'){
        const record=uploaded||await fontFile();
        if(!record?.data){if(ticket===generation)status('Выберите файл шрифта. Он останется только на этом компьютере.','Choose a font file. It stays on this computer.');return;}
        face=await new FontFace('PAIN Custom '+ticket,record.data).load();family=JSON.stringify(face.family);
        if(ticket!==generation)return;
        if(uploaded)await fontFile(record);
        pref={id:'file',name:record.name};
      }
      if(ticket!==generation)return;
      if(save)localStorage.setItem(key,JSON.stringify(pref));
      if(face)document.fonts.add(face);
      if(activeFace)document.fonts.delete(activeFace);activeFace=face;
      if(family){root.style.setProperty('--app-font',family);root.dataset.appFont=pref.id;}
      else{root.style.removeProperty('--app-font');delete root.dataset.appFont;}
      select.value=pref.id;controls();
      if(pref.id==='installed')el('installedFontName').value=pref.name;
      status(pref.name?`Применён: ${pref.name}`:'Шрифт сохранён для этого компьютера.',pref.name?`Applied: ${pref.name}`:'Font saved on this computer.');
    }catch(_){if(ticket===generation)status('Не удалось применить шрифт. Проверьте название или выберите другой файл. Прежний шрифт сохранён.','Could not apply this font. Check its name or choose another file. Your previous font is kept.');}
  }
  select.addEventListener('change',()=>{
    generation++;controls();
    if(select.value==='installed'){status('Введите точное название установленного шрифта.','Enter the exact name of an installed font.');el('installedFontName').focus();}
    else if(select.value==='file')apply({id:'file'});
    else apply({id:select.value});
  });
  el('installedFontForm').addEventListener('submit',e=>{e.preventDefault();apply({id:'installed',name:el('installedFontName').value});});
  el('appFontFile').addEventListener('change',async e=>{
    const file=e.target.files[0];if(!file)return;
    if(file.size>6*1024*1024){status('Максимальный размер шрифта — 6 МБ.','Maximum font size is 6 MB.');e.target.value='';return;}
    const ticket=++generation;
    try{const data=await file.arrayBuffer();if(ticket===generation)await apply({id:'file'},true,{name:file.name,data});}
    catch(_){status('Не удалось прочитать файл шрифта.','Could not read the font file.');}
    e.target.value='';
  });
  try{const saved=JSON.parse(localStorage.getItem(key));if(saved&&typeof saved==='object')apply(saved,false);}catch(_){}
  controls();
})();
