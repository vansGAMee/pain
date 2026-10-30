(function(){
 'use strict';
 const dialog=document.getElementById('togetherDialog'),el=id=>document.getElementById(id),player=window.PainPlayer;
 if(!dialog||!player)return;
 const ru=()=>localStorage.getItem('pain_lang')!=='en',t=(a,b)=>ru()?a:b;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let snapshot={},previous=null,applying=false,ticker,received=performance.now(),submitting=false,searchTimer,sessionTracks=[],queueKey='';
 const active=()=>!!snapshot.identity;
 const control=()=>snapshot.state&&(snapshot.state.mode==='equal'||snapshot.state.host===snapshot.identity);
 const targetPosition=()=>{const p=snapshot.state?.playback;return p?p.position+(p.paused?0:Math.max(0,snapshot.serverNow+performance.now()-received-p.at)/1000):0;};
 async function command(action,values={}){
  const response=await fetch('/api/listen/control',{method:'POST',headers:{'Content-Type':'application/json','X-Pain-Update':'listen'},body:JSON.stringify({action,...values})});
  const result=await response.json();if(!response.ok)throw Error(result.error||'Не удалось выполнить действие');return result;
 }
 function showError(error){el('togetherStatus').textContent=error.message||error;}
 function run(action,values){return command(action,values).catch(showError);}
 const tracks=()=>sessionTracks;
 function align(){
  if(!snapshot.state||!active())return;
  const playback=snapshot.state.playback,track=tracks().find(track=>track._listenUid===playback.uid);
  if(!track){player.sessionPause();return;}
  applying=true;
  try{
   if(player.getTrack()?._listenUid!==track._listenUid){player.playTrackInContext(track,tracks(),{type:'listening',title:t('Слушаем вместе','Listening together'),allowNew:false},targetPosition());}
   const audio=player.getAudio();
   if(audio.error){el('togetherRetryAudio').hidden=false;return;}
   el('togetherRetryAudio').hidden=true;
   if(audio.readyState>=1){
    const target=Math.min(Math.max(0,targetPosition()),Number.isFinite(audio.duration)?Math.max(0,audio.duration-.02):Infinity);
    // Transport tolerance only: avoid seeking repeatedly within browser media
    // clock precision. This does not affect recommendation scores or taste.
    if(Math.abs(audio.currentTime-target)>.25){player.sessionSeek(target);}
   }
   if(playback.paused)player.sessionPause();else if(audio.paused&&!audio.ended)player.sessionResume().catch(showError);
  }finally{applying=false;}
 }
 function render(){
  const state=snapshot.state,joined=active();
  el('togetherBadge').textContent=joined?(snapshot.connected?t('В комнате','In a room'):t('Переподключение…','Reconnecting…')):'';
  el('togetherLobby').hidden=joined;el('togetherRoom').hidden=!joined;
  el('togetherStatus').textContent=snapshot.error||(joined&&!snapshot.connected?t('Соединение потеряно. Музыка на паузе; переподключаемся автоматически.','Connection lost. Playback is paused; reconnecting automatically.'):'');
  if(!state)return;
  const memberName=id=>state.members.find(m=>m.id===id)?.name||t('Слушатель','Listener');
  el('togetherMembers').textContent=state.members.map(m=>`${m.name}${m.id===state.host?t(' · ведущий',' · host'):''}${m.connected?'':t(' · не в сети',' · offline')}`).join('  /  ');
  el('togetherRole').textContent=state.mode==='equal'?t('Равные права: оба управляете очередью и воспроизведением.','Equal rights: both control playback and the queue.'):control()?t('Вы ведущий. Принимайте предложения и задавайте порядок.','You host. Accept suggestions and arrange the queue.'):t('Ведущий управляет музыкой. Вы можете предлагать песни.','The host controls playback. You can suggest songs.');
  el('togetherMode').value=state.mode;el('togetherMode').disabled=state.host!==snapshot.identity;
  const itemHTML=(item,index,proposal)=>`<li><div><strong>${esc(item.title)}</strong><span>${esc(item.artist)} · ${esc(memberName(item.owner))}${item.uid===state.playback.uid?t(' · сейчас',' · now'):''}</span></div><div class="together-item-actions">${control()?proposal?`<button data-together-action="accept" data-uid="${item.uid}" title="${t('В очередь','Accept')}">＋</button>`:`<button data-together-action="play" data-uid="${item.uid}" title="${t('Играть','Play')}">▷</button><button data-together-action="move" data-uid="${item.uid}" data-to="${index-1}"${index===0?' disabled':''} title="${t('Выше','Move up')}">↑</button>`:''}${control()?`<button data-together-action="remove" data-uid="${item.uid}" title="${t('Убрать','Remove')}">×</button>`:''}</div></li>`;
  const queue=el('togetherQueue'),key=JSON.stringify([state.queue,state.proposals,state.playback.uid,control(),ru()]);
  if(queue.dataset.version!==key){queue.dataset.version=key;queue.innerHTML=state.queue.map((item,index)=>itemHTML(item,index,false)).join('')||`<li>${t('Добавьте первую песню из своей фонотеки.','Add the first song from your library.')}</li>`;el('togetherProposals').innerHTML=state.proposals.map((item,index)=>itemHTML(item,index,true)).join('');}
  el('togetherProposalsSection').hidden=!state.proposals.length;
 }
 function update(next){
  const wasActive=active(),wasConnected=snapshot.connected;snapshot=next;received=performance.now();
  if(next.state){const key=JSON.stringify(next.state.queue);if(key!==queueKey){queueKey=key;const library=new Map(player.getTracks().map(track=>[String(track.id),track]));sessionTracks=next.state.queue.map(item=>{const local=library.get(item.localId);return {...(local||{}),id:local?.id||'listen:'+item.uid,title:item.title,artist:item.artist,album:item.album,duration:item.duration,_listenUid:item.uid,_listenRemote:!local};});
   const index=sessionTracks.findIndex(track=>track._listenUid===player.getTrack()?._listenUid);if(wasActive&&index>=0)window.painQueue.setContext('listening',sessionTracks,index,t('Слушаем вместе','Listening together'),false);
  }}
  if(active()&&!wasActive){const q=window.painQueue;previous={track:player.getTrack(),tracks:[...q.tracks],context:{...q.context},position:player.getAudio().currentTime};ticker=setInterval(align,1000);}
  if(wasActive&&!active()){
   clearInterval(ticker);player.sessionPause();
   if(previous?.track){applying=true;try{player.playTrackInContext(previous.track,previous.tracks,previous.context,previous.position);player.sessionPause();}finally{applying=false;}}
   else player.sessionReset();
   previous=null;sessionTracks=[];queueKey='';
  }
  if(active()){if(snapshot.connected){if(!wasConnected&&player.getAudio().error)retryAudio();align();}else player.sessionPause();}
  render();
 }
 function search(){
  const query=el('togetherSearch').value.trim().toLocaleLowerCase();
  const songs=[];for(const track of player.getTracks()){if(!query||[track.title,track.artist,track.album].some(v=>String(v||'').toLocaleLowerCase().includes(query)))songs.push(track);if(songs.length===30)break;}
  el('togetherSongs').innerHTML=songs.map(track=>`<button type="button" data-together-add="${esc(track.id)}"><span><strong>${esc(track.title)}</strong><small>${esc(track.artist)}</small></span><span>＋</span></button>`).join('');
 }
 async function open(){
  dialog.showModal();try{const next=await(await fetch('/api/listen/status')).json();update(next);
   el('togetherServer').value=next.settings.server;el('togetherPin').value=next.settings.pin;el('togetherName').value=next.settings.name;search();
  }catch(error){showError(error);}
 }
 async function saveSettings(){return command('settings',{server:el('togetherServer').value.trim(),pin:el('togetherPin').value.trim(),name:el('togetherName').value.trim()});}
 function retryAudio(){const track=tracks().find(track=>track._listenUid===snapshot.state?.playback.uid);if(!track)return;applying=true;try{player.sessionReload(track,tracks(),targetPosition());}finally{applying=false;}el('togetherRetryAudio').hidden=true;}
 el('togetherOpen').onclick=open;el('togetherSettingsOpen').onclick=()=>{open().then(()=>el('togetherServerDetails').open=true);};
 el('togetherClose').onclick=()=>dialog.close();dialog.addEventListener('keydown',event=>event.stopPropagation());
 el('togetherCreate').onclick=async()=>{if(submitting)return;submitting=true;try{await saveSettings();await command('create',{mode:el('togetherCreateMode').value});}catch(error){showError(error);}finally{submitting=false;}};
 el('togetherJoin').onclick=()=>run('join',{invite:el('togetherInviteInput').value.trim()});
 el('togetherSaveServer').onclick=()=>saveSettings().then(()=>el('togetherStatus').textContent=t('Настройки сохранены.','Settings saved.')).catch(showError);
 el('togetherLeave').onclick=()=>run('leave');el('togetherMode').onchange=()=>run('mode',{mode:el('togetherMode').value});
 el('togetherRetryAudio').onclick=()=>{retryAudio();align();};
 el('togetherCopy').onclick=async()=>{try{const {invite}=await command('invite');el('togetherInviteOutput').value=invite;el('togetherInviteOutput').hidden=false;try{await navigator.clipboard.writeText(invite);el('togetherStatus').textContent=t('Приглашение скопировано. Передайте его другу.','Invitation copied. Send it to your friend.');}catch(_){el('togetherInviteOutput').select();}}catch(error){showError(error);}};
 dialog.addEventListener('click',event=>{const add=event.target.closest('[data-together-add]');if(add)return run('add',{trackId:add.dataset.togetherAdd});const button=event.target.closest('[data-together-action]');if(button)run(button.dataset.togetherAction,{uid:button.dataset.uid,to:Number(button.dataset.to)});});
 el('togetherSearch').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(search,120);};
 const events=new EventSource('/api/listen/events');events.onmessage=event=>{try{update(JSON.parse(event.data));}catch(error){showError(error);}};
 events.onerror=()=>{if(active()){snapshot.connected=false;player.sessionPause();render();}};
 const observer=new MutationObserver(()=>{if(active())align();});observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-playing']});
 document.querySelectorAll('audio').forEach(audio=>{audio.addEventListener('canplay',()=>{if(active())align();});});
 window.PainTogether={get active(){return active();},get applying(){return applying;},offer:track=>track&&run('add',{trackId:track.id}),
  next:automatic=>{if(control())run('next',{automatic,epoch:snapshot.state?.playback.epoch});},
  previous:()=>{if(control()){const queue=snapshot.state.queue,index=queue.findIndex(item=>item.uid===snapshot.state.playback.uid);if(index>0)run('play',{uid:queue[index-1].uid});else run('transport',{position:0});}},
  toggle:()=>{if(control())run('transport',{paused:!snapshot.state.playback.paused,position:targetPosition()});else showError(t('Пауза доступна ведущему.','The host controls playback.'));},
  seek:position=>{if(control())run('transport',{position});},snapshot:()=>snapshot};
})();
