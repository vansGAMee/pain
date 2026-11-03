(function(){
 'use strict';
 const control=document.getElementById('discordPresenceSwitch'),hint=document.getElementById('discordPresenceStatus');let enabled=false,busy=false,timer,last=0,queued=false,generation=0;
 const ru=()=>localStorage.getItem('pain_lang')!=='en';
 function render(data){enabled=data.enabled===true;control.checked=enabled;hint.textContent=data.error?'Discord: '+data.error:!enabled?(ru()?'Название песни, исполнитель и прогресс. Можно отключить в любой момент.':'Track, artist and progress. You can turn sharing off anytime.'):data.connected&&data.pending&&data.retryAfterMs>0?(ru()?`Discord обновится через ${Math.ceil(data.retryAfterMs/1000)} сек. — ограничение Discord.`:`Discord will update in ${Math.ceil(data.retryAfterMs/1000)} sec — Discord rate limit.`):data.connected&&data.transport==='arrpc'?(ru()?'Vesktop · режим совместимости, название песни и исполнитель.':'Vesktop · compatibility mode with the song title and artist.'):data.connected?(ru()?'Discord принял статус · обновляется при смене трека':'Discord accepted the activity · updates on track changes'):(ru()?'Откройте настольный Discord и включите отображение активности в его настройках.':'Open desktop Discord and enable activity sharing in Discord settings.');}
 async function send(force=false){
  if(!force&&Date.now()-last<5000)return;if(busy){queued||=force;return;}
  const revision=generation;busy=true;last=Date.now();try{const track=window.PainPlayer?.getTrack(),audio=window.PainPlayer?.getAudio();const r=await fetch('/api/discord-presence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({trackId:track?.id||null,playing:!!audio&&!audio.paused&&!audio.ended,position:audio?.currentTime||0,rate:audio?.playbackRate||1,volume:audio?audio.volume:null,smart:window.painQueue?.shuffleMode==='smart',heartbeat:!force})});if(r.ok){const data=await r.json();if(revision===generation)render(data);}}catch(_){}finally{busy=false;if(queued){queued=false;send(true);}}
 }
 function changed(event){if(event?.target?.tagName==='AUDIO'&&event.target!==window.PainPlayer?.getAudio())return;clearTimeout(timer);timer=setTimeout(()=>send(true),250);}
 control.addEventListener('change',async()=>{generation++;control.disabled=true;try{const r=await fetch('/api/discord-presence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:control.checked})});if(!r.ok)throw Error();render(await r.json());send(true);}catch(_){control.checked=enabled;hint.textContent=ru()?'Не удалось подключить Discord. Попробуйте ещё раз.':'Could not connect Discord. Try again.';}finally{control.disabled=false;}});
 // A read-only feed alone cannot implement opt-in ducking. This separate local
 // channel accepts only media commands and acknowledges the exact resulting volume.
 const companionChannel=new EventSource('/api/companion-control/events');
 companionChannel.addEventListener('control',async event=>{
  let data;try{data=JSON.parse(event.data);}catch(_){return;}
  if(typeof data.id!=='string'||!['pause','play','volume'].includes(data.command))return;
  const audio=window.PainPlayer?.getAudio();let ok=false,error='No active audio player';
  try{if(audio){if(data.command==='pause')audio.pause();else if(data.command==='play')await audio.play();else if(Number.isFinite(data.value)&&data.value>=0&&data.value<=1)audio.volume=data.value;else throw Error('Invalid volume');ok=true;}}catch(e){error=String(e.message||e);}
  await fetch('/api/companion-control/result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:data.id,ok,error:ok?undefined:error,volume:audio?audio.volume:null,playing:!!audio&&!audio.paused&&!audio.ended})}).catch(()=>{});send(true);
 });
 window.addEventListener('beforeunload',()=>companionChannel.close());
 document.addEventListener('play',changed,true);document.addEventListener('playing',changed,true);document.addEventListener('waiting',changed,true);document.addEventListener('pause',changed,true);document.addEventListener('seeked',changed,true);document.addEventListener('ratechange',changed,true);document.addEventListener('ended',changed,true);document.addEventListener('timeupdate',()=>send(),true);window.addEventListener('pain:track',changed);
 fetch('/api/discord-presence').then(r=>r.ok?r.json():null).then(data=>{if(data&&generation===0){render(data);send(true);}}).catch(()=>{});
})();
