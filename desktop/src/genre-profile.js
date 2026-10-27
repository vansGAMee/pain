(function(){
 'use strict';
 const body=document.getElementById('genreProfileBody'),status=document.getElementById('genreProfileStatus'),toggle=document.getElementById('onlineGenresSwitch');
 const ru=()=>localStorage.getItem('pain_lang')!=='en',t=(a,b)=>ru()?a:b;
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const colors=['#775a89','#628879','#b28b4e','#6089a3','#b57270','#92946a','#8795a2','#aaa79e'];
 let range='all',enabled=true,controller,lastKey='',lastTrackKey='',busyTrack=false,report,selected=-1;
 const visibility=document.getElementById('showTrackGenresSwitch');
 const setVisibility=value=>{document.documentElement.dataset.showTrackGenres=String(value);localStorage.setItem('pain_show_track_genres',String(value));};
 if(visibility){visibility.checked=localStorage.getItem('pain_show_track_genres')!=='false';setVisibility(visibility.checked);visibility.addEventListener('change',()=>setVisibility(visibility.checked));}
 const visible=()=>!document.hidden&&document.getElementById('view-insights').classList.contains('active');
 const duration=ms=>{const m=Math.round(ms/60000);return m>=60?`${Math.floor(m/60)} ${t('ч','h')} ${m%60} ${t('мин','m')}`:`${m} ${t('мин','min')}`;};
 const json=async(url,options={})=>{const r=await fetch(url,{signal:AbortSignal.timeout(10000),...options});if(!r.ok)throw Error('Unavailable');return r.json();};
 function groups(data){
  const known=data.genres.filter(g=>g.name),list=known.slice(0,6).map((g,i)=>({...g,color:colors[i],label:g.name}));
  if(known.length>6)list.push({name:'__other',label:t('Другие жанры','Other genres'),ms:known.slice(6).reduce((s,g)=>s+g.ms,0),color:colors[6]});
  const unknown=data.genres.find(g=>!g.name);if(unknown)list.push({...unknown,label:t('Пока без жанра','Unidentified'),color:colors[7]});
  return list;
 }
 function select(index){
  if(!report)return;const list=groups(report),g=list[index];selected=g?index:-1;
  document.getElementById('genreOrbitValue').textContent=report.total?`${Math.round((g?g.ms:report.identified)/report.total*100)}%`:'—';
  document.getElementById('genreOrbitLabel').textContent=g?g.label:t('жанры найдены','genres identified');
  const orbit=body.querySelector('.genre-orbit');orbit?.classList.toggle('has-selection',!!g);
  orbit?.querySelectorAll('[data-genre-index]').forEach((p,i)=>{p.classList.toggle('is-selected',i===selected);p.setAttribute('aria-pressed',String(i===selected));});
  body.querySelectorAll('.genre-legend button').forEach((b,i)=>b.setAttribute('aria-pressed',String(i===selected)));
 }
 function render(data){
  const previous=report&&groups(report)[selected]?.name;
  report=data;const list=groups(data),total=data.total||1;let offset=0;
  const arcs=list.map((g,i)=>{
   const share=g.ms/total,a=-Math.PI/2+offset*Math.PI*2,b=a+share*Math.PI*2,m=(a+b)/2;
   const xy=(r,angle)=>`${(120+r*Math.cos(angle)).toFixed(4)} ${(120+r*Math.sin(angle)).toFixed(4)}`;
   const d=`M${xy(98,a)} A98 98 0 0 1 ${xy(98,m)} A98 98 0 0 1 ${xy(98,b)} L${xy(70,b)} A70 70 0 0 0 ${xy(70,m)} A70 70 0 0 0 ${xy(70,a)} Z`;
   offset+=share;
   return `<path d="${d}" fill="${g.name?g.color:'url(#genreUnknownPattern)'}" tabindex="0" role="button" data-genre-index="${i}" aria-label="${escape(g.label)}: ${Math.round(share*100)}%"><title>${escape(g.label)} — ${escape(duration(g.ms))}</title></path>`;
  }).join('');
  const legend=list.map((g,i)=>`<button type="button" data-genre-index="${i}" aria-pressed="false" style="--genre-color:${g.color};--genre-share:${g.ms/total*100}%"><i aria-hidden="true"></i><span class="genre-name">${escape(g.label)}</span><span class="genre-share">${Math.round(g.ms/total*100)}%</span><span class="genre-meter" aria-hidden="true"><i></i></span></button>`).join('');
  const weeks=data.weeks.map(w=>{
   const segments=list.map(g=>({g,ms:w.genres.filter(row=>g.name==='__other'?row.name&&!list.some(x=>x.name===row.name):row.name===g.name).reduce((s,row)=>s+row.ms,0)}));
   // Genres outside the selected period still retain a neutral segment in the timeline.
   const represented=segments.reduce((s,x)=>s+x.ms,0);if(w.total>represented+.1)segments.push({g:{color:colors[6],label:t('Другие жанры','Other genres')},ms:w.total-represented});
   const date=new Date(w.day+'T12:00:00').toLocaleDateString(ru()?'ru-RU':'en-US',{day:'numeric',month:'short'});
   return `<div class="genre-week"><div class="genre-week-stack" role="img" aria-label="${escape(date+': '+duration(w.total)+'. '+segments.filter(x=>x.ms).map(x=>x.g.label+' '+Math.round(x.ms/(w.total||1)*100)+'%').join(', '))}">${segments.filter(x=>x.ms>0).map(({g,ms})=>`<span style="--genre-color:${g.color};--genre-share:${ms/(w.total||1)*100}%" title="${escape(g.label+': '+duration(ms))}"></span>`).join('')}</div><div class="genre-week-label"><span>${escape(date)}</span><span>${escape(duration(w.total))}</span></div></div>`;
  }).join('');
  body.innerHTML=`<div class="genre-spectrum"><div class="genre-orbit"><svg viewBox="0 0 240 240" aria-label="${t('Доли жанров по времени прослушивания','Genre shares by listening time')}"><defs><pattern id="genreUnknownPattern" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)"><rect width="6" height="6" fill="var(--border)"/><path d="M0 3H6" stroke="var(--ink-muted)" stroke-opacity=".4" stroke-width="1"/></pattern></defs><circle r="84" cx="120" cy="120" fill="none" stroke="var(--border)" stroke-width="28"/>${arcs}</svg><div class="genre-orbit-center"><strong id="genreOrbitValue"></strong><span id="genreOrbitLabel"></span><small>${t('от всего времени','of all listening time')}</small></div></div><div class="genre-legend">${legend||`<p class="chart-sub">${t('Начни слушать музыку — здесь появится твой спектр.','Start listening to build your spectrum.')}</p>`}</div></div><p class="genre-coverage">${t(`Жанры известны у ${data.known} из ${data.listened} прослушанных треков — ${Math.round(data.identified/total*100)}% времени.`,`Genres identified for ${data.known} of ${data.listened} played tracks — ${Math.round(data.identified/total*100)}% of listening time.`)}</p><div class="genre-timeline"><h3>${t('Как менялся твой вкус','How your taste changed')}</h3><p class="chart-sub">${t('Последние четыре недели · доли жанров за каждую неделю','Last four weeks · genre shares within each week')}</p><div class="genre-week-grid">${weeks}</div></div><p class="genre-profile-note">${t('По сохранённому времени прослушивания. Если у трека несколько жанров, время делится между ними поровну. Жанры берутся из файла, записи или её издания. Интернет-источники: Википедия, MusicBrainz, Apple Music, Deezer.','Based on saved listening time. Tracks with several genres split their time equally between them. Genres come from file tags, recordings or their releases. Online sources: Wikipedia, MusicBrainz, Apple Music and Deezer.')}</p>`;
  const retained=previous===undefined?-1:list.findIndex(g=>g.name===previous);
  select(retained>=0?retained:-1);
 }
 function showStatus(data){
  enabled=data.enabled;toggle.checked=enabled;
  status.textContent=!enabled?t('Поиск жанров выключен. Сохранённые жанры остаются в профиле.','Genre search is off. Saved genres remain in your profile.'):data.scanning?t('Получаем опубликованные жанры и теги треков из интернет-каталогов…','Fetching published song genres and tags from online catalogs…'):data.queued||data.active?t(`Жанры дополняются в фоне. В очереди: ${data.queued}.`,`Genres are updating in the background. Queued: ${data.queued}.`):t('Профиль обновляется по мере прослушивания.','Your profile updates as you listen.');
 }
 async function refresh(){
  if(!visible()||controller)return;
  controller=new AbortController();body.setAttribute('aria-busy','true');const requested=range;
  try{
   const data=await json('/api/taste-profile?range='+range,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])});
   if(requested!==range)return;
   const key=JSON.stringify([ru(),range,data.total,data.genres,data.weeks]);
   if(key!==lastKey){render(data);lastKey=key;}showStatus(data.status);
  }catch(e){if(e.name!=='AbortError')status.textContent=t('Не удалось обновить профиль. Повторим при следующем открытии.','Could not update the profile. We will retry when you return.');}
  finally{controller=null;body.setAttribute('aria-busy','false');if(requested!==range)refresh();}
 }
 async function updateTrack(){
  const track=window.PainPlayer?.getTrack();if(!track||document.hidden||busyTrack)return;
  busyTrack=true;const id=track.id;
  try{const data=await json('/api/genres/track/'+encodeURIComponent(id));if(window.PainPlayer?.getTrack()?.id!==id)return;
   const key=JSON.stringify(data);if(key!==lastTrackKey){lastTrackKey=key;window.dispatchEvent(new CustomEvent('pain:genres',{detail:data}));}
  }catch(_){}finally{busyTrack=false;if(window.PainPlayer?.getTrack()?.id!==id)updateTrack();}
 }
 toggle.addEventListener('change',async()=>{
  const wanted=toggle.checked;toggle.disabled=true;
  try{showStatus(await json('/api/genres?enabled='+(wanted?1:0),{method:'POST'}));refresh();updateTrack();}
  catch(_){toggle.checked=enabled;status.textContent=t('Настройка не сохранилась. Попробуйте снова.','The setting could not be saved. Please try again.');}
  finally{toggle.disabled=false;}
 });
 document.querySelector('.genre-range').addEventListener('click',event=>{
  const button=event.target.closest('[data-genre-range]');if(!button)return;range=button.dataset.genreRange;
  document.querySelectorAll('[data-genre-range]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));refresh();
 });
 body.addEventListener('click',event=>{const target=event.target.closest('[data-genre-index]');if(target){const index=Number(target.dataset.genreIndex);select(index===selected?-1:index);}});
 body.addEventListener('keydown',event=>{const target=event.target.closest('svg [data-genre-index]');if(target&&['Enter',' '].includes(event.key)){event.preventDefault();const index=Number(target.dataset.genreIndex);select(index===selected?-1:index);}});
 window.addEventListener('pain:track',event=>{lastTrackKey='';updateTrack();});
 window.addEventListener('pain:insights',()=>{setTimeout(refresh,0);});
 window.addEventListener('pain:view',()=>{if(!visible())controller?.abort();else refresh();});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)controller?.abort();else{refresh();updateTrack();}});
 setInterval(()=>{refresh();if(enabled&&!document.hidden&&!document.getElementById('trackInfoPanel').hidden)updateTrack();},15000);
 json('/api/genres').then(showStatus).catch(()=>{});refresh();updateTrack();
})();
