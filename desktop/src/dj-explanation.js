/* Translate the recorded decision, never recompute or invent a selection reason. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.DJExplanation=factory();})(globalThis,()=>{
  const copy={
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
