(function() {
  const q = window.painQueue, status = document.getElementById('pulseflowStatus');
  if (!q || !status) return;
  const policy = document.getElementById('pulseflowPolicy'), start = document.getElementById('pulseflowIndex'), stop = document.getElementById('pulseflowCancel');
  const install=document.getElementById('pulseflowInstall'),installCancel=document.getElementById('pulseflowInstallCancel'),runtimeHint=document.getElementById('pulseflowRuntimeHint');
  let runtimeWasInstalling=false;
  const ru = () => localStorage.getItem('pain_lang') === 'ru';
  try { const saved=localStorage.getItem('pain_pulseflow_policy');q.pulseflowPolicy=['smooth','contrast','personal','live','taste'].includes(saved)?saved:'personal'; } catch (_) {}
  policy.value = q.pulseflowPolicy;
  policy.onchange = () => {
    q.pulseflowPolicy = policy.value; if(!q.pulseflowPlan?.preview)q.pulseflowPlan = null; q.cancelPendingSelection();
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
      const runtime=data.runtime||{running:false,state:data.installed?'ready':'missing'},installed=Boolean(data.installed);
      install.hidden=installed&&!runtime.running;install.disabled=runtime.running||runtime.supported===false;
      install.textContent=runtime.running?(ru()?'Установка движка…':'Installing local analysis…'):runtime.state==='error'||runtime.state==='cancelled'?(ru()?'Повторить установку':'Retry installation'):(ru()?'Установить локальный движок':'Install local analysis');
      installCancel.hidden=!runtime.running;
      const phaseLabels=ru()?{tools:'Загрузка инструментов анализа…',python:'Подготовка локального Python…',packages:'Установка компонентов анализа…',checking:'Проверка установленного движка…'}:{tools:'Downloading analysis tools…',python:'Preparing local Python…',packages:'Installing analysis components…',checking:'Checking the installed runtime…'};
      runtimeHint.textContent=runtime.running?(ru()?'Установка идёт в фоне. Музыка и подбор по истории доступны.':'Installation runs in the background. Playback and history-based selection remain available.'):
        !installed?(runtime.state==='error'?(ru()?'Не удалось завершить установку. Проверьте подключение и повторите.':'Installation did not finish. Check your connection and retry.'):
          ru()?'Для анализа звучания нужен локальный движок. Установите его один раз этой кнопкой — терминал не нужен. Компоненты будут скачаны из интернета.':'Audio analysis needs a local runtime. Install it once with this button; no terminal is needed. Components are downloaded from the internet.'):
        (data.state==='no-audio'?(ru()?'Подключите телефон и обновите индекс либо добавьте музыкальные файлы на ПК. Подбор по истории уже доступен.':'Connect your phone and update the index, or add music files on this PC. History-based selection is already available.'):'');
      if(runtimeWasInstalling&&!runtime.running&&installed){q.refreshRecommendations();window.dispatchEvent(new Event('pain:personal-ready'));}
      runtimeWasInstalling=runtime.running;
      const labels = ru() ? { empty: 'Нужен анализ фонотеки', loading: 'Загрузка модели звучания', indexing: 'Анализ музыки', ready: 'Индекс готов', interrupted: 'Анализ прерван — можно продолжить', error: 'Не удалось завершить анализ', 'not-installed': 'Локальный анализ ещё не установлен', 'no-audio':'На этом ПК пока нет файлов для анализа' }
        : { empty: 'Index the library', loading: 'Downloading audio model', indexing: 'Analyzing audio', ready: 'Ready', interrupted: 'Indexing interrupted — resume below', error: 'Analysis did not finish', 'not-installed': 'Local analysis is not installed yet','no-audio':'No local audio files to analyze yet' };
      labels.partial = ru() ? 'Индекс готов частично' : 'Index partially ready';
      labels.preparing = ru() ? 'Подготовка файлов фонотеки' : 'Preparing library files';
      status.textContent = runtime.running?(phaseLabels[runtime.phase]||(ru()?'Подготовка движка…':'Preparing local analysis…')):!installed?labels['not-installed']:data.state==='no-audio'?labels['no-audio']:`${labels[data.state] || data.state}: ${data.indexed || 0} / ${data.total || 0}`
        + (data.failed ? ` · ${ru() ? 'Ошибок' : 'Failed'}: ${data.failed}` : '')
        + (data.current&&installed ? ` · ${data.current}` : '');
      if(runtime.running&&runtime.source)status.textContent+=' · '+runtime.source;
      if(runtime.running&&runtime.progress)status.textContent+=' '+Math.floor(runtime.progress.received/1048576)+(runtime.progress.total?' / '+Math.ceil(runtime.progress.total/1048576):'')+(ru()?' МБ':' MB');
      let personalDiagnostic='';
      if(q.pulseflowPolicy==='taste'&&installed&&!runtime.running){
        try{const response=await fetch('/api/personal/recommend',{method:'POST',headers:{'Content-Type':'application/json','X-Pain-Update':'personal'},body:JSON.stringify({action:'status'})});
          if(response.ok){const own=await response.json();personalDiagnostic=own.error||own.updateError||'';
            const label=own.state==='ready'&&own.method==='insufficient-evidence'?(ru()?'Пока мало истории — частота и лайки':'Little history yet — frequency and likes'):
              own.state==='ready'?(ru()?`Весь вкус готов · ${own.events} событий`:`Whole taste ready · ${own.events} events`):
              own.state==='updating'?(ru()?`Весь вкус работает · ${own.events} событий · обновление в фоне`:`Whole taste is active · ${own.events} events · updating in the background`):
              own.state==='training'?(ru()?'Весь вкус: первое обучение в фоне, плеер доступен':'Whole taste: initial training in the background'):
              own.state==='error'?(ru()?'Ошибка обучения · временный подбор по истории':'Training failed · temporary history-based selection'):
              (ru()?'Первый подбор обучит модель в фоне':'The first selection trains the model in the background');status.textContent+=' · '+label;}
        }catch(_){}
      }
      start.hidden=!installed||runtime.running;start.disabled = data.running || !installed || runtime.running; stop.hidden = !data.running;
      const missing = document.getElementById('pulseflowMissing');
      const reasons=ru()?{AUDIO_NOT_ON_PHONE:'телефон ответил 404: этой записи нет в его библиотеке. Нужен исходный аудиофайл',AUDIO_PHONE_UNREADABLE:'телефон не может прочитать файл. Проверьте разрешение на музыку',PHONE_UNAVAILABLE:'не удалось загрузить файл с телефона. Проверьте соединение'}:
        {AUDIO_NOT_ON_PHONE:'phone returned 404: this track is absent from its library. The original audio file is needed',AUDIO_PHONE_UNREADABLE:'phone cannot read the file. Check music access permission',PHONE_UNAVAILABLE:'could not download from the phone. Check the connection'};
      const unavailable=data.unavailable||[],details=document.getElementById('pulseflowMissingDetails');
      details.hidden=!installed||!unavailable.length;
      document.getElementById('pulseflowMissingSummary').textContent=ru()?`Недоступны для анализа: ${unavailable.length} · показать список`:`Unavailable for analysis: ${unavailable.length} · show list`;
      missing.textContent=unavailable.slice(0,10).map(t=>[t.artist,t.title].filter(Boolean).join(' — ')+': '+(reasons[t.code]||(ru()?'нет локального файла':'no local file'))).join('\n')+(unavailable.length>10?`\n${ru()?'И ещё':'And'} ${unavailable.length-10}`:'');
      const diagnostic=runtime.error||personalDiagnostic||(installed&&data.state!=='no-audio'&&!runtime.running?(data.error||data.lastError||(data.failures?.length?data.failures.slice(0,3).map(e=>e.error).join('\n'):'')):'');
      document.getElementById('pulseflowDiagnostics').hidden=!diagnostic;
      document.getElementById('pulseflowDiagnosticText').textContent=String(diagnostic||'').slice(-12000);
    } catch (error) { if(token===revision){status.textContent = error.message;start.disabled=false;stop.hidden=true;} }
    finally { if(token===revision)busy = false; }
  }
  start.onclick = () => refresh('index'); stop.onclick = () => refresh('cancel');
  const runtimeAction=async action=>{
    install.disabled=true;
    try{const response=await fetch('/api/music-runtime',{method:'POST',headers:{'Content-Type':'application/json','X-Pain-Update':'runtime'},body:JSON.stringify({action})});if(!response.ok)throw Error('Runtime action failed');await refresh();}
    catch(_){status.textContent=ru()?'Не удалось запустить установку. Повторите попытку.':'Could not start installation. Please retry.';install.disabled=false;}
  };
  install.onclick=()=>runtimeAction('install');installCancel.onclick=()=>runtimeAction('cancel');
  refresh();
  setInterval(() => { if (!document.hidden && document.getElementById('pulseflowSettings')?.getClientRects().length) refresh(); }, 3000);
})();
