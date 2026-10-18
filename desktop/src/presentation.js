(function() {
  const shell=document.querySelector('.app-layout');
  const enter=document.getElementById('fullscreenPlayerBtn');
  const exit=document.getElementById('exitFullscreenBtn');
  let busy=false,previousFocus=null;
  const ru=()=>localStorage.getItem('pain_lang')==='ru';
  function labels(){enter.title=enter.ariaLabel=ru()?'Плеер на весь экран':'Fullscreen player';exit.textContent=ru()?'Выйти · Esc':'Exit · Esc';}
  function reset(){shell.classList.remove('player-fullscreen');enter.setAttribute('aria-pressed','false');previousFocus?.focus();}
  async function leave(){if(document.fullscreenElement===shell)await document.exitFullscreen();reset();}
  enter.addEventListener('click',async()=>{
    if(busy)return;busy=true;previousFocus=document.activeElement;
    window.dispatchEvent(new Event('pain:show-player'));shell.classList.add('player-fullscreen');enter.setAttribute('aria-pressed','true');
    try{if(!document.fullscreenElement&&shell.requestFullscreen)await shell.requestFullscreen();}catch(_){/* Focused window mode remains usable if fullscreen is denied. */}
    finally{busy=false;exit.focus();}
  });
  exit.addEventListener('click',()=>leave().catch(reset));
  document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement)reset();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&shell.classList.contains('player-fullscreen'))leave().catch(reset);});
  document.getElementById('langToggle').addEventListener('click',()=>queueMicrotask(labels));labels();
})();
