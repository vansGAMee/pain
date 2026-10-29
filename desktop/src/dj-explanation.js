/* Translate the recorded decision, never recompute or invent a selection reason. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.DJExplanation=factory();})(globalThis,()=>{
  const copy={
    'Модель готовится · частотный подбор':['Модель обучается в фоне. Эта подборка использует частоту и лайки; её порядок сохранён.','The model is learning in the background. This mix uses frequency and likes and keeps its displayed order.','Learning · frequency fallback'],
    'Весь ваш вкус':['Обучение по всей истории и звучанию музыки.','Learns from your whole history and audio.','Your whole taste'],
    'Живой Smart DJ':['Случайный выбор из подходящих по звучанию кандидатов PulseFlow. Уже проигранные и исключённые треки отфильтрованы.','Uniform choice among matching PulseFlow candidates. Played and excluded tracks are filtered out.','Live Smart DJ'],
    'История + PulseFlow':['Сначала частота завершённых прослушиваний; при одинаковой частоте — оригинальный PulseFlow по звучанию.','Completed-listen frequency first; original PulseFlow selects by audio within equal counts.','History + PulseFlow'],
    'PulseFlow: smooth':['Оригинальный PulseFlow: ближайшие треки по CLAP-эмбеддингам звука и косинусному сходству в FAISS.','Original PulseFlow: nearest audio CLAP embeddings by FAISS cosine similarity.','PulseFlow: smooth'],
    'PulseFlow: contrast':['Оригинальный PulseFlow: чередование ближних и дальних результатов внутри найденного набора FAISS.','Original PulseFlow: alternating nearer and farther results within the retrieved FAISS candidate set.','PulseFlow: contrast'],
    'По истории прослушиваний':['Фоновый подбор недоступен; выбран трек по частоте завершённых прослушиваний в текущей очереди.','Background selection is unavailable; completed-listen frequency selects a track in the current queue.','From your listening history'],
    'Вы возвращаетесь к этому треку':['Трек получал завершённые прослушивания в вашей истории. При недостатке данных о звучании подбор опирается на эту частоту.','You have completed this track before. When sound evidence is unavailable, selection uses your completed-listen frequency.','You return to this track'],
    'Близкое звучание':['Анализ звука показал сходство с музыкой, которая сейчас служит ориентиром.','Audio analysis found a similar sound to the current reference.','Similar sound'],
    'Звучание сохранённого вайба':['По звучанию близок к сохранённому вайбу, включённому в момент подбора.','Its sound matches the saved vibe that was active when this track was picked.','Matches the saved vibe'],
    'Сочетается с вашей сессией':['Связи в вашей истории прослушиваний дают этому треку преимущество рядом с последними выбранными треками.','Connections in your listening history favour this track alongside your recent choices.','Fits this session'],
    'По вашим прослушиваниям':['Получил высокий приоритет по вашей истории прослушиваний, с учётом дослушиваний и пропусков.','Your listening history gives this track a high priority, taking completed listens and skips into account.','Based on your listening'],
    'Новое у знакомого исполнителя':['Вы уже слушали этого исполнителя, а у этого трека ещё нет учтённых прослушиваний.','You have listened to this artist, but this track has no recorded listens yet.','New from a familiar artist'],
    'Гармонический переход':['Тональность идеально сочетается по квинтовому кругу с предыдущим треком.','The musical key is harmonically compatible on the circle of fifths with the previous track.','Harmonic flow'],
    'Близкий темп':['Темп близок к треку-ориентиру; учитывается и ритм вдвое быстрее или медленнее.','The tempo is close to the reference, allowing for half-time or double-time rhythm.','Similar tempo'],
    'В настроении последних прослушанных треков':['По звуку сочетается сразу с несколькими недавними треками, которые вы приняли.','Its sound fits several recent tracks you listened to, rather than just one.','Fits your recent listening'],
    'Похоже на музыку, к которой вы возвращаетесь':['Аудиопрофиль похож на треки с положительными сигналами в вашей истории: лайками, дослушиваниями или возвращениями.','Its audio profile resembles tracks with positive signals in your history: likes, completed listens or returns.','Similar to your favourites'],
    'Похоже на первые удачные прослушивания':['По звуку похож на первые удачные прослушивания. Данных пока немного — это предварительный ориентир.','Its sound resembles your first successful listens. There is little history yet, so this is an early indication.','Fits your first listens'],
    'Давно не звучало':['Последнее учтённое прослушивание этого трека было больше трёх недель назад.','Its last recorded listen was more than three weeks ago.','Not heard in a while'],
    'Открываем новое':['Выбран менее знакомый трек, чтобы добавить разнообразия в подбор.','A less familiar track was picked to add variety to the mix.','Exploring a track'],
    'Смена направления после пропусков':['После серии пропусков подбор пробует другое направление. Это не означает, что пропущенные треки вам не нравятся.','After a run of skips, the mix is trying a different direction. This does not mean you dislike the skipped tracks.','A change of direction'],
    'Расширяем подбор':['Добавляем разнообразия: для этого трека нет одной уверенной причины предпочтения.','Adding variety: there is no single strong preference signal for this track.','Adding variety'],
    'Знакомимся с вашим вкусом':['Истории пока недостаточно для уверенного выбора. Этот трек поможет уточнить ваши предпочтения.','There is not enough history for a confident choice yet. This track can help refine your preferences.','Getting to know your taste'],
    'Любимый трек':['Вы добавили этот трек в любимые. Учитываем лайк вместе с дослушиваниями и пропусками.','You liked this track. The like is considered together with completed listens and skips.','Favorite track']
  };
  const reasons=d=>Array.isArray(d?.reasons)?[...new Set(d.reasons.filter(r=>typeof r==='string'))].slice(0,3):[];
  function summary(d,lang='ru'){const r=reasons(d)[0];if(!r)return '';return copy[r]?(lang==='ru'?r:copy[r][2]):'';}
  function describe(d,lang='ru'){
    const ru=lang==='ru',details=d?.explanation||{};
    if(details.method==='personal-taste'){
      const percent=v=>Math.round(Math.max(0,Math.min(1,v))*100)+'%';
      const facts=[ru?`Основа — вся доступная история: ${details.historyEvents} событий, а не одна предыдущая песня.`:`Based on your whole available history: ${details.historyEvents} events.`];
      if(details.listens)facts.push(ru?`Этот трек: ${details.listens} включений, ${details.completed} дослушиваний; в среднем прослушано ${percent(details.heardFraction)} уникальной длительности.`:`This track: ${details.listens} exposures, ${details.completed} completions; average unique coverage ${percent(details.heardFraction)}.`);
      else facts.push(ru?'У этого трека ещё нет учтённых прослушиваний.':'No recorded listening to this track yet.');
      if(details.liked)facts.push(ru?'Ваш лайк учтён как отдельное положительное наблюдение.':'Your like is a separate positive observation.');
      if(details.hasClap===false)facts.push(ru?(details.hasAcoustic?'CLAP-отпечатка пока нет; доступен измеренный акустический профиль.':'Измерения звучания пока нет; доступная основа — история и лайки.'):(details.hasAcoustic?'No CLAP embedding yet; a measured acoustic profile is available.':'No measured audio yet; the available basis is history and likes.'));
      if(details.audioUsed)facts.push(ru?`Внутри группы с частотой ${details.frequencyTier} учтена модель предпочтений по звуку и фактически прослушанной доле.`:`A learned audio and listening-coverage preference selects within the frequency tier ${details.frequencyTier}.`);
      else facts.push(details.evidenceReason==='insufficient-evidence'?(ru?'Окончательных наблюдений пока мало; используем лайки и частотную основу.':'Too few terminal observations; using likes and the frequency baseline.'):(ru?'Для этого подбора частотный вариант получил преимущество по наблюдённым исходам.':'Observed outcomes favored the frequency baseline for this selection.'));
      if(Number.isFinite(details.learnedShare))facts.push(ru?`Текущая доля обученного варианта в смеси — ${percent(details.learnedShare)}; проверено новых исходов: ${details.guardUpdates}.`:`Current learned-expert share: ${percent(details.learnedShare)}; observed new outcomes: ${details.guardUpdates}.`);
      if(details.audioUsed&&details.clock)facts.push(ru?'Связь вкуса с локальным временем суток включена по результату проверки на более поздней истории. Правил по часам здесь нет.':'Local time-of-day context was selected by validation on later listening. There are no fixed hourly music rules.');
      const factorNames=ru?{history:'история этого трека',scenario:'сценарий прослушивания', 'semantic-audio':'нейросетевые признаки звучания',spectrum:'спектр и динамика',timbre:'тембр',contrast:'спектральный контраст',clock:'локальное время'}:{history:'this track’s history',scenario:'listening scenario','semantic-audio':'neural audio features',spectrum:'spectrum and dynamics',timbre:'timbre',contrast:'spectral contrast',clock:'local time'};
      for(const positive of [true,false]){
        const names=(details.audioUsed?(details.factors||[]):[]).filter(f=>(f.key!=='semantic-audio'||details.hasClap!==false)&&(!['spectrum','timbre','contrast'].includes(f.key)||details.hasAcoustic!==false)).filter(f=>Number.isFinite(f.delta)&&(positive?f.delta>0:f.delta<0)).map(f=>factorNames[f.key]).filter(Boolean);
        if(names.length)facts.push((ru?(positive?'В исходной оценке модели повышали приоритет: ':'В исходной оценке модели сдерживали приоритет: '):(positive?'In the raw learned estimate, positive factors: ':'In the raw learned estimate, reducing factors: '))+names.join(', ')+'.');
      }
      const names=(details.anchors||[]).map(a=>'«'+String(a.title||'').slice(0,100)+'»');
      if(names.length)facts.push((ru?'Для сравнения звука: ближайшие дослушанные или отмеченные вами записи — ':'For audio comparison, nearest completed or liked recordings: ')+names.join(', ')+'.');
      if(details.vibe)facts.push(ru?`При выборе был включён сохранённый вайб «${String(details.vibeName||'').slice(0,100)}»; он задавал звучание подбора.`:`The saved vibe “${String(details.vibeName||'').slice(0,100)}” conditioned the sound when this choice was made.`);
      facts.push(ru?'Частотная основа сохранена. Модель выбирает между треками с одинаковой частотой. Её доля обновляется только по прогнозам, сделанным до дослушивания, и уменьшается, если частотный вариант надёжнее. Неопределённость учитывается без обязательной квоты новых песен.':'The frequency marginal is preserved. Pre-outcome forecast evidence adapts preference within equal-frequency groups, with model uncertainty and no fixed exploration quota.');
      return facts.join(' ');
    }
    const lines=reasons(d).map(r=>{
      if(r==='Близкое звучание'&&typeof details.referenceTitle==='string'&&details.referenceTitle.trim()){
        const title=details.referenceTitle.trim().slice(0,160);
        return ru?`По анализу звука близок к «${title}» — этот трек служил ориентиром при подборе.`:`Audio analysis found a similar sound to “${title}”, the reference used for this selection.`;
      }
      if(r==='Близкий темп'&&Number.isFinite(details.referenceBpm)&&details.referenceBpm>0&&Number.isFinite(d.bpm)&&d.bpm>0){
        const a=Math.round(details.referenceBpm),b=Math.round(d.bpm),half=Math.abs(a-b)>8;
        return ru?`Темп: ${b} BPM, у ориентира — ${a} BPM${half?' (с учётом удвоенного или половинного ритма)':''}.`:`Tempo: ${b} BPM; reference: ${a} BPM${half?' (allowing for half-time or double-time rhythm)':''}.`;
      }
      return copy[r]?.[ru?0:1] || r;
    }).filter(Boolean);
    if(details.liked===true&&!reasons(d).includes('Любимый трек')&&!reasons(d).includes('Вы лайкнули этот трек'))lines.push(ru?'Этот трек отмечен вашим лайком; учитываем его вместе с историей прослушиваний.':'You liked this track; we consider this alongside your listening history.');
    return lines.join(' ')||(ru?'Подробная причина этого выбора не сохранена.':'The detailed reason for this selection was not saved.');
  }
  return {describe,summary};
});
