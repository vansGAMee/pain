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
    libraryDirty: true,
    draggedTrackId: null,
    hasPrefetchedNext: false,
    phoneUrl: (localStorage.getItem('pain_phone_url') && localStorage.getItem('pain_phone_url') !== 'http://localhost:8865') 
      ? localStorage.getItem('pain_phone_url') 
      : 'http://192.168.1.2:8865',
    stats: { plays: [], slices: [] },
    cachedTracks: new Set(),
    devices: [],
    hasAutoSynced: false,
    smartVolume: localStorage.getItem('pain_smart_volume') === 'true',
    backgroundDuck: localStorage.getItem('pain_background_duck') !== 'false',
    lastVolume: 1.0,
    isMuted: false,

    // Web Audio Equalizer State
    eq: {
      enabled: true,
      auto: false,
      preset: 'flat',
      preamp: 0,
      bands: [0, 0, 0, 0, 0, 0, 0, 0], // 60, 170, 310, 600, 1k, 3k, 6k, 12k Hz
      manual: null
    },

    // Joint Audio AI State
    jointState: {
      seeds: [],
      results: [],
      isGenerating: false
    },

    // Ambient Fluid Aura Settings
    fluidColor: (function() {
      try { return localStorage.getItem('pain_fluid_color') || '#7c4dff'; } catch(e) { return '#7c4dff'; }
    })(),
    fluidBpmSync: (function() {
      try { return localStorage.getItem('pain_fluid_bpm_sync') === 'true'; } catch(e) { return false; }
    })(),

    // Excluded Tracks from Smart DJ & Recommendations
    excludedRecommendations: (function() {
      try {
        const raw = localStorage.getItem('pain_excluded_recommendations');
        return new Set(raw ? JSON.parse(raw).map(String) : []);
      } catch(e) { return new Set(); }
    })(),

    // Favorite Moment per track (trackId -> seconds)
    favoriteMoments: (function() {
      try {
        const raw = localStorage.getItem('pain_favorite_moments');
        return typeof FavoriteMoments !== 'undefined' ? FavoriteMoments.deserialize(raw) : (raw ? JSON.parse(raw) : {});
      } catch(e) { return {}; }
    })()
  };


  // Restore EQ config if saved
  try {
    const savedEq = localStorage.getItem('pain_eq_config');
    if (savedEq) {
      Object.assign(state.eq, JSON.parse(savedEq));
      if (!Array.isArray(state.eq.bands) || state.eq.bands.length !== 8) state.eq.bands = Array(8).fill(0);
    }
  } catch (e) {}
  if (state.eq.auto) {
    state.eq.preset = 'auto';
    state.eq.preamp = 0;
    state.eq.bands = Array(8).fill(0);
  }

  let audioProfiles=Object.create(null);
  try {audioProfiles=AudioProfile.restore(localStorage.getItem('pain_audio_profiles_v4'));}catch(_){}
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
    audioProfiles,
    excludedTracks: state.excludedRecommendations,
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
  let playingTrackSnapshot = null;
  let preampNode = null;
  let smartVolumeNode = null;
  let autoEqHeadroom = null;
  let pendingSeekTime = null;
  let lastPlaybackSave = -Infinity;
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
    shareProfileBtn: document.getElementById('shareProfileBtn'),
    shareProfileModalBackdrop: document.getElementById('shareProfileModalBackdrop'),
    shareProfileModalBody: document.getElementById('shareProfileModalBody'),
    shareDownloadPngBtn: document.getElementById('shareDownloadPngBtn'),
    shareCopyImageBtn: document.getElementById('shareCopyImageBtn'),
    shareCopyLinkBtn: document.getElementById('shareCopyLinkBtn'),
    shareModalCloseBtn: document.getElementById('shareModalCloseBtn'),

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
    bottomExcludeBtn: document.getElementById('bottomExcludeBtn'),
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
    progressMomentMarker: document.getElementById('progressMomentMarker'),
    bottomMomentBtn: document.getElementById('bottomMomentBtn'),
    seekMomentBadge: document.getElementById('seekMomentBadge'),
    seekMomentTime: document.getElementById('seekMomentTime'),
    seekMomentDel: document.getElementById('seekMomentDel'),
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
    eqAutoBadge: document.getElementById('eqAutoBadge'),
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
    addToPlaylistList: document.getElementById('addToPlaylistList'),

    // Joint Audio AI View
    jointCardLeft: document.getElementById('jointCardLeft'),
    jointModelBadgeText: document.getElementById('jointModelBadgeText'),
    jointUseCurrentBtn: document.getElementById('jointUseCurrentBtn'),
    jointUseFavoritesBtn: document.getElementById('jointUseFavoritesBtn'),
    jointUseFavoritesBtnText: document.getElementById('jointUseFavoritesBtnText'),
    jointUseLibraryBtn: document.getElementById('jointUseLibraryBtn'),
    jointUseLibraryBtnText: document.getElementById('jointUseLibraryBtnText'),
    jointUploadFileBtn: document.getElementById('jointUploadFileBtn'),
    jointFileInput: document.getElementById('jointFileInput'),
    jointPasteListBtn: document.getElementById('jointPasteListBtn'),
    jointPasteBox: document.getElementById('jointPasteBox'),
    jointPasteTextarea: document.getElementById('jointPasteTextarea'),
    jointApplyPasteBtn: document.getElementById('jointApplyPasteBtn'),
    jointCancelPasteBtn: document.getElementById('jointCancelPasteBtn'),
    jointClearSeedsBtn: document.getElementById('jointClearSeedsBtn'),
    jointSeedInput: document.getElementById('jointSeedInput'),
    jointAddSeedBtn: document.getElementById('jointAddSeedBtn'),
    jointSeedsMeta: document.getElementById('jointSeedsMeta'),
    jointActiveSeeds: document.getElementById('jointActiveSeeds'),
    jointFilterPopularity: document.getElementById('jointFilterPopularity'),
    jointFilterArtistLimit: document.getElementById('jointFilterArtistLimit'),
    jointFilterAudioOnly: document.getElementById('jointFilterAudioOnly'),
    jointFilterLocalOnly: document.getElementById('jointFilterLocalOnly'),
    jointGenerateBtn: document.getElementById('jointGenerateBtn'),
    jointGenerateBtnText: document.getElementById('jointGenerateBtnText'),
    jointResultsMeta: document.getElementById('jointResultsMeta'),
    jointSavePlaylistBtn: document.getElementById('jointSavePlaylistBtn'),
    jointResultsList: document.getElementById('jointResultsList'),

    // Settings Modal & Fluid Customizer
    settingsToggleBtn: document.getElementById('settingsToggleBtn'),
    sidebarSettingsBtn: document.getElementById('sidebarSettingsBtn'),
    settingsModalBackdrop: document.getElementById('settingsModalBackdrop'),
    settingsCloseBtn: document.getElementById('settingsCloseBtn'),
    settingsDoneBtn: document.getElementById('settingsDoneBtn'),
    fluidColorPickerInput: document.getElementById('fluidColorPickerInput'),
    fluidColorHexInput: document.getElementById('fluidColorHexInput'),
    fluidPreviewOrb: document.getElementById('fluidPreviewOrb'),
    fluidResetColorBtn: document.getElementById('fluidResetColorBtn'),
    fluidBpmSyncSwitch: document.getElementById('fluidBpmSyncSwitch'),
    fluidBpmStatusText: document.getElementById('fluidBpmStatusText'),
    autoEqSwitch: document.getElementById('autoEqSwitch'),
    autoEqStatusText: document.getElementById('autoEqStatusText'),
    excludedTracksCountHint: document.getElementById('excludedTracksCountHint'),
    viewExcludedTracksBtn: document.getElementById('viewExcludedTracksBtn'),
    clearExcludedTracksBtn: document.getElementById('clearExcludedTracksBtn'),
    excludedTracksListContainer: document.getElementById('excludedTracksListContainer'),
    excludedTracksListContent: document.getElementById('excludedTracksListContent'),
    updateStatusDot: document.getElementById('updateStatusDot'),
    updateStatusText: document.getElementById('updateStatusText'),
    updateActionBtn: document.getElementById('updateActionBtn')
  };



  let pendingAddToPlaylistTrackId = null;
  let updateStatus = null;
  let updateNoticeShown = false;
  let autoEqCharacter = 'learning';

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
    const greetingEl = document.getElementById('viewGreeting');
    if (!greetingEl) return;

    if (typeof PresenceEngine !== 'undefined' && typeof PresenceEngine.generateGreeting === 'function') {
      try {
        const greeting = PresenceEngine.generateGreeting(state.tracks, state.stats, { lang: state.lang });
        if (greeting && greeting.text) {
          const icon = greeting.icon || '✨';
          greetingEl.innerHTML = `<span class="greeting-icon">${icon}</span> <span class="greeting-text">${escapeHtml(greeting.text)}</span>`;
          return;
        }
      } catch (err) {
        console.warn('PresenceEngine greeting error, falling back:', err);
      }
    }

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
    const isRu = state.lang === 'ru';
    greetingEl.innerHTML = `<span class="greeting-icon">${icon}</span> <span class="greeting-text">${isRu ? textRu : textEn}</span>`;
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
        if (state.categoryFilter === 'cached') {
          state.libraryDirty = true;
        }
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
    initSettingsUI();

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
    setTimeout(() => checkForUpdates(false, true), 800);
    setInterval(() => checkForUpdates(true, true), 6 * 60 * 60 * 1000);
    window.addEventListener('pain:show-player',()=>switchView('player'));
    startDiscoveryPolling();

    // Check query parameters and URL Hash for deep-linking
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('mode') === 'grid') applyViewMode('grid');
    if (urlParams.get('mode') === 'list') applyViewMode('list');

    const hash = window.location.hash.replace('#', '');
    if (hash === 'profile') {
      switchView('insights');
      setTimeout(openProfileModal, 150);
    } else if (hash && ['library', 'favorites', 'player', 'insights', 'sync', 'joint-ai'].includes(hash)) {
      switchView(hash);
    } else {
      switchView('library');
    }

    window.addEventListener('hashchange', () => {
      const h = window.location.hash.replace('#', '');
      if (h === 'profile') {
        switchView('insights');
        setTimeout(openProfileModal, 100);
      }
    });

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

      try {
        smartVolumeNode = SmartVolume.create(audioCtx, audio);
        lastNode.connect(smartVolumeNode.input);
        smartVolumeNode.output.connect(audioCtx.destination);
        applySmartVolume();
      } catch (_) {
        lastNode.connect(audioCtx.destination);
      }
      applyEqualizerAudioGains();
      try { autoEqHeadroom = AutoEqualizer.createHeadroom(audioCtx, EQ_FREQUENCIES); } catch (_) {}
      try {AudioProfile.observe(audioCtx,sourceNode,audio,()=>playingTrackSnapshot,
        (track,profile)=>{
          queue?.setAudioProfile(track.id,profile);
          if(state.eq.auto&&String(track.id)===String(state.currentTrackId))applyAutoEqualizer(track,profile);
          try{AudioProfile.persist(audioProfiles,localStorage);}catch(_){}
        },audioProfiles);
      }catch(_){/* Playback remains available if measurement is unsupported. */}
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
      const glide = state.eq.auto ? 0.65 : 0.02;
      const gainMult = Math.pow(10, (state.eq.preamp || 0) / 20);
      preampNode.gain.setTargetAtTime(gainMult, audioCtx.currentTime, glide);
      filterNodes.forEach((node, i) => {
        const val = state.eq.bands[i] || 0;
        node.gain.setTargetAtTime(val, audioCtx.currentTime, glide);
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

    DOM.eqSliderPreamp.step = state.eq.auto ? '0.25' : '0.5';
    DOM.eqSliderPreamp.value = state.eq.preamp;
    DOM.preampVal.textContent = `${state.eq.preamp > 0 ? '+' : ''}${state.eq.preamp}dB`;

    for (let i = 0; i < 8; i++) {
      const slider = document.querySelector(`.eq-v-slider[data-band="${i}"]`);
      const valLabel = document.getElementById(`eqVal${i}`);
      const val = state.eq.bands[i] || 0;
      if (slider) { slider.step = state.eq.auto ? '0.25' : '0.5'; slider.value = val; }
      if (valLabel) valLabel.textContent = `${val > 0 ? '+' : ''}${val}dB`;
    }

    updatePresetChipsUI();
    updateAutoEqualizerUI();
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

  function autoEqDescription() {
    if (!state.eq.auto) return state.lang === 'ru'
      ? 'Слушает текущий трек и мягко настраивает существующий эквалайзер.'
      : 'Listens to the current track and gently adjusts the existing equalizer.';
    if (autoEqCharacter === 'learning') return state.lang === 'ru'
      ? 'Включён · слушает первые секунды трека'
      : 'On · listening to the first seconds';
    const labels = state.lang === 'ru'
      ? { deep: 'глубокий звук', vocal: 'выраженная середина', bright: 'яркий звук', balanced: 'сбалансированный звук' }
      : { deep: 'deep sound', vocal: 'mid-forward sound', bright: 'bright sound', balanced: 'balanced sound' };
    const tandem = state.smartVolume ? (state.lang === 'ru' ? ' · громкость согласована' : ' · level matched') : '';
    return `${state.lang === 'ru' ? 'Включён' : 'On'} · ${labels[autoEqCharacter] || labels.balanced}${tandem}`;
  }

  function updateAutoEqualizerUI() {
    if (DOM.autoEqSwitch) DOM.autoEqSwitch.checked = !!state.eq.auto;
    if (DOM.autoEqStatusText) DOM.autoEqStatusText.textContent = autoEqDescription();
    if (DOM.eqAutoBadge) DOM.eqAutoBadge.hidden = !state.eq.auto;
    document.querySelectorAll('.eq-v-slider,.eq-preset-chip').forEach(control => {
      control.disabled = !!state.eq.auto;
    });
  }

  function applyAutoEqualizer(track, profile = null) {
    if (!state.eq.auto || !track) return;
    const recommendation = AutoEqualizer.recommend(track, profile || AudioProfile.get(audioProfiles, track, true), autoEqHeadroom);
    state.eq.enabled = true;
    state.eq.preset = 'auto';
    state.eq.preamp = recommendation.preamp;
    state.eq.bands = [...recommendation.bands];
    autoEqCharacter = recommendation.character;
    applyEqualizerAudioGains();
    initEqualizerUI();
  }

  function setAutoEqualizer(enabled, notify = true) {
    enabled = !!enabled;
    if (enabled && !state.eq.auto) {
      state.eq.manual = {
        enabled: state.eq.enabled,
        preset: state.eq.preset === 'auto' ? 'flat' : state.eq.preset,
        preamp: state.eq.preamp,
        bands: [...state.eq.bands]
      };
    }
    state.eq.auto = enabled;
    if (enabled) {
      autoEqCharacter = 'learning';
      const track = (queue ? queue.getCurrentTrack() : null) || state.tracks.find(item => item.id === state.currentTrackId);
      if (track) applyAutoEqualizer(track);
      else {
        state.eq.enabled = true; state.eq.preset = 'auto'; state.eq.preamp = 0; state.eq.bands = [...EQ_PRESETS.flat];
      }
    } else {
      const manual = state.eq.manual;
      if (manual && Array.isArray(manual.bands) && manual.bands.length === 8) {
        state.eq.enabled = manual.enabled !== false;
        state.eq.preset = manual.preset || 'custom';
        state.eq.preamp = Number(manual.preamp) || 0;
        state.eq.bands = [...manual.bands];
      }
      state.eq.manual = null;
      autoEqCharacter = 'learning';
    }
    initEqualizerUI();
    saveEqualizerState();
    if (notify) showToast(state.lang === 'ru'
      ? (enabled ? 'Автоэквалайзер включён' : 'Ручные настройки возвращены')
      : (enabled ? 'Auto equalizer enabled' : 'Manual settings restored'), enabled ? 'EQ' : '✓');
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

  function savePlaybackPosition(force = false) {
    if (!state.currentTrackId) return;
    const now = performance.now();
    if (!force && now - lastPlaybackSave < 5000) return;
    const position = pendingSeekTime ?? audio.currentTime;
    if (!Number.isFinite(position) || position < 0) return;
    try {
      localStorage.setItem('pain_last_playback', JSON.stringify({id: state.currentTrackId, position}));
      lastPlaybackSave = now;
    } catch (_) {}
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
          state.libraryDirty = true;
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
          invalidatePlayCountsCache();
          if (queue) setQueueTasteStats(st);
        }
      }

      // Refresh UI components
      renderPlaylistsSidebar();
      updateSidebarLikedCount();
      renderCurrentView();

      // If library is populated, prepare first track in player bar
      if (state.tracks.length > 0 && state.currentTrackIndex === -1) {
        let saved = null;
        try { saved = JSON.parse(localStorage.getItem('pain_last_playback')); } catch (_) {}
        const savedIndex = state.tracks.findIndex(t => t.id === saved?.id);
        state.currentTrackIndex = Math.max(0, savedIndex);
        const track = state.tracks[state.currentTrackIndex];
        state.currentTrackId = track.id;
        const duration = Math.max(0, Number(track.duration) || 0) / 1000;
        const position = savedIndex >= 0 && Number.isFinite(saved?.position) && saved.position >= 0
          && (!duration || saved.position < duration) ? saved.position : 0;
        pendingSeekTime = position;
        if (queue && queue.getTracks().length === 0) {
          queue.setContext('library', state.tracks, state.currentTrackIndex, state.lang === 'ru' ? 'Фонотека' : 'Library', true);
        }
        updatePlayerBarUI(track, false);
        DOM.currentTime.textContent = formatTime(position);
        const pct = duration ? Math.min(100, position / duration * 100) : 0;
        DOM.progressFill.style.width = `${pct}%`;
        if (DOM.progressThumb) DOM.progressThumb.style.left = `${pct}%`;
        updatePlayingRowUI();
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
    } else if (state.currentView === 'joint-ai') {
      renderJointAIView();
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

    state.libraryDirty = true;
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
    } else if (state.categoryFilter === 'cached') {
      list = list.filter(t => state.cachedTracks && state.cachedTracks.has(t.id.replace(/[/\\?%*:|"<>]/g, '_')));
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

  let playCountsCache = null;
  function getTrackPlayCount(trackId) {
    if (!trackId || !state.stats || !state.stats.plays) return 0;
    if (!playCountsCache) {
      playCountsCache = new Map();
      const plays = state.stats.plays;
      for (let i = 0; i < plays.length; i++) {
        const tid = plays[i] && plays[i].track;
        if (tid) playCountsCache.set(tid, (playCountsCache.get(tid) || 0) + 1);
      }
    }
    return playCountsCache.get(trackId) || 0;
  }

  function invalidatePlayCountsCache() {
    playCountsCache = null;
  }

  // --- LIBRARY RENDERING ---
  function renderLibrary(force = false) {
    const hasRendered = state.viewMode === 'grid'
      ? (DOM.tracksGrid && DOM.tracksGrid.children.length > 0)
      : (DOM.tracksTableBody && DOM.tracksTableBody.children.length > 0);

    // If not dirty and already rendered in DOM, avoid wiping and re-rendering all rows
    if (!state.libraryDirty && !force && hasRendered) {
      updatePlayingRowUI();
      return;
    }

    state.libraryDirty = false;
    const processed = getProcessedTracks(state.tracks);

    // Update Header Counter
    const totalBytes = state.tracks.reduce((acc, t) => acc + (t.bytes || 0), 0);
    const gb = (totalBytes / 1e9).toFixed(1);
    DOM.libraryCountSub.textContent = state.lang === 'ru'
      ? `${processed.length} из ${state.tracks.length} треков · ${gb} ГБ · синхронизировано с телефоном`
      : `${processed.length} of ${state.tracks.length} tracks · ${gb} GB · synced with phone`;

    const contextInfo = { type: 'library', title: state.lang === 'ru' ? 'Фонотека' : 'Library', id: 'library', allowNew: !state.searchQuery && state.categoryFilter === 'all' };
    if (state.viewMode === 'grid') {
      renderTracksGrid(DOM.tracksGrid, processed, contextInfo);
    } else {
      renderTracksTable(DOM.tracksTableBody, processed, true, contextInfo);
    }
  }

  // --- RENDERING: LIST TABLE WITH DRAG & DROP ---
  function ensureTableDelegation(container) {
    if (container._hasDelegatedListener) return;
    container._hasDelegatedListener = true;

    // Single delegated click listener for play, fav, add to playlist, uncache
    container.addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-track-id]');
      if (!tr) return;
      const trackId = tr.dataset.trackId;
      const trackList = container._currentTrackList || [];
      const contextInfo = container._currentContextInfo || null;
      const track = trackList.find(t => t.id === trackId) || state.tracks.find(t => t.id === trackId);
      if (!track) return;

      const favBtn = e.target.closest('.row-fav-btn');
      if (favBtn) {
        e.stopPropagation();
        toggleFavorite(track.id, favBtn);
        return;
      }

      const moreBtn = e.target.closest('.row-more-btn');
      if (moreBtn) {
        e.stopPropagation();
        openAddToPlaylistModal(track.id);
        return;
      }

      const uncacheBtn = e.target.closest('.row-uncache-btn');
      if (uncacheBtn) {
        e.stopPropagation();
        deleteTrackFromCache(track.id, track.title);
        return;
      }

      const excludeBtn = e.target.closest('.row-exclude-btn');
      if (excludeBtn) {
        e.stopPropagation();
        toggleExcludeRecommendation(track.id);
        return;
      }

      const momentBadge = e.target.closest('.row-moment-badge');
      if (momentBadge) {
        e.stopPropagation();
        const targetTrackId = momentBadge.dataset.trackId;
        const targetMoment = typeof FavoriteMoments !== 'undefined'
          ? FavoriteMoments.getMoment(state.favoriteMoments, targetTrackId)
          : state.favoriteMoments?.[targetTrackId];
        if (targetMoment !== null && targetMoment !== undefined) {
          if (state.currentTrackId === targetTrackId) {
            seekToPercent(targetMoment / (getCurrentTrackDuration() || 1));
          } else {
            const targetTrack = state.tracks.find(t => t.id === targetTrackId);
            if (targetTrack) {
              playTrackInContext(targetTrack, container._currentTrackList || state.tracks, container._currentContextInfo);
              pendingSeekTime = targetMoment;
            }
          }
        }
        return;
      }

      if (!e.target.closest('button')) {
        playTrackInContext(track, trackList, contextInfo);
      }
    });

    // Single delegated capture listener for image error fallback (zero per-row querySelectors)
    container.addEventListener('error', (e) => {
      const img = e.target;
      if (img && img.classList && img.classList.contains('row-thumb-img')) {
        img.onerror = null;
        const tr = img.closest('tr');
        if (tr && tr.dataset.trackId) {
          const track = (container._currentTrackList || []).find(t => t.id === tr.dataset.trackId) || state.tracks.find(t => t.id === tr.dataset.trackId);
          if (track) img.src = getProceduralCoverSvg(track);
        }
      }
    }, true);

    // Delegated Drag & Drop listeners (eliminating 3800+ individual row listeners)
    container.addEventListener('dragstart', (e) => {
      const tr = e.target.closest('tr[draggable="true"]');
      if (tr) handleDragStart(e);
    });
    container.addEventListener('dragover', (e) => {
      const tr = e.target.closest('tr');
      if (tr) handleDragOver(e);
    });
    container.addEventListener('dragleave', (e) => {
      const tr = e.target.closest('tr');
      if (tr) handleDragLeave(e);
    });
    container.addEventListener('drop', (e) => {
      const tr = e.target.closest('tr');
      if (tr) handleDrop(e);
    });
    container.addEventListener('dragend', (e) => {
      handleDragEnd(e);
    });
  }

  // Each list owns its pending work: switching views must not cancel another list.
  function cancelTrackRender(container) {
    if (container._renderFrame != null) cancelAnimationFrame(container._renderFrame);
    container._renderFrame = null;
  }

  function appendTrackBatches(container, trackList, createItem, firstBatchSize) {
    let nextIndex = 0;
    function appendBatch(limit) {
      const start = performance.now();
      const fragment = document.createDocumentFragment();
      let count = 0;
      do {
        fragment.appendChild(createItem(trackList[nextIndex], nextIndex));
        nextIndex++;count++;
      } while (nextIndex < trackList.length && count < limit && performance.now() - start < 3);
      container.appendChild(fragment);
      if (nextIndex < trackList.length) container._renderFrame = requestAnimationFrame(() => {
        container._renderFrame = null;
        appendBatch(20);
      });
    }
    appendBatch(firstBatchSize);
  }

  function createTrackRow(track, index, enableDragAndDrop) {
    const isCurrent = state.currentTrackId === track.id;
    const isPlayingCurrent = isCurrent && state.isPlaying;
    const durationSec = Math.max(0, Number(track.duration) || 0) / 1000;
    const plays = getTrackPlayCount(track.id);
    const isExcluded = state.excludedRecommendations.has(String(track.id));

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
        <img class="row-thumb-img" src="${getCoverUrl(track)}" alt="" loading="lazy" decoding="async">
      </td>
      <td class="col-title">
        <div class="track-row-title ${isCurrent ? 'active-text' : ''}">${escapeHtml(track.title || 'Untitled')}</div>
        <div class="track-row-sub">${escapeHtml(track.artist || 'Unknown Artist')}</div>
      </td>
      <td class="col-album">${escapeHtml(track.album || '—')}</td>
      <td class="col-plays">${plays}</td>
      <td class="col-time">${(() => {
        const m = typeof FavoriteMoments !== 'undefined' ? FavoriteMoments.getMoment(state.favoriteMoments, track.id) : (state.favoriteMoments ? state.favoriteMoments[track.id] : null);
        return m !== null && m !== undefined ? `<span class="row-moment-badge" data-track-id="${escapeHtml(track.id)}" title="${state.lang === 'ru' ? 'Любимый момент: ' + (typeof FavoriteMoments !== 'undefined' ? FavoriteMoments.formatTime(m) : formatTime(m)) : 'Favorite moment: ' + (typeof FavoriteMoments !== 'undefined' ? FavoriteMoments.formatTime(m) : formatTime(m))}">${typeof FavoriteMoments !== 'undefined' ? FavoriteMoments.formatTime(m) : formatTime(m)}</span>` : '';
      })()}${formatTime(durationSec)}</td>
      <td class="col-actions">
        <button class="row-exclude-btn ${isExcluded ? 'active' : ''}" data-track-id="${escapeHtml(track.id)}" title="${isExcluded ? (state.lang === 'ru' ? 'Вернуть в рекомендации' : 'Include in recommendations') : (state.lang === 'ru' ? 'Исключить из рекомендаций' : 'Do not recommend')}">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><line x1="5.7" y1="5.7" x2="18.3" y2="18.3"/></svg>
        </button>
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
    return tr;
  }

  function renderTracksTable(container, trackList, enableDragAndDrop = true, contextInfo = null) {
    cancelTrackRender(container);
    container.innerHTML = '';
    container._currentTrackList = trackList;
    container._currentContextInfo = contextInfo;
    ensureTableDelegation(container);

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

    appendTrackBatches(container, trackList,
      (track, index) => createTrackRow(track, index, enableDragAndDrop), 24);
  }

  function ensureGridDelegation(container) {
    if (container._hasDelegatedListener) return;
    container._hasDelegatedListener = true;

    container.addEventListener('click', (e) => {
      const card = e.target.closest('.track-card[data-track-id]');
      if (!card) return;
      const trackId = card.dataset.trackId;
      const trackList = container._currentTrackList || [];
      const contextInfo = container._currentContextInfo || null;
      const track = trackList.find(t => t.id === trackId) || state.tracks.find(t => t.id === trackId);
      if (!track) return;

      const favBtn = e.target.closest('.card-fav-btn');
      if (favBtn) {
        e.stopPropagation();
        toggleFavorite(track.id, favBtn);
        return;
      }

      const addBtn = e.target.closest('.card-add-btn');
      if (addBtn) {
        e.stopPropagation();
        openAddToPlaylistModal(track.id);
        return;
      }

      const uncacheBtn = e.target.closest('.card-uncache-btn');
      if (uncacheBtn) {
        e.stopPropagation();
        deleteTrackFromCache(track.id, track.title);
        return;
      }

      const excludeBtn = e.target.closest('.card-exclude-btn');
      if (excludeBtn) {
        e.stopPropagation();
        toggleExcludeRecommendation(track.id);
        return;
      }

      playTrackInContext(track, trackList, contextInfo);
    });

    container.addEventListener('error', (e) => {
      const img = e.target;
      if (img && img.classList && img.classList.contains('track-card-img')) {
        img.onerror = null;
        const card = img.closest('.track-card');
        if (card && card.dataset.trackId) {
          const track = (container._currentTrackList || []).find(t => t.id === card.dataset.trackId) || state.tracks.find(t => t.id === card.dataset.trackId);
          if (track) img.src = getProceduralCoverSvg(track);
        }
      }
    }, true);
  }

  function createTrackCard(track) {
    const isCurrent = state.currentTrackId === track.id;
    const isPlayingCurrent = isCurrent && state.isPlaying;
    const durationSec = Math.max(0, Number(track.duration) || 0) / 1000;
    const isExcluded = state.excludedRecommendations.has(String(track.id));

    const card = document.createElement('div');
    card.className = `track-card ${isCurrent ? 'playing-card' : ''}`;
    card.dataset.trackId = track.id;

    card.innerHTML = `
      <div class="track-card-cover-wrapper">
        <img class="track-card-img" src="${getCoverUrl(track)}" alt="" loading="lazy" decoding="async">
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
          <button class="card-exclude-btn ${isExcluded ? 'active' : ''}" data-track-id="${escapeHtml(track.id)}" title="${isExcluded ? (state.lang === 'ru' ? 'Вернуть в рекомендации' : 'Include in recommendations') : (state.lang === 'ru' ? 'Исключить из рекомендаций' : 'Do not recommend')}">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><line x1="5.7" y1="5.7" x2="18.3" y2="18.3"/></svg>
          </button>
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
    return card;
  }

  // --- RENDERING: GRID CARDS ---
  function renderTracksGrid(container, trackList, contextInfo = null) {
    cancelTrackRender(container);
    container.innerHTML = '';
    container._currentTrackList = trackList;
    container._currentContextInfo = contextInfo;
    ensureGridDelegation(container);

    if (trackList.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 48px; color: var(--ink-secondary); font-size: 13px;">
          ${state.lang === 'ru' ? 'Нет треков для отображения' : 'No tracks to display'}
        </div>
      `;
      return;
    }

    appendTrackBatches(container, trackList, createTrackCard, 12);
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
        state.libraryDirty = true;
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
    const details = ListeningInsights.build(state.tracks, state.stats);
    const plays = details.plays;
    const now = new Date();
    const isRu = state.lang === 'ru';

    // 1. Total Listening Time
    const totalMs = details.totalMs;
    const totalMinutes = Math.floor(totalMs / 60000);
    const totalHours = Math.floor(totalMinutes / 60);

    if (DOM.statTotalTime) {
      DOM.statTotalTime.textContent = totalHours > 0 
        ? (isRu ? `${totalHours} ч ${totalMinutes % 60} мин` : `${totalHours} h ${totalMinutes % 60} m`)
        : (isRu ? `${totalMinutes} мин` : `${totalMinutes} m`);
    }

    // 2. Today's Listening Time
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const todayMs = details.days.get(ListeningInsights.dayKey(todayStart)) || 0;
    const todayMinutes = Math.round(todayMs / 60000);
    if (DOM.statTodayTime) {
      DOM.statTodayTime.textContent = isRu ? `Сегодня: ${todayMinutes} мин` : `Today: ${todayMinutes} min`;
    }

    // 3. Unique Tracks & Total Plays
    const uniqueTracks = new Set(plays.map(p => p.track)).size;
    if (DOM.statUnique) DOM.statUnique.textContent = uniqueTracks;
    if (DOM.statPlays) DOM.statPlays.textContent = isRu ? `${plays.length} прослушиваний` : `${plays.length} plays recorded`;

    // 4. 24-Hour Listening Distribution & Peak Hour
    const hours = details.hours;

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
        col.title = `${String(h).padStart(2, '0')}:00 — ${Math.round(ms / 60000)} ${isRu ? 'мин' : 'min'}`;
        col.innerHTML = `
          <div class="hour-pill ${isPeak ? 'peak' : ''}" style="height: ${pct}px;"></div>
          <div class="hour-label">${h % 4 === 0 ? String(h).padStart(2, '0') : ''}</div>
        `;
        DOM.hourlyBars.appendChild(col);
      });
    }

    // 5. Streaks (Current & Longest Active Days)
    const activeDays = new Set(details.days.keys());

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
    const dayTotalsMs = past7Days.map(d => details.days.get(ListeningInsights.dayKey(d)) || 0);

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
        col.title = `${d.toLocaleDateString()}: ${Math.round(ms / 60000)} ${isRu ? 'мин' : 'min'}`;
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
    renderListeningDetails(details);
  }

  function renderListeningDetails(details) {
    const ru = state.lang === 'ru', locale = ru ? 'ru-RU' : 'en-US';
    const time = ms => {
      if (ms > 0 && ms < 60000) return ru ? 'меньше минуты' : 'under a minute';
      const minutes = Math.floor(ms / 60000), hours = Math.floor(minutes / 60);
      return hours ? (ru ? `${hours} ч ${minutes % 60} мин` : `${hours} h ${minutes % 60} min`) : `${minutes} ${ru ? 'мин' : 'min'}`;
    };
    const date = key => new Date(key + 'T12:00:00').toLocaleDateString(locale, {day:'numeric', month:'long', year:'numeric'});
    const title = id => state.tracks.find(t => String(t.id) === id)?.title || (ru ? 'Трек вне фонотеки' : 'Track outside your library');
    const percent = (a,b) => b > 0 ? `${Math.round(100 * a / b)}%` : '—';
    const cards = [
      [ru ? 'Трек-ритуал' : 'A daily ritual', details.ritual ? title(details.ritual.track) : '—',
        details.ritual ? (ru ? `${details.ritual.days} разных дней за последние 28 дней` : `${details.ritual.days} distinct days in the last 28 days`) : (ru ? 'Появится, когда вернётесь к треку в другой день.' : 'Appears when you return to a track on another day.')],
      [ru ? 'Долгожданное возвращение' : 'A long-awaited return', details.comeback ? title(details.comeback.track) : '—',
        details.comeback ? (ru ? `Возвращение после ${details.comeback.days} дн. перерыва. За последние 30 дней.` : `Back after ${details.comeback.days} days away. In the last 30 days.`) : (ru ? 'Здесь будет трек, к которому вы вернулись после недели перерыва.' : 'A track revisited after at least a week away will appear here.')],
      [ru ? 'Открытия, которые остались' : 'Discoveries that stayed', percent(details.retained, details.discoveries),
        ru ? `${details.retained} из ${details.discoveries} новых в истории треков слушались в разные дни. За 30 дней.` : `${details.retained} of ${details.discoveries} tracks new to your history heard on different days. Last 30 days.`],
      [ru ? 'За пределами избранного' : 'Beyond your favourites', percent(details.outsideFavorites, details.knownTime),
        ru ? 'Доля времени на треки фонотеки, у которых сейчас нет лайка.' : 'Listening time spent on library tracks that are not currently liked.'],
      [ru ? 'Глубина фонотеки' : 'Library explored', percent(details.heardLibrary, details.librarySize),
        ru ? `${details.heardLibrary} из ${details.librarySize} треков слушались хотя бы 30 секунд или половину короткого трека.` : `${details.heardLibrary} of ${details.librarySize} tracks heard for 30 seconds, or half of a short track.`],
      [ru ? 'Самый музыкальный день' : 'Your biggest music day', details.record ? time(details.record.ms) : '—',
        details.record ? date(details.record.day) : (ru ? 'Рекорд появится после первого прослушивания.' : 'Your record appears after your first listen.')]
    ];
    document.getElementById('listeningDetailCards').innerHTML = cards.map(([label,value,description]) => `
      <article class="stat-card listening-detail-card">
        <div class="stat-label">${escapeHtml(label)}</div>
        <div class="listening-detail-value">${escapeHtml(value)}</div>
        <p class="stat-sub">${escapeHtml(description)}</p>
      </article>`).join('');
    const active = details.calendar.filter(day => day.ms > 0).length;
    const total = details.calendar.reduce((sum,day) => sum + day.ms, 0);
    document.getElementById('listeningCalendarSummary').textContent = ru
      ? `${active} дней с музыкой из 28. Всего ${time(total)}.` : `${active} music days out of 28. ${time(total)} total.`;
    const max = Math.max(1, ...details.calendar.map(day => day.ms));
    document.getElementById('listeningCalendarDays').innerHTML = details.calendar.map(day => {
      const level = day.ms > 0 ? Math.max(1, Math.ceil(4 * day.ms / max)) : 0;
      const description = `${date(day.day)}: ${time(day.ms)}`;
      return `<div class="listening-calendar-day" role="listitem" tabindex="0" data-level="${level}" aria-label="${escapeHtml(description)}">
        <span aria-hidden="true">${new Date(day.at).getDate()}</span><span class="listening-day-tooltip" aria-hidden="true">${escapeHtml(description)}</span>
      </div>`;
    }).join('');
  }

  // --- PROFILE SHARE CARD ---
  let currentProfileData = null;
  let profileCanvasCache = null;

  function openProfileModal() {
    if (typeof ProfileCard === 'undefined') return;
    currentProfileData = ProfileCard.collectProfileData(state.tracks, state.stats, state.lang);
    state.currentProfileData = currentProfileData;
    profileCanvasCache = null;

    if (DOM.shareProfileModalBody) {
      DOM.shareProfileModalBody.innerHTML = ProfileCard.renderProfileCardHtml(currentProfileData, getCoverUrl);
    }
    if (DOM.shareProfileModalBackdrop) {
      DOM.shareProfileModalBackdrop.style.display = 'flex';
      DOM.shareProfileModalBackdrop.setAttribute('aria-hidden', 'false');
      requestAnimationFrame(() => {
        DOM.shareProfileModalBackdrop.classList.add('open');
      });
    }
  }

  function closeProfileModal() {
    if (!DOM.shareProfileModalBackdrop) return;
    DOM.shareProfileModalBackdrop.classList.remove('open');
    DOM.shareProfileModalBackdrop.setAttribute('aria-hidden', 'true');
    setTimeout(() => {
      if (!DOM.shareProfileModalBackdrop.classList.contains('open')) {
        DOM.shareProfileModalBackdrop.style.display = 'none';
      }
    }, 280);
    if (window.location.hash === '#profile') {
      try {
        history.replaceState(null, '', window.location.pathname + window.location.search);
      } catch (_) {}
    }
  }

  async function getOrRenderProfileCanvas() {
    if (profileCanvasCache) return profileCanvasCache;
    if (!currentProfileData && typeof ProfileCard !== 'undefined') {
      currentProfileData = ProfileCard.collectProfileData(state.tracks, state.stats, state.lang);
    }
    profileCanvasCache = await ProfileCard.renderProfileCardCanvas(currentProfileData, getCoverUrl);
    return profileCanvasCache;
  }

  // --- AUDIO PLAYBACK ENGINE & CONTEXT-AWARE QUEUE ---
  function playTrackObject(track, startPosition = 0) {
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

    playingTrackSnapshot = {...track};
    if (state.eq.auto) applyAutoEqualizer(track);
    pendingSeekTime = startPosition > 0 ? startPosition : null;
    audio.src = `/api/cached-track/${encodeURIComponent(track.id)}?phoneUrl=${encodeURIComponent(state.phoneUrl)}`;
    savePlaybackPosition(true);
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
      queue.setContext(contextInfo?.type || 'library', list, idx !== -1 ? idx : 0, contextInfo?.title, !!contextInfo?.allowNew);
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
      queue.setContext('library', state.tracks, idx !== -1 ? idx : 0, state.lang === 'ru' ? 'Фонотека' : 'Library', true);
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
      DOM.bottomTrackContext.dataset.contextLabel = '';
      DOM.bottomTrackContext.disabled = true;
      window.dispatchEvent(new Event('pain:queue-ui'));
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
      badge = ' · Smart DJ';
    } else if (info.shuffleMode === 'random') {
      badge = isRu ? ' · 🔀 Случайно' : ' · 🔀 Shuffle';
    }
    DOM.bottomTrackContext.dataset.contextLabel = `${ctxName} · ${pos} ${isRu ? 'из' : 'of'} ${info.total}`;
    DOM.bottomTrackContext.textContent = DOM.bottomTrackContext.dataset.contextLabel + badge;
    window.dispatchEvent(new Event('pain:queue-ui'));
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
    // 1. Demote old active table rows that are no longer the current track
    const prevActiveRows = document.querySelectorAll('.tracks-table tbody tr.playing-row');
    prevActiveRows.forEach(tr => {
      if (tr.dataset.trackId !== state.currentTrackId) {
        tr.classList.remove('playing-row');
        const titleEl = tr.querySelector('.track-row-title');
        if (titleEl) titleEl.classList.remove('active-text');
        const indexNumSpan = tr.querySelector('.index-num');
        if (indexNumSpan) {
          const idx = parseInt(tr.dataset.index, 10);
          indexNumSpan.textContent = isNaN(idx) ? '' : (idx + 1);
          indexNumSpan.style.color = '';
        }
      }
    });

    // 2. Promote current track table row(s)
    if (state.currentTrackId) {
      const currentRows = document.querySelectorAll(`.tracks-table tbody tr[data-track-id="${state.currentTrackId}"]`);
      currentRows.forEach(tr => {
        tr.classList.add('playing-row');
        const titleEl = tr.querySelector('.track-row-title');
        if (titleEl) titleEl.classList.add('active-text');
        const indexNumSpan = tr.querySelector('.index-num');
        if (indexNumSpan) {
          if (state.isPlaying) {
            indexNumSpan.textContent = '▶';
            indexNumSpan.style.color = 'var(--ink)';
          } else {
            const idx = parseInt(tr.dataset.index, 10);
            indexNumSpan.textContent = isNaN(idx) ? '' : (idx + 1);
            indexNumSpan.style.color = '';
          }
        }
      });
    }

    // 3. Demote old active grid cards
    const prevActiveCards = document.querySelectorAll('.track-card.playing-card');
    prevActiveCards.forEach(card => {
      if (card.dataset.trackId !== state.currentTrackId) {
        card.classList.remove('playing-card');
        const title = card.querySelector('.track-card-title');
        if (title) title.classList.remove('active-text');
        const overlay = card.querySelector('.track-card-play-overlay svg');
        if (overlay) overlay.innerHTML = '<polygon points="6 3 20 12 6 21 6 3"/>';
      }
    });

    // 4. Promote current grid card(s)
    if (state.currentTrackId) {
      const currentCards = document.querySelectorAll(`.track-card[data-track-id="${state.currentTrackId}"]`);
      currentCards.forEach(card => {
        card.classList.add('playing-card');
        const title = card.querySelector('.track-card-title');
        if (title) title.classList.add('active-text');
        const overlay = card.querySelector('.track-card-play-overlay svg');
        if (overlay) {
          overlay.innerHTML = state.isPlaying
            ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'
            : '<polygon points="6 3 20 12 6 21 6 3"/>';
        }
      });
    }
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
    updateFluidBpmTempo();
  }
  function togglePlay() {
    initAudioNodes();
    if (!audio.getAttribute('src')) {
      const target = (queue ? queue.getCurrentTrack() : null) || state.tracks[0];
      if (target) {
        playTrackObject(target, pendingSeekTime ?? 0);
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
    updateExcludedUI(track);
    updateFavoriteMomentUI(track);

    renderVinylPlayerView();
  }

  function updateFavoriteUI(isFav) {
    DOM.bottomFavoriteBtn.classList.toggle('active', !!isFav);
    DOM.bottomFavoriteBtn.setAttribute('aria-pressed', String(!!isFav));
    DOM.bottomFavoriteBtn.querySelector('svg').style.fill = isFav ? 'currentColor' : 'none';
  }

  function updateExcludedUI(track) {
    if (!DOM.bottomExcludeBtn) return;
    const isEx = track && state.excludedRecommendations.has(String(track.id));
    DOM.bottomExcludeBtn.classList.toggle('active', !!isEx);
    DOM.bottomExcludeBtn.title = isEx
      ? (state.lang === 'ru' ? 'Исключён из рекомендаций (нажмите, чтобы вернуть)' : 'Excluded from recommendations (click to restore)')
      : (state.lang === 'ru' ? 'Исключить из рекомендаций' : 'Do not recommend');
  }

  function updateExcludedButtonsUI() {
    const curTrack = (queue ? queue.getCurrentTrack() : null) || state.tracks.find(t => t.id === state.currentTrackId);
    updateExcludedUI(curTrack);

    document.querySelectorAll('.row-exclude-btn[data-track-id]').forEach(btn => {
      const id = btn.dataset.trackId;
      const isEx = state.excludedRecommendations.has(String(id));
      btn.classList.toggle('active', isEx);
      btn.title = isEx 
        ? (state.lang === 'ru' ? 'Вернуть в рекомендации' : 'Include in recommendations')
        : (state.lang === 'ru' ? 'Исключить из рекомендаций' : 'Do not recommend');
    });

    document.querySelectorAll('.card-exclude-btn[data-track-id]').forEach(btn => {
      const id = btn.dataset.trackId;
      const isEx = state.excludedRecommendations.has(String(id));
      btn.classList.toggle('active', isEx);
      btn.title = isEx 
        ? (state.lang === 'ru' ? 'Вернуть в рекомендации' : 'Include in recommendations')
        : (state.lang === 'ru' ? 'Исключить из рекомендаций' : 'Do not recommend');
    });
  }

  function toggleExcludeRecommendation(trackId) {
    if (trackId == null) return;
    const idStr = String(trackId);
    const track = state.tracks.find(t => String(t.id) === idStr);
    const title = track ? (track.title || idStr) : idStr;
    const isExcluded = state.excludedRecommendations.has(idStr);

    if (isExcluded) {
      state.excludedRecommendations.delete(idStr);
      if (queue && typeof queue.unexcludeTrack === 'function') {
        queue.unexcludeTrack(idStr);
      }
      showToast(state.lang === 'ru' 
        ? `Трек «${title}» возвращён в рекомендации` 
        : `Track "${title}" restored to recommendations`);
    } else {
      state.excludedRecommendations.add(idStr);
      if (queue && typeof queue.excludeTrack === 'function') {
        queue.excludeTrack(idStr);
      }
      showToast(state.lang === 'ru' 
        ? `Трек «${title}» исключён из рекомендаций навсегда` 
        : `Track "${title}" excluded from recommendations`);
    }

    try {
      localStorage.setItem('pain_excluded_recommendations', JSON.stringify(Array.from(state.excludedRecommendations)));
    } catch (e) {}

    updateExcludedButtonsUI();
    updateSettingsExcludedSection();
  }

  function updateSettingsExcludedSection() {
    const count = state.excludedRecommendations.size;
    if (DOM.excludedTracksCountHint) {
      DOM.excludedTracksCountHint.textContent = state.lang === 'ru'
        ? `${count} ${count === 1 ? 'трек исключён' : (count >= 2 && count <= 4 ? 'трека исключено' : 'треков исключено')}`
        : `${count} ${count === 1 ? 'track' : 'tracks'} excluded`;
    }
    renderExcludedTracksList();
  }

  function renderExcludedTracksList() {
    if (!DOM.excludedTracksListContent) return;
    DOM.excludedTracksListContent.innerHTML = '';
    const ids = Array.from(state.excludedRecommendations);
    if (ids.length === 0) {
      DOM.excludedTracksListContent.innerHTML = `
        <div style="font-size:12px; color:var(--ink-muted); text-align:center; padding:8px;">
          ${state.lang === 'ru' ? 'Нет исключённых треков' : 'No excluded tracks'}
        </div>
      `;
      return;
    }
    ids.forEach(id => {
      const track = state.tracks.find(t => String(t.id) === String(id));
      const title = track ? (track.title || 'Untitled') : `Track ID: ${id}`;
      const artist = track ? (track.artist || 'Unknown Artist') : '';

      const item = document.createElement('div');
      item.className = 'excluded-track-item';
      item.innerHTML = `
        <div class="excluded-track-info">
          <span class="excluded-track-title">${escapeHtml(title)}</span>
          <span class="excluded-track-artist">${escapeHtml(artist)}</span>
        </div>
        <button type="button" class="btn-minimal" data-restore-id="${escapeHtml(id)}" style="padding:2px 8px; font-size:11px;">
          ${state.lang === 'ru' ? 'Вернуть' : 'Restore'}
        </button>
      `;
      const restoreBtn = item.querySelector('button');
      restoreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleExcludeRecommendation(id);
      });
      DOM.excludedTracksListContent.appendChild(item);
    });
  }

  // --- FAVORITE MOMENTS (PER-TRACK BOOKMARK) ---
  function saveFavoriteMoments() {
    try {
      const data = typeof FavoriteMoments !== 'undefined'
        ? FavoriteMoments.serialize(state.favoriteMoments)
        : JSON.stringify(state.favoriteMoments || {});
      localStorage.setItem('pain_favorite_moments', data);
    } catch (_) {}
  }

  function updateFavoriteMomentUI(track = null) {
    const curTrack = track || (queue ? queue.getCurrentTrack() : null) || state.tracks.find(t => t.id === state.currentTrackId);
    const trackId = curTrack?.id;
    const moment = trackId && typeof FavoriteMoments !== 'undefined'
      ? FavoriteMoments.getMoment(state.favoriteMoments, trackId)
      : (trackId ? (state.favoriteMoments?.[trackId] ?? null) : null);
    const dur = getCurrentTrackDuration();
    const ru = state.lang === 'ru';
    const hasMoment = moment !== null && moment !== undefined && Number.isFinite(moment);
    const timeStr = hasMoment
      ? (typeof FavoriteMoments !== 'undefined' ? FavoriteMoments.formatTime(moment) : formatTime(moment))
      : '';

    if (DOM.bottomMomentBtn) {
      if (hasMoment) {
        DOM.bottomMomentBtn.classList.add('active');
        DOM.bottomMomentBtn.title = ru
          ? `Любимый момент: ${timeStr} (клик — перейти, Shift+клик — обновить, правый клик — удалить)`
          : `Favorite moment: ${timeStr} (click to seek, Shift+click to update, right-click to remove)`;
      } else {
        DOM.bottomMomentBtn.classList.remove('active');
        DOM.bottomMomentBtn.title = ru ? 'Сохранить любимый момент' : 'Save favorite moment';
      }
    }

    if (DOM.seekMomentBadge) {
      if (hasMoment) {
        DOM.seekMomentBadge.style.display = 'inline-flex';
        if (DOM.seekMomentTime) DOM.seekMomentTime.textContent = timeStr;
      } else {
        DOM.seekMomentBadge.style.display = 'none';
      }
    }

    if (DOM.progressMomentMarker) {
      if (hasMoment && dur > 0) {
        const pct = Math.max(0, Math.min(100, (moment / dur) * 100));
        DOM.progressMomentMarker.style.display = 'block';
        DOM.progressMomentMarker.style.left = `${pct}%`;
        DOM.progressMomentMarker.title = ru ? `Любимый момент: ${timeStr}` : `Favorite moment: ${timeStr}`;
      } else {
        DOM.progressMomentMarker.style.display = 'none';
      }
    }
  }

  function setFavoriteMomentForCurrentTrack(targetPos = null) {
    const curTrack = (queue ? queue.getCurrentTrack() : null) || state.tracks.find(t => t.id === state.currentTrackId);
    if (!curTrack) return;
    const dur = getCurrentTrackDuration();
    const pos = targetPos !== null ? targetPos : audio.currentTime;
    if (!Number.isFinite(pos) || pos < 0) return;
    const saved = typeof FavoriteMoments !== 'undefined'
      ? FavoriteMoments.setMoment(state.favoriteMoments, curTrack.id, pos, dur)
      : (() => {
          const clamped = Math.max(0, Math.min(dur > 0 ? dur : pos, pos));
          const val = Math.round(clamped * 10) / 10;
          state.favoriteMoments[curTrack.id] = val;
          return val;
        })();
    if (saved !== null && saved !== undefined) {
      saveFavoriteMoments();
      updateFavoriteMomentUI(curTrack);
      renderCurrentView();
      const timeStr = typeof FavoriteMoments !== 'undefined' ? FavoriteMoments.formatTime(saved) : formatTime(saved);
      showToast(state.lang === 'ru' ? `Любимый момент: ${timeStr}` : `Favorite moment: ${timeStr}`, '★');
    }
  }

  function seekToFavoriteMoment(trackId = state.currentTrackId) {
    if (!trackId) return;
    const moment = typeof FavoriteMoments !== 'undefined'
      ? FavoriteMoments.getMoment(state.favoriteMoments, trackId)
      : (state.favoriteMoments?.[trackId] ?? null);
    if (moment === null || moment === undefined || !Number.isFinite(moment)) return;
    const dur = getCurrentTrackDuration();
    if (dur > 0) {
      seekToPercent(moment / dur);
    }
  }

  function removeFavoriteMoment(trackId = state.currentTrackId) {
    if (!trackId) return;
    const removed = typeof FavoriteMoments !== 'undefined'
      ? FavoriteMoments.removeMoment(state.favoriteMoments, trackId)
      : (() => {
          if (trackId in state.favoriteMoments) { delete state.favoriteMoments[trackId]; return true; }
          return false;
        })();
    if (removed) {
      saveFavoriteMoments();
      updateFavoriteMomentUI();
      renderCurrentView();
      showToast(state.lang === 'ru' ? 'Любимый момент удалён' : 'Favorite moment removed', '✓');
    }
  }

  function updateSidebarLikedCount() {
    const count = state.tracks.filter(t => !!t.favorite).length;
    DOM.sidebarLikedCount.textContent = state.lang === 'ru' ? `${count} треков` : `${count} tracks`;
  }

  // --- 2-WAY SYNC: FAVORITES & STATS ---
  function animateFavorite(buttons, isFavorite) {
    const animation = isFavorite ? 'favorite-pop' : 'favorite-unpop';
    for (const button of new Set(buttons.filter(Boolean))) {
      button.classList.remove('favorite-pop', 'favorite-unpop');
      void button.offsetWidth;
      button.classList.add(animation);
      setTimeout(() => button.classList.remove(animation), 650);
    }
  }

  async function toggleFavorite(trackId, sourceButton = null) {
    const track = state.tracks.find(t => t.id === trackId);
    if (!track) return;

    track.favorite = !track.favorite;
    if (queue) setQueueTasteStats(state.stats);
    updateSidebarLikedCount();

    if (state.currentTrackId === track.id) {
      updateFavoriteUI(track.favorite);
    }

    // Direct DOM updates for instant feedback without re-rendering all rows
    const isFav = !!track.favorite;
    const selectorId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(String(track.id)) : String(track.id).replace(/["\\]/g, '\\$&');
    const visibleButtons = [];
    document.querySelectorAll(`tr[data-track-id="${selectorId}"] .row-fav-btn`).forEach(btn => {
      btn.classList.toggle('active', isFav);
      btn.setAttribute('aria-pressed', String(isFav));
      const svg = btn.querySelector('svg');
      if (svg) svg.style.fill = isFav ? 'currentColor' : 'none';
      visibleButtons.push(btn);
    });
    document.querySelectorAll(`.track-card[data-track-id="${selectorId}"] .card-fav-btn`).forEach(btn => {
      btn.classList.toggle('active', isFav);
      btn.setAttribute('aria-pressed', String(isFav));
      const svg = btn.querySelector('svg');
      if (svg) svg.setAttribute('fill', isFav ? 'currentColor' : 'none');
      visibleButtons.push(btn);
    });
    if (state.currentTrackId === track.id) visibleButtons.push(DOM.bottomFavoriteBtn);
    animateFavorite([sourceButton, ...visibleButtons], isFav);

    if (state.currentView === 'favorites' || state.sortOption === 'favorites-first' || state.categoryFilter === 'favorites') {
      state.libraryDirty = true;
      renderCurrentView();
    }

    localSyncRevision++;
    // Persist and relay through the ordered server outbox
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
  }

  function readTasteSkips(){
    try{const rows=JSON.parse(localStorage.getItem('pain_taste_skips')||'[]');return Array.isArray(rows)?rows:[];}catch(_){return [];}
  }
  function setQueueTasteStats(stats){
    queue.setStats({plays:[...(Array.isArray(stats?.plays)?stats.plays:[]),...readTasteSkips()]});
  }

  async function recordTrackFinished(trackId,explicitSkip=false) {
    if(!listening||listening.id!==trackId||listening.closed)return;
    const audible=listening.finish();
    if(!audible){
      if(explicitSkip && listening.heard>=1000 && listening.duration>0 && !listening._tasteRecorded){
        listening._tasteRecorded=true;
        const feedback={track:trackId,started:listening.started,heard:Math.round(listening.heard),duration:listening.duration,skipped:1};
        let skips=readTasteSkips();
        skips.push(feedback);skips=skips.slice(-2000);
        try{localStorage.setItem('pain_taste_skips',JSON.stringify(skips));}catch(_){}
        if(queue)queue.setStats({plays:[...(state.stats.plays||[]),...skips]});
      }
      return;
    }
    const now=Date.now();
    const playRecord={...audible,skipped:explicitSkip&&!audible.finished?1:0,id:'pc_'+(globalThis.crypto?.randomUUID?.() || now+'_'+Math.random().toString(36).slice(2)),session:'pc_companion',at:now,timestamp:now};
    const track=state.tracks.find(t=>t.id===trackId);
    if(!track)return;
    if (!state.stats.plays) state.stats.plays = [];
    state.stats.plays.push(playRecord);
    localSyncRevision++;
    invalidatePlayCountsCache();
    if (queue) setQueueTasteStats(state.stats);

    // 1. Immediately update live DOM play count for all rows showing this track
    const newPlayCount = getTrackPlayCount(track.id);
    document.querySelectorAll(`tr[data-track-id="${track.id}"] .col-plays`).forEach(el => {
      el.textContent = newPlayCount;
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

    // Insights are rendered when opened; avoid rebuilding a hidden lifetime history on each play.
    if(state.currentView==='insights')renderInsights();
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
    if (audio.currentTime > 3) {
      sampleListening();
      pendingSeekTime = null;
      audio.currentTime = 0;
      DOM.currentTime.textContent = formatTime(0);
      DOM.progressFill.style.width = '0%';
      if (DOM.progressThumb) DOM.progressThumb.style.left = '0%';
      savePlaybackPosition(true);
      return;
    }
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
    try {
      localStorage.setItem('pain_theme', theme);
    } catch (e) {}
    if (state.fluidColor && state.fluidColor.toLowerCase() !== '#7c4dff') {
      applyFluidColor(state.fluidColor);
    }
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
    updateFluidBpmTempo();
    updateAutoEqualizerUI();
    renderUpdateStatus();
    if (DOM.shareProfileModalBackdrop && DOM.shareProfileModalBackdrop.classList.contains('open')) {
      openProfileModal();
    }
  }

  // --- SETTINGS MODAL & AMBIENT FLUID CONTROLLER ---
  function openSettingsModal() {
    if (DOM.settingsModalBackdrop) {
      DOM.settingsModalBackdrop.style.display = 'flex';
      applyFluidColor(state.fluidColor);
      if (DOM.fluidBpmSyncSwitch) {
        DOM.fluidBpmSyncSwitch.checked = state.fluidBpmSync;
      }
      updateFluidBpmTempo();
      updateAutoEqualizerUI();
      updateSettingsExcludedSection();
    }
  }

  function closeSettingsModal() {
    if (DOM.settingsModalBackdrop) {
      DOM.settingsModalBackdrop.style.display = 'none';
    }
  }

  function renderUpdateStatus() {
    if (!DOM.updateStatusText || !DOM.updateActionBtn) return;
    const ru = state.lang === 'ru', status = updateStatus;
    DOM.updateStatusDot?.classList.toggle('available', !!status?.available);
    DOM.updateStatusDot?.classList.toggle('error', status?.status === 'error');
    DOM.updateActionBtn.disabled = ['checking', 'downloading', 'downloaded'].includes(status?.status);
    if (!status || status.status === 'checking') {
      DOM.updateStatusText.textContent = ru ? 'Проверка обновлений…' : 'Checking for updates…';
      DOM.updateActionBtn.textContent = ru ? 'Проверить' : 'Check';
    } else if (status.status === 'downloading' || status.status === 'downloaded') {
      DOM.updateStatusText.textContent = ru ? 'Загрузка и проверка обновления…' : 'Downloading and verifying update…';
      DOM.updateActionBtn.textContent = ru ? 'Загрузка…' : 'Downloading…';
    } else if (status.status === 'error') {
      DOM.updateStatusText.textContent = ru ? 'Не удалось проверить обновления' : 'Could not check for updates';
      DOM.updateActionBtn.textContent = ru ? 'Повторить' : 'Retry';
    } else if (status.available) {
      DOM.updateStatusText.textContent = ru
        ? `Доступна версия ${status.latestVersion} · сейчас ${status.currentVersion}`
        : `Version ${status.latestVersion} available · current ${status.currentVersion}`;
      DOM.updateActionBtn.textContent = status.canInstall ? (ru ? 'Обновить' : 'Update') : (ru ? 'Открыть релиз' : 'Open release');
    } else {
      DOM.updateStatusText.textContent = ru ? `Установлена свежая версия ${status.currentVersion}` : `Version ${status.currentVersion} is up to date`;
      DOM.updateActionBtn.textContent = ru ? 'Проверить' : 'Check';
    }
  }

  async function checkForUpdates(force = false, notify = false) {
    if (['downloading', 'downloaded'].includes(updateStatus?.status)) return;
    updateStatus = { ...(updateStatus || {}), status: 'checking' };
    renderUpdateStatus();
    try {
      const response = await fetch(`/api/update-status${force ? '?refresh=1' : ''}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Update check failed');
      updateStatus = await response.json();
      renderUpdateStatus();
      if (notify && updateStatus.available && !updateNoticeShown) {
        updateNoticeShown = true;
        showToast(state.lang === 'ru' ? `Доступно обновление ${updateStatus.latestVersion}` : `Update ${updateStatus.latestVersion} is available`, '↑');
      }
    } catch (_) {
      updateStatus = { ...(updateStatus || {}), status: 'error' };
      renderUpdateStatus();
    }
  }

  async function handleUpdateAction() {
    if (['checking', 'downloading', 'downloaded'].includes(updateStatus?.status)) return;
    if (updateStatus?.status === 'error') { await checkForUpdates(true, true); return; }
    if (!updateStatus?.available) { await checkForUpdates(true, true); return; }
    if (!updateStatus.canInstall) {
      if (updateStatus.page) window.open(updateStatus.page, '_blank', 'noopener');
      return;
    }
    updateStatus = { ...updateStatus, status: 'downloading' };
    renderUpdateStatus();
    try {
      const response = await fetch('/api/install-update', { method: 'POST', headers: { 'X-Pain-Update': 'install' } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Update failed');
      updateStatus = result;
      renderUpdateStatus();
      savePlaybackPosition(true);
      showToast(state.lang === 'ru' ? 'Обновление готово. Pain перезапускается…' : 'Update ready. Restarting Pain…', '↑');
      // The browser can retain the old JavaScript after the local server restarts.
      // Reload only after the new server reports the version we installed.
      const expected = result.latestVersion, deadline = Date.now() + 60000;
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        let status;
        try {
          const check = await fetch('/api/update-status', { cache: 'no-store', signal: AbortSignal.timeout(3000) });
          if (check.ok) status = await check.json();
        } catch (_) { continue; } // A brief disconnect is normal during restart.
        if (expected && status?.currentVersion === expected) { location.reload(); return; }
        if (status?.status === 'error') throw new Error(status.error || 'Restart failed');
      }
      throw new Error('Update restart timed out');
    } catch (error) {
      updateStatus = { ...updateStatus, status: 'error', error: error.message };
      renderUpdateStatus();
      showToast(state.lang === 'ru' ? 'Не удалось установить обновление' : 'Could not install update', '⚠');
    }
  }

  function hexToRgb(hex) {
    let clean = (hex || '').replace('#', '').trim();
    if (clean.length === 3) {
      clean = clean.split('').map(c => c + c).join('');
    }
    if (clean.length !== 6) return null;
    const num = parseInt(clean, 16);
    if (isNaN(num)) return null;
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255
    };
  }

  function applyFluidColor(hex) {
    if (!hex) hex = '#7c4dff';
    state.fluidColor = hex;
    try {
      localStorage.setItem('pain_fluid_color', hex);
    } catch (e) {}

    const root = document.documentElement;

    if (hex.toLowerCase() === '#7c4dff') {
      // Clear inline overrides so CSS stylesheet :root and [data-theme="dark"] take over cleanly
      root.style.removeProperty('--fluid-accent-base');
      root.style.removeProperty('--fluid-accent-light');
      root.style.removeProperty('--fluid-bg-color-1');
      root.style.removeProperty('--fluid-bg-color-2');
      root.style.removeProperty('--fluid-bg-color-3');
      root.style.removeProperty('--fluid-orb1-c1');
      root.style.removeProperty('--fluid-orb1-c2');
      root.style.removeProperty('--fluid-orb2-c1');
      root.style.removeProperty('--fluid-orb2-c2');
      root.style.removeProperty('--fluid-orb3-c1');
      root.style.removeProperty('--fluid-orb3-c2');
    } else {
      const rgb = hexToRgb(hex);
      if (rgb) {
        // Lighter accent variant
        const rLight = Math.min(255, Math.round(rgb.r * 0.65 + 255 * 0.35));
        const gLight = Math.min(255, Math.round(rgb.g * 0.65 + 255 * 0.35));
        const bLight = Math.min(255, Math.round(rgb.b * 0.65 + 255 * 0.35));

        // Secondary variant (slightly shifted)
        const rSec = Math.min(255, Math.round(rgb.r * 0.85 + rgb.b * 0.15));
        const gSec = Math.min(255, Math.round(rgb.g * 0.85 + rgb.r * 0.15));
        const bSec = Math.min(255, Math.round(rgb.b * 0.85 + rgb.g * 0.15));

        // Dark theme stops
        const rD1 = Math.round(rgb.r * 0.35);
        const gD1 = Math.round(rgb.g * 0.35);
        const bD1 = Math.round(rgb.b * 0.35);

        const rD2 = Math.round(rgb.r * 0.22);
        const gD2 = Math.round(rgb.g * 0.22);
        const bD2 = Math.round(rgb.b * 0.22);

        const rD3 = Math.round(rgb.r * 0.45);
        const gD3 = Math.round(rgb.g * 0.45);
        const bD3 = Math.round(rgb.b * 0.45);

        root.style.setProperty('--fluid-accent-base', hex);
        root.style.setProperty('--fluid-accent-light', `rgb(${rLight}, ${gLight}, ${bLight})`);

        const isDark = state.theme === 'dark' || root.getAttribute('data-theme') === 'dark';
        if (isDark) {
          root.style.setProperty('--fluid-bg-color-1', `rgba(${rD1}, ${gD1}, ${bD1}, 0.45)`);
          root.style.setProperty('--fluid-bg-color-2', `rgba(${rD2}, ${gD2}, ${bD2}, 0.55)`);
          root.style.setProperty('--fluid-bg-color-3', `rgba(${rD3}, ${gD3}, ${bD3}, 0.38)`);

          root.style.setProperty('--fluid-orb1-c1', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.30)`);
          root.style.setProperty('--fluid-orb1-c2', `rgba(${rLight}, ${gLight}, ${bLight}, 0.12)`);

          root.style.setProperty('--fluid-orb2-c1', `rgba(${rLight}, ${gLight}, ${bLight}, 0.24)`);
          root.style.setProperty('--fluid-orb2-c2', `rgba(${rSec}, ${gSec}, ${bSec}, 0.10)`);

          root.style.setProperty('--fluid-orb3-c1', `rgba(${rSec}, ${gSec}, ${bSec}, 0.20)`);
          root.style.setProperty('--fluid-orb3-c2', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.08)`);
        } else {
          root.style.setProperty('--fluid-bg-color-1', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.20)`);
          root.style.setProperty('--fluid-bg-color-2', `rgba(${rLight}, ${gLight}, ${bLight}, 0.14)`);
          root.style.setProperty('--fluid-bg-color-3', `rgba(${rSec}, ${gSec}, ${bSec}, 0.18)`);

          root.style.setProperty('--fluid-orb1-c1', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.22)`);
          root.style.setProperty('--fluid-orb1-c2', `rgba(${rLight}, ${gLight}, ${bLight}, 0.08)`);

          root.style.setProperty('--fluid-orb2-c1', `rgba(${rLight}, ${gLight}, ${bLight}, 0.18)`);
          root.style.setProperty('--fluid-orb2-c2', `rgba(${rSec}, ${gSec}, ${bSec}, 0.06)`);

          root.style.setProperty('--fluid-orb3-c1', `rgba(${rSec}, ${gSec}, ${bSec}, 0.14)`);
          root.style.setProperty('--fluid-orb3-c2', `rgba(${rLight}, ${gLight}, ${bLight}, 0.05)`);
        }
      }
    }

    // Only update modal swatches if settings modal exists and is open
    if (DOM.settingsModalBackdrop && DOM.settingsModalBackdrop.style.display !== 'none') {
      document.querySelectorAll('.fluid-color-swatch').forEach(sw => {
        const swColor = sw.dataset.color;
        if (swColor && swColor.toLowerCase() === hex.toLowerCase()) {
          sw.classList.add('active');
        } else {
          sw.classList.remove('active');
        }
      });

      if (DOM.fluidColorPickerInput) DOM.fluidColorPickerInput.value = hex;
      if (DOM.fluidColorHexInput) DOM.fluidColorHexInput.value = hex.toUpperCase();
      if (DOM.fluidPreviewOrb) {
        const rgb = hexToRgb(hex) || { r: 124, g: 77, b: 255 };
        const rLight = Math.min(255, Math.round(rgb.r * 0.65 + 255 * 0.35));
        const gLight = Math.min(255, Math.round(rgb.g * 0.65 + 255 * 0.35));
        const bLight = Math.min(255, Math.round(rgb.b * 0.65 + 255 * 0.35));
        DOM.fluidPreviewOrb.style.background = `radial-gradient(circle, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.9) 0%, rgba(${rLight}, ${gLight}, ${bLight}, 0.4) 60%, transparent 80%)`;
      }
    }
  }

  function updateFluidBpmTempo() {
    const root = document.documentElement;
    const ambientLayer = document.querySelector('.favorites-ambient-layer');

    if (!state.fluidBpmSync) {
      root.style.removeProperty('--fluid-cycle-bg');
      root.style.removeProperty('--fluid-cycle-orb1');
      root.style.removeProperty('--fluid-cycle-orb2');
      root.style.removeProperty('--fluid-cycle-orb3');
      root.style.removeProperty('--fluid-beat-dur');
      if (ambientLayer) ambientLayer.classList.remove('bpm-synced', 'is-playing');
      if (DOM.fluidBpmStatusText) {
        DOM.fluidBpmStatusText.textContent = state.lang === 'ru'
          ? 'Синхронизация отключена (по умолчанию: плавный дрейф 20-28с)'
          : 'Sync disabled (default: ambient drift 20-28s)';
      }
      return;
    }

    const curTrack = (queue ? queue.getCurrentTrack() : state.tracks[state.currentTrackIndex]) || null;
    let bpm = 120;
    let isDefaultBpm = true;

    if (curTrack) {
      const known = queue ? queue.getTrackBpm(curTrack) : curTrack.bpm;
      if (known && known >= 50 && known <= 220) {
        bpm = known;
        isDefaultBpm = false;
      }
    }

    const beatDur = 60 / bpm;
    // Map BPM to musical fluid phrasing (cycles of 32, 36, 44, 48 beats):
    const cycleBg = Math.max(8, Math.min(35, beatDur * 32));
    const cycleOrb1 = Math.max(9, Math.min(38, beatDur * 36));
    const cycleOrb2 = Math.max(10, Math.min(42, beatDur * 44));
    const cycleOrb3 = Math.max(11, Math.min(46, beatDur * 48));

    root.style.setProperty('--fluid-cycle-bg', `${cycleBg.toFixed(2)}s`);
    root.style.setProperty('--fluid-cycle-orb1', `${cycleOrb1.toFixed(2)}s`);
    root.style.setProperty('--fluid-cycle-orb2', `${cycleOrb2.toFixed(2)}s`);
    root.style.setProperty('--fluid-cycle-orb3', `${cycleOrb3.toFixed(2)}s`);
    root.style.setProperty('--fluid-beat-dur', `${beatDur.toFixed(3)}s`);

    const isPlaying = state.isPlaying && !audio.paused;

    if (ambientLayer) {
      ambientLayer.classList.add('bpm-synced');
      if (isPlaying) {
        ambientLayer.classList.add('is-playing');
      } else {
        ambientLayer.classList.remove('is-playing');
      }
    }

    if (DOM.fluidBpmStatusText) {
      const trackTitle = curTrack ? `${curTrack.artist} - ${curTrack.title}` : (state.lang === 'ru' ? 'Нет трека' : 'No track');
      const bpmLabel = isDefaultBpm ? `~${bpm} BPM (базовый)` : `${bpm} BPM`;
      const playStateLabel = isPlaying
        ? (state.lang === 'ru' ? 'пульсация активна' : 'pulsing active')
        : (state.lang === 'ru' ? 'пауза' : 'paused');
      DOM.fluidBpmStatusText.textContent = state.lang === 'ru'
        ? `Ритм: ${bpmLabel} (${trackTitle}) · Пульс: ${beatDur.toFixed(2)}с [${playStateLabel}]`
        : `Tempo: ${bpmLabel} (${trackTitle}) · Beat: ${beatDur.toFixed(2)}s [${playStateLabel}]`;
    }
  }

  function applySmartVolume() {
    smartVolumeNode?.update(state.smartVolume, state.backgroundDuck,
      document.hidden || !document.hasFocus());
  }

  function initSettingsUI() {
    document.getElementById('smartVolumeSwitch').checked = state.smartVolume;
    document.getElementById('backgroundDuckSwitch').checked = state.backgroundDuck;
    document.getElementById('backgroundDuckSwitch').disabled = !state.smartVolume;
    updateAutoEqualizerUI();
    applyFluidColor(state.fluidColor);
    if (DOM.fluidBpmSyncSwitch) {
      DOM.fluidBpmSyncSwitch.checked = state.fluidBpmSync;
    }
    updateFluidBpmTempo();
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

            // Refresh quietly without overlapping exchanges.
            if (!syncBusy && Date.now() - lastSyncAttempt > 60000) syncAll({background:true});
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

  let syncBusy = false, lastSyncAttempt = 0, localSyncRevision = 0;
  async function syncAll({background = false} = {}) {
    if (syncBusy) return;
    syncBusy = true;
    lastSyncAttempt = Date.now();
    const revision = localSyncRevision;
    if (!background) {
      state.phoneUrl = (DOM.phoneIpInput.value.trim() || state.phoneUrl).replace(/\/+$/, '');
      localStorage.setItem('pain_phone_url', state.phoneUrl);
      DOM.progressBanner.classList.add('active');
      DOM.progressTaskTitle.textContent = state.lang === 'ru' ? 'Синхронизация фонотеки…' : 'Syncing library…';
      DOM.syncProgressFill.style.width = '25%';
      DOM.progressPercent.textContent = '25%';
    }
    try {
      const result = await fetch('/api/sync-phone', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({phoneUrl: state.phoneUrl})
      });
      if (!result.ok) throw new Error('Phone sync failed');
      const {library: libData, stats} = await result.json();
      if (!Array.isArray(libData?.tracks) || !Array.isArray(stats?.plays)) throw new Error('Invalid sync snapshot');
      // A local click/play during the exchange must not be rolled back by its response.
      if (revision !== localSyncRevision) { lastSyncAttempt = 0; return; }
      const libraryChanged = JSON.stringify(state.tracks) !== JSON.stringify(libData.tracks);
      const statsChanged = JSON.stringify(state.stats.plays) !== JSON.stringify(stats.plays) || JSON.stringify(state.stats.slices) !== JSON.stringify(stats.slices);
      if (libraryChanged) {
        const oldIds = new Set(state.tracks.map(t => String(t.id)));
        const wholeLibrary = queue && queue.getContext().allowNew && queue.getTracks().length === oldIds.size && queue.getTracks().every(t => oldIds.has(String(t.id)));
        state.tracks = libData.tracks;
        if (queue) queue.refreshLibrary(state.tracks, wholeLibrary);
        state.currentTrackIndex = state.tracks.findIndex(t => t.id === state.currentTrackId);
        state.libraryDirty = true;
      }
      state.stats = stats;
      state.hasAutoSynced = true;
      if (libraryChanged || statsChanged) {
        invalidatePlayCountsCache();
        if (queue) setQueueTasteStats(state.stats);
        updateSidebarLikedCount();
        renderCurrentView();
      }
      if (!background) {
        DOM.syncProgressFill.style.width = '100%';
        DOM.progressPercent.textContent = '100%';
        setTimeout(() => DOM.progressBanner.classList.remove('active'), 1200);
      }
    } catch (err) {
      console.warn('Sync failed:', err);
      if (!background) DOM.progressBanner.classList.remove('active');
    } finally {
      syncBusy = false;
      if (!background && revision !== localSyncRevision) DOM.progressBanner.classList.remove('active');
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
      const safeId = track.id.replace(/[/\\?%*:|"<>]/g, '_');
      const pct = Math.round(((i + 1) / total) * 100);
      DOM.syncProgressFill.style.width = `${pct}%`;
      DOM.progressPercent.textContent = `${pct}%`;

      if (state.cachedTracks && state.cachedTracks.has(safeId)) {
        DOM.progressTaskTitle.textContent = `${state.lang === 'ru' ? 'В кэше' : 'Cached'}: ${track.title} (${i+1}/${total})`;
        continue;
      }

      DOM.progressTaskTitle.textContent = `${state.lang === 'ru' ? 'Кэширование' : 'Caching'}: ${track.title} (${i+1}/${total})`;

      try {
        const streamUrl = `${state.phoneUrl}/api/track/${encodeURIComponent(track.id)}`;
        const res = await fetch(streamUrl);
        if (res.ok) {
          const blob = await res.blob();
          const ext = track.path ? track.path.split('.').pop() : 'mp3';
          const filename = `${track.artist} - ${track.title}.${ext}`;
          const saveRes = await fetch('/api/save-audio', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/octet-stream',
              'X-Track-Id': encodeURIComponent(track.id),
              'X-Filename': encodeURIComponent(filename)
            },
            body: blob
          });
          if (saveRes.ok) {
            state.cachedTracks.add(safeId);
            if (DOM.cacheStatsDesc) {
              DOM.cacheStatsDesc.textContent = state.lang === 'ru'
                ? `${state.cachedTracks.size} файлов сохранено на диске`
                : `${state.cachedTracks.size} audio files cached on disk`;
            }
          }
        }
      } catch (e) {}
    }

    DOM.progressTaskTitle.textContent = state.lang === 'ru' ? 'Кэширование завершено!' : 'Caching complete!';
    setTimeout(() => {
      DOM.progressBanner.classList.remove('active');
    }, 1500);
  }

  // --- JOINT AUDIO AI VIEW & CONTROLLER ---
  function renderJointAIView() {
    renderJointSeeds();
    if (state.jointState.results && state.jointState.results.length > 0) {
      renderJointResults(state.jointState.results);
    }
    if (typeof JointAI !== 'undefined' && JointAI.isLoaded && JointAI.isLoaded()) {
      if (DOM.jointModelBadgeText) {
        DOM.jointModelBadgeText.textContent = state.lang === 'ru'
          ? 'CLAP Sound + ListenBrainz Graph · Модель готова (56 875 треков)'
          : 'CLAP Sound + ListenBrainz Graph · Ready (56k tracks)';
      }
    }
  }

  function renderJointSeeds() {
    if (!DOM.jointActiveSeeds) return;
    DOM.jointActiveSeeds.innerHTML = '';

    const count = state.jointState.seeds ? state.jointState.seeds.length : 0;
    if (DOM.jointSeedsMeta) {
      DOM.jointSeedsMeta.textContent = state.lang === 'ru'
        ? `Выбрано сидов: ${count} треков`
        : `Selected seeds: ${count} tracks`;
    }

    if (!state.jointState.seeds || state.jointState.seeds.length === 0) {
      const emptyNote = document.createElement('div');
      emptyNote.className = 'joint-empty-seeds';
      emptyNote.style.cssText = 'font-size: 12px; color: var(--ink-muted); padding: 4px 6px;';
      emptyNote.textContent = state.lang === 'ru'
        ? 'Нет выбранных треков. Добавьте сиды кнопками выше, загрузите файл (JSON/CSV) или вставьте список.'
        : 'No seeds selected. Use quick buttons, upload JSON/CSV or paste list.';
      DOM.jointActiveSeeds.appendChild(emptyNote);
      return;
    }

    const MAX_CHIPS = 40;
    const seedsToRender = state.jointState.seeds.slice(0, MAX_CHIPS);

    seedsToRender.forEach((seed, idx) => {
      const chip = document.createElement('div');
      chip.className = 'joint-chip';

      const label = document.createElement('span');
      label.textContent = `${seed.artist} - ${seed.title}`;
      chip.appendChild(label);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'joint-chip-remove';
      removeBtn.innerHTML = '&times;';
      removeBtn.title = state.lang === 'ru' ? 'Удалить сид' : 'Remove seed';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.jointState.seeds.splice(idx, 1);
        renderJointSeeds();
      });
      chip.appendChild(removeBtn);

      DOM.jointActiveSeeds.appendChild(chip);
    });

    if (state.jointState.seeds.length > MAX_CHIPS) {
      const moreChip = document.createElement('div');
      moreChip.className = 'joint-chip';
      moreChip.style.background = 'var(--purple-muted, rgba(168, 85, 247, 0.15))';
      moreChip.style.color = 'var(--purple, #a855f7)';
      moreChip.style.fontWeight = '600';
      const remaining = state.jointState.seeds.length - MAX_CHIPS;
      moreChip.textContent = state.lang === 'ru' ? `+ еще ${remaining} треков` : `+ ${remaining} more tracks`;
      DOM.jointActiveSeeds.appendChild(moreChip);
    }
  }

  function addJointSeeds(newSeeds) {
    if (!Array.isArray(newSeeds) || newSeeds.length === 0) return 0;
    if (!state.jointState.seeds) state.jointState.seeds = [];

    const existingKeys = new Set(
      state.jointState.seeds.map(s => `${(s.artist || '').toLowerCase()}:::${(s.title || '').toLowerCase()}`)
    );

    let addedCount = 0;
    const MAX_SEEDS = 1500;

    for (const item of newSeeds) {
      if (state.jointState.seeds.length >= MAX_SEEDS) break;
      const cleanArtist = (item.artist || '').trim();
      const cleanTitle = (item.title || '').trim();
      if (!cleanArtist && !cleanTitle) continue;
      const key = `${cleanArtist.toLowerCase()}:::${cleanTitle.toLowerCase()}`;
      if (!existingKeys.has(key)) {
        existingKeys.add(key);
        state.jointState.seeds.push({ artist: cleanArtist, title: cleanTitle });
        addedCount++;
      }
    }

    if (addedCount > 0) {
      renderJointSeeds();
      if (addedCount > 1) {
        showToast(state.lang === 'ru'
          ? `Добавлено ${addedCount} сид-треков`
          : `Added ${addedCount} seed tracks`, '✓');
      }
    }
    return addedCount;
  }

  function addJointSeed(artist, title) {
    if (!artist && !title) return;
    const cleanArtist = (artist || '').trim();
    const cleanTitle = (title || '').trim();
    if (!cleanTitle && !cleanArtist) return;
    const count = addJointSeeds([{ artist: cleanArtist, title: cleanTitle }]);
    if (count === 0) {
      showToast(state.lang === 'ru' ? 'Трек уже в списке сидов' : 'Seed track already added', '⚠️');
    }
  }

  async function handleGenerateJoint() {
    if (state.jointState.isGenerating) return;
    if (!state.jointState.seeds || state.jointState.seeds.length === 0) {
      showToast(state.lang === 'ru' ? 'Добавьте хотя бы один опорный сид-трек' : 'Add at least one seed track', '⚠️');
      return;
    }

    if (typeof JointAI === 'undefined') {
      showToast(state.lang === 'ru' ? 'Движок Joint AI не загружен' : 'Joint AI engine not loaded', '❌');
      return;
    }

    state.jointState.isGenerating = true;
    if (DOM.jointGenerateBtn) DOM.jointGenerateBtn.disabled = true;
    if (DOM.jointGenerateBtnText) {
      DOM.jointGenerateBtnText.textContent = state.lang === 'ru' ? 'Анализ аудиовекторов CLAP...' : 'Analyzing CLAP vectors...';
    }
    if (DOM.jointResultsMeta) {
      DOM.jointResultsMeta.textContent = state.lang === 'ru' ? 'Загрузка векторов и графа 56k треков...' : 'Loading neural vectors & graph...';
    }
    if (DOM.jointSavePlaylistBtn) {
      DOM.jointSavePlaylistBtn.style.display = 'none';
    }

    if (DOM.jointResultsList) {
      DOM.jointResultsList.innerHTML = `
        <div class="joint-empty-state" style="padding: 40px 20px;">
          <div class="joint-empty-icon" style="font-size: 28px; animation: pulse 1s infinite;">🧠</div>
          <div class="joint-empty-title" style="margin-top: 10px;">${state.lang === 'ru' ? 'Нейросеть вычисляет сходство звука...' : 'Neural network computing acoustic similarity...'}</div>
          <div class="joint-empty-sub">${state.lang === 'ru' ? 'Поиск в 32D латентном пространстве CLAP + граф ListenBrainz' : 'Querying 32D CLAP latent space + ListenBrainz graph'}</div>
        </div>
      `;
    }

    try {
      await new Promise(r => setTimeout(r, 60));

      const popFilter = DOM.jointFilterPopularity ? DOM.jointFilterPopularity.value : 'balanced';
      const artistLimit = DOM.jointFilterArtistLimit ? parseInt(DOM.jointFilterArtistLimit.value, 10) : 2;
      const audioOnly = DOM.jointFilterAudioOnly ? DOM.jointFilterAudioOnly.checked : false;
      const localOnly = DOM.jointFilterLocalOnly ? DOM.jointFilterLocalOnly.checked : false;

      const response = await JointAI.generateJointPlaylist(
        state.jointState.seeds,
        state.tracks,
        '/joint-model',
        {
          targetCount: 50,
          popularityFilter: popFilter,
          maxPerArtist: isNaN(artistLimit) ? 2 : artistLimit,
          requireAudio: audioOnly,
          localOnly: localOnly,
          excludedTracks: state.excludedRecommendations
        }
      );

      state.jointState.results = response.tracks || [];

      if (response.seedsMatched === 0) {
        if (DOM.jointResultsMeta) {
          DOM.jointResultsMeta.textContent = state.lang === 'ru'
            ? 'Сиды не найдены в каталоге 56k'
            : 'Seeds not found in 56k catalog';
        }
        if (DOM.jointResultsList) {
          DOM.jointResultsList.innerHTML = `
            <div class="joint-empty-state" style="padding: 40px 20px;">
              <div class="joint-empty-icon">⚠️</div>
              <div class="joint-empty-title">${state.lang === 'ru' ? 'Треки сидов не распознаны' : 'Seeds not recognized'}</div>
              <div class="joint-empty-sub">${state.lang === 'ru' ? 'Попробуйте указать известных исполнителей или выбрать трек из библиотеки.' : 'Try popular artists or choose tracks from your library.'}</div>
            </div>
          `;
        }
        return;
      }

      if (DOM.jointResultsMeta) {
        DOM.jointResultsMeta.textContent = state.lang === 'ru'
          ? `Сгенерировано ${response.tracks.length} треков · ${response.localAvailableCount} в вашей библиотеке · Сидов распознано: ${response.seedsMatched}/${response.seedsTotal}`
          : `Generated ${response.tracks.length} tracks · ${response.localAvailableCount} in local library · Seeds matched: ${response.seedsMatched}/${response.seedsTotal}`;
      }

      if (DOM.jointModelBadgeText) {
        DOM.jointModelBadgeText.textContent = state.lang === 'ru'
          ? 'CLAP Sound + ListenBrainz Graph · Модель готова (56 875 треков)'
          : 'CLAP Sound + ListenBrainz Graph · Ready (56k tracks)';
      }

      renderJointResults(response.tracks);

      if (response.localAvailableCount > 0 && DOM.jointSavePlaylistBtn) {
        DOM.jointSavePlaylistBtn.style.display = 'inline-flex';
      }

      showToast(state.lang === 'ru' ? `Плейлист сформирован (${response.tracks.length} треков)!` : `${response.tracks.length}-track slate generated!`, '✓');
    } catch (err) {
      console.error('[Joint AI] Generation error:', err);
      if (DOM.jointResultsMeta) {
        DOM.jointResultsMeta.textContent = state.lang === 'ru' ? 'Ошибка генерации' : 'Generation failed';
      }
      showToast(state.lang === 'ru' ? `Ошибка: ${err.message}` : `Error: ${err.message}`, '❌');
      if (DOM.jointResultsList) {
        DOM.jointResultsList.innerHTML = `
          <div class="joint-empty-state" style="padding: 40px 20px;">
            <div class="joint-empty-icon">❌</div>
            <div class="joint-empty-title">${state.lang === 'ru' ? 'Ошибка загрузки модели' : 'Failed to load model'}</div>
            <div class="joint-empty-sub">${escapeHtml(err.message)}</div>
          </div>
        `;
      }
    } finally {
      state.jointState.isGenerating = false;
      if (DOM.jointGenerateBtn) DOM.jointGenerateBtn.disabled = false;
      if (DOM.jointGenerateBtnText) {
        DOM.jointGenerateBtnText.textContent = state.lang === 'ru' ? 'Сгенерировать 50 треков (Joint AI)' : 'Synthesize 50-Track Playlist';
      }
    }
  }

  function renderJointResults(tracks) {
    if (!DOM.jointResultsList) return;
    DOM.jointResultsList.innerHTML = '';

    if (!tracks || tracks.length === 0) {
      DOM.jointResultsList.innerHTML = `
        <div class="joint-empty-state">
          <div class="joint-empty-icon">🎧</div>
          <div class="joint-empty-title">${state.lang === 'ru' ? 'Нейросеть готова к работе' : 'AI ready'}</div>
          <div class="joint-empty-sub">${state.lang === 'ru' ? 'Добавьте сид-треки слева и нажмите «Сгенерировать 50 треков».' : 'Add seed tracks on the left and hit generate.'}</div>
        </div>
      `;
      return;
    }

    const matchedLocalTracks = tracks.filter(t => t.isLocal && t.matchedLocalTrack).map(t => t.matchedLocalTrack);

    tracks.forEach(track => {
      const row = document.createElement('div');
      row.className = 'joint-track-row';
      if (track.isLocal) row.classList.add('is-local');

      // Rank
      const rankEl = document.createElement('div');
      rankEl.className = 'joint-track-rank';
      rankEl.textContent = track.rank;
      row.appendChild(rankEl);

      // Info
      const infoEl = document.createElement('div');
      infoEl.className = 'joint-track-info';

      const titleEl = document.createElement('div');
      titleEl.className = 'joint-track-title';
      titleEl.textContent = track.title;
      infoEl.appendChild(titleEl);

      const artistEl = document.createElement('div');
      artistEl.className = 'joint-track-artist';
      artistEl.textContent = track.artist;
      infoEl.appendChild(artistEl);

      row.appendChild(infoEl);

      // Badges
      const badgesEl = document.createElement('div');
      badgesEl.className = 'joint-track-meta';

      if (track.hasAudioFeatures) {
        const clapBadge = document.createElement('span');
        clapBadge.className = 'joint-badge-clap';
        clapBadge.textContent = 'CLAP 512D';
        clapBadge.title = state.lang === 'ru' ? 'Акустический звуковой вектор' : 'CLAP acoustic sound vector';
        badgesEl.appendChild(clapBadge);
      }

      if (track.popularity !== undefined && track.popularity !== null) {
        const popBadge = document.createElement('span');
        popBadge.className = 'joint-badge-pop';
        popBadge.textContent = `🔥 ${track.popularity}% pop`;
        popBadge.title = state.lang === 'ru' ? `Популярность в ListenBrainz: ${track.popularity}%` : `Popularity percentile: ${track.popularity}%`;
        badgesEl.appendChild(popBadge);
      }

      const matchPercent = track.matchPercent !== undefined
        ? track.matchPercent
        : (track.score !== undefined ? Math.min(99, Math.max(70, Math.round(track.score * 50))) : 85);

      const scoreBadge = document.createElement('span');
      scoreBadge.className = 'joint-score';
      scoreBadge.textContent = `${matchPercent}% match`;
      scoreBadge.title = state.lang === 'ru' ? 'Нейронная оценка соответствия звука и графа' : 'Neural relevance match';
      badgesEl.appendChild(scoreBadge);

      if (track.isLocal && track.matchedLocalTrack) {
        const localBadge = document.createElement('span');
        localBadge.className = 'joint-badge-local';
        localBadge.textContent = state.lang === 'ru' ? 'В библиотеке' : 'In Library';
        badgesEl.appendChild(localBadge);

        const playBtn = document.createElement('button');
        playBtn.className = 'joint-play-btn';
        playBtn.title = state.lang === 'ru' ? 'Слушать трек' : 'Play track';
        playBtn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5,3 19,12 5,21"></polygon>
          </svg>
        `;
        playBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          playTrackInContext(track.matchedLocalTrack, matchedLocalTracks, {
            type: 'playlist',
            title: 'Joint AI Mix',
            id: 'joint-ai'
          });
          showToast(state.lang === 'ru' ? `Воспроизведение: ${track.artist} - ${track.title}` : `Playing: ${track.artist} - ${track.title}`);
        });
        badgesEl.appendChild(playBtn);

        row.title = state.lang === 'ru' ? 'Нажмите для воспроизведения' : 'Click to play';
        row.style.cursor = 'pointer';
        row.addEventListener('click', () => {
          playTrackInContext(track.matchedLocalTrack, matchedLocalTracks, {
            type: 'playlist',
            title: 'Joint AI Mix',
            id: 'joint-ai'
          });
          showToast(state.lang === 'ru' ? `Воспроизведение: ${track.artist} - ${track.title}` : `Playing: ${track.artist} - ${track.title}`);
        });
      } else {
        const catBadge = document.createElement('span');
        catBadge.className = 'joint-badge-catalog';
        catBadge.textContent = state.lang === 'ru' ? 'Каталог' : 'Catalog';
        badgesEl.appendChild(catBadge);
      }

      row.appendChild(badgesEl);
      DOM.jointResultsList.appendChild(row);
    });
  }

  function handleSaveJointPlaylist() {
    if (!state.jointState.results || state.jointState.results.length === 0) return;
    const matchedTrackIds = state.jointState.results
      .filter(t => t.isLocal && t.matchedLocalTrack)
      .map(t => t.matchedLocalTrack.id);

    if (matchedTrackIds.length === 0) {
      showToast(state.lang === 'ru' ? 'В фонотеке нет совпавших треков для сохранения' : 'No matched local tracks to save', '⚠️');
      return;
    }

    const dateStr = new Date().toLocaleDateString(state.lang === 'ru' ? 'ru-RU' : 'en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    const defaultName = `Joint AI (${dateStr})`;

    const name = prompt(state.lang === 'ru' ? 'Название плейлиста:' : 'Playlist name:', defaultName);
    if (!name || !name.trim()) return;

    const newPl = {
      id: 'pl_joint_' + Date.now(),
      name: name.trim(),
      trackIds: matchedTrackIds
    };

    state.playlists.push(newPl);
    savePlaylistsToServer();
    renderPlaylistsSidebar();
    showToast(state.lang === 'ru'
      ? `Плейлист «${newPl.name}» сохранен (${matchedTrackIds.length} треков)`
      : `Playlist "${newPl.name}" saved (${matchedTrackIds.length} tracks)`, '✓');
    switchView('playlist', newPl.id);
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

    // Coalesce fast typing instead of rebuilding the whole library for every key.
    let searchTimer = null;
    // Search
    DOM.searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      DOM.searchClearBtn.style.display = state.searchQuery ? 'block' : 'none';
      state.libraryDirty = true;
      clearTimeout(searchTimer);
      cancelTrackRender(DOM.tracksGrid);
      cancelTrackRender(DOM.tracksTableBody);
      searchTimer = setTimeout(() => renderLibrary(), 120);
    });

    DOM.searchClearBtn.addEventListener('click', () => {
      clearTimeout(searchTimer);
      DOM.searchInput.value = '';
      state.searchQuery = '';
      DOM.searchClearBtn.style.display = 'none';
      state.libraryDirty = true;
      renderLibrary();
    });

    // Filter Chips
    DOM.filterChips.forEach(chip => {
      chip.addEventListener('click', () => {
        DOM.filterChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        state.categoryFilter = chip.dataset.filter;
        state.libraryDirty = true;
        renderLibrary();
      });
    });

    // Sort Selector
    DOM.sortSelect.addEventListener('change', (e) => {
      state.sortOption = e.target.value;
      state.libraryDirty = true;
      renderLibrary();
    });

    // View Mode Toggles (Grid vs List)
    DOM.viewModeGridBtn.addEventListener('click', () => applyViewMode('grid'));
    DOM.viewModeListBtn.addEventListener('click', () => applyViewMode('list'));

    // Play All Button in Library
    DOM.playAllBtn.addEventListener('click', () => {
      const processed = getProcessedTracks(state.tracks);
      if (processed.length > 0) {
        playTrackInContext(processed[0], processed, { type: 'library', title: state.lang === 'ru' ? 'Фонотека' : 'Library', id: 'library', allowNew: !state.searchQuery && state.categoryFilter === 'all' });
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
        toggleFavorite(state.currentTrackId, DOM.bottomFavoriteBtn);
      }
    });

    if (DOM.bottomExcludeBtn) {
      DOM.bottomExcludeBtn.addEventListener('click', () => {
        const curTrack = (queue ? queue.getCurrentTrack() : null) || state.tracks.find(t => t.id === state.currentTrackId);
        if (curTrack) toggleExcludeRecommendation(curTrack.id);
      });
    }

    if (DOM.bottomMomentBtn) {
      DOM.bottomMomentBtn.addEventListener('click', (e) => {
        const trackId = state.currentTrackId;
        if (!trackId) return;
        const moment = typeof FavoriteMoments !== 'undefined'
          ? FavoriteMoments.getMoment(state.favoriteMoments, trackId)
          : state.favoriteMoments?.[trackId];
        if (e.shiftKey) {
          setFavoriteMomentForCurrentTrack();
        } else if (moment !== null && moment !== undefined) {
          seekToFavoriteMoment(trackId);
        } else {
          setFavoriteMomentForCurrentTrack();
        }
      });
      DOM.bottomMomentBtn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        removeFavoriteMoment();
      });
    }

    if (DOM.seekMomentBadge) {
      DOM.seekMomentBadge.addEventListener('click', (e) => {
        e.stopPropagation();
        seekToFavoriteMoment();
      });
      DOM.seekMomentBadge.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        removeFavoriteMoment();
      });
    }

    if (DOM.seekMomentDel) {
      DOM.seekMomentDel.addEventListener('click', (e) => {
        e.stopPropagation();
        removeFavoriteMoment();
      });
    }

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
    audio.addEventListener('pause',()=>{savePlaybackPosition(true);sampleListening(true);listening?.anchor(performance.now(),audio.currentTime,false);syncPlaybackState();});
    audio.addEventListener('waiting',()=>{sampleListening(true);listening?.anchor(performance.now(),audio.currentTime,false);});
    audio.addEventListener('seeking',()=>listening?.anchor(performance.now(),audio.currentTime,false));
    audio.addEventListener('seeked',()=>savePlaybackPosition(true));
    audio.addEventListener('seeked',()=>listening?.anchor(performance.now(),audio.currentTime,!audio.paused&&!audio.muted&&audio.volume>0));
    window.addEventListener('pagehide',()=>{savePlaybackPosition(true);sampleListening();if(state.currentTrackId)recordTrackFinished(state.currentTrackId);});
    audio.addEventListener('error',()=>{state.isPlaying=false;updatePlayBtnUI();DOM.vinylBigDisc.classList.remove('spinning');});
    audio.addEventListener('volumechange',()=>listening?.anchor(performance.now(),audio.currentTime,!audio.paused&&!audio.muted&&audio.volume>0));
    audio.addEventListener('ratechange',()=>listening?.anchor(performance.now(),audio.currentTime,!audio.paused));

    // Audio Metadata & Buffering
    audio.addEventListener('loadedmetadata', () => {
      const dur = getCurrentTrackDuration();
      if (dur > 0) DOM.totalTime.textContent = formatTime(dur);
      updateFavoriteMomentUI();
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
      savePlaybackPosition();
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
      const enabled = e.target.checked;
      initAudioNodes();
      if (!enabled && state.eq.auto) setAutoEqualizer(false, false);
      state.eq.enabled = enabled;
      initEqualizerUI();
      saveEqualizerState();
    });

    DOM.eqSliderPreamp.addEventListener('input', (e) => {
      if (state.eq.auto) return;
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
          if (state.eq.auto) return;
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
        if (state.eq.auto) return;
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

    // Settings Modal & Fluid Customizer Event Listeners
    if (DOM.settingsToggleBtn) DOM.settingsToggleBtn.addEventListener('click', openSettingsModal);
    if (DOM.sidebarSettingsBtn) DOM.sidebarSettingsBtn.addEventListener('click', openSettingsModal);
    if (DOM.settingsCloseBtn) DOM.settingsCloseBtn.addEventListener('click', closeSettingsModal);
    if (DOM.settingsDoneBtn) DOM.settingsDoneBtn.addEventListener('click', closeSettingsModal);
    if (DOM.settingsModalBackdrop) {
      DOM.settingsModalBackdrop.addEventListener('click', (e) => {
        if (e.target === DOM.settingsModalBackdrop) closeSettingsModal();
      });
    }

    // Swatches
    document.querySelectorAll('.fluid-color-swatch').forEach(sw => {
      sw.addEventListener('click', () => {
        const color = sw.dataset.color;
        if (color) applyFluidColor(color);
      });
    });

    // Custom color picker
    if (DOM.fluidColorPickerInput) {
      DOM.fluidColorPickerInput.addEventListener('input', (e) => {
        applyFluidColor(e.target.value);
      });
    }

    // Hex input
    if (DOM.fluidColorHexInput) {
      DOM.fluidColorHexInput.addEventListener('input', (e) => {
        let val = e.target.value.trim();
        if (!val.startsWith('#')) val = '#' + val;
        if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
          applyFluidColor(val);
        }
      });
    }

    // Reset color to default
    if (DOM.fluidResetColorBtn) {
      DOM.fluidResetColorBtn.addEventListener('click', () => {
        applyFluidColor('#7c4dff');
      });
    }

    for (const [id, key, storageKey] of [
      ['smartVolumeSwitch', 'smartVolume', 'pain_smart_volume'],
      ['backgroundDuckSwitch', 'backgroundDuck', 'pain_background_duck']
    ]) document.getElementById(id).addEventListener('change', e => {
      state[key] = e.target.checked;
      try { localStorage.setItem(storageKey, String(state[key])); } catch (_) {}
      document.getElementById('backgroundDuckSwitch').disabled = !state.smartVolume;
      applySmartVolume();
      updateAutoEqualizerUI();
    });
    if (DOM.autoEqSwitch) DOM.autoEqSwitch.addEventListener('change', e => {
      initAudioNodes();
      setAutoEqualizer(e.target.checked);
    });
    window.addEventListener('focus', applySmartVolume);
    window.addEventListener('blur', applySmartVolume);
    document.addEventListener('visibilitychange', applySmartVolume);

    // BPM Sync Switch
    if (DOM.fluidBpmSyncSwitch) {
      DOM.fluidBpmSyncSwitch.addEventListener('change', (e) => {
        state.fluidBpmSync = e.target.checked;
        try {
          localStorage.setItem('pain_fluid_bpm_sync', String(state.fluidBpmSync));
        } catch (err) {}
        updateFluidBpmTempo();
        showToast(state.lang === 'ru'
          ? (state.fluidBpmSync ? 'Синхронизация по BPM включена' : 'Синхронизация по BPM выключена')
          : (state.fluidBpmSync ? 'BPM Sync Enabled' : 'BPM Sync Disabled'),
          state.fluidBpmSync ? '⚡' : '✓'
        );
      });
    }

    // Excluded tracks management in settings
    if (DOM.viewExcludedTracksBtn) {
      DOM.viewExcludedTracksBtn.addEventListener('click', () => {
        if (!DOM.excludedTracksListContainer) return;
        const isHidden = DOM.excludedTracksListContainer.style.display === 'none';
        DOM.excludedTracksListContainer.style.display = isHidden ? 'block' : 'none';
        if (isHidden) renderExcludedTracksList();
      });
    }

    if (DOM.clearExcludedTracksBtn) {
      DOM.clearExcludedTracksBtn.addEventListener('click', () => {
        if (state.excludedRecommendations.size === 0) return;
        state.excludedRecommendations.clear();
        if (queue && typeof queue.setExcludedTracks === 'function') {
          queue.setExcludedTracks([]);
        }
        try {
          localStorage.removeItem('pain_excluded_recommendations');
        } catch(e) {}
        updateExcludedButtonsUI();
        updateSettingsExcludedSection();
        showToast(state.lang === 'ru' ? 'Все треки возвращены в рекомендации' : 'All tracks restored to recommendations');
      });
    }

    if (DOM.updateActionBtn) DOM.updateActionBtn.addEventListener('click', handleUpdateAction);

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

    // Joint Audio AI Event Listeners
    if (DOM.jointUseCurrentBtn) {
      DOM.jointUseCurrentBtn.addEventListener('click', () => {
        const curr = (queue ? queue.getCurrentTrack() : state.tracks[state.currentTrackIndex]) || null;
        if (!curr) {
          showToast(state.lang === 'ru' ? 'Сейчас ничего не играет' : 'No track currently playing', '⚠️');
          return;
        }
        addJointSeed(curr.artist, curr.title);
      });
    }

    if (DOM.jointUseFavoritesBtn) {
      DOM.jointUseFavoritesBtn.addEventListener('click', () => {
        const liked = state.tracks.filter(t => t.favorite);
        if (liked.length === 0) {
          showToast(state.lang === 'ru' ? 'Список избранного пуст' : 'Favorites list is empty', '⚠️');
          return;
        }
        addJointSeeds(liked.map(t => ({ artist: t.artist, title: t.title })));
      });
    }

    if (DOM.jointUseLibraryBtn) {
      DOM.jointUseLibraryBtn.addEventListener('click', () => {
        if (!state.tracks || state.tracks.length === 0) {
          showToast(state.lang === 'ru' ? 'Фонотека пуста' : 'Library is empty', '⚠️');
          return;
        }
        addJointSeeds(state.tracks.map(t => ({ artist: t.artist, title: t.title })));
      });
    }

    const handleFileSelected = (file) => {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const content = e.target.result;
          const parsed = (typeof JointAI !== 'undefined' && JointAI.parseFileContent)
            ? JointAI.parseFileContent(content)
            : [];
          if (!parsed || parsed.length === 0) {
            showToast(state.lang === 'ru' ? 'Не удалось распознать треки в файле' : 'Could not recognize tracks in file', '⚠️');
            return;
          }
          const added = addJointSeeds(parsed);
          showToast(state.lang === 'ru'
            ? `Импортировано ${added} из ${parsed.length} треков (${file.name})`
            : `Imported ${added} of ${parsed.length} tracks (${file.name})`, '✓');
        } catch (err) {
          showToast(state.lang === 'ru' ? `Ошибка чтения: ${err.message}` : `Read error: ${err.message}`, '❌');
        }
      };
      reader.readAsText(file);
    };

    if (DOM.jointUploadFileBtn && DOM.jointFileInput) {
      DOM.jointUploadFileBtn.addEventListener('click', () => {
        DOM.jointFileInput.value = '';
        DOM.jointFileInput.click();
      });
      DOM.jointFileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) handleFileSelected(file);
      });
    }

    if (DOM.jointCardLeft) {
      DOM.jointCardLeft.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        DOM.jointCardLeft.classList.add('dragover');
      });
      DOM.jointCardLeft.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        DOM.jointCardLeft.classList.remove('dragover');
      });
      DOM.jointCardLeft.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        DOM.jointCardLeft.classList.remove('dragover');
        const dt = e.dataTransfer;
        if (dt && dt.files && dt.files.length > 0) {
          handleFileSelected(dt.files[0]);
        }
      });
    }

    if (DOM.jointPasteListBtn && DOM.jointPasteBox) {
      DOM.jointPasteListBtn.addEventListener('click', () => {
        const isHidden = DOM.jointPasteBox.style.display === 'none' || !DOM.jointPasteBox.style.display;
        DOM.jointPasteBox.style.display = isHidden ? 'flex' : 'none';
        if (isHidden && DOM.jointPasteTextarea) {
          DOM.jointPasteTextarea.focus();
        }
      });
    }

    if (DOM.jointCancelPasteBtn && DOM.jointPasteBox) {
      DOM.jointCancelPasteBtn.addEventListener('click', () => {
        DOM.jointPasteBox.style.display = 'none';
      });
    }

    if (DOM.jointApplyPasteBtn && DOM.jointPasteTextarea) {
      DOM.jointApplyPasteBtn.addEventListener('click', () => {
        const text = DOM.jointPasteTextarea.value.trim();
        if (!text) {
          if (DOM.jointPasteBox) DOM.jointPasteBox.style.display = 'none';
          return;
        }
        const parsed = (typeof JointAI !== 'undefined' && JointAI.parseFileContent)
          ? JointAI.parseFileContent(text)
          : [];
        if (!parsed || parsed.length === 0) {
          showToast(state.lang === 'ru' ? 'Не удалось распознать треки в тексте' : 'Could not recognize tracks in text', '⚠️');
          return;
        }
        const added = addJointSeeds(parsed);
        DOM.jointPasteTextarea.value = '';
        if (DOM.jointPasteBox) DOM.jointPasteBox.style.display = 'none';
        showToast(state.lang === 'ru'
          ? `Импортировано ${added} из ${parsed.length} треков`
          : `Imported ${added} of ${parsed.length} tracks`, '✓');
      });
    }

    if (DOM.jointClearSeedsBtn) {
      DOM.jointClearSeedsBtn.addEventListener('click', () => {
        state.jointState.seeds = [];
        renderJointSeeds();
      });
    }

    if (DOM.jointAddSeedBtn && DOM.jointSeedInput) {
      const submitSeed = () => {
        const val = DOM.jointSeedInput.value.trim();
        if (!val) return;
        let artist = '';
        let title = val;
        if (val.includes(' - ')) {
          const parts = val.split(' - ');
          artist = parts[0].trim();
          title = parts.slice(1).join(' - ').trim();
        }
        addJointSeed(artist, title);
        DOM.jointSeedInput.value = '';
      };
      DOM.jointAddSeedBtn.addEventListener('click', submitSeed);
      DOM.jointSeedInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitSeed();
      });
    }

    if (DOM.jointGenerateBtn) {
      DOM.jointGenerateBtn.addEventListener('click', handleGenerateJoint);
    }

    if (DOM.jointSavePlaylistBtn) {
      DOM.jointSavePlaylistBtn.addEventListener('click', handleSaveJointPlaylist);
    }

    // Share Profile Card Modal & Actions
    if (DOM.shareProfileBtn) {
      DOM.shareProfileBtn.addEventListener('click', openProfileModal);
    }
    if (DOM.shareModalCloseBtn) {
      DOM.shareModalCloseBtn.addEventListener('click', closeProfileModal);
    }
    if (DOM.shareProfileModalBackdrop) {
      DOM.shareProfileModalBackdrop.addEventListener('click', (e) => {
        if (e.target === DOM.shareProfileModalBackdrop) closeProfileModal();
      });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && DOM.shareProfileModalBackdrop?.classList.contains('open')) {
        closeProfileModal();
      }
    });

    if (DOM.shareDownloadPngBtn) {
      DOM.shareDownloadPngBtn.addEventListener('click', async () => {
        const btn = DOM.shareDownloadPngBtn;
        const origText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = state.lang === 'ru' ? '<span>Генерация...</span>' : '<span>Generating...</span>';
        try {
          const canvas = await getOrRenderProfileCanvas();
          ProfileCard.downloadProfileCardPng(canvas, `pain-profile-${new Date().toISOString().slice(0, 10)}.png`);
          showToast(state.lang === 'ru' ? 'Карточка сохранена в Загрузки!' : 'Profile card saved to Downloads!', '✓');
        } catch (err) {
          showToast(state.lang === 'ru' ? `Ошибка: ${err.message}` : `Error: ${err.message}`, '❌');
        } finally {
          btn.disabled = false;
          btn.innerHTML = origText;
        }
      });
    }

    if (DOM.shareCopyImageBtn) {
      DOM.shareCopyImageBtn.addEventListener('click', async () => {
        const btn = DOM.shareCopyImageBtn;
        const origText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = state.lang === 'ru' ? '<span>Копирование...</span>' : '<span>Copying...</span>';
        try {
          const canvas = await getOrRenderProfileCanvas();
          await ProfileCard.copyProfileCardImage(canvas);
          showToast(state.lang === 'ru' ? 'Картинка скопирована в буфер обмена!' : 'Image copied to clipboard!', '✓');
        } catch (err) {
          showToast(state.lang === 'ru' ? 'Не удалось скопировать картинку в буфер' : 'Failed to copy image to clipboard', '⚠️');
        } finally {
          btn.disabled = false;
          btn.innerHTML = origText;
        }
      });
    }

    if (DOM.shareCopyLinkBtn) {
      DOM.shareCopyLinkBtn.addEventListener('click', async () => {
        if (!currentProfileData && typeof ProfileCard !== 'undefined') {
          currentProfileData = ProfileCard.collectProfileData(state.tracks, state.stats, state.lang);
        }
        try {
          const res = await ProfileCard.shareProfile(currentProfileData);
          if (res.shared) {
            showToast(state.lang === 'ru' ? 'Ссылка и статистика скопированы!' : 'Link and stats copied!', '✓');
          }
        } catch (err) {
          showToast(state.lang === 'ru' ? 'Не удалось скопировать ссылку' : 'Failed to copy link', '⚠️');
        }
      });
    }
  }


  // Run on DOM ready
  document.addEventListener('DOMContentLoaded', init);
})();
