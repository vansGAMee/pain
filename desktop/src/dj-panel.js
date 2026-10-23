/* Local, explicit acoustic bookmarks. Explanations come from the saved decision. */
(function() {
  'use strict';
  const queue=window.painQueue,dialog=document.getElementById('djDialog');
  if(!queue||!dialog)return;
  const el=id=>document.getElementById(id),key='pain_dj_vibes_v1',limit=8;
  const text=(ru,en)=>localStorage.getItem('pain_lang')==='ru'?ru:en;
  let saved={items:[],activeId:null},draft=null,listKey='';
  try {
    const data=JSON.parse(localStorage.getItem(key)),ids=new Set();
    for(const item of (Array.isArray(data?.items)?data.items:[]).slice(0,limit)){
      const profile=QueueEngine.validateVibeProfile(item?.profile);
      if(!profile||typeof item.id!=='string'||item.id.length>100||ids.has(item.id)||typeof item.name!=='string'||!item.name.trim())continue;
      ids.add(item.id);
      saved.items.push({id:item.id,name:item.name.trim().slice(0,80),source:typeof item.source==='string'?item.source.slice(0,300):'',profile});
    }
    saved.activeId=saved.items.some(v=>v.id===data?.activeId)?data.activeId:null;
    saved.updatedAt=Number.isSafeInteger(data?.updatedAt)?data.updatedAt:0;
  } catch (_) {}
  const active=()=>saved.items.find(v=>v.id===saved.activeId);
  queue.setVibeProfile(active()?.profile||null);
  function draftProfile(){
    if(!draft)return null;
    if(!draft.profile){
      const profile=AudioProfile.get(queue.audioProfiles,draft.track);
      if(AudioProfile.texture(profile))draft.profile=QueueEngine.validateVibeProfile(profile);
    }
    return draft.profile;
  }
  function availability(){
    if(!dialog.open)return;
    const ready=!!draftProfile();
    el('djSave').disabled=!ready||saved.items.length>=limit;
    const source=draft?.track?.title||text('Без названия','Untitled');
    el('djVibeHint').textContent=!ready
      ?(draft?text(`Нужно больше звучания трека «${source}». Послушайте его немного дольше.`,`More sound from “${source}” is needed. Listen a little longer.`):text('Выберите трек, чтобы сохранить его звучание.','Choose a track to save its sound.'))
      :text(`Ориентир — «${source}». Пропуски и ваш вкус продолжат учитываться.`,`Sound reference: “${source}”. Skips and your listening preferences still count.`);
    if(saved.items.length>=limit)el('djVibeHint').textContent=text('Сохранено 8 вайбов. Удалите один, чтобы добавить новый.','8 vibes saved. Remove one to add another.');
  }
  function commit(next,message){
    next.updatedAt=Date.now();
    try { localStorage.setItem(key,JSON.stringify(next)); }
    catch (_) { el('djStatus').textContent=text('Не удалось сохранить. Возможно, закончилось место.','Could not save. Storage may be full.');return false; }
    saved=next;
    window.dispatchEvent(new Event('pain:dj-changed'));
    queue.setVibeProfile(active()?.profile||null);
    render();
    el('djStatus').textContent=message;
    return true;
  }
  const activationMessage=()=>queue.getShuffleMode()==='smart'
    ?text('Вайб включён со следующего подбора.','Vibe enabled for the next selection.')
    :text('Вайб выбран. Включите Smart DJ для подбора.','Vibe selected. Enable Smart DJ to use it.');
  function render(){
    const smart=queue.getShuffleMode()==='smart',track=queue.getCurrentTrack(),vibe=active(),trigger=el('bottomTrackContext');
    trigger.disabled=!track&&!saved.items.length;
    trigger.title=text('Почему этот трек и сохранённые вайбы','Why this track and saved vibes');
    trigger.setAttribute('aria-label',trigger.title);
    // Keep the existing queue context, with one quiet, actionable label.
    if(smart&&track){
      const prefix=trigger.dataset.contextLabel||'',decision=queue.getLastTransition();
      const matched=String(decision?.toTrack?.id)===String(track.id);
      const reason=matched?DJExplanation.summary(decision,localStorage.getItem('pain_lang')):'';
      trigger.textContent=prefix+' · '+(reason||'Smart DJ')+(vibe?' · '+vibe.name:'');
      if(matched)trigger.title=DJExplanation.describe(decision,localStorage.getItem('pain_lang'))+'\n'+text('Нажмите, чтобы подробнее','Click for details');
    }else if(!track&&saved.items.length)trigger.textContent=text('Сохранённые вайбы','Saved vibes');
    if(!dialog.open)return;
    el('djClose').textContent=text('Закрыть','Close');
    el('djWhyLabel').textContent=text('Почему этот трек','Why this track');
    el('djVibeLabel').textContent=text('Сохранить вайб','Save a vibe');
    el('djNameLabel').textContent=text('Название','Name');
    el('djSave').textContent=text('Сохранить','Save');
    el('djSavedLabel').textContent=text('Сохранённые вайбы','Saved vibes');
    el('djRelease').textContent=text('Отпустить вайб','Release vibe');
    el('djRelease').hidden=!vibe;
    el('djTrack').textContent=track?[track.title,track.artist].filter(Boolean).join(' — '):text('Нет текущего трека','No current track');
    const decision=queue.getLastTransition();
    const reasons=smart&&track&&String(decision?.toTrack?.id)===String(track.id)?decision.reasons:[];
    el('djReason').textContent=reasons?.length
      ?DJExplanation.describe(decision,localStorage.getItem('pain_lang'))
      :(!track?text('Нет текущего трека.','No current track.'):text('Трек запущен из очереди.','Started from the queue.'));
    el('djActive').textContent=vibe
      ?(smart?text('Удерживаем: ','Keeping: '):text('На паузе до включения Smart DJ: ','Paused until Smart DJ is enabled: '))+vibe.name
      :text('Свободный подбор. Выберите вайб, чтобы вернуться к его звучанию.','Free selection. Choose a saved vibe to return to its sound.');
    // Queue/profile refreshes must not remove the focused button from the DOM.
    const nextListKey=JSON.stringify([saved.items.map(v=>[v.id,v.name,v.source]),saved.activeId,text('ru','en')]);
    if(nextListKey!==listKey){
     listKey=nextListKey;el('djVibes').replaceChildren();
     for(const item of saved.items){
      const row=document.createElement('div');row.className='dj-vibe-row';
      const select=document.createElement('button');select.type='button';select.className='dj-vibe-select';
      select.setAttribute('aria-pressed',String(item.id===saved.activeId));
      const label=document.createElement('span');label.textContent=item.name;
      const source=document.createElement('small');source.textContent=item.source;
      select.append(label,source);
      select.onclick=()=>{
        if(commit({...saved,activeId:item.id},activationMessage()))
          el('djVibes').querySelector('[aria-pressed="true"]')?.focus();
      };
      const remove=document.createElement('button');remove.type='button';remove.className='dj-text-button';
      remove.textContent=text('Удалить','Remove');remove.setAttribute('aria-label',text('Удалить вайб ','Remove vibe ')+item.name);
      remove.onclick=()=>{
        if(commit({items:saved.items.filter(v=>v.id!==item.id),activeId:saved.activeId===item.id?null:saved.activeId},text('Вайб удалён.','Vibe removed.')))el('djVibeName').focus();
      };
      row.append(select,remove);el('djVibes').append(row);
     }
    }
    availability();
  }
  el('bottomTrackContext').addEventListener('click',()=>{
    const track=queue.getCurrentTrack();
    draft=track?{track:{...track},profile:null}:null;
    el('djVibeName').value=(track?.title||'').slice(0,80);
    el('djStatus').textContent='';dialog.showModal();render();el('djClose').focus();
  });
  dialog.addEventListener('close',()=>{draft=null;});
  el('djClose').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('keydown',event=>event.stopPropagation());
  dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
  el('djSaveForm').addEventListener('submit',event=>{
    event.preventDefault();
    const name=el('djVibeName').value.trim(),profile=draftProfile();
    if(!name||!profile||saved.items.length>=limit){availability();return;}
    const source=[draft.track.title,draft.track.artist].filter(Boolean).join(' — ').slice(0,300);
    const existing=saved.items.find(v=>v.name===name&&v.source===source&&JSON.stringify(v.profile)===JSON.stringify(profile));
    if(existing){commit({...saved,activeId:existing.id},text('Этот вайб уже сохранён.','This vibe is already saved.'));return;}
    const id=globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
    const item={id,name:name.slice(0,80),source,profile};
    commit({items:[...saved.items,item],activeId:item.id},text('Вайб сохранён. ','Vibe saved. ')+activationMessage());
  });
  el('djRelease').addEventListener('click',()=>{
    if(commit({...saved,activeId:null},text('Подбор снова свободный.','Selection is free again.')))
      (el('djVibes').querySelector('button')||el('djVibeName')).focus();
  });
  window.addEventListener('pain:queue-ui',render);
  window.PainDJVibes={
    list:()=>({items:saved.items.map(v=>({id:v.id,name:v.name})),activeId:saved.activeId,updatedAt:saved.updatedAt}),
    select:id=>{
      if(id!==null&&!saved.items.some(v=>v.id===id))return false;
      return commit({...saved,activeId:id},id?activationMessage():text('Подбор снова свободный.','Selection is free again.'));
    }
  };
  window.addEventListener('pain:dj-state',event=>{saved=event.detail;listKey='';queue.setVibeProfile(active()?.profile||null);render();});
  el('audioEngine').addEventListener('timeupdate',availability);
  el('langToggle').addEventListener('click',()=>queueMicrotask(render));
  render();
})();
