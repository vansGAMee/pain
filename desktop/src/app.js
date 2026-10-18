// Pain Desktop Companion Application Logic
// Built for Arch Linux / Hyprland & Windows 10/11
// Warm Paper & Tactile Ink Ergonomics
(function() {
  'use strict';

  // --- APPLICATION STATE ---
  const state = {
    lang: localStorage.getItem('pain_lang') || 'en',
    theme: localStorage.getItem('pain_theme') || 'paper',
    viewMode: localStorage.getItem('pain_view_mode') || 'list',
    currentView: 'library',
    tracks: [],
    playlists: [],
    activePlaylistId: null, // null = all tracks, 'favorites' = liked songs, or playlist id
    currentTrackIndex: -1,
    currentTrackId: null,
    isPlaying: false,
    loopMode: 'all', // 'off' | 'all' | 'one'
    shuffle: false,
    shuffleMode: 'off', // 'off' | 'random' | 'smart'
    shuffledOrder: [],
    searchQuery: '',
    categoryFilter: 'all', // 'all' | 'favorites' | 'albums' | 'artists'
    sortOption: 'default',
    draggedTrackId: null,
    hasPrefetchedNext: false,
    phoneUrl: (localStorage.getItem('pain_phone_url') && localStorage.getItem('pain_phone_url') !== 'http://localhost:8865') 
      ? localStorage.getItem('pain_phone_url') 
      : 'http://192.168.1.2:8865',
    stats: { plays: [], slices: [] },
    cachedTracks: new Set(),
    devices: [],
    hasAutoSynced: false,
    lastVolume: 1.0,
    isMuted: false,

    // Web Audio Equalizer State
    eq: {
      enabled: true,
      preset: 'flat',
      preamp: 0,
      bands: [0, 0, 0, 0, 0, 0, 0, 0] // 60, 170, 310, 600, 1k, 3k, 6k, 12k Hz
    }
  };

  // Restore EQ config if saved
  try {
    const savedEq = localStorage.getItem('pain_eq_config');
    if (savedEq) {
      Object.assign(state.eq, JSON.parse(savedEq));
    }
  } catch (e) {}

  let initialBpmCache = {};
  try {
    const rawBpm = localStorage.getItem('pain_bpm_cache_v2');
    if (rawBpm) initialBpmCache = JSON.parse(rawBpm);
  } catch (e) {}

  try {
    const savedShuffle = localStorage.getItem('pain_shuffle_mode');
    if (savedShuffle) {
      state.shuffleMode = savedShuffle;
      state.shuffle = savedShuffle !== 'off';
    }
    const savedLoop = localStorage.getItem('pain_loop_mode');
    if (savedLoop) {
      state.loopMode = savedLoop;
    }
  } catch (e) {}

  // --- AUDIO & WEB AUDIO NODES ---
  const audio = document.getElementById('audioEngine');
  const QueueClass = (typeof QueueEngine !== 'undefined' && (QueueEngine.QueueEngine || QueueEngine)) || null;
  const queue = QueueClass ? new QueueClass({
    stats: state.stats,
    bpmCache: initialBpmCache,
    shuffleMode: state.shuffleMode || 'off',
    loopMode: state.loopMode || 'all',
    onQueueChange: (info) => {
      updateQueueContextUI(info);
    }
  }) : null;
  window.painQueue = queue;
  window.PainPlayer = { getTrack: () => (queue ? queue.getCurrentTrack() : state.tracks[state.currentTrackIndex]) || null };
  let audioCtx = null;
  let sourceNode = null;
  let preampNode = null;
  let filterNodes = [];
  const EQ_FREQUENCIES = [60, 170, 310, 600, 1000, 3000, 6000, 12000];

  const EQ_PRESETS = {
    flat: [0, 0, 0, 0, 0, 0, 0, 0],
    bass: [6, 5, 3, 1, 0, 0, 0, 0],
    vocal: [-2, 0, 3, 5, 4, 1, -1, -2],
    acoustic: [3, 2, 0, 1, 2, 3, 4, 3],
    electronic: [5, 4, 1, 0, 2, 4, 5, 5],
    rock: [5, 3, -1, -2, 1, 3, 5, 6],
    treble: [-2, -2, -1, 0, 2, 4, 6, 7]
  };

  // --- DOM CACHE ---
  const DOM = {
    // Nav & Shell
    navItems: document.querySelectorAll('.nav-item'),
    viewPanes: document.querySelectorAll('.view-pane'),
    langToggle: document.getElementById('langToggle'),
    themeToggle: document.getElementById('themeToggle'),
    sidebarDot: document.getElementById('sidebarDot'),
    sidebarStatusText: document.getElementById('sidebarStatusText'),
    sidebarDetailText: document.getElementById('sidebarDetailText'),
    sidebarLikedCount: document.getElementById('sidebarLikedCount'),
    sidebarLikedSongsTile: document.getElementById('sidebarLikedSongsTile'),
    sidebarPlaylistsList: document.getElementById('sidebarPlaylistsList'),
    newPlaylistBtn: document.getElementById('newPlaylistBtn'),

    // Top Bar
    searchInput: document.getElementById('searchInput'),
    searchClearBtn: document.getElementById('searchClearBtn'),
    filterChips: document.querySelectorAll('.filter-chip'),
    sortSelect: document.getElementById('sortSelect'),
    viewModeGridBtn: document.getElementById('viewModeGridBtn'),
    viewModeListBtn: document.getElementById('viewModeListBtn'),
    eqToggleBtn: document.getElementById('eqToggleBtn'),

    // Views
    tracksGrid: document.getElementById('tracksGrid'),
    tracksTableWrapper: document.getElementById('tracksTableWrapper'),
    tracksTableBody: document.getElementById('tracksTableBody'),
    libraryCountSub: document.getElementById('libraryCountSub'),
    playAllBtn: document.getElementById('playAllBtn'),

    // Favorites View
    favoritesHeroMeta: document.getElementById('favoritesHeroMeta'),
    favoritesTableBody: document.getElementById('favoritesTableBody'),
    playFavoritesBtn: document.getElementById('playFavoritesBtn'),

    // Custom Playlist View
    customPlaylistTitle: document.getElementById('customPlaylistTitle'),
    customPlaylistMeta: document.getElementById('customPlaylistMeta'),
    deletePlaylistBtn: document.getElementById('deletePlaylistBtn'),
    playPlaylistBtn: document.getElementById('playPlaylistBtn'),
    playlistTableBody: document.getElementById('playlistTableBody'),

    // Vinyl Player View
    vinylBigDisc: document.getElementById('vinylBigDisc'),
    vinylBigCoverImg: document.getElementById('vinylBigCoverImg'),
    bigTrackTitle: document.getElementById('bigTrackTitle'),
    bigTrackArtist: document.getElementById('bigTrackArtist'),
    bigTrackAlbum: document.getElementById('bigTrackAlbum'),
    bigOriginBadge: document.getElementById('bigOriginBadge'),

    // Insights View
    statTotalTime: document.getElementById('statTotalTime'),
    statTodayTime: document.getElementById('statTodayTime'),
    statUnique: document.getElementById('statUnique'),
    statPlays: document.getElementById('statPlays'),
    statPeakHour: document.getElementById('statPeakHour'),
    statPeakDesc: document.getElementById('statPeakDesc'),
    statStreak: document.getElementById('statStreak'),
    statLongestStreak: document.getElementById('statLongestStreak'),
    statStreakBadge: document.getElementById('statStreakBadge'),
    statStreakText: document.getElementById('statStreakText'),
    statCompletionRate: document.getElementById('statCompletionRate'),
    statEarlySkips: document.getElementById('statEarlySkips'),
    statDiscoveryRate: document.getElementById('statDiscoveryRate'),
    statReplayRate: document.getElementById('statReplayRate'),
    weekBars: document.getElementById('weekBars'),
    weekTotalLabel: document.getElementById('weekTotalLabel'),
    hourlyBars: document.getElementById('hourlyBars'),
    topTracksList: document.getElementById('topTracksList'),
    topArtistsList: document.getElementById('topArtistsList'),

    // Sync View
    phoneIpInput: document.getElementById('phoneIpInput'),
    connectBtn: document.getElementById('connectBtn'),
    deviceInfoText: document.getElementById('deviceInfoText'),
    syncAllBtn: document.getElementById('syncAllBtn'),
    downloadAllAudioBtn: document.getElementById('downloadAllAudioBtn'),
    clearAllCacheBtn: document.getElementById('clearAllCacheBtn'),
    cacheStatsDesc: document.getElementById('cacheStatsDesc'),
    progressBanner: document.getElementById('progressBanner'),
    progressTaskTitle: document.getElementById('progressTaskTitle'),
    progressPercent: document.getElementById('progressPercent'),
    syncProgressFill: document.getElementById('syncProgressFill'),

    // Persistent Bottom Player Bar
    bottomPlayerBar: document.getElementById('bottomPlayerBar'),
    bottomCoverImg: document.getElementById('bottomCoverImg'),
    bottomTrackTitle: document.getElementById('bottomTrackTitle'),
    bottomTrackArtist: document.getElementById('bottomTrackArtist'),
    bottomTrackContext: document.getElementById('bottomTrackContext'),
    bottomFavoriteBtn: document.getElementById('bottomFavoriteBtn'),
    bottomShuffleBtn: document.getElementById('bottomShuffleBtn'),
    bottomShuffleBadge: document.getElementById('bottomShuffleBadge'),
    bottomPrevBtn: document.getElementById('bottomPrevBtn'),
    bottomPlayBtn: document.getElementById('bottomPlayBtn'),
    bottomPlayIcon: document.getElementById('bottomPlayIcon'),
    bottomNextBtn: document.getElementById('bottomNextBtn'),
    bottomRepeatBtn: document.getElementById('bottomRepeatBtn'),
    bottomLoopBadge: document.getElementById('bottomLoopBadge'),
    currentTime: document.getElementById('currentTime'),
    totalTime: document.getElementById('totalTime'),
    progressTrack: document.getElementById('progressTrack'),
    progressFill: document.getElementById('progressFill'),
    progressThumb: document.getElementById('progressThumb'),
    bottomEqToggleBtn: document.getElementById('bottomEqToggleBtn'),
    bottomVinylToggleBtn: document.getElementById('bottomVinylToggleBtn'),
    bottomMuteBtn: document.getElementById('bottomMuteBtn'),
    volumeIcon: document.getElementById('volumeIcon'),
    volumeSlider: document.getElementById('volumeSlider'),

    // Equalizer Modal
    eqModalBackdrop: document.getElementById('eqModalBackdrop'),
    eqCloseBtn: document.getElementById('eqCloseBtn'),
    eqPowerSwitch: document.getElementById('eqPowerSwitch'),
    eqStateLabel: document.getElementById('eqStateLabel'),
    eqPresetsRow: document.getElementById('eqPresetsRow'),
    eqSliderPreamp: document.getElementById('eqSliderPreamp'),
    preampVal: document.getElementById('preampVal'),

    // New Playlist Modal
    newPlaylistModalBackdrop: document.getElementById('newPlaylistModalBackdrop'),
    newPlaylistCloseBtn: document.getElementById('newPlaylistCloseBtn'),
    newPlaylistCancelBtn: document.getElementById('newPlaylistCancelBtn'),
    newPlaylistConfirmBtn: document.getElementById('newPlaylistConfirmBtn'),
    newPlaylistNameInput: document.getElementById('newPlaylistNameInput'),

    // Add to Playlist Modal
    addToPlaylistModalBackdrop: document.getElementById('addToPlaylistModalBackdrop'),
    addToPlaylistCloseBtn: document.getElementById('addToPlaylistCloseBtn'),
    addToPlaylistCancelBtn: document.getElementById('addToPlaylistCancelBtn'),
    addToPlaylistList: document.getElementById('addToPlaylistList')
  };

  let pendingAddToPlaylistTrackId = null;

  // --- TOAST NOTIFICATIONS ---
  function showToast(message, icon = '✓') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<span style="font-size:14px;">${icon}</span> <span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('hiding');
      setTimeout(() => toast.remove(), 250);
    }, 2800);
  }

  // --- TIME-OF-DAY GREETING ---
  function updateGreeting() {
    const hour = new Date().getHours();
    let textRu, textEn, icon;
    if (hour >= 5 && hour < 12) {
      textRu = 'Доброе утро';
      textEn = 'Good morning';
      icon = '☕';
    } else if (hour >= 12 && hour < 18) {
      textRu = 'Добрый день';
      textEn = 'Good afternoon';
      icon = '☀️';
    } else if (hour >= 18 && hour < 23) {
      textRu = 'Добрый вечер';
      textEn = 'Good evening';
      icon = '🌙';
    } else {
      textRu = 'Доброй ночи';
      textEn = 'Good night';
      icon = '✨';
    }
    const greetingEl = document.getElementById('viewGreeting');
    if (greetingEl) {
      const isRu = state.lang === 'ru';
      greetingEl.innerHTML = `<span class="greeting-icon">${icon}</span> <span class="greeting-text">${isRu ? textRu : textEn}</span>`;
    }
  }

  // --- CACHE MANAGEMENT ---
  async function loadCachedTracksList() {
    try {
      const res = await fetch('/api/cached-tracks');
      if (res.ok) {
        const data = await res.json();
        state.cachedTracks = new Set(data.cached || []);
        if (DOM.cacheStatsDesc) {
          DOM.cacheStatsDesc.textContent = state.lang === 'ru'
            ? `${state.cachedTracks.size} файлов сохранено на диске`
            : `${state.cachedTracks.size} audio files cached on disk`;
        }
      }
    } catch (e) {}
  }

  async function deleteTrackFromCache(trackId, trackTitle) {
    try {
      const res = await fetch('/api/delete-cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackId })
      });
      const data = await res.json();
      if (data.status === 'ok') {
        const safeId = trackId.replace(/[/\\?%*:|"<>]/g, '_');
        state.cachedTracks.delete(safeId);
        const msg = state.lang === 'ru' 
          ? `«${trackTitle || 'Трек'}» удалён из кэша` 
          : `"${trackTitle || 'Track'}" removed from cache`;
        showToast(msg, '🗑️');
        renderCurrentView();
      }
    } catch (e) {
      console.warn('Delete cache error:', e);
    }
  }

  async function clearAllCache() {
    const confirmMsg = state.lang === 'ru' 
      ? 'Очистить весь локальный кэш аудио на ПК?' 
      : 'Clear all local audio cache on PC?';
    if (!confirm(confirmMsg)) return;
    try {
      const res = await fetch('/api/delete-cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearAll: true })
      });
      const data = await res.json();
      if (data.status === 'ok') {
        state.cachedTracks.clear();
        const msg = state.lang === 'ru' 
          ? `Удалено ${data.cleared} файлов из кэша` 
          : `Cleared ${data.cleared} files from cache`;
        showToast(msg, '🗑️');
        if (DOM.cacheStatsDesc) {
          DOM.cacheStatsDesc.textContent = state.lang === 'ru' ? '0 файлов в кэше' : '0 files cached';
        }
        renderCurrentView();
      }
    } catch (e) {
      console.warn('Clear all cache error:', e);
    }
  }

  // --- INITIALIZATION ---
  async function init() {
    applyTheme(state.theme);
    applyLang(state.lang);
    applyViewMode(state.viewMode);

    DOM.phoneIpInput.value = state.phoneUrl;
    initEqualizerUI();

    if (state.loopMode === 'all') {
      DOM.bottomRepeatBtn.classList.add('active');
      DOM.bottomRepeatBtn.title = 'Repeat All';
      if (DOM.bottomLoopBadge) DOM.bottomLoopBadge.style.display = 'none';
    } else if (state.loopMode === 'one') {
      DOM.bottomRepeatBtn.classList.add('active');
      DOM.bottomRepeatBtn.title = 'Repeat One';
      if (DOM.bottomLoopBadge) DOM.bottomLoopBadge.style.display = 'block';
    } else {
      DOM.bottomRepeatBtn.classList.remove('active');
      if (DOM.bottomLoopBadge) DOM.bottomLoopBadge.style.display = 'none';
    }

    if (DOM.bottomShuffleBtn) {
      const mode = queue ? queue.getShuffleMode() : state.shuffleMode;
      DOM.bottomShuffleBtn.classList.toggle('active', mode !== 'off');
      DOM.bottomShuffleBtn.classList.toggle('smart-mode', mode === 'smart');
      if (DOM.bottomShuffleBadge) {
        let badge = '';
        if (mode === 'smart') badge = 'DJ';
        else if (mode === 'random') badge = '🔀';
        DOM.bottomShuffleBadge.textContent = badge;
        DOM.bottomShuffleBadge.classList.toggle('active', !!badge);
        DOM.bottomShuffleBadge.classList.toggle('smart-badge', mode === 'smart');
      }
    }

    await loadLocalData();
    await loadCachedTracksList();
    updateGreeting();
    setupEventListeners();
    window.addEventListener('pain:show-player',()=>switchView('player'));
    startDiscoveryPolling();

    // Check query parameters and URL Hash for deep-linking
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('mode') === 'grid') applyViewMode('grid');
    if (urlParams.get('mode') === 'list') applyViewMode('list');

    const hash = window.location.hash.replace('#', '');
    if (hash && ['library', 'favorites', 'player', 'insights', 'sync'].includes(hash)) {
      switchView(hash);
    } else {
      switchView('library');
    }

    if (urlParams.get('eq') === '1') {
      setTimeout(() => {
        DOM.eqModalBackdrop.style.display = 'flex';
      }, 300);
    }
  }

  // --- WEB AUDIO API EQUALIZER ---
  function initAudioNodes() {
    if (audioCtx) return;
    try {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioCtxClass();
      sourceNode = audioCtx.createMediaElementSource(audio);
      preampNode = audioCtx.createGain();

      let lastNode = sourceNode;
      lastNode.connect(preampNode);
      lastNode = preampNode;

      filterNodes = EQ_FREQUENCIES.map((freq, index) => {
        const filter = audioCtx.createBiquadFilter();
        if (index === 0) {
          filter.type = 'lowshelf';
        } else if (index === EQ_FREQUENCIES.length - 1) {
          filter.type = 'highshelf';
        } else {
          filter.type = 'peaking';
          filter.Q.value = 1.2;
        }
        filter.frequency.value = freq;
        filter.gain.value = 0;

        lastNode.connect(filter);
        lastNode = filter;
        return filter;
      });

      lastNode.connect(audioCtx.destination);
      applyEqualizerAudioGains();
    } catch (err) {
      console.warn('Web Audio API Equalizer initialization deferred or unsupported:', err);
    }
  }

  function applyEqualizerAudioGains() {
    if (!audioCtx || !preampNode) return;
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }

    if (state.eq.enabled) {
      const gainMult = Math.pow(10, (state.eq.preamp || 0) / 20);
      preampNode.gain.setTargetAtTime(gainMult, audioCtx.currentTime, 0.02);
      filterNodes.forEach((node, i) => {
        const val = state.eq.bands[i] || 0;
        node.gain.setTargetAtTime(val, audioCtx.currentTime, 0.02);
      });
    } else {
      preampNode.gain.setTargetAtTime(1.0, audioCtx.currentTime, 0.02);
      filterNodes.forEach(node => {
        node.gain.setTargetAtTime(0, audioCtx.currentTime, 0.02);
      });
    }
  }

  function initEqualizerUI() {
    DOM.eqPowerSwitch.checked = state.eq.enabled;
    DOM.eqStateLabel.textContent = state.eq.enabled ? (state.lang === 'ru' ? 'ВКЛ' : 'ON') : (state.lang === 'ru' ? 'ВЫКЛ' : 'OFF');

    DOM.eqSliderPreamp.value = state.eq.preamp;
    DOM.preampVal.textContent = `${state.eq.preamp > 0 ? '+' : ''}${state.eq.preamp}dB`;

    for (let i = 0; i < 8; i++) {
      const slider = document.querySelector(`.eq-v-slider[data-band="${i}"]`);
      const valLabel = document.getElementById(`eqVal${i}`);
      const val = state.eq.bands[i] || 0;
      if (slider) slider.value = val;
      if (valLabel) valLabel.textContent = `${val > 0 ? '+' : ''}${val}dB`;
    }

    updatePresetChipsUI();
  }

  function updatePresetChipsUI() {
    document.querySelectorAll('.eq-preset-chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.preset === state.eq.preset);
    });
  }

  function saveEqualizerState() {
    localStorage.setItem('pain_eq_config', JSON.stringify(state.eq));
    applyEqualizerAudioGains();
  }

  // --- PROCEDURAL WARM PAPER VINYL COVER ART GENERATOR ---
  const coverCache = new Map();

  function getProceduralCoverSvg(track) {
    if (!track) track = { title: 'Pain', artist: 'Audio' };
    const key = track.id || (track.title + track.artist);
    if (coverCache.has(key)) return coverCache.get(key);

    // Deterministic hash
    let hash = 0;
    const str = (track.title || 'Pain') + (track.artist || 'Audio');
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    const absHash = Math.abs(hash);

    // Warm minimalist paper tone palettes
    const paperBgs = ['#EAE7DF', '#E2DFD5', '#DCD8CE', '#E7E4DC', '#DDD8CD', '#ECE9E1'];
    const labelBgs = ['#FAF9F6', '#1C1C1A', '#EFEDE6', '#E4E1D7'];
    const bg = paperBgs[absHash % paperBgs.length];
    const labelBg = labelBgs[(absHash >> 2) % labelBgs.length];
    const isDarkLabel = labelBg === '#1C1C1A';
    const textFill = isDarkLabel ? '#EFEDE6' : '#1C1C1A';

    // Monogram (1 or 2 uppercase letters)
    let monogram = '';
    if (track.title) {
      const words = track.title.trim().split(/\s+/);
      if (words.length >= 2) {
        monogram = (words[0][0] + words[1][0]).toUpperCase();
      } else if (words[0].length >= 2) {
        monogram = words[0].substring(0, 2).toUpperCase();
      } else {
        monogram = words[0].toUpperCase();
      }
    } else {
      monogram = 'P';
    }

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
        <rect width="200" height="200" fill="${bg}"/>
        <!-- Subtle Vinyl Grooves -->
        <circle cx="100" cy="100" r="88" fill="none" stroke="#1C1C1A" stroke-width="0.75" opacity="0.08"/>
        <circle cx="100" cy="100" r="76" fill="none" stroke="#1C1C1A" stroke-width="0.75" opacity="0.07"/>
        <circle cx="100" cy="100" r="64" fill="none" stroke="#1C1C1A" stroke-width="0.75" opacity="0.08"/>
        <circle cx="100" cy="100" r="52" fill="none" stroke="#1C1C1A" stroke-width="0.75" opacity="0.09"/>
        <circle cx="100" cy="100" r="42" fill="none" stroke="#1C1C1A" stroke-width="0.75" opacity="0.07"/>
        <!-- Center Disc Label -->
        <circle cx="100" cy="100" r="32" fill="${labelBg}" stroke="#1C1C1A" stroke-width="0.8" opacity="0.95"/>
        <!-- Spindle Hole -->
        <circle cx="100" cy="100" r="5.5" fill="${bg}" stroke="#1C1C1A" stroke-width="1.2"/>
        <!-- Monogram -->
        <text x="100" y="86" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-size="14" font-weight="700" letter-spacing="-0.5" fill="${textFill}">${escapeXml(monogram)}</text>
        <!-- Minimal Track Label -->
        <text x="100" y="122" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-size="6.5" font-weight="600" letter-spacing="1" fill="${textFill}" opacity="0.75">PAIN AUDIO</text>
      </svg>
    `.trim();

    const dataUri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    coverCache.set(key, dataUri);
    return dataUri;
  }

  function getCoverUrl(track) {
    if (!track) return '/assets/app-icon.png';
    return `/api/cover/${encodeURIComponent(track.id)}`;
  }

  function escapeXml(str) {
    return String(str || '').replace(/[&<>'"]/g, tag => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&apos;', '"': '&quot;'
    }[tag] || tag));
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>'"]/g, tag => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag] || tag));
  }

  function formatTime(seconds) {
    if (!seconds || isNaN(seconds) || !isFinite(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  // --- DATA LOADING & PERSISTENCE ---
  async function loadLocalData() {
    try {
      // 1. Library
      const libRes = await fetch('/api/saved-library');
      if (libRes.ok) {
        const lib = await libRes.json();
        if (lib.tracks && Array.isArray(lib.tracks)) {
          state.tracks = lib.tracks;
        }
      }

      // 2. Playlists
      const plRes = await fetch('/api/playlists');
      if (plRes.ok) {
        const pls = await plRes.json();
        if (Array.isArray(pls)) {
          state.playlists = pls;
        }
      }

      // 3. Stats
      const statsRes = await fetch('/api/saved-stats');
      if (statsRes.ok) {
        const st = await statsRes.json();
        if (st) {
          state.stats = st;
          if (queue) setQueueTasteStats(st);
        }
      }

      // Refresh UI components
      renderPlaylistsSidebar();
      updateSidebarLikedCount();
      renderCurrentView();
      renderInsights();

      // If library is populated, prepare first track in player bar
      if (state.tracks.length > 0 && state.currentTrackIndex === -1) {
        state.currentTrackIndex = 0;
        state.currentTrackId = state.tracks[0].id;
        if (queue && queue.getTracks().length === 0) {
          queue.setContext('library', state.tracks, 0, state.lang === 'ru' ? 'Фонотека' : 'Library');
        }
        updatePlayerBarUI(state.tracks[0], false);
      }
    } catch (e) {
      console.warn('Error loading local data:', e);
    }
  }

  // --- NAVIGATION & VIEW SWITCHING ---
  function switchView(viewName, playlistId = null) {
    state.currentView = viewName;
    state.activePlaylistId = playlistId;

    DOM.navItems.forEach(item => {
      item.classList.toggle('active', item.dataset.view === viewName && !playlistId);
    });

    // Sidebar custom playlist items active state
    document.querySelectorAll('.custom-playlist-item').forEach(el => {
      el.classList.toggle('active', el.dataset.id === playlistId);
    });

    DOM.sidebarLikedSongsTile.classList.toggle('active', viewName === 'favorites');

    DOM.viewPanes.forEach(pane => {
      pane.classList.remove('active');
    });

    const targetPane = document.getElementById(`view-${viewName}`);
    if (targetPane) {
      targetPane.classList.add('active');
    }

    renderCurrentView();
    window.location.hash = playlistId ? `playlist=${playlistId}` : viewName;
  }

  function renderCurrentView() {
    if (state.currentView === 'library') {
      renderLibrary();
    } else if (state.currentView === 'favorites') {
      renderFavoritesView();
    } else if (state.currentView === 'playlist') {
      renderCustomPlaylistView();
    } else if (state.currentView === 'player') {
      renderVinylPlayerView();
    } else if (state.currentView === 'insights') {
      renderInsights();
    }
  }

  // --- VIEW MODE: GRID VS LIST ---
  function applyViewMode(mode) {
    state.viewMode = mode;
    localStorage.setItem('pain_view_mode', mode);

    DOM.viewModeGridBtn.classList.toggle('active', mode === 'grid');
    DOM.viewModeListBtn.classList.toggle('active', mode === 'list');

    if (mode === 'grid') {
      DOM.tracksGrid.style.display = 'grid';
      DOM.tracksTableWrapper.style.display = 'none';
    } else {
      DOM.tracksGrid.style.display = 'none';
      DOM.tracksTableWrapper.style.display = 'block';
    }

    renderLibrary();
  }

  // --- FILTERING & SORTING LOGIC ---
  function getProcessedTracks(trackList) {
    if (!Array.isArray(trackList)) return [];
    let list = [...trackList];

    // 1. Search Query
    const q = state.searchQuery.toLowerCase().trim();
    if (q) {
      list = list.filter(t => {
        return (t.title && t.title.toLowerCase().includes(q)) ||
               (t.artist && t.artist.toLowerCase().includes(q)) ||
               (t.album && t.album.toLowerCase().includes(q));
      });
    }

    // 2. Category Filter
    if (state.categoryFilter === 'favorites') {
      list = list.filter(t => !!t.favorite);
    } else if (state.categoryFilter === 'albums') {
      list = list.filter(t => !!t.album);
    }

    // 3. Sorting
    switch (state.sortOption) {
      case 'title-asc':
        list.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
        break;
      case 'title-desc':
        list.sort((a, b) => (b.title || '').localeCompare(a.title || ''));
        break;
      case 'artist-asc':
        list.sort((a, b) => (a.artist || '').localeCompare(b.artist || '') || (a.title || '').localeCompare(b.title || ''));
        break;
      case 'album-asc':
        list.sort((a, b) => (a.album || '').localeCompare(b.album || '') || (a.title || '').localeCompare(b.title || ''));
        break;
      case 'duration-asc':
        list.sort((a, b) => (a.duration || 0) - (b.duration || 0));
        break;
      case 'duration-desc':
        list.sort((a, b) => (b.duration || 0) - (a.duration || 0));
        break;
      case 'plays-desc':
        list.sort((a, b) => getTrackPlayCount(b.id) - getTrackPlayCount(a.id));
        break;
      case 'favorites-first':
        list.sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || (a.title || '').localeCompare(b.title || ''));
        break;
      default:
        // Default order
        break;
    }

    return list;
  }

  function getTrackPlayCount(trackId) {
    if (!trackId || !state.stats || !state.stats.plays) return 0;
    return state.stats.plays.filter(p => p.track === trackId).length;
  }

  // --- LIBRARY RENDERING ---
  function renderLibrary() {
    const processed = getProcessedTracks(state.tracks);

    // Update Header Counter
    const totalBytes = state.tracks.reduce((acc, t) => acc + (t.bytes || 0), 0);
    const gb = (totalBytes / 1e9).toFixed(1);
    DOM.libraryCountSub.textContent = state.lang === 'ru'
      ? `${processed.length} из ${state.tracks.length} треков · ${gb} ГБ · синхронизировано с телефоном`
      : `${processed.length} of ${state.tracks.length} tracks · ${gb} GB · synced with phone`;

    const contextInfo = { type: 'library', title: state.lang === 'ru' ? 'Фонотека' : 'Library', id: 'library' };
    if (state.viewMode === 'grid') {
      renderTracksGrid(DOM.tracksGrid, processed, contextInfo);
    } else {
      renderTracksTable(DOM.tracksTableBody, processed, true, contextInfo);
    }
  }

  // --- RENDERING: LIST TABLE WITH DRAG & DROP ---
  function renderTracksTable(container, trackList, enableDragAndDrop = true, contextInfo = null) {
    container.innerHTML = '';

    if (trackList.length === 0) {
      container.innerHTML = `
        <tr>
          <td colspan="7" style="text-align:center; padding: 40px; color: var(--ink-secondary); font-size: 13px;">
            ${state.lang === 'ru' ? 'Нет треков для отображения' : 'No tracks to display'}
          </td>
        </tr>
      `;
      return;
    }

    trackList.forEach((track, index) => {
      const isCurrent = state.currentTrackId === track.id;
      const isPlayingCurrent = isCurrent && state.isPlaying;
      const durationSec = Math.max(0, Number(track.duration) || 0) / 1000;
      const plays = getTrackPlayCount(track.id);

      const tr = document.createElement('tr');
      tr.dataset.trackId = track.id;
      tr.dataset.index = index;
      if (enableDragAndDrop && state.sortOption === 'default' && !state.searchQuery) {
        tr.draggable = true;
      }
      if (isCurrent) tr.classList.add('playing-row');

      tr.innerHTML = `
        <td class="col-index">
          <div class="index-cell-wrapper">
            <svg class="drag-grip-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>
            <span class="index-num">${isPlayingCurrent ? '▶' : index + 1}</span>
          </div>
        </td>
        <td class="col-cover">
          <img class="row-thumb-img" src="${getCoverUrl(track)}" alt="" loading="lazy">
        </td>
        <td class="col-title">
          <div class="track-row-title ${isCurrent ? 'active-text' : ''}">${escapeHtml(track.title || 'Untitled')}</div>
          <div class="track-row-sub">${escapeHtml(track.artist || 'Unknown Artist')}</div>
        </td>
        <td class="col-album">${escapeHtml(track.album || '—')}</td>
        <td class="col-plays">${plays}</td>
        <td class="col-time">${formatTime(durationSec)}</td>
        <td class="col-actions">
          <button class="row-fav-btn ${track.favorite ? 'active' : ''}" title="${state.lang === 'ru' ? 'В избранное' : 'Favorite'}">
            <svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
          </button>
          <button class="row-more-btn" title="${state.lang === 'ru' ? 'В плейлист' : 'Add to Playlist'}">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
          <button class="row-uncache-btn" title="${state.lang === 'ru' ? 'Удалить из кэша' : 'Delete from Cache'}">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
          </button>
        </td>
      `;

      // Thumbnail error fallback
      const thumbImg = tr.querySelector('.row-thumb-img');
      if (thumbImg) {
        thumbImg.onerror = () => {
          thumbImg.onerror = null;
          thumbImg.src = getProceduralCoverSvg(track);
        };
      }

      // Click to play
      tr.addEventListener('click', (e) => {
        if (!e.target.closest('button')) {
          playTrackInContext(track, trackList, contextInfo);
        }
      });

      // Favorite button
      const favBtn = tr.querySelector('.row-fav-btn');
      favBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(track.id);
      });

      // Add to playlist button
      const moreBtn = tr.querySelector('.row-more-btn');
      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openAddToPlaylistModal(track.id);
      });

      // Uncache button
      const uncacheBtn = tr.querySelector('.row-uncache-btn');
      uncacheBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteTrackFromCache(track.id, track.title);
      });

      // Drag and drop reordering
      if (tr.draggable) {
        tr.addEventListener('dragstart', handleDragStart);
        tr.addEventListener('dragover', handleDragOver);
        tr.addEventListener('dragleave', handleDragLeave);
        tr.addEventListener('drop', handleDrop);
        tr.addEventListener('dragend', handleDragEnd);
      }

      container.appendChild(tr);
    });
  }

  // --- RENDERING: GRID CARDS ---
  function renderTracksGrid(container, trackList, contextInfo = null) {
    container.innerHTML = '';

    if (trackList.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 48px; color: var(--ink-secondary); font-size: 13px;">
          ${state.lang === 'ru' ? 'Нет треков для отображения' : 'No tracks to display'}
        </div>
      `;
      return;
    }

    trackList.forEach(track => {
      const isCurrent = state.currentTrackId === track.id;
      const isPlayingCurrent = isCurrent && state.isPlaying;
      const durationSec = Math.max(0, Number(track.duration) || 0) / 1000;

      const card = document.createElement('div');
      card.className = `track-card ${isCurrent ? 'playing-card' : ''}`;
      card.dataset.trackId = track.id;

      card.innerHTML = `
        <div class="track-card-cover-wrapper">
          <img class="track-card-img" src="${getCoverUrl(track)}" alt="">
          <div class="track-card-play-overlay">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              ${isPlayingCurrent 
                ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>' 
                : '<polygon points="6 3 20 12 6 21 6 3"/>'}
            </svg>
          </div>
        </div>
        <div class="track-card-title ${isCurrent ? 'active-text' : ''}">${escapeHtml(track.title || 'Untitled')}</div>
        <div class="track-card-artist">${escapeHtml(track.artist || 'Unknown Artist')}</div>
        <div class="track-card-footer">
          <span class="track-card-duration">${formatTime(durationSec)}</span>
          <div style="display: flex; gap: 4px; align-items: center;">
            <button class="card-add-btn" title="${state.lang === 'ru' ? 'В плейлист' : 'Add to Playlist'}">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
            <button class="card-uncache-btn" title="${state.lang === 'ru' ? 'Удалить из кэша' : 'Delete from Cache'}">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
            <button class="card-fav-btn ${track.favorite ? 'active' : ''}" title="${state.lang === 'ru' ? 'В избранное' : 'Favorite'}">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="${track.favorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
            </button>
          </div>
        </div>
      `;

      // Cover error fallback
      const cardImg = card.querySelector('.track-card-img');
      if (cardImg) {
        cardImg.onerror = () => {
          cardImg.onerror = null;
          cardImg.src = getProceduralCoverSvg(track);
        };
      }

      card.addEventListener('click', (e) => {
        if (!e.target.closest('button')) {
          playTrackInContext(track, trackList, contextInfo);
        }
      });

      const playOverlay = card.querySelector('.track-card-play-overlay');
      playOverlay.addEventListener('click', (e) => {
        e.stopPropagation();
        playTrackInContext(track, trackList, contextInfo);
      });

      const favBtn = card.querySelector('.card-fav-btn');
      favBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(track.id);
      });

      const addBtn = card.querySelector('.card-add-btn');
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openAddToPlaylistModal(track.id);
      });

      const uncacheBtn = card.querySelector('.card-uncache-btn');
      uncacheBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteTrackFromCache(track.id, track.title);
      });

      container.appendChild(card);
    });
  }

  // --- DRAG AND DROP REORDERING HANDLERS ---
  function handleDragStart(e) {
    const tr = e.target.closest('tr');
    if (!tr) return;
    state.draggedTrackId = tr.dataset.trackId;
    tr.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', tr.dataset.trackId);
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const tr = e.target.closest('tr');
    if (!tr || tr.dataset.trackId === state.draggedTrackId) return;

    const rect = tr.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (e.clientY < midY) {
      tr.classList.add('drag-over-top');
      tr.classList.remove('drag-over-bottom');
    } else {
      tr.classList.add('drag-over-bottom');
      tr.classList.remove('drag-over-top');
    }
  }

  function handleDragLeave(e) {
    const tr = e.target.closest('tr');
    if (tr) {
      tr.classList.remove('drag-over-top', 'drag-over-bottom');
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    const targetTr = e.target.closest('tr');
    if (!targetTr || !state.draggedTrackId) return;

    const sourceId = state.draggedTrackId;
    const targetId = targetTr.dataset.trackId;
    if (sourceId === targetId) return;

    const rect = targetTr.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const insertAfter = e.clientY >= midY;

    // Handle reordering in main library or active custom playlist
    if (state.activePlaylistId && state.activePlaylistId !== 'favorites') {
      const pl = state.playlists.find(p => p.id === state.activePlaylistId);
      if (pl && pl.trackIds) {
        const fromIdx = pl.trackIds.indexOf(sourceId);
        if (fromIdx !== -1) {
          pl.trackIds.splice(fromIdx, 1);
          let toIdx = pl.trackIds.indexOf(targetId);
          if (insertAfter) toIdx++;
          pl.trackIds.splice(toIdx, 0, sourceId);
          savePlaylistsToServer();
          renderCustomPlaylistView();
        }
      }
    } else {
      // Reorder in state.tracks
      const fromIdx = state.tracks.findIndex(t => t.id === sourceId);
      if (fromIdx !== -1) {
        const [movedTrack] = state.tracks.splice(fromIdx, 1);
        let toIdx = state.tracks.findIndex(t => t.id === targetId);
        if (insertAfter) toIdx++;
        state.tracks.splice(toIdx, 0, movedTrack);

        // Update currentTrackIndex if affected
        state.currentTrackIndex = state.tracks.findIndex(t => t.id === state.currentTrackId);

        // Persist to local library.json
        saveLibraryToServer();
        renderLibrary();
      }
    }

    cleanDragStyles();
  }

  function handleDragEnd() {
    state.draggedTrackId = null;
    cleanDragStyles();
  }

  function cleanDragStyles() {
    document.querySelectorAll('.tracks-table tbody tr').forEach(tr => {
      tr.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom');
    });
  }

  // --- FAVORITES / LIKED SONGS VIEW ---
  function renderFavoritesView() {
    const likedTracks = state.tracks.filter(t => !!t.favorite);
    DOM.favoritesHeroMeta.textContent = state.lang === 'ru' 
      ? `${likedTracks.length} треков в избранном`
      : `${likedTracks.length} liked tracks`;

    const contextInfo = { type: 'favorites', title: state.lang === 'ru' ? 'Избранное' : 'Favorites', id: 'favorites' };
    renderTracksTable(DOM.favoritesTableBody, likedTracks, false, contextInfo);
  }

  // --- CUSTOM PLAYLISTS ---
  function renderPlaylistsSidebar() {
    DOM.sidebarPlaylistsList.innerHTML = '';

    state.playlists.forEach(pl => {
      const count = (pl.trackIds || []).length;
      const li = document.createElement('li');
      li.className = `custom-playlist-item ${state.activePlaylistId === pl.id ? 'active' : ''}`;
      li.dataset.id = pl.id;

      li.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
        <span class="custom-pl-title">${escapeHtml(pl.name)}</span>
        <span class="custom-pl-count">${count}</span>
      `;

      li.addEventListener('click', () => {
        switchView('playlist', pl.id);
      });

      DOM.sidebarPlaylistsList.appendChild(li);
    });
  }

  function renderCustomPlaylistView() {
    const pl = state.playlists.find(p => p.id === state.activePlaylistId);
    if (!pl) {
      switchView('library');
      return;
    }

    DOM.customPlaylistTitle.textContent = pl.name;
    const trackCount = (pl.trackIds || []).length;
    DOM.customPlaylistMeta.textContent = state.lang === 'ru'
      ? `${trackCount} треков · кастомный плейлист`
      : `${trackCount} tracks · custom playlist`;

    const plTracks = (pl.trackIds || []).map(id => state.tracks.find(t => t.id === id)).filter(Boolean);
    const contextInfo = { type: 'playlist', title: pl.name, id: pl.id };
    renderTracksTable(DOM.playlistTableBody, plTracks, true, contextInfo);
  }

  function createNewPlaylist(name) {
    if (!name || !name.trim()) return;
    const newPl = {
      id: 'pl_' + Date.now(),
      name: name.trim(),
      trackIds: []
    };
    state.playlists.push(newPl);
    savePlaylistsToServer();
    renderPlaylistsSidebar();
    switchView('playlist', newPl.id);
  }

  function deleteActivePlaylist() {
    if (!state.activePlaylistId) return;
    const confirmed = confirm(state.lang === 'ru' ? 'Удалить этот плейлист?' : 'Delete this playlist?');
    if (!confirmed) return;

    state.playlists = state.playlists.filter(p => p.id !== state.activePlaylistId);
    savePlaylistsToServer();
    renderPlaylistsSidebar();
    switchView('library');
  }

  function openAddToPlaylistModal(trackId) {
    pendingAddToPlaylistTrackId = trackId;
    DOM.addToPlaylistList.innerHTML = '';

    if (state.playlists.length === 0) {
      DOM.addToPlaylistList.innerHTML = `
        <div class="add-playlist-empty">
          ${state.lang === 'ru' ? 'Сначала создайте плейлист в боковом меню (+).' : 'Create a playlist first using the (+) button.'}
        </div>
      `;
    } else {
      state.playlists.forEach(pl => {
        const hasTrack = (pl.trackIds || []).includes(trackId);
        const btn = document.createElement('button');
        btn.className = 'add-playlist-item-btn';
        btn.innerHTML = `
          <span>${escapeHtml(pl.name)}</span>
          <span style="font-size: 11px; opacity: 0.7;">${hasTrack ? '✓ Added' : '+ Add'}</span>
        `;
        btn.addEventListener('click', () => {
          if (!pl.trackIds) pl.trackIds = [];
          if (!pl.trackIds.includes(trackId)) {
            pl.trackIds.push(trackId);
            savePlaylistsToServer();
            renderPlaylistsSidebar();
          }
          closeAddToPlaylistModal();
        });
        DOM.addToPlaylistList.appendChild(btn);
      });
    }

    DOM.addToPlaylistModalBackdrop.style.display = 'flex';
  }

  function closeAddToPlaylistModal() {
    pendingAddToPlaylistTrackId = null;
    DOM.addToPlaylistModalBackdrop.style.display = 'none';
  }

  async function savePlaylistsToServer() {
    try {
      await fetch('/api/playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.playlists)
      });
    } catch (e) {
      console.warn('Failed to save playlists:', e);
    }
  }

  async function saveLibraryToServer() {
    try {
      await fetch('/api/save-library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracks: state.tracks })
      });
    } catch (e) {
      console.warn('Failed to save library:', e);
    }
  }

  // --- VINYL PLAYER VIEW ---
  function renderVinylPlayerView() {
    const track = (queue ? queue.getCurrentTrack() : null) || state.tracks.find(t => t.id === state.currentTrackId) || state.tracks[0];
    if (!track) return;

    DOM.bigTrackTitle.textContent = track.title || 'Untitled';
    DOM.bigTrackArtist.textContent = track.artist || 'Unknown Artist';
    DOM.bigTrackAlbum.textContent = track.album || '';

    const ctx = queue ? queue.getContext() : null;
    const ctxTitle = ctx ? ctx.title : 'PAIN AUDIO';
    const bpm = queue ? queue.getTrackBpm(track) : (track.bpm || 120);
    DOM.bigOriginBadge.textContent = `${ctxTitle.toUpperCase()} · ${bpm ? bpm + ' BPM · ' : ''}${track.mime || 'audio/mpeg'}`;

    DOM.vinylBigCoverImg.src = getCoverUrl(track);
    DOM.vinylBigCoverImg.onerror = function() {
      this.onerror = null;
      this.src = getProceduralCoverSvg(track);
    };

    DOM.vinylBigDisc.classList.toggle('spinning', state.isPlaying);
  }

  // --- INSIGHTS / STATS VIEW ---
  function renderInsights() {
    const plays = state.stats.plays || [];
    const slices = state.stats.slices || [];
    const now = new Date();
    const isRu = state.lang === 'ru';

    // 1. Total Listening Time
    let totalMs = slices.reduce((acc, s) => acc + (s.ms || 0), 0);
    if (totalMs === 0 && plays.length > 0) {
      totalMs = plays.reduce((acc, p) => acc + (p.heard || 0), 0);
    }
    const totalMinutes = Math.floor(totalMs / 60000);
    const totalHours = Math.floor(totalMinutes / 60);

    if (DOM.statTotalTime) {
      DOM.statTotalTime.textContent = totalHours > 0 
        ? (isRu ? `${totalHours} ч ${totalMinutes % 60} мин` : `${totalHours} h ${totalMinutes % 60} m`)
        : (isRu ? `${totalMinutes} мин` : `${totalMinutes} m`);
    }

    // 2. Today's Listening Time
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    let todayMs = 0;
    slices.forEach(s => { if (s.at >= todayStart) todayMs += (s.ms || 0); });
    if (todayMs === 0) {
      plays.forEach(p => {
        const ts = p.started || p.timestamp || 0;
        if (ts >= todayStart) todayMs += (p.heard || 0);
      });
    }
    const todayMinutes = Math.round(todayMs / 60000);
    if (DOM.statTodayTime) {
      DOM.statTodayTime.textContent = isRu ? `Сегодня: ${todayMinutes} мин` : `Today: ${todayMinutes} min`;
    }

    // 3. Unique Tracks & Total Plays
    const uniqueTracks = new Set(plays.map(p => p.track)).size;
    if (DOM.statUnique) DOM.statUnique.textContent = uniqueTracks;
    if (DOM.statPlays) DOM.statPlays.textContent = isRu ? `${plays.length} прослушиваний` : `${plays.length} plays recorded`;

    // 4. 24-Hour Listening Distribution & Peak Hour
    const hours = new Array(24).fill(0);
    slices.forEach(s => {
      const h = new Date(s.at).getHours();
      hours[h] += (s.ms || 0);
    });
    if (slices.length === 0) {
      plays.forEach(p => {
        const ts = p.started || p.timestamp || Date.now();
        const h = new Date(ts).getHours();
        hours[h] += (p.heard || 60000);
      });
    }

    let peakHour = -1, maxHourMs = 0;
    hours.forEach((ms, h) => {
      if (ms > maxHourMs) {
        maxHourMs = ms;
        peakHour = h;
      }
    });

    if (DOM.statPeakHour) {
      DOM.statPeakHour.textContent = peakHour >= 0 && maxHourMs > 0 ? `${String(peakHour).padStart(2, '0')}:00` : '—';
    }
    if (DOM.statPeakDesc) {
      DOM.statPeakDesc.textContent = peakHour >= 0 && maxHourMs > 0
        ? (isRu ? `Пик: ${Math.round(maxHourMs / 60000)} мин активности` : `Peak: ${Math.round(maxHourMs / 60000)}m active`)
        : (isRu ? 'Пока нет данных' : 'No data yet');
    }

    if (DOM.hourlyBars) {
      DOM.hourlyBars.innerHTML = '';
      const maxH = Math.max(...hours, 60000);
      hours.forEach((ms, h) => {
        const pct = Math.max(4, Math.round((ms / maxH) * 85));
        const isPeak = h === peakHour && ms > 0;
        const col = document.createElement('div');
        col.className = 'hour-col';
        col.title = `${String(h).padStart(2, '0')}:00 — ${Math.round(ms / 60000)} min`;
        col.innerHTML = `
          <div class="hour-pill ${isPeak ? 'peak' : ''}" style="height: ${pct}px;"></div>
          <div class="hour-label">${h % 4 === 0 ? String(h).padStart(2, '0') : ''}</div>
        `;
        DOM.hourlyBars.appendChild(col);
      });
    }

    // 5. Streaks (Current & Longest Active Days)
    const activeDays = new Set();
    slices.forEach(s => {
      const d = new Date(s.at);
      activeDays.add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
    });
    plays.forEach(p => {
      const ts = p.started || p.timestamp || 0;
      if (ts > 0) {
        const d = new Date(ts);
        activeDays.add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
      }
    });

    const sortedDays = Array.from(activeDays).sort();
    let currentStreak = 0, longestStreak = 0, streakCount = 0;
    if (sortedDays.length > 0) {
      longestStreak = 1;
      streakCount = 1;
      for (let i = 1; i < sortedDays.length; i++) {
        const prev = new Date(sortedDays[i-1]);
        const curr = new Date(sortedDays[i]);
        const diffDays = Math.round((curr - prev) / 86400000);
        if (diffDays === 1) {
          streakCount++;
          if (streakCount > longestStreak) longestStreak = streakCount;
        } else if (diffDays > 1) {
          streakCount = 1;
        }
      }
      const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
      const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth()+1).padStart(2,'0')}-${String(yesterday.getDate()).padStart(2,'0')}`;
      if (activeDays.has(todayStr) || activeDays.has(yesterdayStr)) {
        currentStreak = streakCount;
      }
    }

    if (DOM.statStreak) DOM.statStreak.textContent = isRu ? `${currentStreak} дн` : `${currentStreak} days`;
    if (DOM.statLongestStreak) DOM.statLongestStreak.textContent = isRu ? `Рекорд: ${longestStreak} дн` : `Best: ${longestStreak} days`;
    if (DOM.statStreakText) DOM.statStreakText.textContent = isRu ? `${currentStreak} дн подряд` : `${currentStreak} day streak`;

    // 6. Behavioral Habits & Completion Ratios
    let completed = 0, early = 0, totalPlays = plays.length;
    plays.forEach(p => {
      if (p.finished === 1 || p.finished === true) completed++;
      else if (p.skipped === 1 || (p.duration > 0 && p.heard < p.duration * 0.5)) early++;
    });
    const compPct = totalPlays > 0 ? Math.round((completed / totalPlays) * 100) : 0;
    const earlyPct = totalPlays > 0 ? Math.round((early / totalPlays) * 100) : 0;
    if (DOM.statCompletionRate) DOM.statCompletionRate.textContent = `${compPct}%`;
    if (DOM.statEarlySkips) DOM.statEarlySkips.textContent = `${earlyPct}%`;

    const trackCounts = {};
    plays.forEach(p => trackCounts[p.track] = (trackCounts[p.track] || 0) + 1);
    const replayed = Object.values(trackCounts).filter(c => c > 1).length;
    const uniqueCount = Object.keys(trackCounts).length;
    const replayPct = uniqueCount > 0 ? Math.round((replayed / uniqueCount) * 100) : 0;
    const discoveryPct = totalPlays > 0 ? Math.round((uniqueCount / totalPlays) * 100) : 0;
    if (DOM.statReplayRate) DOM.statReplayRate.textContent = `${replayPct}%`;
    if (DOM.statDiscoveryRate) DOM.statDiscoveryRate.textContent = `${discoveryPct}%`;

    // 7. Real 7-Day Activity Pulse
    const dayNamesEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayNamesRu = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    const past7Days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      past7Days.push(d);
    }
    const dayTotalsMs = past7Days.map(d => {
      const dayStart = d.getTime();
      const dayEnd = dayStart + 86400000;
      let ms = 0;
      slices.forEach(s => {
        if (s.at >= dayStart && s.at < dayEnd) ms += (s.ms || 0);
      });
      if (ms === 0) {
        plays.forEach(p => {
          const ts = p.started || p.timestamp || 0;
          if (ts >= dayStart && ts < dayEnd) ms += (p.heard || 0);
        });
      }
      return ms;
    });

    const maxDayMs = Math.max(...dayTotalsMs, 60000);
    const weekTotalMinutes = Math.round(dayTotalsMs.reduce((a, b) => a + b, 0) / 60000);
    if (DOM.weekTotalLabel) {
      DOM.weekTotalLabel.textContent = isRu 
        ? `Всего за неделю: ${weekTotalMinutes} мин`
        : `${weekTotalMinutes} min total this week`;
    }

    if (DOM.weekBars) {
      DOM.weekBars.innerHTML = '';
      past7Days.forEach((d, idx) => {
        const ms = dayTotalsMs[idx];
        const h = Math.max(6, Math.round((ms / maxDayMs) * 90));
        const col = document.createElement('div');
        col.className = 'bar-col';
        col.title = `${d.toLocaleDateString()}: ${Math.round(ms / 60000)} min`;
        col.innerHTML = `
          <div class="bar-pill" style="height: ${h}px;"></div>
          <div class="bar-label">${isRu ? dayNamesRu[d.getDay()] : dayNamesEn[d.getDay()]}</div>
        `;
        DOM.weekBars.appendChild(col);
      });
    }

    // 8. Top 5 Tracks & Obsessions
    if (DOM.topTracksList) {
      const sortedTracks = Object.entries(trackCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      DOM.topTracksList.innerHTML = '';
      if (sortedTracks.length === 0) {
        DOM.topTracksList.innerHTML = `<div style="color:var(--ink-secondary); font-size:12px; padding:8px 0;">${isRu ? 'Пока нет прослушиваний' : 'No listening history yet'}</div>`;
      } else {
        sortedTracks.forEach(([trackId, count], idx) => {
          const track = state.tracks.find(t => t.id === trackId) || { id: trackId, title: trackId, artist: '—' };
          const item = document.createElement('div');
          item.className = 'leaderboard-item';
          item.innerHTML = `
            <div class="leaderboard-item-left">
              <span class="leaderboard-rank">#${idx + 1}</span>
              <img class="leaderboard-thumb" src="${getCoverUrl(track)}" alt="" onerror="this.src='${getProceduralCoverSvg(track)}'">
              <div class="leaderboard-text">
                <div class="leaderboard-title">${escapeHtml(track.title || 'Untitled')}</div>
                <div class="leaderboard-sub">${escapeHtml(track.artist || 'Unknown')}</div>
              </div>
            </div>
            <div class="leaderboard-stat">${count} ${isRu ? 'воспр.' : 'plays'}</div>
          `;
          item.addEventListener('click', () => playTrackById(track.id));
          DOM.topTracksList.appendChild(item);
        });
      }
    }

    // 9. Top 5 Artists
    if (DOM.topArtistsList) {
      const artistTimes = {};
      plays.forEach(p => {
        const t = state.tracks.find(x => x.id === p.track);
        const artist = (t && t.artist) || 'Unknown Artist';
        artistTimes[artist] = (artistTimes[artist] || 0) + (p.heard || 60000);
      });
      const sortedArtists = Object.entries(artistTimes)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      DOM.topArtistsList.innerHTML = '';
      if (sortedArtists.length === 0) {
        DOM.topArtistsList.innerHTML = `<div style="color:var(--ink-secondary); font-size:12px; padding:8px 0;">${isRu ? 'Пока нет данных' : 'No listening history yet'}</div>`;
      } else {
        sortedArtists.forEach(([artist, ms], idx) => {
          const m = Math.round(ms / 60000);
          const item = document.createElement('div');
          item.className = 'leaderboard-item';
          item.innerHTML = `
            <div class="leaderboard-item-left">
              <span class="leaderboard-rank">#${idx + 1}</span>
              <div class="leaderboard-text">
                <div class="leaderboard-title">${escapeHtml(artist)}</div>
                <div class="leaderboard-sub">${isRu ? 'Исполнитель' : 'Artist'}</div>
              </div>
            </div>
            <div class="leaderboard-stat">${m} ${isRu ? 'мин' : 'min'}</div>
          `;
          DOM.topArtistsList.appendChild(item);
        });
      }
    }
  }

  // --- AUDIO PLAYBACK ENGINE & CONTEXT-AWARE QUEUE ---
  function playTrackObject(track) {
    if (!track) return;
    initAudioNodes();
    sampleListening();
    if (state.currentTrackId) recordTrackFinished(state.currentTrackId,true);
    const request = ++playbackRequest;
    state.currentTrackId = track.id;
    state.currentTrackIndex = state.tracks.findIndex(t => t.id === track.id);
    state.hasPrefetchedNext = false;
    beginListening(track);
    state.isPlaying = false;
    DOM.currentTime.textContent = '0:00';
    DOM.totalTime.textContent = formatTime(Math.max(0, Number(track.duration) || 0) / 1000);
    DOM.progressFill.style.width = '0%';
    if (DOM.progressThumb) DOM.progressThumb.style.left = '0%';

    audio.src = `/api/cached-track/${encodeURIComponent(track.id)}?phoneUrl=${encodeURIComponent(state.phoneUrl)}`;
    audio.play().then(() => {
      if (request === playbackRequest) syncPlaybackState();
    }).catch(async err => {
      // A superseded play or explicit pause must never restore an older source.
      if (request !== playbackRequest || err.name === 'AbortError') return;
      if (state.phoneUrl) {
        audio.src = `${state.phoneUrl.replace(/\/+$/, '')}/api/track/${encodeURIComponent(track.id)}`;
        try { await audio.play(); } catch (e) {
          if (request === playbackRequest) console.warn('Audio unavailable:', e);
        }
      }
      if (request === playbackRequest) syncPlaybackState();
    });

    updatePlayerBarUI(track, false);
    updatePlayBtnUI();
    updatePlayingRowUI();
    if (queue) {
      updateQueueContextUI({
        context: queue.getContext(),
        track: track,
        index: queue.getCurrentIndex(),
        total: queue.getTracks().length,
        shuffleMode: queue.getShuffleMode(),
        loopMode: queue.getLoopMode()
      });
    }
    if (state.currentView === 'player') renderVinylPlayerView();
    analyzeTrackBpmInBackground(track);
  }

  async function analyzeTrackBpmInBackground(track) {
    if (!track || !track.id || !queue) return;
    if (queue.bpmCache && queue.bpmCache[track.id]) return;
    if (track._bpmAnalyzing) return;
    track._bpmAnalyzing = true;

    try {
      const srcUrl = `/api/cached-track/${encodeURIComponent(track.id)}?phoneUrl=${encodeURIComponent(state.phoneUrl)}`;
      const resp = await fetch(srcUrl, { headers: { Range: 'bytes=0-320000' } });
      if (!resp.ok && resp.status !== 206) return;
      const arrayBuffer = await resp.arrayBuffer();

      const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!OfflineCtx) return;
      const offlineCtx = new OfflineCtx(1, 44100 * 12, 44100);
      const audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer);
      const pcmData = audioBuffer.getChannelData(0);
      const detectFn = QueueEngine?.detectBpmFromPcm || (QueueClass && QueueClass.detectBpmFromPcm);
      const detected = detectFn ? detectFn(pcmData, audioBuffer.sampleRate) : null;
      if (detected && detected >= 60 && detected <= 200) {
        queue.bpmCache[track.id] = detected;
        try {
          localStorage.setItem('pain_bpm_cache_v2', JSON.stringify(queue.bpmCache));
        } catch (e) {}
        if (state.currentTrackId === track.id) {
          updateQueueContextUI({
            context: queue.getContext(),
            track: track,
            index: queue.getCurrentIndex(),
            total: queue.getTracks().length,
            shuffleMode: queue.getShuffleMode(),
            loopMode: queue.getLoopMode()
          });
          if (state.currentView === 'player') renderVinylPlayerView();
        }
      }
    } catch (e) {
      // Unknown tempo stays unknown when decoding fails.
    } finally {
      track._bpmAnalyzing = false;
    }
  }

  function playTrackInContext(track, trackList, contextInfo) {
    if (!track) return;
    if (queue) {
      const list = Array.isArray(trackList) && trackList.length > 0 ? trackList : state.tracks;
      const idx = list.findIndex(t => t.id === track.id);
      queue.setContext(contextInfo?.type || 'library', list, idx !== -1 ? idx : 0, contextInfo?.title);
    }
    playTrackObject(track);
  }

  function playTrackById(trackId) {
    if (queue) {
      const inQueue = queue.jumpToTrack(trackId);
      if (inQueue) {
        playTrackObject(inQueue);
        return;
      }
    }
    const track = state.tracks.find(t => t.id === trackId);
    if (!track) return;
    if (queue) {
      const idx = state.tracks.findIndex(t => t.id === trackId);
      queue.setContext('library', state.tracks, idx !== -1 ? idx : 0, state.lang === 'ru' ? 'Фонотека' : 'Library');
    }
    playTrackObject(track);
  }

  function playTrackIndex(index) {
    if (index < 0 || index >= state.tracks.length) return;
    playTrackById(state.tracks[index].id);
  }

  function updateQueueContextUI(info) {
    if (!DOM.bottomTrackContext) return;
    if (!info || !info.context || !info.total) {
      DOM.bottomTrackContext.textContent = '';
      return;
    }
    const isRu = state.lang === 'ru';
    let ctxName = info.context.title;
    if (!ctxName) {
      ctxName = info.context.type === 'favorites' ? (isRu ? 'Избранное' : 'Favorites') : (isRu ? 'Фонотека' : 'Library');
    }
    const pos = info.index >= 0 ? info.index + 1 : 1;
    const isSmart = info.shuffleMode === 'smart';
    DOM.bottomTrackContext.classList.toggle('smart-active', isSmart);

    let badge = '';
    if (isSmart) {
      const lastTrans = queue && typeof queue.getLastTransition === 'function' ? queue.getLastTransition() : null;
      let reasonText = '';
      if (lastTrans && Array.isArray(lastTrans.reasons) && lastTrans.reasons.length > 0) {
        reasonText = ` (${lastTrans.reasons[0]})`;
      }
      const curTrack = info.track || (queue && queue.getCurrentTrack());
      const curBpm = (queue && curTrack) ? queue.getTrackBpm(curTrack) : null;
      const bpmPart = curBpm ? ` · ${curBpm} BPM` : '';
      badge = ` · ⚡ Smart DJ${bpmPart}${reasonText}`;
    } else if (info.shuffleMode === 'random') {
      badge = isRu ? ' · 🔀 Случайно' : ' · 🔀 Shuffle';
    }
    DOM.bottomTrackContext.textContent = `${ctxName} · ${pos} ${isRu ? 'из' : 'of'} ${info.total}${badge}`;
  }

  function getCurrentTrackDuration() {
    if (audio.duration && isFinite(audio.duration) && audio.duration > 0) {
      return audio.duration;
    }
    const track = state.tracks[state.currentTrackIndex];
    if (track && track.duration) {
      return Math.max(0, Number(track.duration) || 0) / 1000;
    }
    return 0;
  }

  function updatePlayingRowUI() {
    document.querySelectorAll('.tracks-table tbody tr').forEach(tr => {
      const isCurrent = tr.dataset.trackId === state.currentTrackId;
      tr.classList.toggle('playing-row', isCurrent);
      const titleEl = tr.querySelector('.track-row-title');
      if (titleEl) titleEl.classList.toggle('active-text', isCurrent);
      const indexNumSpan = tr.querySelector('.index-num');
      if (indexNumSpan) {
        const idx = parseInt(tr.dataset.index, 10);
        if (isCurrent && state.isPlaying) {
          indexNumSpan.textContent = '▶';
          indexNumSpan.style.color = 'var(--ink)';
        } else {
          indexNumSpan.textContent = isNaN(idx) ? '' : (idx + 1);
          indexNumSpan.style.color = '';
        }
      }
    });
  }

  let playbackRequest = 0;
  let listening = null;
  function sampleListening(active = !audio.paused && !audio.seeking) {
    listening?.sample(performance.now(), audio.currentTime || 0, active && !audio.muted && audio.volume > 0, audio.playbackRate || 1);
  }
  function beginListening(track) {
    listening = new ListeningLedger(track.id, Number(track.duration)||0);
  }
  function syncPlaybackState() {
    state.isPlaying = !audio.paused && !audio.ended;
    updatePlayBtnUI();
    DOM.vinylBigDisc.classList.toggle('spinning',state.isPlaying);
    updatePlayingRowUI();
  }
  function togglePlay() {
    initAudioNodes();
    if (!audio.getAttribute('src')) {
      const target = (queue ? queue.getCurrentTrack() : null) || state.tracks[0];
      if (target) {
        playTrackObject(target);
        return;
      }
    }

    if (audio.paused) {
      audio.play().then(() => {
        state.isPlaying = true;
        updatePlayBtnUI();
        DOM.vinylBigDisc.classList.add('spinning');
        updatePlayingRowUI();
      }).catch(err => console.warn(err));
    } else {
      ++playbackRequest;
      audio.pause();
      state.isPlaying = false;
      updatePlayBtnUI();
      DOM.vinylBigDisc.classList.remove('spinning');
      updatePlayingRowUI();
    }

    if (state.currentView === 'player') renderVinylPlayerView();
  }

  function updatePlayBtnUI() {
    if (state.isPlaying) {
      DOM.bottomPlayIcon.innerHTML = '<rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/>';
      DOM.bottomPlayBtn.title = 'Pause';
    } else {
      DOM.bottomPlayIcon.innerHTML = '<polygon points="6 3 20 12 6 21 6 3" fill="currentColor"/>';
      DOM.bottomPlayBtn.title = 'Play';
    }
  }

  function updatePlayerBarUI(track, isPlaying) {
    window.dispatchEvent(new CustomEvent("pain:track",{detail:track}));
    if (!track) return;
    DOM.bottomTrackTitle.textContent = track.title || 'Untitled';
    DOM.bottomTrackArtist.textContent = (track.artist || 'Unknown Artist') + (track.album ? ` · ${track.album}` : '');

    DOM.bottomCoverImg.src = getCoverUrl(track);
    DOM.bottomCoverImg.onerror = function() {
      this.onerror = null;
      this.src = getProceduralCoverSvg(track);
    };

    const durationSec = Math.max(0, Number(track.duration) || 0) / 1000;
    DOM.totalTime.textContent = formatTime(durationSec);

    updateFavoriteUI(track.favorite);

    renderVinylPlayerView();
  }

  function updateFavoriteUI(isFav) {
    DOM.bottomFavoriteBtn.classList.toggle('active', !!isFav);
    DOM.bottomFavoriteBtn.querySelector('svg').style.fill = isFav ? 'currentColor' : 'none';
  }

  function updateSidebarLikedCount() {
    const count = state.tracks.filter(t => !!t.favorite).length;
    DOM.sidebarLikedCount.textContent = state.lang === 'ru' ? `${count} треков` : `${count} tracks`;
  }

  // --- 2-WAY SYNC: FAVORITES & STATS ---
  async function toggleFavorite(trackId) {
    const track = state.tracks.find(t => t.id === trackId);
    if (!track) return;

    track.favorite = !track.favorite;
    updateSidebarLikedCount();

    if (state.currentTrackId === track.id) {
      updateFavoriteUI(track.favorite);
    }

    renderCurrentView();

    // 1. Relay to backend & mobile phone via server
    try {
      await fetch('/api/sync-like', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trackId: track.id,
          favorite: track.favorite ? 1 : 0,
          phoneUrl: state.phoneUrl
        })
      });
    } catch (e) {
      console.warn('Favorite sync error:', e);
    }

    // 2. Direct relay to phone if reachable
    if (state.phoneUrl) {
      try {
        const cleanUrl = state.phoneUrl.replace(/\/+$/, '');
        fetch(`${cleanUrl}/api/favorite`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trackId: track.id,
            favorite: track.favorite ? 1 : 0
          })
        }).catch(() => {});
      } catch (e) {}
    }

    // 3. Persist local library
    saveLibraryToServer();
  }

  function setQueueTasteStats(stats){
    let skips=[];try{skips=JSON.parse(localStorage.getItem('pain_taste_skips')||'[]');}catch(_){}
    queue.setStats({plays:[...(stats.plays||[]),...skips]});
  }

  async function recordTrackFinished(trackId,explicitSkip=false) {
    if(!listening||listening.id!==trackId||listening.closed)return;
    const audible=listening.finish();
    if(!audible){
      if(explicitSkip && listening.heard>=1000 && listening.duration>0 && !listening._tasteRecorded){
        listening._tasteRecorded=true;
        const feedback={track:trackId,started:listening.started,heard:Math.round(listening.heard),duration:listening.duration,skipped:1};
        let skips=[];try{skips=JSON.parse(localStorage.getItem('pain_taste_skips')||'[]');}catch(_){}
        skips.push(feedback);skips=skips.slice(-2000);
        try{localStorage.setItem('pain_taste_skips',JSON.stringify(skips));}catch(_){}
        if(queue)queue.setStats({plays:[...(state.stats.plays||[]),...skips]});
      }
      return;
    }
    const now=Date.now();
    const playRecord={...audible,id:'pc_'+(globalThis.crypto?.randomUUID?.() || now+'_'+Math.random().toString(36).slice(2)),session:'pc_companion',at:now,timestamp:now};
    const track=state.tracks.find(t=>t.id===trackId);
    if(!track)return;
    if (!state.stats.plays) state.stats.plays = [];
    state.stats.plays.push(playRecord);
    if (queue) setQueueTasteStats(state.stats);

    // 1. Immediately update live DOM play count for all rows showing this track
    const newPlayCount = getTrackPlayCount(track.id);
    document.querySelectorAll('tr[data-track-id]').forEach(row => {
      if(row.dataset.trackId===track.id){const el=row.querySelector('.col-plays');if(el)el.textContent=newPlayCount;}
    });

    // 2. Relay to server
    try {
      await fetch('/api/sync-stats', {
        keepalive:true,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          play: playRecord,
          ...playRecord,
          phoneUrl: state.phoneUrl
        })
      });
    } catch (e) {}

    // The server is the single relay to the phone; a second POST counted plays twice.
    renderInsights();
  }

  // --- SLEEP-RESISTANT PREFETCHING ---
  function prefetchNextTrack() {
    if (state.hasPrefetchedNext) return;
    const nextTrack = getNextTrack();
    if (!nextTrack) return;

    state.hasPrefetchedNext = true;
    fetch(`/api/preload-track/${encodeURIComponent(nextTrack.id)}?phoneUrl=${encodeURIComponent(state.phoneUrl)}`, {
      method: 'POST'
    }).catch(() => {});
  }

  function getNextTrack() {
    if (queue) {
      return queue.peekNext();
    }
    if (state.tracks.length === 0) return null;
    let nextIdx = state.currentTrackIndex + 1;
    if (nextIdx >= state.tracks.length) nextIdx = 0;
    return state.tracks[nextIdx];
  }

  function playNextTrack() {
    sampleListening();
    if(state.currentTrackId)recordTrackFinished(state.currentTrackId,!audio.ended);
    if (queue) {
      const nextTrack = queue.next();
      if (nextTrack) {
        playTrackObject(nextTrack);
      } else {
        state.isPlaying = false;
        updatePlayBtnUI();
        DOM.vinylBigDisc.classList.remove('spinning');
        updatePlayingRowUI();
      }
      return;
    }

    if (state.tracks.length === 0) return;
    let nextIdx;
    if (state.shuffle) {
      nextIdx = Math.floor(Math.random() * state.tracks.length);
    } else {
      nextIdx = state.currentTrackIndex + 1;
      if (nextIdx >= state.tracks.length) nextIdx = 0;
    }
    playTrackIndex(nextIdx);
  }

  function playPrevTrack() {
    if (queue) {
      const prevTrack = queue.prev();
      if (prevTrack) {
        playTrackObject(prevTrack);
      }
      return;
    }

    if (state.tracks.length === 0) return;
    let prevIdx = state.currentTrackIndex - 1;
    if (prevIdx < 0) prevIdx = state.tracks.length - 1;
    playTrackIndex(prevIdx);
  }

  // --- REPEAT & LOOP MODES ---
  function cycleRepeatMode() {
    if (state.loopMode === 'off') {
      state.loopMode = 'all';
      if (queue) queue.setLoopMode('all');
      audio.loop = false;
      DOM.bottomRepeatBtn.classList.add('active');
      DOM.bottomLoopBadge.style.display = 'none';
      DOM.bottomRepeatBtn.title = 'Repeat All';
      showToast(state.lang === 'ru' ? 'Повтор всех треков' : 'Repeat All', '🔁');
    } else if (state.loopMode === 'all') {
      state.loopMode = 'one';
      if (queue) queue.setLoopMode('one');
      audio.loop = false; // NEVER set native audio.loop = true: HTML5 spec suppresses 'ended' event when audio.loop is true!
      DOM.bottomRepeatBtn.classList.add('active');
      DOM.bottomLoopBadge.style.display = 'block';
      DOM.bottomRepeatBtn.title = 'Repeat One';
      showToast(state.lang === 'ru' ? 'Повтор одного трека' : 'Repeat One', '🔂');
    } else {
      state.loopMode = 'off';
      if (queue) queue.setLoopMode('off');
      audio.loop = false;
      DOM.bottomRepeatBtn.classList.remove('active');
      DOM.bottomLoopBadge.style.display = 'none';
      DOM.bottomRepeatBtn.title = 'Repeat Off';
      showToast(state.lang === 'ru' ? 'Повтор выключен' : 'Repeat Off', '➡️');
    }
    try {
      localStorage.setItem('pain_loop_mode', state.loopMode);
    } catch (e) {}
  }

  // --- THEME & LANGUAGE ---
  function applyTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('pain_theme', theme);
  }

  function applyLang(lang) {
    state.lang = lang;
    localStorage.setItem('pain_lang', lang);

    document.querySelectorAll('[data-en]').forEach(el => {
      el.textContent = lang === 'ru' ? (el.dataset.ru || el.dataset.en) : el.dataset.en;
    });

    document.querySelectorAll('[data-en-placeholder]').forEach(el => {
      el.placeholder = lang === 'ru' ? (el.dataset.ruPlaceholder || el.dataset.enPlaceholder) : el.dataset.enPlaceholder;
    });

    const langSpan = DOM.langToggle.querySelector('span');
    if (langSpan) langSpan.textContent = lang === 'ru' ? 'RU / EN' : 'EN / RU';
    else DOM.langToggle.textContent = lang === 'ru' ? 'RU / EN' : 'EN / RU';

    if (state.eq && DOM.eqStateLabel) {
      DOM.eqStateLabel.textContent = state.eq.enabled ? (lang === 'ru' ? 'ВКЛ' : 'ON') : (lang === 'ru' ? 'ВЫКЛ' : 'OFF');
    }

    updateGreeting();
    renderCurrentView();
  }

  // --- DISCOVERY & ZERO-TOUCH AUTO-SYNC ---
  function startDiscoveryPolling() {
    setInterval(async () => {
      try {
        const res = await fetch('/api/devices');
        if (res.ok) {
          const list = await res.json();
          if (Array.isArray(list) && list.length > 0) {
            state.devices = list;
            const phone = list[0];

            DOM.sidebarDot.classList.add('connected');
            DOM.sidebarStatusText.textContent = phone.name;
            DOM.sidebarDetailText.textContent = `${phone.ip}:${phone.port} · ${phone.tracks} tracks`;

            if (phone.ip && phone.ip !== '127.0.0.1') {
              state.phoneUrl = `http://${phone.ip}:${phone.port}`;
              DOM.phoneIpInput.value = state.phoneUrl;
              localStorage.setItem('pain_phone_url', state.phoneUrl);
            }

            // Zero-touch instant auto-sync if empty
            if (!state.hasAutoSynced || state.tracks.length === 0) {
              state.hasAutoSynced = true;
              syncAll();
            }
          }
        }
      } catch (ignored) {}
    }, 1500);
  }

  async function checkConnection() {
    const url = DOM.phoneIpInput.value.trim().replace(/\/$/, '');
    state.phoneUrl = url;
    localStorage.setItem('pain_phone_url', url);

    try {
      const res = await fetch(`${url}/api/status`);
      if (res.ok) {
        const data = await res.json();
        DOM.sidebarDot.classList.add('connected');
        DOM.sidebarStatusText.textContent = `${data.appName} (${data.device || 'Android'})`;
        DOM.sidebarDetailText.textContent = `${url} · ${data.tracks} tracks`;
        DOM.deviceInfoText.innerHTML = `
          <strong>Connected!</strong> Device: ${data.device || 'Android'} (${data.appName}), Tracks: ${data.tracks}.
        `;
        return true;
      }
    } catch (e) {
      DOM.deviceInfoText.innerHTML = `
        <span style="color:#D32F2F;">Connection failed.</span> Verify phone is on the same Wi-Fi and Pain is open.
      `;
      return false;
    }
  }

  async function syncAll() {
    const ok = await checkConnection();
    if (!ok && state.tracks.length > 0) return;

    DOM.progressBanner.classList.add('active');
    DOM.progressTaskTitle.textContent = state.lang === 'ru' ? 'Синхронизация фонотеки…' : 'Syncing library…';
    DOM.syncProgressFill.style.width = '25%';
    DOM.progressPercent.textContent = '25%';

    try {
      // 1. Fetch Library
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

      DOM.syncProgressFill.style.width = '70%';
      DOM.progressPercent.textContent = '70%';

      // 2. Fetch Stats
      const statsRes = await fetch(`${state.phoneUrl}/api/stats`);
      if (statsRes.ok) {
        const statsData = await statsRes.json();

        await fetch('/api/save-stats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(statsData)
        });
        const merged=await fetch('/api/saved-stats');
        if(merged.ok) {
          state.stats=await merged.json();
          if (queue) setQueueTasteStats(state.stats);
        }
      }

      DOM.syncProgressFill.style.width = '100%';
      DOM.progressPercent.textContent = '100%';

      updateSidebarLikedCount();
      renderCurrentView();

      setTimeout(() => {
        DOM.progressBanner.classList.remove('active');
      }, 1200);
    } catch (err) {
      console.warn('Sync failed:', err);
      DOM.progressBanner.classList.remove('active');
    }
  }

  async function downloadAllAudio() {
    if (state.tracks.length === 0) {
      await syncAll();
    }
    if (state.tracks.length === 0) return;

    DOM.progressBanner.classList.add('active');
    const total = state.tracks.length;

    for (let i = 0; i < total; i++) {
      const track = state.tracks[i];
      DOM.progressTaskTitle.textContent = `${state.lang === 'ru' ? 'Кэширование' : 'Caching'}: ${track.title} (${i+1}/${total})`;
      const pct = Math.round(((i + 1) / total) * 100);
      DOM.syncProgressFill.style.width = `${pct}%`;
      DOM.progressPercent.textContent = `${pct}%`;

      try {
        const streamUrl = `${state.phoneUrl}/api/track/${encodeURIComponent(track.id)}`;
        const res = await fetch(streamUrl);
        if (res.ok) {
          const blob = await res.blob();
          const ext = track.path ? track.path.split('.').pop() : 'mp3';
          const filename = `${track.artist} - ${track.title}.${ext}`;
          await fetch('/api/save-audio', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/octet-stream',
              'X-Filename': encodeURIComponent(filename)
            },
            body: blob
          });
        }
      } catch (e) {}
    }

    DOM.progressTaskTitle.textContent = state.lang === 'ru' ? 'Кэширование завершено!' : 'Caching complete!';
    setTimeout(() => {
      DOM.progressBanner.classList.remove('active');
    }, 1500);
  }

  // --- EVENT LISTENERS SETUP ---
  function setupEventListeners() {
    // Nav Items
    DOM.navItems.forEach(item => {
      item.addEventListener('click', () => {
        switchView(item.dataset.view);
      });
    });

    // Pinned Liked Songs Tile
    DOM.sidebarLikedSongsTile.addEventListener('click', () => {
      switchView('favorites');
    });

    // Language & Theme
    DOM.langToggle.addEventListener('click', () => {
      applyLang(state.lang === 'en' ? 'ru' : 'en');
    });

    DOM.themeToggle.addEventListener('click', () => {
      applyTheme(state.theme === 'paper' ? 'dark' : 'paper');
    });

    // Search
    DOM.searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      DOM.searchClearBtn.style.display = state.searchQuery ? 'block' : 'none';
      renderLibrary();
    });

    DOM.searchClearBtn.addEventListener('click', () => {
      DOM.searchInput.value = '';
      state.searchQuery = '';
      DOM.searchClearBtn.style.display = 'none';
      renderLibrary();
    });

    // Filter Chips
    DOM.filterChips.forEach(chip => {
      chip.addEventListener('click', () => {
        DOM.filterChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        state.categoryFilter = chip.dataset.filter;
        renderLibrary();
      });
    });

    // Sort Selector
    DOM.sortSelect.addEventListener('change', (e) => {
      state.sortOption = e.target.value;
      renderLibrary();
    });

    // View Mode Toggles (Grid vs List)
    DOM.viewModeGridBtn.addEventListener('click', () => applyViewMode('grid'));
    DOM.viewModeListBtn.addEventListener('click', () => applyViewMode('list'));

    // Play All Button in Library
    DOM.playAllBtn.addEventListener('click', () => {
      const processed = getProcessedTracks(state.tracks);
      if (processed.length > 0) {
        playTrackInContext(processed[0], processed, { type: 'library', title: state.lang === 'ru' ? 'Фонотека' : 'Library', id: 'library' });
      }
    });

    if (DOM.playFavoritesBtn) {
      DOM.playFavoritesBtn.addEventListener('click', () => {
        const likedTracks = state.tracks.filter(t => !!t.favorite);
        if (likedTracks.length > 0) {
          playTrackInContext(likedTracks[0], likedTracks, { type: 'favorites', title: state.lang === 'ru' ? 'Избранное' : 'Favorites', id: 'favorites' });
        }
      });
    }

    if (DOM.playPlaylistBtn) {
      DOM.playPlaylistBtn.addEventListener('click', () => {
        const pl = state.playlists.find(p => p.id === state.activePlaylistId);
        const plTracks = (pl?.trackIds || []).map(id => state.tracks.find(t => t.id === id)).filter(Boolean);
        if (plTracks.length > 0) {
          playTrackInContext(plTracks[0], plTracks, { type: 'playlist', title: pl.name, id: pl.id });
        }
      });
    }

    // Bottom Player Controls
    DOM.bottomPlayBtn.addEventListener('click', togglePlay);
    DOM.bottomNextBtn.addEventListener('click', playNextTrack);
    DOM.bottomPrevBtn.addEventListener('click', playPrevTrack);
    DOM.bottomRepeatBtn.addEventListener('click', cycleRepeatMode);

    DOM.bottomShuffleBtn.addEventListener('click', () => {
      if (queue) {
        const desc = queue.cycleShuffleMode();
        state.shuffle = desc.mode !== 'off';
        state.shuffleMode = desc.mode;
        try {
          localStorage.setItem('pain_shuffle_mode', desc.mode);
        } catch (e) {}

        DOM.bottomShuffleBtn.classList.toggle('active', desc.mode !== 'off');
        DOM.bottomShuffleBtn.classList.toggle('smart-mode', desc.mode === 'smart');

        if (DOM.bottomShuffleBadge) {
          DOM.bottomShuffleBadge.textContent = desc.badge;
          DOM.bottomShuffleBadge.classList.toggle('active', !!desc.badge);
          DOM.bottomShuffleBadge.classList.toggle('smart-badge', desc.mode === 'smart');
        }

        showToast(state.lang === 'ru' ? desc.labelRu : desc.labelEn, desc.badge || '🔀');
        if (queue.getCurrentTrack()) {
          updateQueueContextUI({
            context: queue.getContext(),
            track: queue.getCurrentTrack(),
            index: queue.getCurrentIndex(),
            total: queue.getTracks().length,
            shuffleMode: queue.getShuffleMode(),
            loopMode: queue.getLoopMode()
          });
        }
      } else {
        state.shuffle = !state.shuffle;
        DOM.bottomShuffleBtn.classList.toggle('active', state.shuffle);
      }
    });

    DOM.bottomFavoriteBtn.addEventListener('click', () => {
      if (state.currentTrackId) {
        toggleFavorite(state.currentTrackId);
      }
    });

    DOM.bottomVinylToggleBtn.addEventListener('click', () => {
      switchView('player');
    });

    // Volume & Mute
    DOM.volumeSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      audio.volume = val;
      state.lastVolume = val;
      state.isMuted = val === 0;
      updateVolumeIcon(val);
    });

    DOM.bottomMuteBtn.addEventListener('click', () => {
      if (state.isMuted) {
        audio.volume = state.lastVolume > 0 ? state.lastVolume : 1.0;
        DOM.volumeSlider.value = audio.volume;
        state.isMuted = false;
      } else {
        state.lastVolume = audio.volume;
        audio.volume = 0;
        DOM.volumeSlider.value = 0;
        state.isMuted = true;
      }
      updateVolumeIcon(audio.volume);
    });

    function updateVolumeIcon(vol) {
      if (vol === 0) {
        DOM.volumeIcon.innerHTML = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>';
      } else if (vol < 0.5) {
        DOM.volumeIcon.innerHTML = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>';
      } else {
        DOM.volumeIcon.innerHTML = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>';
      }
    }

    // --- AUDIO TIMELINE, SEEKING & POINTER SCRUBBING ---
    let isScrubbing = false;
    let pendingSeekTime = null;

    function getScrubPercent(e) {
      const rect = DOM.progressTrack.getBoundingClientRect();
      if (rect.width <= 0) return 0;
      const clickX = e.clientX - rect.left;
      return Math.max(0, Math.min(1, clickX / rect.width));
    }

    function seekToPercent(pct) {
      const dur = getCurrentTrackDuration();
      if (dur <= 0) return;
      const clampedPct = Math.max(0, Math.min(1, pct));
      const targetTime = clampedPct * dur;

      DOM.currentTime.textContent = formatTime(targetTime);
      DOM.progressFill.style.width = `${clampedPct * 100}%`;
      if (DOM.progressThumb) DOM.progressThumb.style.left = `${clampedPct * 100}%`;

      if (audio.readyState >= 1) {
        try {
          audio.currentTime = targetTime;
        } catch (err) {
          console.warn('Audio currentTime seek error:', err);
          pendingSeekTime = targetTime;
        }
      } else {
        pendingSeekTime = targetTime;
      }
    }

    audio.addEventListener('playing',()=>{
      if(listening?.closed){const track=state.tracks[state.currentTrackIndex];if(track)beginListening(track);}
      listening?.anchor(performance.now(),audio.currentTime,!audio.muted&&audio.volume>0);
      syncPlaybackState();
    });
    audio.addEventListener('pause',()=>{sampleListening(true);listening?.anchor(performance.now(),audio.currentTime,false);syncPlaybackState();});
    audio.addEventListener('waiting',()=>{sampleListening(true);listening?.anchor(performance.now(),audio.currentTime,false);});
    audio.addEventListener('seeking',()=>listening?.anchor(performance.now(),audio.currentTime,false));
    audio.addEventListener('seeked',()=>listening?.anchor(performance.now(),audio.currentTime,!audio.paused&&!audio.muted&&audio.volume>0));
    window.addEventListener('pagehide',()=>{sampleListening();if(state.currentTrackId)recordTrackFinished(state.currentTrackId);});
    audio.addEventListener('error',()=>{state.isPlaying=false;updatePlayBtnUI();DOM.vinylBigDisc.classList.remove('spinning');});
    audio.addEventListener('volumechange',()=>listening?.anchor(performance.now(),audio.currentTime,!audio.paused&&!audio.muted&&audio.volume>0));
    audio.addEventListener('ratechange',()=>listening?.anchor(performance.now(),audio.currentTime,!audio.paused));

    // Audio Metadata & Buffering
    audio.addEventListener('loadedmetadata', () => {
      const dur = getCurrentTrackDuration();
      if (dur > 0) DOM.totalTime.textContent = formatTime(dur);
      if (pendingSeekTime !== null) {
        try { audio.currentTime = pendingSeekTime; } catch (e) {}
        pendingSeekTime = null;
      }
    });

    audio.addEventListener('canplay', () => {
      if (pendingSeekTime !== null) {
        try { audio.currentTime = pendingSeekTime; } catch (e) {}
        pendingSeekTime = null;
      }
    });

    // Audio Timeline & Prefetching
    audio.addEventListener('timeupdate', () => {
      sampleListening();
      if (isScrubbing) return;

      const dur = getCurrentTrackDuration();
      const cur = audio.currentTime;

      DOM.currentTime.textContent = formatTime(cur);
      if (dur > 0) {
        DOM.totalTime.textContent = formatTime(dur);
        const pct = Math.max(0, Math.min(100, (cur / dur) * 100));
        DOM.progressFill.style.width = `${pct}%`;
        if (DOM.progressThumb) DOM.progressThumb.style.left = `${pct}%`;

        // Sleep-resistant prefetch next song halfway or 20s before end
        if (cur > dur * 0.5 || (dur - cur < 20)) {
          prefetchNextTrack();
        }
      }
    });

    audio.addEventListener('ended', () => {
      sampleListening(true);
      if (state.currentTrackId) {
        recordTrackFinished(state.currentTrackId);
      }

      if (state.loopMode === 'one' || (queue && queue.getLoopMode() === 'one')) {
        audio.currentTime = 0;
        audio.play().catch(() => {});
      } else {
        playNextTrack();
      }
    });

    // Pointer Scrubbing (drag + click)
    DOM.progressTrack.addEventListener('pointerdown', (e) => {
      if (state.currentTrackIndex === -1 && state.tracks.length > 0) {
        playTrackIndex(0);
      }
      isScrubbing = true;
      DOM.progressTrack.classList.add('scrubbing');
      try { DOM.progressTrack.setPointerCapture(e.pointerId); } catch (err) {}

      const pct = getScrubPercent(e);
      const dur = getCurrentTrackDuration();
      if (dur > 0) {
        const previewTime = pct * dur;
        DOM.currentTime.textContent = formatTime(previewTime);
        DOM.progressFill.style.width = `${pct * 100}%`;
        if (DOM.progressThumb) DOM.progressThumb.style.left = `${pct * 100}%`;
      }
    });

    DOM.progressTrack.addEventListener('pointermove', (e) => {
      if (!isScrubbing) return;
      const pct = getScrubPercent(e);
      const dur = getCurrentTrackDuration();
      if (dur > 0) {
        const previewTime = pct * dur;
        DOM.currentTime.textContent = formatTime(previewTime);
        DOM.progressFill.style.width = `${pct * 100}%`;
        if (DOM.progressThumb) DOM.progressThumb.style.left = `${pct * 100}%`;
      }
    });

    function finishScrub(e) {
      if (!isScrubbing) return;
      isScrubbing = false;
      DOM.progressTrack.classList.remove('scrubbing');
      try { DOM.progressTrack.releasePointerCapture(e.pointerId); } catch (err) {}
      const pct = getScrubPercent(e);
      seekToPercent(pct);
    }

    DOM.progressTrack.addEventListener('pointerup', finishScrub);
    DOM.progressTrack.addEventListener('pointercancel', finishScrub);

    DOM.progressTrack.addEventListener('click', (e) => {
      if (isScrubbing) return;
      const pct = getScrubPercent(e);
      seekToPercent(pct);
    });

    // Equalizer Modals & Controls
    const openEqModal = () => {
      initAudioNodes();
      initEqualizerUI();
      DOM.eqModalBackdrop.style.display = 'flex';
    };
    const closeEqModal = () => {
      DOM.eqModalBackdrop.style.display = 'none';
    };

    DOM.eqToggleBtn.addEventListener('click', openEqModal);
    DOM.bottomEqToggleBtn.addEventListener('click', openEqModal);
    DOM.eqCloseBtn.addEventListener('click', closeEqModal);
    DOM.eqModalBackdrop.addEventListener('click', (e) => {
      if (e.target === DOM.eqModalBackdrop) closeEqModal();
    });

    DOM.eqPowerSwitch.addEventListener('change', (e) => {
      initAudioNodes();
      state.eq.enabled = e.target.checked;
      DOM.eqStateLabel.textContent = state.eq.enabled ? (state.lang === 'ru' ? 'ВКЛ' : 'ON') : (state.lang === 'ru' ? 'ВЫКЛ' : 'OFF');
      saveEqualizerState();
    });

    DOM.eqSliderPreamp.addEventListener('input', (e) => {
      initAudioNodes();
      const val = parseFloat(e.target.value);
      state.eq.preamp = val;
      DOM.preampVal.textContent = `${val > 0 ? '+' : ''}${val}dB`;
      saveEqualizerState();
    });

    // 8 EQ Band Sliders
    for (let i = 0; i < 8; i++) {
      const slider = document.querySelector(`.eq-v-slider[data-band="${i}"]`);
      const valLabel = document.getElementById(`eqVal${i}`);
      if (slider) {
        slider.addEventListener('input', (e) => {
          initAudioNodes();
          const val = parseFloat(e.target.value);
          state.eq.bands[i] = val;
          if (valLabel) valLabel.textContent = `${val > 0 ? '+' : ''}${val}dB`;
          state.eq.preset = 'custom';
          updatePresetChipsUI();
          saveEqualizerState();
        });
      }
    }

    // EQ Preset Chips
    document.querySelectorAll('.eq-preset-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        initAudioNodes();
        const pKey = chip.dataset.preset;
        if (EQ_PRESETS[pKey]) {
          state.eq.preset = pKey;
          state.eq.bands = [...EQ_PRESETS[pKey]];
          initEqualizerUI();
          saveEqualizerState();
        }
      });
    });

    // New Playlist Modal
    DOM.newPlaylistBtn.addEventListener('click', () => {
      DOM.newPlaylistNameInput.value = '';
      DOM.newPlaylistModalBackdrop.style.display = 'flex';
      DOM.newPlaylistNameInput.focus();
    });

    const closeNewPlaylistModal = () => {
      DOM.newPlaylistModalBackdrop.style.display = 'none';
    };
    DOM.newPlaylistCloseBtn.addEventListener('click', closeNewPlaylistModal);
    DOM.newPlaylistCancelBtn.addEventListener('click', closeNewPlaylistModal);
    DOM.newPlaylistModalBackdrop.addEventListener('click', (e) => {
      if (e.target === DOM.newPlaylistModalBackdrop) closeNewPlaylistModal();
    });

    DOM.newPlaylistConfirmBtn.addEventListener('click', () => {
      const name = DOM.newPlaylistNameInput.value;
      if (name.trim()) {
        createNewPlaylist(name);
        closeNewPlaylistModal();
      }
    });

    DOM.newPlaylistNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        DOM.newPlaylistConfirmBtn.click();
      } else if (e.key === 'Escape') {
        closeNewPlaylistModal();
      }
    });

    // Delete Playlist Button
    DOM.deletePlaylistBtn.addEventListener('click', deleteActivePlaylist);

    // Add To Playlist Modal
    DOM.addToPlaylistCloseBtn.addEventListener('click', closeAddToPlaylistModal);
    DOM.addToPlaylistCancelBtn.addEventListener('click', closeAddToPlaylistModal);
    DOM.addToPlaylistModalBackdrop.addEventListener('click', (e) => {
      if (e.target === DOM.addToPlaylistModalBackdrop) closeAddToPlaylistModal();
    });

    // Sync View Buttons
    DOM.connectBtn.addEventListener('click', checkConnection);
    DOM.syncAllBtn.addEventListener('click', syncAll);
    DOM.downloadAllAudioBtn.addEventListener('click', downloadAllAudio);
    if (DOM.clearAllCacheBtn) DOM.clearAllCacheBtn.addEventListener('click', clearAllCache);
  }

  // Run on DOM ready
  document.addEventListener('DOMContentLoaded', init);
})();
