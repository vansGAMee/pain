(function(){
 'use strict';
 const panel=document.getElementById('trackInfoPanel'),button=document.getElementById('trackInfoToggle'),body=document.getElementById('trackInfoBody');
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const ru=()=>localStorage.getItem('pain_lang')!=='en',t=(a,b)=>ru()?a:b;
 let controller,timer,ticket=0,lastId;
 function showRating(data){
  const box=document.getElementById('trackInfoRating');if(!box)return;
  const r=data?.rating;let source;
  try{const u=new URL(r?.source);if(u.protocol==='https:'&&((['musicbrainz.org','critiquebrainz.org'].includes(u.hostname)&&/^\/recording\/[0-9a-f-]{36}$/i.test(u.pathname))||(u.hostname==='www.besteveralbums.com'&&u.pathname==='/thechart.php'&&/^\d+$/.test(u.searchParams.get('t')||''))))source=u.href;}catch(_){}
  if(!r||!source||!Number.isFinite(r.value)||r.value<0||r.value>10||!Number.isSafeInteger(r.votes)||r.votes<1){
   box.innerHTML=`<div><small class="track-info-status">${data?.reason==='unavailable'?t('Источники оценок сейчас недоступны','Rating sources are currently unavailable'):t('У этой записи пока нет подтверждённой оценки','No verified rating for this recording yet')}</small><button type="button" class="btn-minimal" data-info-retry>${t('Повторить поиск','Try again')}</button></div>`;return;
  }
  const score=r.value.toLocaleString(ru()?'ru-RU':'en-US',{maximumFractionDigits:1,minimumFractionDigits:1});
  box.innerHTML=`<div class="track-rating-score"><strong>${score}</strong><span>/ 10</span></div><div><a href="${escape(source)}" target="_blank" rel="noopener noreferrer">${escape(r.name||'MusicBrainz')}</a><small>${t('Оценка слушателей · голосов: ','Listener rating · votes: ')}${r.votes.toLocaleString(ru()?'ru-RU':'en-US')}${data.offline?' · '+t('сохранено','saved'):''}</small>${r.edition?`<small>${t('Издание: ','Release: ')}${escape(r.edition)}</small>`:''}</div>`;
 }
 function safeLink(value){try{const u=new URL(value);return u.protocol==='https:'&&/^(ru|en)\.wikipedia\.org$/.test(u.hostname)?u.href:null;}catch(_){return null;}}
 function section(article){
  const url=safeLink(article.url);if(!url)return '';
  const labels={artist:t('Об исполнителе','About the artist'),track:t('История песни','About the song'),album:t('Альбом этой песни','About the album'),'possible-track':t('Возможное совпадение по названию','Possible title match')};
  const paragraphs=text=>String(text||'').split('\n').filter(Boolean).map(p=>`<p>${escape(p)}</p>`).join('');
  return `<section class="track-info-article"><h3>${labels[article.kind]||''}</h3><h4>${escape(article.title)}</h4>${paragraphs(article.text)}${(article.stories||[]).map(story=>`<details class="track-info-story" open><summary>${escape(story.heading)}</summary>${paragraphs(story.text)}</details>`).join('')}<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${t('Читать в Википедии','Read on Wikipedia')}${article.language==='en'?' · EN':''}</a>${article.offline?`<small>${t('Сохранённая версия','Saved version')}</small>`:''}</section>`;
 }
 function catalogSection(record){
  if(!record||!/^https:\/\/musicbrainz\.org\/recording\/[0-9a-f-]+$/i.test(record.source||''))return '';
  const releases=record.releases||[],first=record['first-release-date'];
  const tags=(record.tags||[]).map(tag=>tag.name).filter(Boolean).slice(0,5);
  const facts=[
   [t('Исполнитель в каталоге','Catalog artist'),record.artist],
   [t('Первый известный выпуск','Earliest documented release'),first],
   [t('Издания с этой записью','Releases featuring this recording'),[...new Set(releases.map(r=>r.title))].slice(0,3).join(' · ')],
   [t('Жанры и теги слушателей','Listener genres and tags'),tags.join(' · ')]
  ].filter(([,value])=>value);
  return `<section class="track-info-article"><h3>${record.possible?t('Возможная запись: совпали название и длительность','Possible recording: title and duration match'):record.relatedVersion?t('Другая версия этой песни в каталоге','Another edition of this song in the catalog'):t('Паспорт записи','Inside the recording')}</h3><h4>${escape(record.title)}</h4><dl>${facts.map(([k,v])=>`<div><dt>${k}</dt><dd>${escape(v)}</dd></div>`).join('')}</dl><a href="${escape(record.source)}" target="_blank" rel="noopener noreferrer">MusicBrainz · ${t('участники и издания','credits and releases')}</a></section>`;
 }
 function contextSection(card){
  const sources={title:t('По пометке в названии','From the version label'),library:t('Из твоей фонотеки','From your library'),history:t('Из сохранённой истории','From your listening history')};
  return `<section class="track-info-article"><h3>${escape(card.heading)}</h3>${String(card.text||'').split('\n').filter(Boolean).map(p=>`<p>${escape(p)}</p>`).join('')}<small>${sources[card.source]||''}</small></section>`;
 }
 function showGenres(data){
  const box=document.getElementById('trackInfoGenres');if(!box)return;
  const names=data?.names||[],tags=data?.tags||[];if(!names.length&&!tags.length){box.innerHTML='';return;}
  const labels={store:t('Жанр каталога · Apple Music','Catalog genre · Apple Music'),file:t('Жанры из тегов файла','Genres from file tags'),recording:t('Жанры записи · MusicBrainz','Recording genres · MusicBrainz'),album:t('Жанры альбома · MusicBrainz','Album genres · MusicBrainz'),original:t('Жанры оригинальной песни · MusicBrainz','Original song genres · MusicBrainz')};
  let source='';try{const u=new URL(data.source);if(u.protocol==='https:'&&/^(?:(?:ru|en)\.wikipedia\.org|musicbrainz\.org|music\.apple\.com|itunes\.apple\.com|www\.deezer\.com)$/.test(u.hostname))source=u.href;}catch(_){}
  const label=(labels[data.scope]||t('Опубликованные жанры записи','Published recording genres')).replace('MusicBrainz',source.includes('wikipedia.org')?t('Википедия','Wikipedia'):source.includes('deezer.com')?'Deezer':'MusicBrainz');
  box.innerHTML=`${names.length?`<div class="track-genres">${names.map(name=>`<span>${escape(name)}</span>`).join('')}</div>`:''}<small class="track-genres-source">${escape(label)}${source?` · <a href="${escape(source)}" target="_blank" rel="noopener noreferrer">${t('Источник','Source')}</a>`:''}</small>${tags.length?`<details class="track-info-story" open><summary>${t('Теги записи / издания','Recording / release tags')} · ${tags.length}</summary><div class="track-genres">${tags.map(tag=>`<span>${escape(tag)}</span>`).join('')}</div></details>`:''}`;
  if(tags.length&&/^https:\/\/musicbrainz\.org\/(?:recording|release-group)\/[0-9a-f-]+$/i.test(data.tagSource||'')){
   const link=document.createElement('a');link.href=data.tagSource;link.target='_blank';link.rel='noopener noreferrer';link.textContent=t('Источник тегов · MusicBrainz','Tag source · MusicBrainz');box.querySelector('details').appendChild(link);
  }
  const sources=(data.genreSources||[]).filter(s=>s.names?.length);
  if(sources.length>1)box.innerHTML+=`<details class="track-info-story"><summary>${t('Откуда жанры','Genre sources')} · ${sources.length}</summary>${sources.map(s=>{
   let u;try{u=new URL(s.source);}catch(_){return '';}
   if(u.protocol!=='https:'||!/^(?:(?:ru|en)\.wikipedia\.org|musicbrainz\.org|music\.apple\.com|itunes\.apple\.com|www\.deezer\.com)$/.test(u.hostname))return '';
   return `<p><a href="${escape(u.href)}" target="_blank" rel="noopener noreferrer">${escape(u.hostname)} · ${escape(s.scope==='album'?t('издание','release'):t('запись','recording'))}</a><br>${s.names.map(escape).join(', ')}</p>`;
  }).join('')}</details>`;
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
  body.innerHTML=`<img class="track-info-cover" src="/api/cover/${encodeURIComponent(track.id)}?priority=1&online=${localStorage.getItem('pain_online_covers') === 'true' ? 1 : 0}" alt=""><h2>${escape(track.title||t('Без названия','Untitled'))}</h2><dl>${facts.map(([label,value])=>`<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl><div id="trackInfoGenres"></div><div id="trackInfoArticles" aria-live="polite"><p class="track-info-status">${t('Ищем историю этой музыки…','Finding the story behind the music…')}</p></div><div id="trackInfoContext"></div><div id="trackInfoHistory"></div>`;
  const rating=document.createElement('section');rating.id='trackInfoRating';rating.className='track-rating';rating.setAttribute('aria-live','polite');rating.innerHTML=`<small class="track-info-status">${t('Ищем оценку записи…','Finding the recording rating…')}</small>`;
  body.insertBefore(rating,body.querySelector('dl'));
  body.querySelector('img').onerror=e=>{e.target.hidden=true;};
  panel.scrollTop=0;controller=new AbortController();
  fetch(`/api/track-rating/${encodeURIComponent(track.id)}`,{signal:controller.signal}).then(r=>r.ok?r.json():{reason:'unavailable'}).then(data=>{if(generation===ticket)showRating(data);}).catch(error=>{if(generation===ticket&&error.name!=='AbortError')showRating({reason:'unavailable'});});
  fetch(`/api/track-info/${encodeURIComponent(track.id)}?local=1&lang=${ru()?'ru':'en'}`,{signal:controller.signal}).then(r=>r.ok?r.json():null).then(history=>{
   if(!history||generation!==ticket)return;
   document.getElementById('trackInfoContext').innerHTML=(history.cards||[]).map(contextSection).join('');
   showGenres(history.genres);
   const date=stamp=>new Date(stamp).toLocaleDateString(ru()?'ru-RU':'en-US',{day:'numeric',month:'long',year:'numeric'});
   const facts=[[t('Прослушиваний','Listens'),history.plays]];
   if(history.heard)facts.push([t('Вместе с песней','Time together'),`${Math.round(history.heard/60000)} ${t('мин','min')}`]);
   if(history.first)facts.push([t('Впервые в истории','First in your history'),date(history.first)]);
   if(history.last)facts.push([t('Последний раз','Last listened'),date(history.last)]);
   if(Number.isFinite(history.moment))facts.push([t('Любимый момент','Favourite moment'),`${Math.floor(history.moment/60)}:${String(Math.floor(history.moment%60)).padStart(2,'0')}`]);
   const meta=history.metadata||{},audio=history.audio;
   const fileFacts=[[t('Исполнитель в файле','Artist in file'),meta.artist],[t('Альбом в файле','Album in file'),meta.album],[t('Год записи в тегах','Year in file tags'),meta.year],[t('Жанр в тегах','Genre in file tags'),meta.genre]];
   if(audio){fileFacts.push([t('Формат звука','Audio format'),[audio.codec?.toUpperCase(),audio.sampleRate?`${audio.sampleRate/1000} kHz`:null,audio.bitrate?`${Math.round(audio.bitrate/1000)} kbps`:null].filter(Boolean).join(' · ')]);}
   const localDetails=fileFacts.filter(([,v])=>v);
   const detailsHtml=localDetails.length?`<section class="track-info-article"><h3>${t('Что хранится в аудиофайле','Inside your audio file')}</h3><dl>${localDetails.map(([k,v])=>`<div><dt>${k}</dt><dd>${escape(v)}</dd></div>`).join('')}</dl></section>`:'';
   document.getElementById('trackInfoHistory').innerHTML=detailsHtml+`<section class="track-info-article"><h3>${t('Ваша история с этой песней','Your history with this song')}</h3><dl>${facts.map(([k,v])=>`<div><dt>${k}</dt><dd>${escape(v)}</dd></div>`).join('')}</dl></section>`;
  }).catch(()=>{});
  try{
   const response=await fetch(`/api/track-info/${encodeURIComponent(track.id)}?lang=${ru()?'ru':'en'}`,{signal:controller.signal});
   if(!response.ok)throw new Error('Unavailable');
   const data=await response.json();if(generation!==ticket)return;
   const articles=(data.articles||[]).map(section).join('');
   const catalog=catalogSection(data.catalog);
   document.getElementById('trackInfoArticles').innerHTML=(articles?`${articles}<p class="track-info-credit">${t('Текст: Википедия, сокращённые отрывки.','Text: Wikipedia, shortened excerpts.')} <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">CC BY-SA</a></p>`:
    `<details class="track-info-story"><summary>${data.unavailable?t('Онлайн-источники пока недоступны','Online sources are currently unavailable'):t('Отдельная статья пока не найдена','No matching article yet')}</summary><p class="track-info-status">${t('Ниже — контекст из названия, фонотеки и сохранённой истории.','Below is context from the title, your library and listening history.')}</p><button type="button" class="btn-minimal" data-info-retry>${t('Повторить поиск','Try again')}</button></details>`)+catalog;
  }catch(error){if(generation!==ticket||error.name==='AbortError')return;document.getElementById('trackInfoArticles').innerHTML=`<p class="track-info-status">${t('Не удалось загрузить историю. Проверьте подключение.','Could not load the story. Check your connection.')}</p><button type="button" class="btn-minimal" data-info-retry>${t('Повторить','Retry')}</button>`;}
 }
 function open(value){panel.hidden=!value;document.querySelector('.app-layout').classList.toggle('track-info-open',value);button.setAttribute('aria-expanded',String(value));if(value)render();else{++ticket;clearTimeout(timer);controller?.abort();button.focus();}}
 button.title=t('О треке и исполнителе','About the track and artist');button.setAttribute('aria-label',button.title);
 button.onclick=()=>open(panel.hidden);document.getElementById('trackInfoClose').onclick=()=>open(false);
 body.addEventListener('click',event=>{if(event.target.closest('[data-info-retry]'))render();});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden){open(false);event.stopPropagation();}});
 window.addEventListener('pain:track',event=>{if(!panel.hidden&&event.detail?.id!==lastId){controller?.abort();++ticket;clearTimeout(timer);timer=setTimeout(render,250);}});
 window.addEventListener('pain:genres',event=>{if(!panel.hidden&&event.detail?.id===lastId)showGenres(event.detail);});
 open(true);
})();
