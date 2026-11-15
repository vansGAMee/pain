'use strict';
(() => {
 const image=document.getElementById('theme-preview');if(!image)return;
 const gallery=document.querySelector('.theme-gallery'),status=document.getElementById('theme-status');
 const buttons=[...document.querySelectorAll('[data-preview-theme]')];let request=0;
 async function select(button){
  const ticket=++request,theme=button.dataset.previewTheme,name=button.textContent.trim();
  gallery.setAttribute('aria-busy','true');
  try{
   const source=`assets/screenshots/theme-${theme}.webp`,next=new Image();next.src=source;await next.decode();
   if(ticket!==request)return;
   image.src=source;image.alt=`Фонотека PAIN на ПК в теме «${name}»`;
   image.closest('button').setAttribute('aria-label',`Увеличить тему ${name}`);
   gallery.dataset.currentTheme=theme;
   buttons.forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
   status.textContent=`Тема «${name}»`;
  }catch(_){if(ticket===request)status.textContent='Скриншот не загрузился. Выберите тему ещё раз.';}
  finally{if(ticket===request)gallery.setAttribute('aria-busy','false');}
 }
 buttons.forEach(button=>button.addEventListener('click',()=>select(button)));
})();

(() => {
 const image=document.getElementById('statistics-preview');if(!image)return;
 const frame=document.querySelector('.statistics-frame'),status=document.getElementById('statistics-status');
 const buttons=[...document.querySelectorAll('[data-statistics-screen]')];let request=0;
 buttons.forEach(button=>button.addEventListener('click',async()=>{
  const ticket=++request,name=button.dataset.statisticsScreen;frame.setAttribute('aria-busy','true');
  try{
   const source=`assets/screenshots/statistics-${name}.webp`,next=new Image();next.src=source;await next.decode();if(ticket!==request)return;
   image.src=source;image.alt=`PAIN: ${button.textContent.trim()}`;frame.dataset.currentScreen=name;
   buttons.forEach(item=>item.setAttribute('aria-pressed',String(item===button)));status.textContent=button.textContent.trim();
  }catch(_){if(ticket===request)status.textContent='Скриншот не загрузился. Попробуйте ещё раз.';}
  finally{if(ticket===request)frame.setAttribute('aria-busy','false');}
 }));
})();
