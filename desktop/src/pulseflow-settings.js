(function() {
  const q = window.painQueue, status = document.getElementById('pulseflowStatus');
  if (!q || !status) return;
  const policy = document.getElementById('pulseflowPolicy'), start = document.getElementById('pulseflowIndex'), stop = document.getElementById('pulseflowCancel');
  const ru = () => localStorage.getItem('pain_lang') === 'ru';
  try { const saved=localStorage.getItem('pain_pulseflow_policy');q.pulseflowPolicy=['smooth','contrast','personal','live','taste'].includes(saved)?saved:'personal'; } catch (_) {}
  policy.value = q.pulseflowPolicy;
  policy.onchange = () => {
    q.pulseflowPolicy = policy.value; q.pulseflowPlan = null; q.cancelPendingSelection();
    try { localStorage.setItem('pain_pulseflow_policy', policy.value); } catch (_) {}
    window.dispatchEvent(new Event('pain:dj-changed'));
  };
  let personalActive=false,personalReadyTimer=null,checkingPersonal=false;
  const checkPersonalUse=()=>{
    const active=q.pulseflowPolicy==='taste'&&q.getShuffleMode()==='smart';
    if(personalActive&&!active)fetch('/api/personal/recommend',{method:'POST',headers:{'Content-Type':'application/json','X-Pain-Update':'personal'},body:JSON.stringify({action:'abandon',cancel:q.pulseflowPolicy!=='taste'})}).catch(()=>{});
    if((personalActive&&!active)||q.pulseflowPolicy!=='taste'){clearInterval(personalReadyTimer);personalReadyTimer=null;}
    personalActive=active;
  };
  window.addEventListener('pain:queue-ui',checkPersonalUse);
  window.addEventListener('pain:dj-changed',checkPersonalUse);
  const startPersonalPoll=()=>{
    if(personalReadyTimer||q.pulseflowPolicy!=='taste')return;
    const check=async()=>{
      if(checkingPersonal)return;checkingPersonal=true;
      try{
        const response=await fetch('/api/personal/recommend',{method:'POST',headers:{'Content-Type':'application/json','X-Pain-Update':'personal'},body:JSON.stringify({action:'status'})});
        if(!response.ok)return;const data=await response.json();
        if(data.state==='ready'||data.state==='error'||q.pulseflowPolicy!=='taste'){
          clearInterval(personalReadyTimer);personalReadyTimer=null;
          if(data.state==='ready'&&q.pulseflowPolicy==='taste'){q.refreshRecommendations();window.dispatchEvent(new Event('pain:personal-ready'));}
        }
      }catch(_){}finally{checkingPersonal=false;}
    };
    // Operational readiness polling only while a refit is active.
    personalReadyTimer=setInterval(check,500);check();
  };
  window.addEventListener('pain:personal-preparing',startPersonalPoll);
  checkPersonalUse();
  let busy = false, revision = 0;
  async function refresh(action = 'status') {
    if (busy && action !== 'cancel') return;
    busy = true; const token = ++revision;
    if (action === 'index') { start.disabled=true;stop.hidden=false;status.textContent=ru()?'Подготовка файлов фонотеки…':'Preparing library files…'; }
    try {
      const response = await fetch('/api/pulseflow/' + action, action === 'status' ? {} : {
        method: 'POST', headers: { 'X-Pain-Update': 'pulseflow' }
      });
      const data = await response.json();
      if (token !== revision) return;
      if (!response.ok) throw new Error(data.error || 'PulseFlow unavailable');
      const labels = ru() ? { empty: 'Нужен анализ фонотеки', loading: 'Загрузка модели CLAP', indexing: 'Индексация музыки', ready: 'Индекс готов', interrupted: 'Анализ прерван — можно продолжить', error: 'Ошибка анализа', 'not-installed': 'Python-движок не установлен' }
        : { empty: 'Index the library', loading: 'Loading CLAP', indexing: 'Analyzing audio', ready: 'Ready', interrupted: 'Indexing interrupted — resume below', error: 'Indexing failed', 'not-installed': 'Python runtime is not installed' };
      labels.partial = ru() ? 'Индекс готов частично' : 'Index partially ready';
      labels.preparing = ru() ? 'Подготовка файлов фонотеки' : 'Preparing library files';
      status.textContent = `${labels[data.state] || data.state}: ${data.indexed || 0} / ${data.total || 0}`
        + (data.failed ? ` · ${ru() ? 'Ошибок' : 'Failed'}: ${data.failed}` : '')
        + (data.current ? ` · ${data.current}` : '') + (data.error || data.lastError ? ` · ${data.error || data.lastError}` : '');
      if(q.pulseflowPolicy==='taste'){
        try{const response=await fetch('/api/personal/recommend',{method:'POST',headers:{'Content-Type':'application/json','X-Pain-Update':'personal'},body:JSON.stringify({action:'status'})});
          if(response.ok){const own=await response.json();const label=own.state==='ready'&&own.method==='insufficient-evidence'?(ru()?'Пока мало истории — частота и лайки':'Little history yet — frequency and likes'):own.state==='ready'?(ru()?`Весь вкус готов · ${own.events} событий`:`Whole taste ready · ${own.events} events`):own.state==='training'?(ru()?'Весь вкус: обучение в фоне, плеер доступен':'Whole taste: learning in the background'):own.state==='error'?own.error:(ru()?'Первый подбор обучит модель в фоне':'The first selection trains the model in the background');status.textContent+=' · '+label;}
        }catch(_){}
      }
      if (data.failures?.length) status.textContent += ' · ' + data.failures.map(e => e.id + ': ' + e.error).join('; ');
      start.disabled = data.running || !data.installed; stop.hidden = !data.running;
      const missing = document.getElementById('pulseflowMissing');
      const reasons=ru()?{AUDIO_NOT_ON_PHONE:'телефон ответил 404: этой записи нет в его библиотеке. Нужен исходный аудиофайл',AUDIO_PHONE_UNREADABLE:'телефон не может прочитать файл. Проверьте разрешение на музыку',PHONE_UNAVAILABLE:'не удалось загрузить файл с телефона. Проверьте соединение'}:
        {AUDIO_NOT_ON_PHONE:'phone returned 404: this track is absent from its library. The original audio file is needed',AUDIO_PHONE_UNREADABLE:'phone cannot read the file. Check music access permission',PHONE_UNAVAILABLE:'could not download from the phone. Check the connection'};
      missing.textContent = (data.unavailable || []).map(t=>[t.artist,t.title].filter(Boolean).join(' — ')+': '+(reasons[t.code]||(ru()?'нет файла на ПК. Обновите индекс при подключённом телефоне':'file missing on this PC. Update the index with the phone connected'))).join('; ');
    } catch (error) { if(token===revision){status.textContent = error.message;start.disabled=false;stop.hidden=true;} }
    finally { if(token===revision)busy = false; }
  }
  start.onclick = () => refresh('index'); stop.onclick = () => refresh('cancel');
  refresh();
  setInterval(() => { if (!document.hidden && document.getElementById('pulseflowSettings')?.getClientRects().length) refresh(); }, 3000);
})();
