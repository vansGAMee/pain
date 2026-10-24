/* Home owns presentation only. Playback and saved vibes use existing actions. */
(function(){
 'use strict';
 const root=document.getElementById('homeContent');if(!root)return;
 const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const icon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 10 7-10 7z" fill="currentColor"/></svg>';
 let snapshot,actions,mix=[],mixKey='',mixPending=false,mixError=false,variation=0,ticket=0;
 function render(data,handlers){
  snapshot=data;actions=handlers;
  const ru=data.lang==='ru',t=(a,b)=>ru?a:b,locale=ru?'ru-RU':'en-US',now=Date.now();
  const m=HomeModel.build(data.tracks,data.stats,now),d=m.details;
  const time=ms=>{const minutes=Math.floor(ms/60000);return ms>0&&minutes===0?t('< 1 мин','< 1 min'):minutes>=60?`${Math.floor(minutes/60)} ${t('ч','h')} ${minutes%60} ${t('мин','min')}`:`${minutes} ${t('мин','min')}`;};
  const duration=ms=>{const seconds=Math.floor(Math.max(0,Number(ms)||0)/1000);return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;};
  const title=track=>track?.title||t('Без названия','Untitled');
  const artist=track=>track?.artist||t('Неизвестный исполнитель','Unknown artist');
  const current=data.current||m.recent[0]||data.tracks[0];
  const vibes=window.PainDJVibes?.list()||{items:[],activeId:null};
  const isPlayingMix=Boolean(data.isPlaying&&data.current&&mix.some(x=>String(x.track.id)===String(data.current.id)));
  const key=JSON.stringify([data.tracks.map(t=>String(t.id)),[...(data.queue?.excludedTracks||[])],
   vibes.activeId,vibes.updatedAt,variation]);
  if(key!==mixKey){
   mixKey=key;mixPending=true;mixError=false;const generation=++ticket;
   // Paint Home first; bounded existing DJ scoring runs once per mix, not per frame.
   requestAnimationFrame(()=>setTimeout(()=>{
    if(generation!==ticket)return;
    try{mix=HomeModel.mix(snapshot.tracks,snapshot.queue,6,variation);}catch(_){mix=[];mixError=true;}
    mixPending=false;if(document.getElementById('view-home').classList.contains('active'))render(snapshot,actions);
   },0));
  }
  const focused=document.activeElement?.closest('[data-home-action]');
  const focusKey=focused&&root.contains(focused)?[focused.dataset.homeAction,focused.dataset.id||'']:null;
  const button=(label,action,cls='',id='',disabled=false)=>`<button type="button" class="home-button ${cls}" data-home-action="${action}" data-id="${escape(id)}"${disabled?' disabled':''}>${escape(label)}</button>`;
  const empty=message=>`<p class="home-empty">${escape(message)}</p>`;
  const rows=(tracks,group='track',limit=4)=>tracks.slice(0,limit).map((track,i)=>{
   const isCurrent=current&&String(current.id)===String(track.id);
   const isPlayingCurrent=isCurrent&&data.isPlaying;
   const end=group==='mix'?(isPlayingCurrent?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM14 5h4v14h-4z" fill="currentColor"/></svg>':icon):escape(duration(track.duration));
   return `<button type="button" class="home-track${isCurrent?' is-current':''}" data-home-action="${group}" data-id="${escape(track.id)}" title="${escape(title(track)+' — '+artist(track))}"><span class="home-track-number">${i+1}</span><img src="${escape(handlers.cover(track))}" data-cover-id="${escape(track.id)}" loading="lazy" alt=""><span class="home-track-copy"><strong>${escape(title(track))}</strong><span>${escape(artist(track))}</span></span><span class="home-track-end">${end}</span></button>`;
  }).join('');
  const section=(heading,content,action='')=>`<section class="home-section"><header class="home-section-head"><h2>${escape(heading)}</h2>${action}</header>${content}</section>`;
  const stat=(label,value,note)=>`<div class="home-readout"><dt>${escape(label)}</dt><dd>${escape(value)}</dd><span>${escape(note)}</span></div>`;
  const percent=(a,b)=>b?Math.round(100*a/b):null;
  function chart(values,labels,label,highlight=-1){
   const max=Math.max(60000,Math.ceil(Math.max(...values)/60000)*60000),width=504/values.length;
   return `<svg viewBox="0 0 560 152" role="img" aria-label="${escape(label)}" class="home-chart"><text x="0" y="12">${Math.round(max/60000)} ${t('мин','min')}</text><text x="20" y="116">0</text><path d="M48 16H552M48 64H552M48 112H552" class="home-chart-grid"/>${values.map((value,i)=>`<g><title>${escape(labels[i]+': '+time(value))}</title><rect class="home-chart-bar${i===highlight?' is-highlight':''}" x="${48+i*width+4}" y="${112-96*value/max}" width="${Math.max(2,width-8)}" height="${96*value/max}" rx="1"/><text x="${48+(i+.5)*width}" y="144" text-anchor="middle">${escape(values.length>7&&i%4!==0?'':labels[i])}</text></g>`).join('')}</svg>`;
  }
  const hour=new Date(now).getHours(),greeting=hour<5?t('Тихой ночи.','Good night.'):hour<12?t('Доброе утро.','Good morning.'):hour<18?t('Добрый день.','Good afternoon.'):t('Добрый вечер.','Good evening.');
  const ritual=d.ritual&&m.library.get(d.ritual.track);
  const fact=ritual?t(`Вы слушали «${title(ritual)}» в ${d.ritual.days} из последних 28 дней.`,`“${title(ritual)}” played on ${d.ritual.days} different days in the last four weeks.`):d.plays.length?t(`В вашей истории уже ${d.heardLibrary} прослушанных треков из фонотеки. Можно продолжить знакомое или найти следующее открытие.`,`Your history includes ${d.heardLibrary} tracks from your library. Return to something familiar or find your next discovery.`):t('Ваша музыка, в вашем ритме. Первые прослушивания появятся здесь вместе с вашей историей.','Your music, at your pace. Your first listens will bring this page to life.');
  const explored=percent(d.heardLibrary,d.librarySize),outside=percent(d.outsideFavorites,d.knownTime);
  const activeDays=d.calendar.filter(x=>x.ms>=60000).length;
  const hourMax=d.hours.some(Boolean)?d.hours.indexOf(Math.max(...d.hours)):-1;
  root.innerHTML=`
   <header class="home-hero">
    <div class="home-intro"><p class="home-date">${escape(new Date(now).toLocaleDateString(locale,{weekday:'long',day:'numeric',month:'long'}))}</p><h1>${escape(greeting)}</h1><p class="home-personal">${escape(fact)}</p>
     <div class="home-actions">${button(data.isPlaying?t('Открыть плеер','Open player'):t('Продолжить слушать','Continue listening'),data.isPlaying?'player':'resume','home-primary','',!current)}${button(t('Вся фонотека','Your library'),'library','home-text-button')}</div>
    </div>
    <div class="home-now"><button type="button" class="home-turntable" data-home-action="resume" aria-label="${escape(data.isPlaying?t('Пауза','Pause'):t('Воспроизвести','Play'))}"${!current?' disabled':''}><span class="home-record"><span class="home-record-label">${current?`<img src="${escape(handlers.cover(current))}" data-cover-id="${escape(current.id)}" alt="">`:icon}</span></span><span class="home-record-control">${data.isPlaying?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM14 5h4v14h-4z" fill="currentColor"/></svg>':icon}</span></button>
     <div class="home-now-copy"><span>${escape(data.isPlaying?t('Сейчас звучит','Now playing'):t('На вашей стороне','On your side'))}</span><strong>${escape(current?title(current):t('Место для вашей музыки','A place for your music'))}</strong><span>${escape(current?artist(current):t('Добавьте треки в фонотеку','Add tracks to your library'))}</span></div>
    </div>
   </header>
   <dl class="home-readouts">${stat(t('Сегодня с музыкой','Listening today'),time(m.todayMs),t('По сохранённым прослушиваниям','From saved listening'))}${stat(t('Последние 7 дней','Last seven days'),time(m.weekMs),t('Семь дней, включая сегодня','Seven days, including today'))}${stat(t('Серия прослушиваний','Listening streak'),`${d.behavior.streak} ${t('дн','days')}`,t(`Рекорд: ${d.behavior.longestStreak} дн`,`Best: ${d.behavior.longestStreak} days`))}${stat(t('Новые знакомые','New discoveries'),d.discoveries,t('Первое прослушивание за 30 дней','First recorded listen in 30 days'))}</dl>
   <div class="home-charts">
    <figure><figcaption><strong>${t('Ритм недели','Your week in music')}</strong><span>${t('Время прослушивания','Listening time')}</span></figcaption>${chart(m.week.map(x=>x.ms),m.week.map(x=>new Date(x.at).toLocaleDateString(locale,{weekday:'short'})),t('Время прослушивания за семь дней','Listening time over seven days'),6)}</figure>
    <figure><figcaption><strong>${t('Ваше время для музыки','Your hours for music')}</strong><span>${t('По всей сохранённой истории','Across your saved history')}</span></figcaption>${chart(d.hours,Array.from({length:24},(_,i)=>String(i).padStart(2,'0')),t('Прослушивание по часам суток','Listening by hour of day'),hourMax)}</figure>
    <figure class="home-explored"><figcaption><strong>${t('Глубина фонотеки','Library explored')}</strong><span>${d.heardLibrary} ${t('из','of')} ${d.librarySize}</span></figcaption><div class="home-ring" style="--ring-value:${explored||0}"><span>${explored===null?'—':explored+'%'}</span></div><small>${t('Хотя бы 30 секунд или половина короткого трека','At least 30 seconds or half a short track')}</small></figure>
   </div>
   <div class="home-dj-layout">
    ${section(t('Следующая хорошая песня','Your next good song'),`<p class="home-section-note">${t('Подборка Smart DJ по звучанию, вашей истории и выбранному вайбу.','A Smart DJ mix based on sound, your history and the selected vibe.')}</p><div class="home-mix" aria-busy="${mixPending}">${mixPending&&!mix.length?empty(t('Собираем подборку…','Building your mix…')):mixError?empty(t('Не удалось собрать подборку. Попробуйте обновить.','Could not build the mix. Try refreshing.')):mix.length?rows(mix.map(x=>x.track),'mix',6):empty(t('Добавьте музыку или разрешите треки для подбора.','Add music or allow tracks in recommendations.'))}</div><div class="home-actions">${button(isPlayingMix?t('Пауза','Pause'):t('Слушать подборку','Play the mix'),'mix-play','home-primary','',mixPending&&!mix.length||!mix.length)}${button(t('Обновить','Refresh'),'refresh','home-text-button','',mixPending)}</div>`, '<span class="home-section-note">Smart DJ</span>')}
    ${section(t('Настроение на сегодня','A mood for today'),`<p class="home-section-note">${t('Сохранённое вами звучание — ориентир для следующего подбора.','Sounds you saved guide the next selection.')}</p><div class="home-vibes">${button(t('Свободный подбор','Free selection'),'vibe',!vibes.activeId?'is-selected':'','')}${vibes.items.map(v=>button(v.name,'vibe',v.id===vibes.activeId?'is-selected':'',v.id)).join('')}</div>${!vibes.items.length?empty(t('Сохраните вайб понравившегося трека, чтобы возвращаться к его звучанию.','Save a track’s vibe to return to its sound.')):''}${button(t('Сохранить текущий вайб','Save the current vibe'),'save-vibe','home-text-button','',!data.current)}<div class="home-fact"><h3>${t('Чуть больше о вас','A little more about you')}</h3><p>${outside===null?t('Факты появятся после первых прослушиваний.','Facts appear after your first listens.'):t(`${outside}% времени вы слушаете музыку за пределами избранного.`,`${outside}% of your listening time is spent outside your favourites.`)}</p><p>${t(`Музыка звучала в ${activeDays} из последних 28 дней.`,`Music played on ${activeDays} of the last 28 days.`)}</p></div>`)}</div>
   <div class="home-pair">${section(t('Недавно звучало','Recently played'),m.recent.length?rows(m.recent):empty(t('Здесь будет история полноценных прослушиваний.','Your meaningful listening history will appear here.')))}${section(t('Недавно открыты','Recently discovered'),`<p class="home-section-note">${t('Впервые в сохранённой истории за последние 30 дней.','First heard in your saved history within the last 30 days.')}</p>`+(m.fresh.length?rows(m.fresh):empty(t('Новые открытия ещё впереди.','Your next discoveries are ahead.'))))}</div>
   ${section(t('Всегда рядом','Always close'),m.favorites.length?`<div class="home-favorite-grid">${m.favorites.slice(0,6).map(track=>`<button type="button" class="home-favorite" data-home-action="track" data-id="${escape(track.id)}"><img src="${escape(handlers.cover(track))}" data-cover-id="${escape(track.id)}" loading="lazy" alt=""><strong>${escape(title(track))}</strong><span>${escape(artist(track))}</span></button>`).join('')}</div>`:empty(t('Отмечайте любимые треки сердцем — они появятся здесь.','Like your favourite tracks to keep them here.')),button(t('Всё избранное','All favourites'),'favorites','home-text-button'))}
   <div class="home-pair">${section(t('Давно не встречались','Worth returning to'),m.past.length?rows(m.past):empty(t('Здесь появятся знакомые треки, которые не звучали неделю.','Familiar tracks unheard for a week will appear here.')))}${section(t('Ваши плейлисты','Your playlists'),data.playlists.length?`<div class="home-playlists">${data.playlists.map(pl=>`<button type="button" class="home-playlist" data-home-action="playlist" data-id="${escape(pl.id)}"><strong>${escape(pl.name)}</strong><span>${t('Треков','Tracks')}: ${new Set((pl.trackIds||[]).map(String).filter(id=>m.library.has(id))).size}</span></button>`).join('')}</div>`:empty(t('Соберите песни для дороги, работы или тихого вечера.','Collect songs for a journey, work or a quiet evening.')),button(t('Создать','Create'),'new-playlist','home-text-button'))}</div>
   ${(() => {
     if (data.showMoments === false) return '';
     const momentsStore = data.favoriteMoments || {};
     const moments = [];
     for (const [id, sec] of Object.entries(momentsStore)) {
       const track = m.library.get(String(id));
       if (track && Number.isFinite(sec)) {
         moments.push({ track, sec, dur: Number(track.duration) || 0 });
       }
     }
     moments.sort((a, b) => (m.last?.get(String(b.track.id)) || 0) - (m.last?.get(String(a.track.id)) || 0));
     const reel = data.momentsReel || { active: false, snippetSec: 25 };
     const activeSec = reel.snippetSec ?? 25;
     const durationsHtml = `
       <div class="home-moments-controls">
         <div class="home-moments-durations" role="group" aria-label="${escape(t('Длина фрагмента','Snippet duration'))}">
           ${[15, 25, 45, 0].map(s => `<button type="button" class="home-duration-pill${activeSec === s ? ' is-selected' : ''}" data-home-action="reel-duration" data-id="${s}">${s === 0 ? t('Вся песня','Full track') : s + ' ' + t('с','s')}</button>`).join('')}
         </div>
         ${reel.active
           ? button(t('Остановить микс','Stop reel'), 'reel-stop', 'home-button is-active')
           : button(t('Слушать микс моментов','Play moments mix'), 'start-reel', 'home-primary')}
       </div>
     `;
     const reelBanner = reel.active ? `
       <div class="home-reel-bar">
         <div class="home-reel-info">
           <span class="home-reel-badge">⚡ ${t('Микс хайлайтов','Highlight reel')}</span>
           <span class="home-reel-meta"><strong>${escape(current ? title(current) : '')}</strong> — ${escape(current ? artist(current) : '')}</span>
           <span class="home-reel-timer">${reel.snippetSec > 0 ? `${reel.snippetSec} ${t('сек / фрагмент','sec / snippet')}` : t('до конца трека','until track ends')}</span>
         </div>
         <div class="home-reel-actions">
           ${button(t('След. момент ⏭','Next moment ⏭'), 'reel-next', 'home-button')}
           ${button(t('Слушать целиком','Keep playing'), 'reel-keep', 'home-button')}
           ${button(t('✕ Выйти','✕ Exit'), 'reel-stop', 'home-text-button')}
         </div>
       </div>
     ` : '';
     const momentsGrid = moments.length ? `
       <div class="home-moments-grid">
         ${moments.map(({track, sec, dur}) => {
           const isCurrent = current && String(current.id) === String(track.id);
           const isPlayingCurrent = isCurrent && data.isPlaying;
           const durSec = dur > 0 ? dur / 1000 : 1;
           const pct = Math.min(100, Math.max(0, Math.round((sec / durSec) * 100)));
           const snippetSpan = Math.min(100 - pct, Math.max(5, Math.round(((activeSec || 25) / durSec) * 100)));
           const timeStr = typeof FavoriteMoments !== 'undefined' ? FavoriteMoments.formatTime(sec) : duration(sec * 1000);
           return `
             <article class="home-moment-card${isCurrent ? ' is-current' : ''}">
               <button type="button" class="home-moment-cover-btn" data-home-action="moment" data-id="${escape(track.id)}" title="${escape(title(track) + ' — ' + artist(track) + ' (' + timeStr + ')')}">
                 <img src="${escape(handlers.cover(track))}" data-cover-id="${escape(track.id)}" loading="lazy" alt="">
                 <span class="home-moment-badge">⏱ ${escape(timeStr)}</span>
                 <span class="home-moment-overlay">${isPlayingCurrent ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM14 5h4v14h-4z" fill="currentColor"/></svg>' : icon}</span>
               </button>
               <div class="home-moment-meta">
                 <strong title="${escape(title(track))}">${escape(title(track))}</strong>
                 <span title="${escape(artist(track))}">${escape(artist(track))}</span>
               </div>
               <div class="home-moment-timeline" aria-hidden="true" title="${escape(t('Момент на ','Moment at ') + timeStr + ' / ' + duration(dur) + ' (' + pct + '%)')}">
                 <div class="home-moment-track-bar">
                   <div class="home-moment-slice" style="left:${pct}%;width:${snippetSpan}%"></div>
                   <div class="home-moment-pin" style="left:${pct}%"></div>
                 </div>
                 <div class="home-moment-times">
                   <span>${escape(timeStr)}</span>
                   <span>${escape(duration(dur))}</span>
                 </div>
               </div>
             </article>
           `;
         }).join('')}
       </div>
     ` : empty(t('Вы пока не отметили ни одного момента. Во время прослушивания трека нажмите иконку тайм-кода в плеере, чтобы зафиксировать любимую секунду.','You haven’t saved any favorite moments yet. While playing a track, tap the bookmark icon in the player to save your favorite part.'));
     return section(
       t('Лучшие моменты', 'Favorite moments'),
       `<p class="home-section-note">${t('Кульминации ваших треков. Запускайте непрерывный микс хайлайтов или слушайте любимый отрезок песни.','Peak moments from your tracks. Play a continuous highlight reel or jump straight to the best part of any song.')}</p>${reelBanner}${momentsGrid}`,
       moments.length ? durationsHtml : ''
     );
   })()}
   <footer class="home-footer"><span>${t('Только ваша музыка и ваша история.','Just your music and your history.')}</span>${button(t('Больше статистики','More listening insights'),'insights','home-text-button')}</footer>`;
  root.querySelectorAll('[data-home-action="vibe"]').forEach(b=>b.setAttribute('aria-pressed',String(b.classList.contains('is-selected'))));
  if(focusKey){const candidate=[...root.querySelectorAll('[data-home-action]')].find(b=>b.dataset.homeAction===focusKey[0]&&(b.dataset.id||'')===focusKey[1]);candidate?.focus({preventScroll:true});}
 }
 root.addEventListener('error',event=>{
  const img=event.target;if(img.tagName!=='IMG'||!img.dataset.coverId)return;
  const track=snapshot?.tracks.find(t=>String(t.id)===img.dataset.coverId);delete img.dataset.coverId;
  if(track)img.src=actions.fallbackCover(track);
 },true);
 root.addEventListener('click',event=>{
  const b=event.target.closest('[data-home-action]');if(!b||b.disabled)return;
  const action=b.dataset.homeAction,id=b.dataset.id;
  if(action==='refresh'){variation++;render(snapshot,actions);}
  else if(action==='mix-play'||action==='mix'){
   const live=new Map(snapshot.tracks.map(t=>[String(t.id),t]));
   const tracks=mix.map(x=>live.get(String(x.track.id))).filter(t=>t&&!snapshot.queue.isExcluded(t.id));
   if(!tracks.length)return;
   const isPlayingMix=snapshot.isPlaying&&snapshot.current&&tracks.some(t=>String(t.id)===String(snapshot.current.id));
   if(action==='mix-play'){
    if(isPlayingMix){actions.resume();}
    else{const track=tracks[0];if(track)actions.playMix(track,tracks);}
   }else{
    const track=tracks.find(t=>String(t.id)===id);
    if(track){
     if(snapshot.current&&String(snapshot.current.id)===String(track.id)){actions.resume();}
     else{actions.playMix(track,tracks);}
    }
   }
  }else if(action==='track')actions.playTrack(id);
  else if(action==='moment'){if(actions.playMoment)actions.playMoment(id);}
  else if(action==='start-reel'){if(actions.startReel)actions.startReel(null);}
  else if(action==='reel-stop'){if(actions.stopReel)actions.stopReel();}
  else if(action==='reel-next'){if(actions.nextReel)actions.nextReel();}
  else if(action==='reel-keep'){if(actions.keepFull)actions.keepFull();}
  else if(action==='reel-duration'){if(actions.setSnippetSec)actions.setSnippetSec(Number(id));}
  else if(action==='vibe'){if(window.PainDJVibes?.select(id||null)){mixKey='';render(snapshot,actions);}}
  else if(action==='resume')actions.resume();
  else if(action==='playlist')actions.navigate('playlist',id);
  else if(action==='new-playlist')document.getElementById('newPlaylistBtn').click();
  else if(action==='save-vibe')document.getElementById('bottomTrackContext').click();
  else actions.navigate(action);
 });
  function setPlaying(playing){
   if(!snapshot)return;snapshot.isPlaying=playing;
   const ru=snapshot.lang==='ru',turntable=root.querySelector('.home-turntable'),control=root.querySelector('.home-record-control');
   turntable?.setAttribute('aria-label',playing?(ru?'Пауза':'Pause'):(ru?'Воспроизвести':'Play'));
   if(control)control.innerHTML=playing?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM14 5h4v14h-4z" fill="currentColor"/></svg>':icon;
   const resume=root.querySelector('.home-intro .home-primary');
   if(resume){resume.dataset.homeAction=playing?'player':'resume';resume.textContent=playing?(ru?'Открыть плеер':'Open player'):(ru?'Продолжить слушать':'Continue listening');}
   const label=root.querySelector('.home-now-copy>span');if(label)label.textContent=playing?(ru?'Сейчас звучит':'Now playing'):(ru?'На вашей стороне':'On your side');
   root.querySelectorAll('.home-moment-card.is-current .home-moment-overlay').forEach(overlay => {
     overlay.innerHTML = playing ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM14 5h4v14h-4z" fill="currentColor"/></svg>' : icon;
   });
   root.querySelectorAll('.home-mix .home-track').forEach(row => {
     const isCurrent = row.classList.contains('is-current');
     const end = row.querySelector('.home-track-end');
     if (end) end.innerHTML = (isCurrent && playing) ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM14 5h4v14h-4z" fill="currentColor"/></svg>' : icon;
   });
   const mixPlayBtn = root.querySelector('[data-home-action="mix-play"]');
   if (mixPlayBtn && mix.some(x => snapshot.current && String(x.track.id) === String(snapshot.current.id))) {
     mixPlayBtn.textContent = playing ? (ru ? 'Пауза' : 'Pause') : (ru ? 'Слушать подборку' : 'Play the mix');
   }
  }
  window.HomeView={render,setPlaying};
})();
