// One occasional highlight, then complete rest. No per-frame JavaScript.
(()=>{
 const root=document.documentElement,media=matchMedia('(prefers-reduced-motion: reduce)');
 let timer,target,effect,last=null;
 const textChanges=new MutationObserver(()=>schedule());
 const allowed=()=>root.dataset.theme==='form-night'&&!document.hidden&&!root.hasAttribute('data-reduced-motion')&&root.dataset.performanceMode!=='maximum'&&!media.matches&&!document.querySelector('.app-layout.karaoke-open');
 function stop(){clearTimeout(timer);timer=null;textChanges.disconnect();if(target){target.classList.remove(effect);target.removeAttribute('data-night-glint-text');}target=null;effect=null;}
 function schedule(first=false){
  stop();if(!allowed())return;
  // This is a decorative cadence, never part of playback or recommendation.
  timer=setTimeout(()=>flash(first),first?14000:65000+Math.random()*45000);
 }
 function visible(el){
  const r=el.getBoundingClientRect(),viewport=el.closest('.views-viewport,.track-info-panel'),clip=viewport?.getBoundingClientRect();
  return r.width>0&&r.height>0&&r.top>=0&&r.bottom<innerHeight-12&&(!clip||r.top>=clip.top&&r.bottom<=clip.bottom)&&getComputedStyle(el).visibility!=='hidden';
 }
 function flash(first=false){
  if(!allowed()){stop();return;}
  if([...document.querySelectorAll('dialog[open],.modal-backdrop,.eq-modal-backdrop,.share-profile-modal-backdrop.open')].some(el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden')){schedule();return;}
  const candidates=[...document.querySelectorAll('.view-pane.active :is(.view-heading,.home-intro h1,.vinyl-title,.genre-profile h2,.insight-gallery-heading h2)')].filter(visible).map(el=>({el,style:'night-metal-glint'}));
  if(!first){
   const edge=document.querySelector('.bottom-player-bar');if(edge&&visible(edge))candidates.push({el:edge,style:'night-edge-glint'});
   const cover=document.querySelector('.track-info-cover');if(cover&&visible(cover))candidates.push({el:cover,style:'night-cover-glint'});
  }
  const choices=candidates.filter(item=>item.el!==last),pool=choices.length?choices:candidates;
  if(!pool.length){schedule();return;}
  const item=pool[Math.floor(Math.random()*pool.length)];target=item.el;effect=item.style;last=target;
  if(effect==='night-metal-glint'){target.setAttribute('data-night-glint-text',target.textContent);textChanges.observe(target,{childList:true,subtree:true,characterData:true});}
  target.classList.add(effect);
  timer=setTimeout(()=>schedule(),2300);
 }
 window.addEventListener('pain:theme',()=>schedule(true));
 window.addEventListener('pain:performance',()=>schedule());
 window.addEventListener('pain:view',()=>{if(target&&!target.closest('.view-pane.active'))schedule();else if(!timer)schedule(true);});
 document.addEventListener('visibilitychange',()=>{root.toggleAttribute('data-window-hidden',document.hidden);schedule();});
 document.getElementById('reducedMotionSwitch')?.addEventListener('change',()=>schedule());
 media.addEventListener('change',()=>schedule());
 // A font/language change cancels the old copy before the next paint.
 new MutationObserver(records=>schedule(records.some(r=>r.attributeName==='data-theme'))).observe(root,{attributes:true,attributeFilter:['data-app-font','data-theme','data-performance-mode','data-reduced-motion','lang','dir']});
 document.getElementById('langToggle')?.addEventListener('click',()=>schedule());
 const shell=document.querySelector('.app-layout');let karaoke=shell?.classList.contains('karaoke-open');
 if(shell)new MutationObserver(()=>{const open=shell.classList.contains('karaoke-open');if(open!==karaoke){karaoke=open;schedule();}}).observe(shell,{attributes:true,attributeFilter:['class']});
 schedule(true);
})();
