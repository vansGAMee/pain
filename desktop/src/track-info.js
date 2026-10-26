(function(){
 'use strict';
 const panel=document.getElementById('trackInfoPanel'),button=document.getElementById('trackInfoToggle'),body=document.getElementById('trackInfoBody');
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const ru=()=>localStorage.getItem('pain_lang')!=='en',t=(a,b)=>ru()?a:b;
 let controller,timer,ticket=0,lastId;
 function safeLink(value){try{const u=new URL(value);return u.protocol==='https:'&&/^(ru|en)\.wikipedia\.org$/.test(u.hostname)?u.href:null;}catch(_){return null;}}
 function section(article){
  const url=safeLink(article.url);if(!url)return '';
  const labels={artist:t('Об исполнителе','About the artist'),track:t('История песни','About the song'),album:t('Альбом этой песни','About the album'),'possible-track':t('Возможное совпадение по названию','Possible title match')};
  const paragraphs=text=>String(text||'').split('\n').filter(Boolean).map(p=>`<p>${escape(p)}</p>`).join('');
  return `<section class="track-info-article"><h3>${labels[article.kind]||''}</h3><h4>${escape(article.title)}</h4>${paragraphs(article.text)}${(article.stories||[]).map(story=>`<details class="track-info-story" open><summary>${escape(story.heading)}</summary>${paragraphs(story.text)}</details>`).join('')}<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${t('Читать в Википедии','Read on Wikipedia')}${article.language==='en'?' · EN':''}</a>${article.offline?`<small>${t('Сохранённая версия','Saved version')}</small>`:''}</section>`;
 }
 async function render(){
  clearTimeout(timer);controller?.abort();const generation=++ticket;
  if(panel.hidden)return;
  const track=window.PainPlayer?.getTrack();lastId=track?.id;
  document.getElementById('trackInfoHeading').textContent=t('За музыкой','Behind the music');
  document.getElementById('trackInfoClose').title=t('Закрыть','Close');
  document.getElementById('trackInfoClose').setAttribute('aria-label',t('Закрыть','Close'));
  if(!track){body.textContent=t('Выберите трек, чтобы узнать о нём больше.','Choose a track to learn more.');return;}
  const seconds=Math.floor(Number(track.duration||0)/1000),facts=[
   [t('Исполнитель','Artist'),track.artist],[t('Альбом','Album'),track.album],
   [t('Длительность','Duration'),seconds?`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`:null],
   [t('Год','Year'),track.year],[t('Жанр','Genre'),track.genre]
  ].filter(([,v])=>v);
  body.innerHTML=`<img class="track-info-cover" src="/api/cover/${encodeURIComponent(track.id)}?online=${localStorage.getItem('pain_online_covers') === 'true' ? 1 : 0}" alt=""><h2>${escape(track.title||t('Без названия','Untitled'))}</h2><dl>${facts.map(([label,value])=>`<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl><div id="trackInfoArticles" aria-live="polite"><p class="track-info-status">${t('Ищем историю этой музыки…','Finding the story behind the music…')}</p></div><div id="trackInfoHistory"></div>`;
  body.querySelector('img').onerror=e=>{e.target.hidden=true;};
  panel.scrollTop=0;controller=new AbortController();
  fetch(`/api/track-info/${encodeURIComponent(track.id)}?local=1`,{signal:controller.signal}).then(r=>r.ok?r.json():null).then(history=>{
   if(!history||generation!==ticket)return;
   const date=stamp=>new Date(stamp).toLocaleDateString(ru()?'ru-RU':'en-US',{day:'numeric',month:'long',year:'numeric'});
   const facts=[[t('Прослушиваний','Listens'),history.plays]];
   if(history.heard)facts.push([t('Вместе с песней','Time together'),`${Math.round(history.heard/60000)} ${t('мин','min')}`]);
   if(history.first)facts.push([t('Впервые в истории','First in your history'),date(history.first)]);
   if(history.last)facts.push([t('Последний раз','Last listened'),date(history.last)]);
   if(Number.isFinite(history.moment))facts.push([t('Любимый момент','Favourite moment'),`${Math.floor(history.moment/60)}:${String(Math.floor(history.moment%60)).padStart(2,'0')}`]);
   document.getElementById('trackInfoHistory').innerHTML=`<section class="track-info-article"><h3>${t('Ваша история с этой песней','Your history with this song')}</h3><dl>${facts.map(([k,v])=>`<div><dt>${k}</dt><dd>${escape(v)}</dd></div>`).join('')}</dl></section>`;
  }).catch(()=>{});
  try{
   const response=await fetch(`/api/track-info/${encodeURIComponent(track.id)}?lang=${ru()?'ru':'en'}`,{signal:controller.signal});
   if(!response.ok)throw new Error('Unavailable');
   const data=await response.json();if(generation!==ticket)return;
   const articles=(data.articles||[]).map(section).join('');
   document.getElementById('trackInfoArticles').innerHTML=articles?`${articles}<p class="track-info-credit">${t('Текст: Википедия, сокращённые отрывки.','Text: Wikipedia, shortened excerpts.')} <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">CC BY-SA</a></p>`:
    `<p class="track-info-status">${data.unavailable?t('Источник сейчас недоступен. Сведения из файла показаны выше.','The source is unavailable. File details are shown above.'):data.missingArtist?t('По названию и имени файла подтверждённой статьи не найдено. Указанный в тегах исполнитель поможет уточнить поиск.','No matching article found by title or filename. Artist tags help identify the recording.'):t('Подтверждённой статьи пока нет. Сведения из файла показаны выше.','No matching article yet. File details are shown above.')}</p><button type="button" class="btn-minimal" data-info-retry>${t('Повторить поиск','Try again')}</button>`;
  }catch(error){if(generation!==ticket||error.name==='AbortError')return;document.getElementById('trackInfoArticles').innerHTML=`<p class="track-info-status">${t('Не удалось загрузить историю. Проверьте подключение.','Could not load the story. Check your connection.')}</p><button type="button" class="btn-minimal" data-info-retry>${t('Повторить','Retry')}</button>`;}
 }
 function open(value){panel.hidden=!value;document.querySelector('.app-layout').classList.toggle('track-info-open',value);button.setAttribute('aria-expanded',String(value));if(value)render();else{++ticket;clearTimeout(timer);controller?.abort();button.focus();}}
 button.title=t('О треке и исполнителе','About the track and artist');button.setAttribute('aria-label',button.title);
 button.onclick=()=>open(panel.hidden);document.getElementById('trackInfoClose').onclick=()=>open(false);
 body.addEventListener('click',event=>{if(event.target.closest('[data-info-retry]'))render();});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden){open(false);event.stopPropagation();}});
 window.addEventListener('pain:track',event=>{if(!panel.hidden&&event.detail?.id!==lastId){controller?.abort();++ticket;clearTimeout(timer);timer=setTimeout(render,250);}});
 open(true);
})();
