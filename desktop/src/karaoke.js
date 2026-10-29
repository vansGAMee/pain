/* Line-synchronised lyrics, automatic lookup and a local manual editor. */
(()=>{
 let audio=document.getElementById('audioEngine');const shell=document.querySelector('.app-layout');
 const ru=()=>localStorage.getItem('pain_lang')==='ru',t=(a,b)=>ru()?a:b;
 const entry=document.createElement('button');entry.id='karaokeBtn';entry.className='ctrl-btn-subtle';
 entry.innerHTML='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg>';
 entry.title=entry.ariaLabel=t('Текст и караоке','Lyrics and karaoke');document.getElementById('fullscreenPlayerBtn').before(entry);
 const panel=document.createElement('section');panel.id='karaoke';panel.hidden=true;panel.setAttribute('aria-label',t('Караоке','Karaoke'));shell.append(panel);
 let track=null,lines=[],history=[],editing=false,next=0,active=-2,loadToken=0,manualUntil=0,saveBusy=false,ownsFullscreen=false,loadController,onlineEnabled=true,prefetchTimer,prefetchId;
 const $=s=>panel.querySelector(s),key=id=>'pain_lyrics_draft_'+id;
 function note(s){const n=$('#karaokeStatus');if(n)n.textContent=s;}
 function describe(data){
  const messages={disabled:t('Автопоиск отключён в настройках. Можно добавить текст вручную.','Automatic lookup is disabled. You can add lyrics manually.'),'not-found':t('Текст пока не найден. Попробуйте позже или добавьте свой.','Lyrics not found yet. Retry later or add your own.'),'missing-metadata':t('Для поиска нужны название и исполнитель в тегах файла.','Lookup needs a title and artist in the file tags.'),error:t('Источник сейчас недоступен. Повторите поиск позже; можно добавить свой текст.','Lyrics provider is unavailable. Retry later or add your own.')};
  note(data.manual?t('Ваш текст и отметки сохранены локально.','Your lyrics and timing are saved locally.'):data.instrumental?t('В источнике эта запись отмечена как инструментальная.','The source identifies this recording as instrumental.'):data.synced?t('Строки синхронизированы с музыкой.','Lyrics are synchronized with the music.'):data.editionFallback&&lines.length?t('Найден текст другой скоростной версии. Её тайминги не применены.','Lyrics found for a different speed edition. Its timing is not applied.'):lines.length?t('Найден текст без таймингов. Можно отметить строки в редакторе.','Lyrics found without timing. You can time the lines in the editor.'):messages[data.state]||messages['not-found']);
  if(data.source?.name==='LRCLIB'&&Number.isSafeInteger(data.source.id)){const a=document.createElement('a');a.textContent=' · LRCLIB ↗';a.href='https://lrclib.net/api/get/'+data.source.id;a.target='_blank';a.rel='noopener noreferrer';$('#karaokeStatus').append(a);}
  if(data.source?.name==='KuGou'){const a=document.createElement('a');a.textContent=' · KuGou ↗';a.href='https://www.kugou.com/';a.target='_blank';a.rel='noopener noreferrer';$('#karaokeStatus').append(a);}
  if(!lines.length&&Array.isArray(data.checks)){const details=document.createElement('details'),summary=document.createElement('summary'),body=document.createElement('p');summary.textContent=t('Источники поиска','Lookup sources');const labels={'not-found':t('ответил, подходящий текст не найден','responded; no matching lyrics'),unavailable:t('не отвечает или ограничивает доступ','unreachable or restricting requests'),found:t('текст найден','lyrics found')};body.textContent=data.checks.filter(c=>['LRCLIB','KuGou'].includes(c.source)).map(c=>c.source+': '+(labels[c.state]||labels.unavailable)).join(' · ');details.append(summary,body);$('#karaokeStatus').append(details);}
 }
 function draft(){try{localStorage.setItem(key(track.id),JSON.stringify(lines));}catch(_){note(t('Не удалось сохранить черновик. Нажмите «Сохранить».','Draft unavailable. Please save.'));}}
 function clock(n){if(n===null)return '—';return `${Math.floor(n/60)}:${(n%60).toFixed(2).padStart(5,'0')}`;}
 function snapshot(){history.push(JSON.stringify(lines));if(history.length>100)history.shift();}
 function recalc(){next=lines.findIndex(l=>l.time===null);if(next<0)next=lines.length;active=-2;}
 function layout(){
  panel.classList.remove('is-editing');
  panel.innerHTML=`<header class="karaoke-header"><div><span class="karaoke-eyebrow">${t('ТЕКСТ ПЕСНИ','LYRICS')}</span><h2 id="karaokeTitle"></h2><p id="karaokeArtist"></p></div><div class="karaoke-actions"><button class="btn-minimal" id="karaokeEdit">${t('Редактировать','Edit')}</button><button class="btn-minimal" id="karaokeFull">${t('На весь экран','Fullscreen')}</button><button class="btn-minimal" id="karaokeClose">${t('Закрыть','Close')} · Esc</button></div></header>
  <div class="karaoke-body"><aside class="karaoke-editor" hidden><label for="karaokeText">${t('Текст песни — каждая строка отдельно','Lyrics — one line at a time')}</label><textarea id="karaokeText" spellcheck="false" placeholder="${t('Вставьте текст или LRC с отметками времени','Paste lyrics or timestamped LRC')}"></textarea><button class="btn-minimal" id="karaokeApply">${t('Применить текст','Apply text')}</button><p>${t('Включите трек. В начале строки нажмите «Отметить строку» или Enter. Клик по строке отмечает её текущим временем.','Play the track. At each line’s start, click “Mark line” or press Enter. Clicking a line stamps it at the current time.')}</p><button class="btn-minimal karaoke-stamp" id="karaokeStamp"></button><div class="karaoke-actions"><button class="btn-minimal" id="karaokeUndo">${t('Отменить отметку','Undo')}</button><button class="btn-minimal" id="karaokeSave">${t('Сохранить','Save')}</button><button class="btn-minimal" id="karaokeExport">${t('Скачать LRC','Export LRC')}</button></div><p class="karaoke-progress" id="karaokeProgress"></p></aside><div class="karaoke-scroll" tabindex="0" aria-label="${t('Строки песни','Song lyrics')}"><div class="karaoke-lines"></div></div></div><div id="karaokeStatus" role="status" aria-live="polite"></div>`;
  $('.karaoke-editor').prepend($('#karaokeStamp'),$('#karaokeUndo').parentElement);
  const search=document.createElement('button');search.id='karaokeSearch';search.className='btn-minimal';search.textContent=t('Повторить поиск','Search again');search.disabled=!track||!onlineEnabled;search.onclick=()=>load(true);$('.karaoke-header .karaoke-actions').prepend(search);
  $('#karaokeTitle').textContent=track?.title||t('Выберите трек','Choose a track');$('#karaokeArtist').textContent=track?.artist||'';
  $('#karaokeClose').onclick=close;$('#karaokeEdit').onclick=()=>setEditing(!editing);
  $('#karaokeFull').onclick=async()=>{try{if(!document.fullscreenElement){await shell.requestFullscreen();ownsFullscreen=true;}else if(ownsFullscreen){await document.exitFullscreen();ownsFullscreen=false;}}catch(_){note(t('Полный экран недоступен в этом окне.','Fullscreen is unavailable in this window.'));}};
  $('#karaokeApply').onclick=apply;$('#karaokeStamp').onclick=()=>stamp(next);$('#karaokeUndo').onclick=()=>{if(!history.length)return;lines=JSON.parse(history.pop());draft();recalc();render();};
  $('#karaokeSave').onclick=save;$('#karaokeExport').onclick=exportLrc;
  $('#karaokeText').addEventListener('input',()=>{if(track)try{localStorage.setItem(key(track.id)+'_text',$('#karaokeText').value);}catch(_){}});
  $('.karaoke-scroll').addEventListener('wheel',()=>manualUntil=Date.now()+4000,{passive:true});
  $('.karaoke-scroll').addEventListener('touchstart',()=>manualUntil=Date.now()+4000,{passive:true});
 }
 function setEditing(value){editing=value;panel.classList.toggle('is-editing',value);$('.karaoke-editor').hidden=!value;$('#karaokeEdit').textContent=value?t('Просмотр','Preview'):t('Редактировать','Edit');render();}
 function render(){
  const container=$('.karaoke-lines');container.replaceChildren();container.classList.toggle('is-unsynced',!lines.some(l=>l.time!==null));
  if(!lines.length){const p=document.createElement('p');p.className='karaoke-empty';p.textContent=track?t('Ищем слова этой песни…','Finding the words to this song…'):t('Выберите песню в библиотеке, затем откройте караоке.','Choose a song from your library, then open karaoke.');container.append(p);}
  lines.forEach((line,i)=>{const row=document.createElement('div');row.className='karaoke-row';
   const b=document.createElement('button');b.className='karaoke-line';b.textContent=line.text||'♪';b.dataset.index=i;b.onclick=()=>{if(editing)stamp(i);else if(line.time!==null&&audio.readyState>=1)audio.currentTime=Math.min(line.time,Number.isFinite(audio.duration)?audio.duration:line.time);};
   b.title=editing?t('Отметить текущим временем','Stamp current time'):line.time===null?t('Время ещё не задано','Not timed yet'):t('Перейти к строке','Seek to line');row.append(b);
   if(editing){const input=document.createElement('input');input.type='number';input.min='0';input.step='.01';input.value=line.time===null?'':line.time.toFixed(2);input.placeholder='—';input.setAttribute('aria-label',t('Начало строки в секундах: ','Line start in seconds: ')+line.text);input.onchange=()=>{const v=input.value===''?null:Number(input.value);if(!validTime(i,v)){input.value=line.time===null?'':line.time.toFixed(2);return;}snapshot();line.time=v;draft();recalc();render();};row.append(input);}
   container.append(row);
  });
  $('#karaokeStamp').textContent=next<lines.length?t('Отметить строку ','Mark line ')+(next+1):t('Все строки отмечены','All lines marked');$('#karaokeStamp').disabled=next>=lines.length||!track;
  $('#karaokeUndo').disabled=!history.length;$('#karaokeSave').disabled=!track||saveBusy;$('#karaokeApply').disabled=!track;
  $('#karaokeProgress').textContent=`${lines.filter(l=>l.time!==null).length} / ${lines.length} · ${t('строк отмечено','lines timed')}`;active=-2;highlight();
 }
 function validTime(i,time){
  if(time===null)return true;
  const before=lines.slice(0,i).filter(l=>l.time!==null).at(-1)?.time??0;
  const after=lines.slice(i+1).find(l=>l.time!==null)?.time??Infinity;
  if(!Number.isFinite(time)||time<before||time>after||time>=86400||(Number.isFinite(audio.duration)&&time>audio.duration)){note(t('Время должно идти по порядку и находиться внутри трека.','Timing must be in order and within the track.'));return false;}return true;
 }
 function stamp(i){if(!track||i>=lines.length)return;if(audio.readyState<1){note(t('Сначала запустите трек.','Start the track first.'));return;}const time=Math.round(audio.currentTime*100)/100;if(!validTime(i,time))return;snapshot();lines[i].time=time;draft();recalc();render();note(t('Отмечено: ','Marked: ')+clock(time));const row=$(`[data-index="${next}"]`);row?.scrollIntoView({block:'center',behavior:motion()});}
 function apply(){
  const text=$('#karaokeText').value;if(text.length>200000){note(t('Текст слишком большой.','Text is too large.'));return;}
  const parsed=[];for(const raw of text.split(/\r?\n/)){const s=raw.trim();if(!s)continue;const tags=[...s.matchAll(/\[(\d+):(\d{2}(?:\.\d+)?)\]/g)];if(tags.length){const lyric=s.replace(/\[[^\]]*\]/g,'').trim();if(lyric)for(const tag of tags)parsed.push({text:lyric,time:Number(tag[1])*60+Number(tag[2])});}else if(!/^\[(ar|ti|al|by|offset):/i.test(s))parsed.push({text:s,time:null});}
  if(parsed.length>2000||parsed.some(l=>l.text.length>2000||l.time>=86400)){note(t('Слишком длинный текст или неверные отметки.','Text or timestamps exceed the limit.'));return;}
  if(parsed.length&&parsed.every(l=>l.time!==null))parsed.sort((a,b)=>a.time-b.time);
  snapshot();lines=parsed;draft();recalc();render();note(t('Текст применён. Можно отмечать строки.','Text applied. You can now mark the lines.'));
 }
 async function save(){
  if(!track||saveBusy)return;const id=track.id,payload=JSON.stringify({lines}),token=loadToken;saveBusy=true;$('#karaokeSave').disabled=true;
  try{const r=await fetch('/api/lyrics?track='+encodeURIComponent(id),{method:'PUT',headers:{'Content-Type':'application/json'},body:payload,signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error();if(token===loadToken)note(t('Сохранено на этом компьютере.','Saved on this computer.'));}
  catch(_){if(token===loadToken)note(t('Не удалось сохранить файл. Черновик остался в этом браузере — повторите сохранение.','Could not save the file. The browser draft is retained — please retry.'));}
  finally{saveBusy=false;if(!panel.hidden)$('#karaokeSave').disabled=!track;}
 }
 function exportLrc(){const text=lines.filter(l=>l.time!==null).map(l=>`[${clock(l.time).padStart(8,'0')}]${l.text}`).join('\n');if(!text){note(t('Сначала отметьте строки.','Mark the lines first.'));return;}const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=(track?.title||'lyrics').replace(/[\\/:*?"<>|]/g,'_')+'.lrc';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 function motion(){return document.documentElement.hasAttribute('data-reduced-motion')||matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth';}
 function highlight(){if(panel.hidden)return;audio=window.PainPlayer.getAudio?.()||audio;let index=-1;lines.forEach((l,i)=>{if(l.time!==null&&l.time<=audio.currentTime)index=i;});if(index===active)return;active=index;
  panel.querySelectorAll('.karaoke-line').forEach((el,i)=>{el.classList.toggle('is-current',i===index);el.classList.toggle('is-past',i<index);el.classList.toggle('is-next',editing&&i===next);if(i===index)el.setAttribute('aria-current','true');else el.removeAttribute('aria-current');});
  if(!editing&&Date.now()>manualUntil&&index>=0)$(`[data-index="${index}"]`)?.scrollIntoView({block:'center',behavior:motion()});
 }
 async function load(refresh=false){
  loadController?.abort();loadController=new AbortController();const controller=loadController;
  const token=++loadToken;track=window.PainPlayer.getTrack();audio=window.PainPlayer.getAudio?.()||audio;lines=[];history=[];next=0;editing=false;layout();render();if(!track)return;
  let local=null;try{local=JSON.parse(localStorage.getItem(key(track.id)));}catch(_){}
  let data={manual:true};
  if(Array.isArray(local))lines=local;else{note(t('Поиск текста и таймингов…','Finding lyrics and timing…'));$('#karaokeSearch').disabled=true;try{const r=await fetch('/api/lyrics?track='+encodeURIComponent(track.id)+(refresh?'&refresh=1':''),{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(40000)])});if(!r.ok)throw Error();data=await r.json();if(token!==loadToken)return;lines=Array.isArray(data.lines)?data.lines:[];}catch(_){if(token!==loadToken)return;data={state:'error'};}}
  if(token!==loadToken)return;recalc();$('#karaokeText').value=localStorage.getItem(key(track.id)+'_text')??lines.map(l=>l.time===null?l.text:`[${clock(l.time)}]${l.text}`).join('\n');setEditing(false);describe(data);$('#karaokeSearch').disabled=!onlineEnabled;
  if(!lines.length)$('.karaoke-empty').textContent=data.instrumental?'♪':t('Пока без текста. Добавьте свой в редакторе или повторите поиск.','No lyrics yet. Add your own in the editor or retry the search.');
 }
 async function open(){panel.hidden=false;shell.classList.add('karaoke-open');entry.setAttribute('aria-pressed','true');await load();$('#karaokeClose')?.focus();}
 function close(){panel.hidden=true;shell.classList.remove('karaoke-open');++loadToken;loadController?.abort();entry.setAttribute('aria-pressed','false');if(ownsFullscreen&&document.fullscreenElement)document.exitFullscreen().catch(()=>{});ownsFullscreen=false;entry.focus();}
 entry.onclick=()=>panel.hidden?open():close();
 function prefetch(current){clearTimeout(prefetchTimer);if(!onlineEnabled||!current||String(current.id)===prefetchId)return;prefetchId=String(current.id);prefetchTimer=setTimeout(()=>fetch('/api/lyrics?track='+encodeURIComponent(current.id)).catch(()=>{}),900);}
 window.addEventListener('pain:track',e=>{if(!panel.hidden&&e.detail?.id!==track?.id)load();else prefetch(e.detail);});
 window.addEventListener('pain:companion-synced',()=>{if(!panel.hidden)load();});
 for(const deck of document.querySelectorAll('audio')){deck.addEventListener('timeupdate',highlight);deck.addEventListener('seeked',()=>{manualUntil=0;highlight();});}
 const toggle=document.getElementById('onlineLyricsSwitch'),sourceMode=document.getElementById('lyricsSourceMode');let savedMode='auto';
 fetch('/api/lyrics/settings').then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{onlineEnabled=data.enabled!==false;if(toggle){toggle.checked=onlineEnabled;toggle.disabled=false;}savedMode=data.mode||'auto';if(sourceMode){sourceMode.value=savedMode;sourceMode.disabled=!onlineEnabled;}prefetch(window.PainPlayer.getTrack());}).catch(()=>{if(toggle)toggle.disabled=true;});
 if(toggle)toggle.onchange=async()=>{const enabled=toggle.checked;toggle.disabled=true;try{const r=await fetch('/api/lyrics/settings',{method:'POST',headers:{'Content-Type':'application/json','X-Pain-Update':'lyrics'},body:JSON.stringify({enabled})});if(!r.ok)throw Error();onlineEnabled=enabled;if(sourceMode)sourceMode.disabled=!enabled;clearTimeout(prefetchTimer);prefetchId=null;if(enabled)prefetch(window.PainPlayer.getTrack());if(!panel.hidden)$('#karaokeSearch').disabled=!enabled;}catch(_){toggle.checked=onlineEnabled;}finally{toggle.disabled=false;}};
 if(sourceMode)sourceMode.onchange=async()=>{const mode=sourceMode.value;sourceMode.disabled=true;try{const r=await fetch('/api/lyrics/settings',{method:'POST',headers:{'Content-Type':'application/json','X-Pain-Update':'lyrics'},body:JSON.stringify({mode})});if(!r.ok)throw Error();savedMode=mode;clearTimeout(prefetchTimer);prefetchId=null;if(!panel.hidden)await load();else prefetch(window.PainPlayer.getTrack());}catch(_){sourceMode.value=savedMode;}finally{sourceMode.disabled=!onlineEnabled;}};
 document.addEventListener('keydown',e=>{if(panel.hidden)return;if(e.key==='Escape'){close();return;}if(e.key==='Enter'&&editing&&!e.repeat&&!['INPUT','TEXTAREA','BUTTON'].includes(document.activeElement.tagName)){e.preventDefault();stamp(next);}});
})();
