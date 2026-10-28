// One occasional highlight, then complete rest. No per-frame JavaScript.
(()=>{
 const root=document.documentElement,media=matchMedia('(prefers-reduced-motion: reduce)');
 let timer,target,last=null;
 const allowed=()=>root.dataset.theme==='form-night'&&!document.hidden&&!root.hasAttribute('data-reduced-motion')&&root.dataset.performanceMode!=='maximum'&&!media.matches;
 function stop(){clearTimeout(timer);timer=null;target?.classList.remove('night-metal-glint');target=null;}
 function schedule(first=false){
  stop();if(!allowed())return;
  // This is a decorative cadence, never part of playback or recommendation.
  timer=setTimeout(flash,first?14000:65000+Math.random()*45000);
 }
 function flash(){
  if(!allowed()){stop();return;}
  const candidates=[...document.querySelectorAll('.view-pane.active :is(.view-heading,.home-intro h1,.vinyl-title,.genre-profile h2,.insight-gallery-heading h2)')].filter(el=>{
   const r=el.getBoundingClientRect();return r.width>0&&r.top>=0&&r.bottom<innerHeight-100;
  });
  const choices=candidates.filter(el=>el!==last),pool=choices.length?choices:candidates;
  if(!pool.length){schedule();return;}
  target=pool[Math.floor(Math.random()*pool.length)];last=target;target.classList.add('night-metal-glint');
  timer=setTimeout(()=>schedule(),2300);
 }
 window.addEventListener('pain:theme',()=>schedule(true));
 window.addEventListener('pain:performance',()=>schedule());
 window.addEventListener('pain:view',()=>{if(target&&!target.closest('.view-pane.active'))schedule();else if(!timer)schedule(true);});
 document.addEventListener('visibilitychange',()=>{root.toggleAttribute('data-window-hidden',document.hidden);schedule();});
 document.getElementById('reducedMotionSwitch')?.addEventListener('change',()=>schedule());
 media.addEventListener('change',()=>schedule());
 schedule(true);
})();
