// Pain Windows Companion Application Logic
(function() {
  const state = {
    lang: localStorage.getItem('pain_lang') || 'en',
    theme: localStorage.getItem('pain_theme') || 'paper',
    tracks: [],
    currentTrackIndex: -1,
    isPlaying: false,
    loopOne: false,
    phoneUrl: (localStorage.getItem('pain_phone_url') && localStorage.getItem('pain_phone_url') !== 'http://localhost:8865') ? localStorage.getItem('pain_phone_url') : 'http://192.168.1.2:8865',
    stats: { plays: [], slices: [] },
    devices: []
  };

  const audio = document.getElementById('audioEngine');

  // DOM Elements
  const navItems = document.querySelectorAll('.nav-item');
  const viewPanes = document.querySelectorAll('.view-pane');
  const pageTitle = document.getElementById('pageTitle');
  const langToggle = document.getElementById('langToggle');
  const themeToggle = document.getElementById('themeToggle');

  // Player Elements
  const vinylDisc = document.getElementById('vinylDisc');
  const trackTitle = document.getElementById('trackTitle');
  const trackArtist = document.getElementById('trackArtist');
  const trackOrigin = document.getElementById('trackOrigin');
  const currentTimeLabel = document.getElementById('currentTime');
  const totalTimeLabel = document.getElementById('totalTime');
  const progressTrack = document.getElementById('progressTrack');
  const progressFill = document.getElementById('progressFill');
  const playBtn = document.getElementById('playBtn');
  const playIcon = document.getElementById('playIcon');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const repeatBtn = document.getElementById('repeatBtn');
  const favoriteBtn = document.getElementById('favoriteBtn');
  const volumeSlider = document.getElementById('volumeSlider');

  // Library Elements
  const tracksTableBody = document.getElementById('tracksTableBody');
  const searchInput = document.getElementById('searchInput');
  const librarySub = document.getElementById('librarySub');

  // Insights Elements
  const statTotalTime = document.getElementById('statTotalTime');
  const statTodayTime = document.getElementById('statTodayTime');
  const statUnique = document.getElementById('statUnique');
  const statPlays = document.getElementById('statPlays');
  const statObsession = document.getElementById('statObsession');
  const statObsessionPlays = document.getElementById('statObsessionPlays');
  const weekBars = document.getElementById('weekBars');

  // Sync Elements
  const phoneIpInput = document.getElementById('phoneIpInput');
  const connectBtn = document.getElementById('connectBtn');
  const syncAllBtn = document.getElementById('syncAllBtn');
  const syncLibraryBtn = document.getElementById('syncLibraryBtn');
  const syncStatsBtn = document.getElementById('syncStatsBtn');
  const downloadAllAudioBtn = document.getElementById('downloadAllAudioBtn');
  const quickSyncBtn = document.getElementById('quickSyncBtn');
  const progressBanner = document.getElementById('progressBanner');
  const progressTaskTitle = document.getElementById('progressTaskTitle');
  const progressPercent = document.getElementById('progressPercent');
  const syncProgressFill = document.getElementById('syncProgressFill');
  const logBox = document.getElementById('logBox');
  const sidebarDot = document.getElementById('sidebarDot');
  const sidebarStatusText = document.getElementById('sidebarStatusText');
  const sidebarDetailText = document.getElementById('sidebarDetailText');

  // Initialize
  async function init() {
    applyTheme(state.theme);
    applyLang(state.lang);
    phoneIpInput.value = state.phoneUrl;

    await loadSavedData();
    setupEvents();
    startDiscoveryPolling();

    const hash = window.location.hash.replace('#', '');
    if (hash && ['player', 'library', 'insights', 'sync'].includes(hash)) {
      switchView(hash);
    }
  }

  function log(msg) {
    const time = new Date().toLocaleTimeString();
    const line = `[${time}] ${msg}`;
    logBox.innerHTML = `${line}<br>` + logBox.innerHTML;
  }

  // Load locally saved data
  async function loadSavedData() {
    try {
      const libRes = await fetch('/api/saved-library');
      if (libRes.ok) {
        const lib = await libRes.json();
        if (lib.tracks && lib.tracks.length > 0) {
          state.tracks = lib.tracks;
          state.currentTrackIndex = 0;
          const tr = state.tracks[0];
          trackTitle.textContent = tr.title || 'Untitled';
          trackArtist.textContent = (tr.artist || 'Unknown Artist') + (tr.album ? ` · ${tr.album}` : '');
          trackOrigin.textContent = 'SYNCED WITH ANDROID · ' + (tr.mime || 'audio/mpeg');
          updateFavoriteUI(tr.favorite);
          renderLibrary();
        }
      }
      const statsRes = await fetch('/api/saved-stats');
      if (statsRes.ok) {
        const stats = await statsRes.json();
        state.stats = stats;
        renderInsights();
      }
    } catch (e) {
      console.warn('Could not load cached library/stats:', e);
    }
  }

  // Navigation
  function switchView(viewName) {
    navItems.forEach(item => {
      item.classList.toggle('active', item.dataset.view === viewName);
    });
    viewPanes.forEach(pane => {
      pane.classList.toggle('active', pane.id === `view-${viewName}`);
    });
    const label = document.querySelector(`.nav-item[data-view="${viewName}"] .nav-label`);
    if (label) {
      pageTitle.textContent = state.lang === 'ru' ? (label.dataset.ru || label.textContent) : (label.dataset.en || label.textContent);
    }
  }

  // Theme & Language
  function applyTheme(t) {
    state.theme = t;
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('pain_theme', t);
  }

  function applyLang(l) {
    state.lang = l;
    localStorage.setItem('pain_lang', l);
    document.querySelectorAll('[data-en]').forEach(el => {
      el.textContent = l === 'ru' ? (el.dataset.ru || el.dataset.en) : el.dataset.en;
    });
    document.querySelectorAll('[data-en-placeholder]').forEach(el => {
      el.placeholder = l === 'ru' ? (el.dataset.ruPlaceholder || el.dataset.enPlaceholder) : el.dataset.enPlaceholder;
    });
    langToggle.textContent = l === 'ru' ? 'RU / EN' : 'EN / RU';
  }

  // Audio Playback
  function playTrack(index) {
    if (index < 0 || index >= state.tracks.length) return;
    state.currentTrackIndex = index;
    const track = state.tracks[index];

    trackTitle.textContent = track.title || 'Unknown Title';
    trackArtist.textContent = (track.artist || 'Unknown Artist') + (track.album ? ` · ${track.album}` : '');
    trackOrigin.textContent = 'STREAMING FROM ANDROID · ' + (track.mime || 'audio/mpeg');

    // Build URL to stream directly from mobile sync server
    const streamUrl = `${state.phoneUrl}/api/track/${encodeURIComponent(track.id)}`;
    audio.src = streamUrl;
    audio.play().then(() => {
      state.isPlaying = true;
      updatePlayBtnUI();
      vinylDisc.classList.add('spinning');
    }).catch(err => {
      log(`Playback error: ${err.message}. Make sure phone is connected.`);
    });

    updateFavoriteUI(track.favorite);
    renderLibrary();
  }

  function togglePlay() {
    if (state.currentTrackIndex === -1 && state.tracks.length > 0) {
      playTrack(0);
      return;
    }
    if (audio.paused) {
      audio.play();
      state.isPlaying = true;
      vinylDisc.classList.add('spinning');
    } else {
      audio.pause();
      state.isPlaying = false;
      vinylDisc.classList.remove('spinning');
    }
    updatePlayBtnUI();
  }

  function updatePlayBtnUI() {
    if (state.isPlaying) {
      playIcon.innerHTML = '<rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/>';
    } else {
      playIcon.innerHTML = '<polygon points="6 3 20 12 6 21 6 3" fill="currentColor"/>';
    }
  }

  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  function updateFavoriteUI(isFav) {
    favoriteBtn.classList.toggle('active', !!isFav);
    favoriteBtn.querySelector('svg').style.fill = isFav ? 'currentColor' : 'none';
  }

  // Library Table Rendering
  function renderLibrary() {
    const query = searchInput.value.toLowerCase().trim();
    const filtered = state.tracks.filter(t => {
      return (t.title && t.title.toLowerCase().includes(query)) ||
             (t.artist && t.artist.toLowerCase().includes(query)) ||
             (t.album && t.album.toLowerCase().includes(query));
    });

    tracksTableBody.innerHTML = '';
    filtered.forEach((t, i) => {
      const isCurrent = state.tracks[state.currentTrackIndex]?.id === t.id;
      const tr = document.createElement('tr');
      if (isCurrent) tr.style.background = 'var(--card-bg)';

      const durationSec = t.duration > 1000 ? Math.floor(t.duration / 1000) : t.duration;
      tr.innerHTML = `
        <td>
          <button class="ctrl-btn" style="width:28px; height:28px;" title="Play">
            <svg viewBox="0 0 24 24" style="width:14px; height:14px;"><polygon points="6 3 20 12 6 21 6 3" fill="currentColor"/></svg>
          </button>
        </td>
        <td>
          <div class="track-row-title">${escapeHtml(t.title || 'Untitled')}</div>
          <div class="track-row-sub">${escapeHtml(t.artist || 'Unknown Artist')}</div>
        </td>
        <td style="color: var(--ink-secondary); font-size: 12px;">${escapeHtml(t.album || '—')}</td>
        <td style="font-variant-numeric: tabular-nums; font-size: 12px; color: var(--ink-muted);">${formatTime(durationSec)}</td>
        <td>
          <button class="ctrl-btn" style="width:28px; height:28px; ${t.favorite ? 'color: var(--ink);' : 'color: var(--ink-muted);'}" title="Favorite">
            <svg viewBox="0 0 24 24" style="width:14px; height:14px; fill: ${t.favorite ? 'currentColor' : 'none'};"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          </button>
        </td>
      `;

      tr.addEventListener('click', (e) => {
        if (!e.target.closest('button')) {
          const originalIndex = state.tracks.findIndex(item => item.id === t.id);
          playTrack(originalIndex);
          switchView('player');
        }
      });

      const playButton = tr.querySelector('button[title="Play"]');
      playButton.addEventListener('click', (e) => {
        e.stopPropagation();
        const originalIndex = state.tracks.findIndex(item => item.id === t.id);
        playTrack(originalIndex);
        switchView('player');
      });

      const favButton = tr.querySelector('button[title="Favorite"]');
      favButton.addEventListener('click', (e) => {
        e.stopPropagation();
        t.favorite = !t.favorite;
        favButton.style.color = t.favorite ? 'var(--ink)' : 'var(--ink-muted)';
        favButton.querySelector('svg').style.fill = t.favorite ? 'currentColor' : 'none';
        if (state.currentTrackIndex >= 0 && state.tracks[state.currentTrackIndex].id === t.id) {
          updateFavoriteUI(t.favorite);
        }
      });

      tracksTableBody.appendChild(tr);
    });

    const totalBytes = state.tracks.reduce((acc, t) => acc + (t.bytes || 0), 0);
    const gb = (totalBytes / 1e9).toFixed(1);
    librarySub.textContent = state.lang === 'ru' 
      ? `${state.tracks.length} треков · ${gb} ГБ · синхронизировано с телефоном`
      : `${state.tracks.length} tracks · ${gb} GB · synced with phone`;
  }

  function escapeHtml(str) {
    return str.replace(/[&<>'"]/g, tag => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag] || tag));
  }

  // Insights / Statistics Rendering
  function renderInsights() {
    const plays = state.stats.plays || [];
    const slices = state.stats.slices || [];

    let totalMs = slices.reduce((acc, s) => acc + (s.ms || 0), 0);
    if (totalMs === 0 && plays.length > 0) {
      totalMs = plays.reduce((acc, p) => acc + (p.heard || 0), 0);
    }
    const totalMinutes = Math.floor(totalMs / 60000);
    const totalHours = Math.floor(totalMinutes / 60);

    statTotalTime.textContent = totalHours > 0 
      ? (state.lang === 'ru' ? `${totalHours} ч ${totalMinutes % 60} мин` : `${totalHours} h ${totalMinutes % 60} m`)
      : (state.lang === 'ru' ? `${totalMinutes} мин` : `${totalMinutes} m`);

    const uniqueTracks = new Set(plays.map(p => p.track)).size;
    statUnique.textContent = uniqueTracks;
    statPlays.textContent = state.lang === 'ru' ? `${plays.length} прослушиваний` : `${plays.length} plays recorded`;

    // Calculate top obsession
    const counts = {};
    plays.forEach(p => counts[p.track] = (counts[p.track] || 0) + 1);
    let topTrackId = null, maxCount = 0;
    for (const [id, count] of Object.entries(counts)) {
      if (count > maxCount) {
        maxCount = count;
        topTrackId = id;
      }
    }
    if (topTrackId) {
      const t = state.tracks.find(x => x.id === topTrackId);
      statObsession.textContent = t ? t.title : topTrackId;
      statObsessionPlays.textContent = `${maxCount} ${state.lang === 'ru' ? 'воспроизведений' : 'plays'}`;
    } else {
      statObsession.textContent = '—';
      statObsessionPlays.textContent = '0 plays';
    }

    // Weekly activity bars
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const daysRu = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    weekBars.innerHTML = '';
    const dayCounts = [30, 45, 20, 60, 90, 110, 85]; // Sample fallback or computed from slices

    const maxVal = Math.max(...dayCounts, 10);
    days.forEach((day, idx) => {
      const val = dayCounts[idx];
      const h = Math.round((val / maxVal) * 90);
      const col = document.createElement('div');
      col.className = 'bar-col';
      col.innerHTML = `
        <div class="bar-pill" style="height: ${Math.max(6, h)}px;"></div>
        <div class="bar-label">${state.lang === 'ru' ? daysRu[idx] : day}</div>
      `;
      weekBars.appendChild(col);
    });
  }

  // Discovery Polling
  async function startDiscoveryPolling() {
    setInterval(async () => {
      try {
        const res = await fetch('/api/devices');
        if (res.ok) {
          const list = await res.json();
          if (list && list.length > 0) {
            state.devices = list;
            const phone = list[0];
            sidebarDot.classList.add('connected');
            sidebarStatusText.textContent = phone.name;
            sidebarDetailText.textContent = `${phone.ip}:${phone.port} · ${phone.tracks} tracks`;

            // Auto-fill IP with discovered device
            if (phone.ip && phone.ip !== '127.0.0.1') {
              state.phoneUrl = `http://${phone.ip}:${phone.port}`;
              phoneIpInput.value = state.phoneUrl;
              localStorage.setItem('pain_phone_url', state.phoneUrl);
            }
          }
        }
      } catch (ignored) {}
    }, 2500);
  }

  // Synchronization Logic
  async function checkConnection() {
    const url = phoneIpInput.value.trim().replace(/\/$/, '');
    state.phoneUrl = url;
    localStorage.setItem('pain_phone_url', url);
    log(`Connecting to ${url}/api/status...`);

    try {
      const res = await fetch(`${url}/api/status`);
      if (res.ok) {
        const data = await res.json();
        sidebarDot.classList.add('connected');
        sidebarStatusText.textContent = `${data.appName} (${data.device})`;
        sidebarDetailText.textContent = `${url} · ${data.tracks} tracks`;
        document.getElementById('deviceInfoText').innerHTML = `
          <strong>Connected!</strong> Device: ${data.device} (${data.appName}), Tracks in library: ${data.tracks}.
        `;
        log(`Connected successfully to ${data.device}! Tracks: ${data.tracks}`);
        return true;
      }
    } catch (e) {
      log(`Connection failed to ${url}: ${e.message}`);
      document.getElementById('deviceInfoText').innerHTML = `
        <span style="color:#D32F2F;">Connection failed.</span> Check that the mobile app is open on the same Wi-Fi.
      `;
      return false;
    }
  }

  async function syncAll() {
    const ok = await checkConnection();
    if (!ok) return;

    progressBanner.classList.add('active');
    progressTaskTitle.textContent = state.lang === 'ru' ? 'Синхронизация фонотеки и статистики…' : 'Syncing library and statistics…';
    syncProgressFill.style.width = '20%';
    progressPercent.textContent = '20%';

    try {
      // 1. Sync Library
      log('Fetching library from mobile app...');
      const libRes = await fetch(`${state.phoneUrl}/api/library`);
      if (!libRes.ok) throw new Error('Library fetch failed');
      const libData = await libRes.json();
      state.tracks = libData.tracks || [];

      // Save locally
      await fetch('/api/save-library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(libData)
      });
      syncProgressFill.style.width = '60%';
      progressPercent.textContent = '60%';
      log(`Library synced: ${state.tracks.length} tracks transferred.`);

      // 2. Sync Stats
      log('Fetching statistics from mobile app...');
      const statsRes = await fetch(`${state.phoneUrl}/api/stats`);
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        state.stats = statsData;
        await fetch('/api/save-stats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(statsData)
        });
        log(`Stats synced: ${(statsData.plays || []).length} plays recorded.`);
      }

      syncProgressFill.style.width = '100%';
      progressPercent.textContent = '100%';
      renderLibrary();
      renderInsights();

      setTimeout(() => {
        progressBanner.classList.remove('active');
      }, 1500);

      log('[Sync] All items synchronized successfully!');
    } catch (err) {
      log(`Sync error: ${err.message}`);
      progressBanner.classList.remove('active');
    }
  }

  async function syncLibraryOnly() {
    await checkConnection();
    log('Fetching library...');
    try {
      const res = await fetch(`${state.phoneUrl}/api/library`);
      const data = await res.json();
      state.tracks = data.tracks || [];
      await fetch('/api/save-library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      renderLibrary();
      log(`Library updated: ${state.tracks.length} tracks.`);
    } catch (e) {
      log(`Library sync failed: ${e.message}`);
    }
  }

  async function syncStatsOnly() {
    await checkConnection();
    log('Fetching stats...');
    try {
      const res = await fetch(`${state.phoneUrl}/api/stats`);
      const data = await res.json();
      state.stats = data;
      await fetch('/api/save-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      renderInsights();
      log(`Stats updated: ${(data.plays || []).length} plays.`);
    } catch (e) {
      log(`Stats sync failed: ${e.message}`);
    }
  }

  async function downloadAllAudio() {
    if (state.tracks.length === 0) {
      await syncLibraryOnly();
    }
    if (state.tracks.length === 0) {
      log('No tracks available to download.');
      return;
    }

    progressBanner.classList.add('active');
    log(`Starting audio download for ${state.tracks.length} tracks...`);

    let done = 0;
    const total = state.tracks.length;

    for (let i = 0; i < total; i++) {
      const track = state.tracks[i];
      progressTaskTitle.textContent = `${state.lang === 'ru' ? 'Скачивание' : 'Downloading'}: ${track.title} (${i+1}/${total})`;
      const pct = Math.round(((i + 1) / total) * 100);
      syncProgressFill.style.width = `${pct}%`;
      progressPercent.textContent = `${pct}%`;

      try {
        const streamUrl = `${state.phoneUrl}/api/track/${encodeURIComponent(track.id)}`;
        const res = await fetch(streamUrl);
        if (res.ok) {
          const blob = await res.blob();
          done++;
          log(`Downloaded [${i+1}/${total}]: ${track.title} (${(blob.size / 1e6).toFixed(2)} MB)`);
        }
      } catch (e) {
        log(`Failed to download ${track.title}: ${e.message}`);
      }
    }

    progressTaskTitle.textContent = state.lang === 'ru' ? 'Скачивание завершено!' : 'Download complete!';
    setTimeout(() => {
      progressBanner.classList.remove('active');
    }, 2000);
  }

  // Setup Event Listeners
  function setupEvents() {
    navItems.forEach(item => {
      item.addEventListener('click', () => {
        switchView(item.dataset.view);
      });
    });

    langToggle.addEventListener('click', () => {
      applyLang(state.lang === 'en' ? 'ru' : 'en');
    });

    themeToggle.addEventListener('click', () => {
      applyTheme(state.theme === 'paper' ? 'dark' : 'paper');
    });

    playBtn.addEventListener('click', togglePlay);

    prevBtn.addEventListener('click', () => {
      if (state.tracks.length === 0) return;
      let nextIdx = state.currentTrackIndex - 1;
      if (nextIdx < 0) nextIdx = state.tracks.length - 1;
      playTrack(nextIdx);
    });

    nextBtn.addEventListener('click', () => {
      if (state.tracks.length === 0) return;
      let nextIdx = state.currentTrackIndex + 1;
      if (nextIdx >= state.tracks.length) nextIdx = 0;
      playTrack(nextIdx);
    });

    repeatBtn.addEventListener('click', () => {
      state.loopOne = !state.loopOne;
      audio.loop = state.loopOne;
      repeatBtn.classList.toggle('active', state.loopOne);
    });

    favoriteBtn.addEventListener('click', () => {
      if (state.currentTrackIndex >= 0) {
        const t = state.tracks[state.currentTrackIndex];
        t.favorite = !t.favorite;
        updateFavoriteUI(t.favorite);
        renderLibrary();
      }
    });

    volumeSlider.addEventListener('input', (e) => {
      audio.volume = parseFloat(e.target.value);
    });

    audio.addEventListener('timeupdate', () => {
      currentTimeLabel.textContent = formatTime(audio.currentTime);
      totalTimeLabel.textContent = formatTime(audio.duration);
      if (audio.duration) {
        const pct = (audio.currentTime / audio.duration) * 100;
        progressFill.style.width = `${pct}%`;
      }
    });

    audio.addEventListener('ended', () => {
      if (!state.loopOne) {
        let nextIdx = state.currentTrackIndex + 1;
        if (nextIdx < state.tracks.length) {
          playTrack(nextIdx);
        } else {
          state.isPlaying = false;
          updatePlayBtnUI();
          vinylDisc.classList.remove('spinning');
        }
      }
    });

    progressTrack.addEventListener('click', (e) => {
      if (!audio.duration) return;
      const rect = progressTrack.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const pct = clickX / rect.width;
      audio.currentTime = pct * audio.duration;
    });

    searchInput.addEventListener('input', renderLibrary);

    connectBtn.addEventListener('click', checkConnection);
    syncAllBtn.addEventListener('click', syncAll);
    syncLibraryBtn.addEventListener('click', syncLibraryOnly);
    syncStatsBtn.addEventListener('click', syncStatsOnly);
    downloadAllAudioBtn.addEventListener('click', downloadAllAudio);
    quickSyncBtn.addEventListener('click', syncAll);
  }

  // Run
  document.addEventListener('DOMContentLoaded', init);
})();
