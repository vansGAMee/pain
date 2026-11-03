/* Display-only title rules. Original metadata and playback identities stay intact. */
(function(){
 'use strict';
 const KEY='pain_title_cleanup_v1';let options=ComfortUtils.normalizeTitleOptions(),bound=false;
 try{const raw=localStorage.getItem(KEY);if(raw&&raw.length<8192)options=ComfortUtils.normalizeTitleOptions(JSON.parse(raw));}catch(_){}
 function init({getLang=()=>localStorage.getItem('pain_lang'),getTrack=()=>null,onChange=()=>{}}={}){
  if(bound)return;const toggle=document.getElementById('cleanTitlesSwitch'),row=toggle?.closest('.fluid-setting-row');if(!row)return;bound=true;
  const wrapper=document.createElement('div');wrapper.className='title-cleanup-settings';
  wrapper.innerHTML=`<button type="button" class="btn-minimal title-cleanup-configure" aria-expanded="false" aria-controls="titleCleanupPanel"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 17h16M8 4v6M16 14v6"/></svg><span></span></button><div class="title-cleanup-panel" id="titleCleanupPanel" hidden><label><input type="checkbox" data-rule="sites"><span data-copy="sites"></span></label><label><input type="checkbox" data-rule="underscores"><span data-copy="underscores"></span></label><label class="title-cleanup-domains"><span data-copy="domains"></span><textarea rows="2" maxlength="4096" spellcheck="false" placeholder="example.com, music.site"></textarea></label><div class="title-cleanup-preview"><small data-copy="preview"></small><span class="title-cleanup-before"></span><strong class="title-cleanup-after"></strong></div><button type="button" class="btn-minimal primary title-cleanup-apply"></button></div>`;
  row.after(wrapper);
  const button=wrapper.querySelector('.title-cleanup-configure'),panel=wrapper.querySelector('.title-cleanup-panel'),sites=wrapper.querySelector('[data-rule="sites"]'),underscores=wrapper.querySelector('[data-rule="underscores"]'),extra=wrapper.querySelector('textarea'),apply=wrapper.querySelector('.title-cleanup-apply');
  sites.checked=options.sites;underscores.checked=options.underscores;extra.value=options.extraSites;
  let timer;
  function preview(){const raw=getTrack()?.title||'Artist_-_Song_(SkySound.cc)';wrapper.querySelector('.title-cleanup-before').textContent=raw;wrapper.querySelector('.title-cleanup-after').textContent=ComfortUtils.cleanTitle(raw,options);}
  function translate(){const ru=getLang()==='ru';button.querySelector('span').textContent=ru?'Настроить очистку':'Configure cleanup';const copy={sites:ru?'Убирать адреса сайтов':'Remove website addresses',underscores:ru?'Заменять подчёркивания пробелами':'Replace underscores with spaces',domains:ru?'Дополнительные сайты через запятую':'Additional websites, separated by commas',preview:ru?'Предпросмотр':'Preview'};for(const node of wrapper.querySelectorAll('[data-copy]'))node.textContent=copy[node.dataset.copy];apply.textContent=ru?'Применить к названиям':'Apply to titles';preview();}
  function save(deferred=false){options=ComfortUtils.normalizeTitleOptions({sites:sites.checked,underscores:underscores.checked,extraSites:extra.value});try{localStorage.setItem(KEY,JSON.stringify(options));}catch(_){}preview();clearTimeout(timer);if(deferred)timer=setTimeout(onChange,180);else onChange();}
  button.addEventListener('click',()=>{panel.hidden=!panel.hidden;button.setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden){translate();sites.focus({preventScroll:true});}});
  sites.addEventListener('change',()=>save());underscores.addEventListener('change',()=>save());extra.addEventListener('input',()=>save(true));
  apply.addEventListener('click',()=>{clearTimeout(timer);if(!toggle.checked){toggle.checked=true;toggle.dispatchEvent(new Event('change',{bubbles:true}));}else onChange();});
  window.addEventListener('pain:language',translate);translate();
 }
 window.TitleCleanup={getOptions:()=>options,init};
})();
