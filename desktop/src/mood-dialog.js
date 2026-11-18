(function () {
  'use strict';
  const el = id => document.getElementById(id);
  const dialog = el('moodDialog');
  const options = el('moodOptions');
  const preview = el('moodPreview');
  const status = el('moodStatus');
  const playButton = el('moodPlay');
  const tasteButton = el('moodWholeTaste');
  const analyzeButton = el('moodAnalyze');
  const lang = () => localStorage.getItem('pain_lang') || 'en';
  const text = (ru, en) => lang() === 'ru' ? ru : en;
  const lastMoodKey = 'pain_last_mood';
  const bars = [...preview.querySelectorAll('i')];
  const buttons = new Map();
  let catalog = new Map(), available = new Map(), genreCache = {}, selectedId, chosenId, request, loading;
  let ranking = 0, genresLoadedAt = 0, scan, scanMessage = '';
  const attempted = new Set();
  let lastMood;
  try { lastMood = localStorage.getItem(lastMoodKey); } catch (_) {}

  const tracksFor = mood => (mood?.ids || []).map(id => available.get(id)).filter(Boolean);
  const together = () => {
    if (!window.PainTogether?.active) return false;
    status.textContent = text('Выйдите из комнаты, чтобы включить личную подборку.', 'Leave the room to play a personal mix.');
    return true;
  };

  function select(id, animate = true) {
    selectedId = id;
    const mood = catalog.get(id);
    const tracks = tracksFor(mood);
    for (const [key, button] of buttons) button.setAttribute('aria-pressed', String(key === id));
    playButton.disabled = !tracks.length;
    preview.hidden = !tracks.length;
    if (!tracks.length) return;

    el('moodPreviewTitle').textContent = mood.label + ' · ' + mood.description;
    const names = tracks.slice(0, 3).map(track => window.PainPlayer.displayTitle(track));
    const list = new Intl.ListFormat(lang()).format(names);
    const count = new Intl.NumberFormat(lang()).format(tracks.length);
    const unit = lang() === 'ru'
      ? ({one: 'трек', few: 'трека', many: 'треков'})[new Intl.PluralRules('ru').select(tracks.length)]
      : tracks.length === 1 ? 'track' : 'tracks';
    el('moodPreviewTracks').textContent = count + ' ' + unit + ' · ' + list;
    el('moodPreviewTracks').title = list;

    const shape = [...id].reduce((sum, letter) => sum + letter.charCodeAt(0), 0);
    bars.forEach((bar, i) => {
      bar.style.setProperty('--bar-index', i);
      bar.style.setProperty('--bar', (8 + (shape * (i + 2) + i * 11) % 18) + 'px');
    });
    if (animate) {
      preview.classList.remove('is-changing');
      void preview.offsetWidth;
      preview.classList.add('is-changing');
    }
  }

  function showMoods(moods) {
    catalog = new Map(moods.map(mood => [mood.id, mood]));
    for (const mood of moods) {
      let button = buttons.get(mood.id);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'mood-option';
        button.addEventListener('click', () => { chosenId = mood.id; select(chosenId); });
        buttons.set(mood.id, button);
        options.append(button);
      }
      button.textContent = mood.label;
      button.disabled = !mood.ids.some(id => available.has(id));
      button.title = button.disabled ? text('Нет подходящих треков', 'No matching tracks') : mood.description;
    }
    const first = moods.find(mood => !buttons.get(mood.id).disabled)?.id;
    const enabled = id => buttons.has(id) && !buttons.get(id).disabled;
    const current = enabled(chosenId) ? chosenId : null;
    const remembered = enabled(lastMood) ? lastMood : null;
    const preferred = current || remembered || first;
    select(preferred, !!preferred && preferred !== selectedId);
    status.textContent = scanMessage || (first ? '' : loading
      ? text('Ищем подходящие треки…', 'Finding matching tracks…')
      : !window.PainPlayer.getTracks().length
        ? text('Добавьте музыку в фонотеку.', 'Add music to your library.')
        : !available.size
          ? text('Все треки исключены из рекомендаций.', 'All tracks are excluded from recommendations.')
          : text('У этих треков пока мало данных о звучании.', 'These tracks have too little sound data yet.'));
  }

  function needsAnalysis(track) {
    if (attempted.has(String(track.id))) return false;
    const profile = window.painQueue.audioProfiles[track.id];
    return !profile || profile.frames < 20 || profile.seconds < 10 || profile.signature !== AudioProfile.signature(track);
  }

  function scanTargets() {
    const pending = [...available.values()].filter(needsAnalysis);
    const matched = new Set([...catalog.values()].flatMap(mood => mood.ids));
    pending.sort((a, b) => Number(matched.has(String(a.id))) - Number(matched.has(String(b.id))));
    const artists = new Set(), first = [], rest = [];
    for (const track of pending) {
      const name = String(track.artist || '').toLowerCase();
      (artists.has(name) ? rest : first).push(track);
      artists.add(name);
    }
    return first.concat(rest).slice(0, 16);
  }

  function updateAnalyzeButton() {
    let pending = false;
    if (!scan) for (const track of available.values()) {
      if (needsAnalysis(track)) { pending = true; break; }
    }
    analyzeButton.hidden = !scan && !pending;
    analyzeButton.textContent = scan ? text('Остановить анализ', 'Stop analysis') : text('Поискать по звучанию', 'Analyze audio for more');
  }

  async function render() {
    const player = window.PainPlayer;
    available = new Map(player.getTracks().filter(track => !player.isExcluded(track.id)).map(track => [String(track.id), track]));
    tasteButton.disabled = !available.size;
    const run = ++ranking;
    const tracks = [...available.values()];
    const settings = {genres: genreCache, profiles: window.painQueue.audioProfiles, tempos: window.painQueue.bpmCache, lang: lang()};
    try {
      const moods = await window.DJWorker.request({action: 'moods', tracks, options: settings});
      if (run === ranking && dialog.open) {
        showMoods(moods);
        updateAnalyzeButton();
      }
    } catch (_) {
      if (run !== ranking || !dialog.open) return;
      // Keep the local fallback bounded if a worker is unavailable.
      showMoods(MoodMix.build(tracks.slice(0, 1000), settings));
      updateAnalyzeButton();
    }
  }

  async function open() {
    if (dialog.open) return;
    request?.abort();
    scan?.abort();
    scan = null;
    const controller = new AbortController();
    request = controller;
    loading = Date.now() - genresLoadedAt > 30000;
    scanMessage = '';
    attempted.clear();
    selectedId = chosenId = null;
    preview.classList.remove('is-changing');
    dialog.showModal();
    if (catalog.size) showMoods([...catalog.values()]);
    else status.textContent = text('Ищем подходящие треки…', 'Finding matching tracks…');
    render();
    if (!loading) return;
    try {
      const response = await fetch('/api/genres/snapshot?tags=1', {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(2000)])
      });
      const entries = response.ok ? (await response.json()).entries : null;
      if (entries && request === controller) {
        genreCache = entries;
        genresLoadedAt = Date.now();
      }
    } catch (_) { /* Keep previously loaded tags and local audio evidence. */ }
    if (request !== controller || !dialog.open) return;
    loading = false;
    render();
  }

  playButton.addEventListener('click', () => {
    if (together()) return;
    const mood = catalog.get(selectedId);
    const player = window.PainPlayer;
    const byId = new Map(player.getTracks().map(track => [String(track.id), track]));
    const tracks = (mood?.ids || []).map(id => byId.get(id)).filter(track => track && !player.isExcluded(track.id));
    if (!tracks.length) {
      render();
      status.textContent = text('Эти треки больше недоступны.', 'These tracks are no longer available.');
      return;
    }
    lastMood = mood.id;
    try { localStorage.setItem(lastMoodKey, lastMood); } catch (_) {}
    dialog.close();
    player.playTrackInContext(tracks[0], tracks, {type: 'mood', title: mood.label});
  });
  tasteButton.addEventListener('click', () => {
    if (!together() && window.PainPlayer.playWholeTaste()) dialog.close();
  });
  analyzeButton.addEventListener('click', () => {
    if (scan) {
      scan.abort();
      scan = null;
      scanMessage = '';
      render();
      return;
    }
    const tracks = scanTargets();
    if (!tracks.length) return;
    const active = new AbortController();
    scan = active;
    let succeeded = 0;
    const started = window.PainPlayer.analyzeMoodTracks(tracks, active.signal, {
      onProgress({completed, total}) {
        scanMessage = text('Анализ звучания', 'Analyzing audio') + ' · ' + completed + ' / ' + total;
        if (status.textContent !== scanMessage) status.textContent = scanMessage;
      },
      onTrackComplete() { if (++succeeded % 4 === 1) render(); },
      onComplete(progress) {
        for (const track of tracks) attempted.add(String(track.id));
        scan = null;
        scanMessage = progress.succeeded ? ''
          : text('Не удалось прочитать звук этих треков. Проверьте доступ к файлам.', 'Could not read these tracks. Check access to the audio files.');
        render();
      }
    });
    if (!started) {
      scan = null;
      scanMessage = text('Фонотека уже анализируется. Откройте подборки чуть позже.', 'A library scan is already running. Reopen the mood picker in a moment.');
      status.textContent = scanMessage;
    }
    updateAnalyzeButton();
  });
  el('moodOpen').addEventListener('click', open);
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    request?.abort();
    scan?.abort();
    scan = null;
    ranking++;
  });
  dialog.addEventListener('keydown', event => event.stopPropagation());
  window.addEventListener('keydown', event => {
    if (event.altKey && !event.ctrlKey && !event.metaKey && event.code === 'KeyM' &&
        !event.repeat && !document.querySelector('dialog[open]')) {
      event.preventDefault();
      el('moodOpen').focus();
      open();
    }
  });
  window.PainMoods = {open};
})();
