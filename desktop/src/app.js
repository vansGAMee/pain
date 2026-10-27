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
    showRemaining: localStorage.getItem('pain_remaining_time') === 'true',
    backgroundDuck: localStorage.getItem('pain_background_duck') !== 'false',
    volumeLimit: Math.max(25, Math.min(100, Number(localStorage.getItem('pain_volume_limit')) || 100)),
    trackTransition: (() => {
      const raw = localStorage.getItem('pain_track_transition');
      const saved = raw === null ? NaN : Number(raw);
      return Number.isFinite(saved) ? Math.max(0, Math.min(4, saved)) : 1;
    })(),
    reducedMotion: localStorage.getItem('pain_reduced_motion') === 'true',
    performanceMode: PerformanceMode.normalize(localStorage.getItem('pain_performance_mode')),
    resourceSaver: PerformanceMode.get(localStorage.getItem('pain_performance_mode')).saver,
    cleanTitles: localStorage.getItem('pain_clean_titles') === 'true',
    saveHistory: localStorage.getItem('pain_save_history') !== 'false',
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
    })(),

    // Favorite Moments on Home tab toggle
    homeMomentsEnabled: (function() {
      try {
        const val = localStorage.getItem('pain_home_moments_enabled');
        return val === null ? true : val === 'true';
      } catch (_) { return true; }
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
  let audioSyncTimer=null,audioSyncBusy=false,audioSyncAgain=false;

  let persistAudioProfilesTimer = null;
  function schedulePersistAudioProfiles(immediate = false) {
    if (immediate) {
      if (persistAudioProfilesTimer) {
        clearTimeout(persistAudioProfilesTimer);
        persistAudioProfilesTimer = null;
      }
      try { AudioProfile.persist(audioProfiles, localStorage); } catch (_) {}
      return;
    }
    if (!persistAudioProfilesTimer) {
      persistAudioProfilesTimer = setTimeout(() => {
        persistAudioProfilesTimer = null;
        try { AudioProfile.persist(audioProfiles, localStorage); } catch (_) {}
      }, 5000);
    }
  }

  let persistBpmCacheTimer = null;
  function schedulePersistBpmCache(immediate = false) {
    if (immediate) {
      if (persistBpmCacheTimer) {
        clearTimeout(persistBpmCacheTimer);
        persistBpmCacheTimer = null;
      }
      if (queue?.bpmCache) {
        try { localStorage.setItem('pain_bpm_cache_v2', JSON.stringify(queue.bpmCache)); } catch (_) {}
      }
      return;
    }
    if (!persistBpmCacheTimer) {
      persistBpmCacheTimer = setTimeout(() => {
        persistBpmCacheTimer = null;
        if (queue?.bpmCache) {
          try { localStorage.setItem('pain_bpm_cache_v2', JSON.stringify(queue.bpmCache)); } catch (_) {}
        }
      }, 5000);
    }
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
      schedulePersistAudioProfiles(true);
      schedulePersistBpmCache(true);
    });
  }

  function sharedVibes(){try{const v=JSON.parse(localStorage.getItem('pain_dj_vibes_v1'));return v?{...v,updatedAt:v.updatedAt||0}:null;}catch(_){return null;}}
  function mergeSharedAudio(remote){
    if(!remote)return;
    const state=DjState.merge({profiles:audioProfiles,vibes:sharedVibes()},remote),merged=state.profiles;
    let changed = false;
    for(const [id,profile] of Object.entries(merged)){
      const existing = audioProfiles[id];
      if (existing !== profile) {
        if (!existing || existing.updatedAt !== profile.updatedAt || existing.signature !== profile.signature) {
          audioProfiles[id] = profile;
          queue?.setAudioProfile(id, profile);
          changed = true;
        }
      }
    }
    if (changed) schedulePersistAudioProfiles();
    if(state.vibes&&JSON.stringify(state.vibes)!==JSON.stringify(sharedVibes())){
      try{localStorage.setItem('pain_dj_vibes_v1',JSON.stringify(state.vibes));window.dispatchEvent(new CustomEvent('pain:dj-state',{detail:state.vibes}));}catch(_){}
    }
  }
  async function syncSharedAudio(){
    if(audioSyncBusy){audioSyncAgain=true;return;}audioSyncBusy=true;
    try{const response=await fetch('/api/dj-state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({profiles:audioProfiles,vibes:sharedVibes()})});if(response.ok)mergeSharedAudio(await response.json());}catch(_){}
    finally{audioSyncBusy=false;if(audioSyncAgain){audioSyncAgain=false;syncSharedAudio();}}
  }
  async function syncExcludedTracksFromServer() {
    try {
      const res = await fetch('/api/excluded-tracks');
      if (res.ok) {
        const remote = await res.json();
        if (Array.isArray(remote)) {
          let added = 0;
          for (const id of remote) {
            const sid = String(id);
            if (!state.excludedRecommendations.has(sid)) {
              state.excludedRecommendations.add(sid);
              if (queue && typeof queue.excludeTrack === 'function') {
                queue.excludeTrack(sid);
              }
              added++;
            }
          }
          if (added > 0) {
            try {
              localStorage.setItem('pain_excluded_recommendations', JSON.stringify(Array.from(state.excludedRecommendations)));
            } catch (_) {}
            if (typeof updateExcludedButtonsUI === 'function') updateExcludedButtonsUI();
            if (typeof updateSettingsExcludedSection === 'function') updateSettingsExcludedSection();
          }
          if (state.excludedRecommendations.size > remote.length) {
            fetch('/api/excluded-tracks', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(Array.from(state.excludedRecommendations))
            }).catch(() => {});
          }
        }
      }
    } catch (_) {}
  }
  async function syncFavoriteMomentsFromServer() {
    try {
      const res = await fetch('/api/favorite-moments');
      if (res.ok) {
        const remote = await res.json();
        if (remote && typeof remote === 'object' && !Array.isArray(remote)) {
          let added = 0;
          for (const [id, sec] of Object.entries(remote)) {
            if (state.favoriteMoments[id] === undefined && Number.isFinite(sec)) {
              state.favoriteMoments[id] = sec;
              added++;
            }
          }
          if (added > 0) {
            saveFavoriteMoments();
            if (typeof updateFavoriteMomentUI === 'function') updateFavoriteMomentUI();
          }
          const localKeys = Object.keys(state.favoriteMoments || {});
          if (localKeys.some(k => remote[k] === undefined)) {
            fetch('/api/favorite-moments', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(state.favoriteMoments)
            }).catch(() => {});
          }
        }
      }
    } catch (_) {}
  }
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

  // --- DUAL-DECK SEAMLESS AUDIO ENGINE ---
  const deckA = (typeof document !== 'undefined') ? document.getElementById('audioEngine') : null;
  let deckB = (typeof document !== 'undefined') ? document.getElementById('audioEngineB') : null;
  if (!deckB && typeof document !== 'undefined' && document.createElement) {
    deckB = document.createElement('audio');
    deckB.id = 'audioEngineB';
    deckB.crossOrigin = 'anonymous';
    document.body.appendChild(deckB);
  }
  let activeDeck = deckA;
  let standbyDeck = deckB;
  const deckTrackSnapshots = new WeakMap();
  let sourceNodeA = null;
  let sourceNodeB = null;
  let gainNodeA = null;
  let gainNodeB = null;
  let crossfadeTimerId = 0;
  let isCrossfading = false;
  let lastReelAdvanceTime = 0;

  const audio = (deckA && typeof Proxy !== 'undefined') ? new Proxy(deckA, {
    get(target, prop) {
      if (prop === 'deckA') return deckA;
      if (prop === 'deckB') return deckB;
      if (prop === 'activeDeck') return activeDeck;
      if (prop === 'standbyDeck') return standbyDeck;
      if (prop === 'pause') {
        return () => {
          isCrossfading = false;
          if (deckA) try { deckA.pause(); } catch (_) {}
          if (deckB) try { deckB.pause(); } catch (_) {}
        };
      }
      if (prop === 'addEventListener') {
        return (event, handler, options) => {
          if (deckA) deckA.addEventListener(event, (e) => {
            if (activeDeck === deckA) handler(e);
          }, options);
          if (deckB) deckB.addEventListener(event, (e) => {
            if (activeDeck === deckB) handler(e);
          }, options);
        };
      }
      const current = activeDeck || deckA;
      const val = current[prop];
      if (typeof val === 'function') return val.bind(current);
      return val;
    },
    set(target, prop, value) {
      if (prop === 'volume') {
        if (deckA) deckA.volume = value;
        if (deckB) deckB.volume = value;
        return true;
      }
      if (prop === 'playbackRate') {
        if (deckA) deckA.playbackRate = value;
        if (deckB) deckB.playbackRate = value;
        return true;
      }
      if (prop === 'muted') {
        if (deckA) deckA.muted = value;
        if (deckB) deckB.muted = value;
        return true;
      }
      const current = activeDeck || deckA;
      current[prop] = value;
      return true;
    }
  }) : deckA;

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
  window.PainPlayer = {
    getTrack: () => (queue ? queue.getCurrentTrack() : state.tracks[state.currentTrackIndex]) || null,
    flushListening: () => {savePlaybackPosition(true);sampleListening();return state.currentTrackId?recordTrackFinished(state.currentTrackId):Promise.resolve();}
  };
  let audioCtx = null;
  let audioObservationStops = [];
  let bpmAnalysisController = null;
  let sourceNode = null;
  let playingTrackSnapshot = null;
  let transitionGainNode = null;
  let trackTransitionTimer = null;
  let trackTransitionRequest = 0;
  let isTrackFadingOut = false;
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
    updateActionBtn: document.getElementById('updateActionBtn'),
    dataGuardStatusHint: document.getElementById('dataGuardStatusHint'),
    exportBackupBtn: document.getElementById('exportBackupBtn'),
    importBackupBtn: document.getElementById('importBackupBtn'),
    importBackupFileInput: document.getElementById('importBackupFileInput'),
    audioAnalysisCountLabel: document.getElementById('audioAnalysisCountLabel'),
    audioAnalysisCurrentTrack: document.getElementById('audioAnalysisCurrentTrack'),
    startAudioAnalysisBtn: document.getElementById('startAudioAnalysisBtn'),
    pauseAudioAnalysisBtn: document.getElementById('pauseAudioAnalysisBtn'),
    audioAnalysisProgressBar: document.getElementById('audioAnalysisProgressBar'),

    // Track Upload to Phone
    trackUploadDeviceBadge: document.getElementById('trackUploadDeviceBadge'),
    trackUploadDeviceText: document.getElementById('trackUploadDeviceText'),
    trackUploadDropzone: document.getElementById('trackUploadDropzone'),
    trackUploadFileInput: document.getElementById('trackUploadFileInput'),
    trackUploadPreviewCard: document.getElementById('trackUploadPreviewCard'),
    trackUploadFileName: document.getElementById('trackUploadFileName'),
    trackUploadFileSize: document.getElementById('trackUploadFileSize'),
    trackUploadTitleInput: document.getElementById('trackUploadTitleInput'),
    trackUploadArtistInput: document.getElementById('trackUploadArtistInput'),
    trackUploadSubmitBtn: document.getElementById('trackUploadSubmitBtn'),
    trackUploadCancelBtn: document.getElementById('trackUploadCancelBtn'),
    trackUploadProgressContainer: document.getElementById('trackUploadProgressContainer'),
    trackUploadProgressFill: document.getElementById('trackUploadProgressFill'),
    trackUploadStatusMsg: document.getElementById('trackUploadStatusMsg')
  };



  let pendingAddToPlaylistTrackId = null;
  let updateStatus = null;
  let updateNoticeShown = false;
  let autoEqCharacter = 'learning';

  // --- TOAST NOTIFICATIONS ---
  function showToast(message, icon = '✓', duration = 2800) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<span style="font-size:14px;">${icon}</span> <span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('hiding');
      setTimeout(() => toast.remove(), 250);
    }, duration);
  }

  // --- TIME-OF-DAY GREETING ---
  let greetingKey = null;
  let greetingUpdatedAt = 0;
  function updateGreeting() {
    const greetingEl = document.getElementById('viewGreeting');
    if (!greetingEl) return;
    const now = new Date(), plays = [...(state.stats?.plays || []), ...readTasteSkips()], last = plays.at(-1);
    const key = JSON.stringify([state.lang, now.toDateString(), now.getHours(), state.tracks.length,
      plays.length, last?.id, last?.started, last?.heard, last?.finished, last?.skipped]);
    if (key === greetingKey && now.getTime() - greetingUpdatedAt < 15 * 60000) return;
    greetingKey = key;
    greetingUpdatedAt = now.getTime();

    if (typeof PresenceEngine !== 'undefined' && typeof PresenceEngine.generateGreeting === 'function') {
      try {
        const greeting = PresenceEngine.generateGreeting(state.tracks, {...state.stats, plays}, { lang: state.lang });
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
    syncSharedAudio();
    syncExcludedTracksFromServer();
    syncFavoriteMomentsFromServer();
    await loadCachedTracksList();
    updateGreeting();
    setupEventListeners();
    updateDataGuardStatusUI();
    window.addEventListener('pain:dj-changed',syncSharedAudio);
    setInterval(() => { if (!document.hidden) { updateGreeting(); if(state.currentView==='home')renderHome(); } }, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) updateGreeting(); });
    setTimeout(() => checkForUpdates(false, true), 800);
    setInterval(() => checkForUpdates(true, true), 6 * 60 * 60 * 1000);
    window.addEventListener('pain:show-player',()=>switchView('player'));
    let homeFrame=0;
    window.addEventListener('pain:queue-ui',()=>{
      if(state.currentView==='home'&&!homeFrame)homeFrame=requestAnimationFrame(()=>{homeFrame=0;if(state.currentView==='home')renderHome();});
    });
    startDiscoveryPolling();

    // Check query parameters and URL Hash for deep-linking
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('mode') === 'grid') applyViewMode('grid');
    if (urlParams.get('mode') === 'list') applyViewMode('list');

    const hash = window.location.hash.replace('#', '');
    if (hash === 'profile') {
      switchView('insights');
      setTimeout(openProfileModal, 150);
    } else if (hash && ['home', 'library', 'favorites', 'player', 'insights', 'sync'].includes(hash)) {
      switchView(hash);
    } else {
      switchView(state.theme==='form'?'home':'library');
    }

    window.addEventListener('hashchange', () => {
      const h = window.location.hash.replace('#', '');
      if (h === 'profile') {
        switchView('insights');
        setTimeout(openProfileModal, 100);
      } else if(state.theme==='form'&&h!==state.currentView&&['home','library','favorites','player','insights','sync'].includes(h)) {
        switchView(h);
      }
    });

    if (urlParams.get('eq') === '1') {
      setTimeout(() => {
        DOM.eqModalBackdrop.style.display = 'flex';
      }, 300);
    }
  }

  // --- WEB AUDIO API EQUALIZER & DUAL-DECK ROUTING ---
  function initAudioNodes() {
    if (audioCtx) return;
    try {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioCtxClass();

      if (deckA) {
        sourceNodeA = audioCtx.createMediaElementSource(deckA);
        gainNodeA = audioCtx.createGain();
        gainNodeA.gain.value = 1.0;
        sourceNodeA.connect(gainNodeA);
      }
      if (deckB) {
        sourceNodeB = audioCtx.createMediaElementSource(deckB);
        gainNodeB = audioCtx.createGain();
        gainNodeB.gain.value = 0.0;
        sourceNodeB.connect(gainNodeB);
      }

      sourceNode = sourceNodeA || sourceNodeB;
      preampNode = audioCtx.createGain();
      if (gainNodeA) gainNodeA.connect(preampNode);
      if (gainNodeB) gainNodeB.connect(preampNode);

      let lastNode = preampNode;

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

      transitionGainNode = audioCtx.createGain();
      transitionGainNode.gain.value = 1;

      try {
        smartVolumeNode = SmartVolume.create(audioCtx, audio);
        lastNode.connect(smartVolumeNode.input);
        smartVolumeNode.output.connect(transitionGainNode);
        applySmartVolume();
      } catch (_) {
        lastNode.connect(transitionGainNode);
      }
      transitionGainNode.connect(audioCtx.destination);
      applyEqualizerAudioGains();
      try { autoEqHeadroom = AutoEqualizer.createHeadroom(audioCtx, EQ_FREQUENCIES); } catch (_) {}
      updateAudioObservers();
    } catch (err) {
      console.warn('Web Audio API Equalizer initialization deferred or unsupported:', err);
    }
  }

  function updateAudioObservers() {
    const allowed = state.performanceMode !== 'maximum' && !document.hidden;
    if (!allowed) {
      const stops = audioObservationStops; audioObservationStops = [];
      for (const stop of stops) stop();
      return;
    }
    if (!audioCtx || audioObservationStops.length) return;
    const onProfile = (track, profile) => {
      queue?.setAudioProfile(track.id, profile);
      if (state.eq.auto && String(track.id) === String(state.currentTrackId)) applyAutoEqualizer(track, profile);
      schedulePersistAudioProfiles();
      if (audioSyncTimer === null) audioSyncTimer = setTimeout(() => { audioSyncTimer = null; syncSharedAudio(); }, 30000);
    };
    try {
      for (const [deck, source] of [[deckA, sourceNodeA], [deckB, sourceNodeB]]) {
        if (deck && source) audioObservationStops.push(AudioProfile.observe(audioCtx, source, deck,
          () => deckTrackSnapshots.get(deck), onProfile, audioProfiles));
      }
    } catch (_) { for (const stop of audioObservationStops) stop(); audioObservationStops = []; }
  }
  document.addEventListener('visibilitychange', () => {
    updateAudioObservers();
    if (document.hidden) bpmAnalysisController?.abort();
  });

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
    return `/api/cover/${encodeURIComponent(track.id)}?priority=${track.id === state.currentTrackId ? 1 : 0}&online=${localStorage.getItem('pain_online_covers') === 'true' ? 1 : 0}`;
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

  function updateDurationLabel(duration, position = pendingSeekTime ?? audio.currentTime ?? 0) {
    const remaining = state.showRemaining;
    DOM.totalTime.textContent = (remaining ? '−' : '') + formatTime(remaining ? Math.max(0, duration - position) : duration);
    const hint = state.lang === 'ru'
      ? (remaining ? 'Оставшееся время · нажмите, чтобы показать длительность' : 'Длительность · нажмите, чтобы показать оставшееся время')
      : (remaining ? 'Time left · click to show duration' : 'Duration · click to show time left');
    DOM.totalTime.title = hint;
    DOM.totalTime.setAttribute('aria-label', hint);
    DOM.totalTime.setAttribute('aria-pressed', String(remaining));
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
      updateAudioAnalysisSettingsUI();
    } catch (e) {
      console.warn('Error loading local data:', e);
    }
  }

  // --- NAVIGATION & VIEW SWITCHING ---
  function switchView(viewName, playlistId = null) {
    if(viewName==='home'&&state.theme!=='form')viewName='library';
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
    if(state.theme==='form')document.querySelector('.views-viewport').scrollTop=0;
    window.location.hash = playlistId ? `playlist=${playlistId}` : viewName;
  }

  function renderCurrentView() {
    if (state.currentView === 'home') {
      renderHome();
    } else if (state.currentView === 'library') {
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

  function renderHome(){
    if(typeof HomeView==='undefined')return;
    HomeView.render({
      tracks:state.tracks,
      stats:state.stats,
      playlists:state.playlists,
      queue,
      lang:state.lang,
      current:queue?.getCurrentTrack(),
      isPlaying:state.isPlaying,
      showMoments:state.homeMomentsEnabled,
      favoriteMoments:state.favoriteMoments,
      momentsReel:momentsReel?momentsReel.getState():{active:false,snippetSec:25}
    }, {
      cover:getCoverUrl,
      fallbackCover:getProceduralCoverSvg,
      navigate:switchView,
      duo:handleDuoPlaylist,
      resume:togglePlay,
      playTrack:id=>{const track=state.tracks.find(t=>String(t.id)===id);if(track)playTrackById(track.id);},
      playMix:(track,tracks,items)=>{
        playTrackInContext(track,state.tracks,{type:'library',title:'Smart DJ',allowNew:true});
        const start=tracks.findIndex(t=>String(t.id)===String(track.id));
        const decision=items?.[start]?.decision,details=decision?.explanation;
        if(['pulseflow-clap-faiss','frequency-pulseflow-ties','pulseflow-uniform'].includes(details?.method)){
          queue.setShuffleMode('smart');state.shuffleMode='smart';
          queue.lastTransition=decision;
          queue.pulseflowPlan={seed:decision.fromTrack,policy:details.policy,personal:details.method==='frequency-pulseflow-ties',preview:true,vibeKey:JSON.stringify(queue.pulseflowVibe||null),
            remaining:items.slice(start+1).map(row=>({id:row.track.id,score:row.decision.explanation.score}))};
          // Finish the selected preview, then continue through the library.
        }
      },
      playMoment:id=>{
        if (momentsReel && momentsReel.getState().active) {
          startMomentsReel(id);
        } else {
          seekToFavoriteMoment(id, state.tracks, { type: 'moments', title: state.lang === 'ru' ? 'Лучшие моменты' : 'Favorite Moments' });
        }
      },
      startReel:(id,sec)=>startMomentsReel(id,sec),
      stopReel:()=>stopMomentsReel(),
      nextReel:()=>nextMomentsReel(),
      keepFull:()=>keepFullMomentsReel(),
      setSnippetSec:sec=>setMomentsSnippetSec(sec)
    });
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
      const identities=new Set(),now=Date.now();
      for (let i = 0; i < plays.length; i++) {
        const p=plays[i],tid=p?.track,key=JSON.stringify([tid,p?.started]),duration=Number(p?.duration);
        const threshold=duration>0?Math.min(30000,Math.max(1000,duration/2)):30000;
        if(tid&&p.started>0&&p.started<=now&&p.heard>=threshold&&!identities.has(key)){identities.add(key);playCountsCache.set(tid,(playCountsCache.get(tid)||0)+1);}
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
        seekToFavoriteMoment(targetTrackId, container._currentTrackList || state.tracks, container._currentContextInfo);
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
        <div class="track-row-title ${isCurrent ? 'active-text' : ''}">${escapeHtml(displayTrackTitle(track))}</div>
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
      <div class="track-card-title ${isCurrent ? 'active-text' : ''}">${escapeHtml(displayTrackTitle(track))}</div>
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
  function resolveDuoPlaylist(pl) {
    if(pl.duo!==1||!Array.isArray(pl.sharedTracks))return null;
    const resolved=DuoPlaylist.resolve(pl.sharedTracks,state.tracks);
    pl.trackIds=resolved.ids;return resolved;
  }

  async function handleDuoPlaylist(action,scope,id){
    const ru=state.lang==='ru';
    try{
      if(action==='duo-share'){
        const pl=state.playlists.find(p=>p.id===id&&p.duo===1);
        if(pl)DuoPlaylist.download(DuoPlaylist.pack(pl.sharedTracks,'playlist',pl.name));return;
      }
      const mine=DuoPlaylist.select(state.tracks,scope,scope==='history'?queue.completedCounts():undefined);
      if(action==='duo-export'){
        if(!mine.length){showToast(ru?'В выбранном списке пока пусто. Попробуйте «Избранное» или «Вся фонотека».':'This selection is empty. Try Favourites or Entire library.');return;}
        DuoPlaylist.download(DuoPlaylist.pack(mine));return;
      }
      const input=document.createElement('input');input.type='file';input.accept='.json,application/json';
      input.onchange=async()=>{
        const file=input.files?.[0];if(!file)return;
        try{
          if(file.size>4*1024*1024)throw Error('File too large');
          const received=DuoPlaylist.parse(await file.text());
          if(received.kind==='selection'&&!mine.length)throw Error('Empty local selection');
          const sharedTracks=received.kind==='playlist'?received.tracks:DuoPlaylist.combine(mine,received.tracks);
          if(!sharedTracks.length)throw Error('Empty list');
          const pl={id:'pl_'+crypto.randomUUID(),name:received.kind==='playlist'&&received.name?received.name:(ru?'Вместе':'Together'),duo:1,sharedTracks,trackIds:[]};
          resolveDuoPlaylist(pl);
          const response=await fetch('/api/playlists',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify([...state.playlists,pl])});
          if(!response.ok)throw Error('Save failed');
          state.playlists.push(pl);renderPlaylistsSidebar();switchView('playlist',pl.id);
          showToast(ru?'Общий список сохранён. Передать его другу можно внизу Главной.':'Combined list saved. Share it from the bottom of Home.');
        }catch(_){showToast(ru?'Не удалось создать плейлист. Нужен файл PAIN до 4 МБ и непустой выбранный список.':'Could not create playlist. Use a PAIN file under 4 MB and a nonempty selection.');}
      };
      input.click();
    }catch(_){showToast(ru?'Не удалось обработать список.':'Could not process the list.');}
  }

  function renderPlaylistsSidebar() {
    DOM.sidebarPlaylistsList.innerHTML = '';

    state.playlists.forEach(pl => {
      resolveDuoPlaylist(pl);
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
    const duo=resolveDuoPlaylist(pl);
    const trackCount = (pl.trackIds || []).length;
    DOM.customPlaylistMeta.textContent = state.lang === 'ru'
      ? `${trackCount} треков · кастомный плейлист`
      : `${trackCount} tracks · custom playlist`;
    if(duo)DOM.customPlaylistMeta.textContent=state.lang==='ru'
      ? `Совместный · ${trackCount} доступны · ${duo.missing.length} нужно добавить в фонотеку · ${pl.sharedTracks.length} всего`
      : `Together · ${trackCount} available · ${duo.missing.length} missing audio · ${pl.sharedTracks.length} total`;
    const missing=document.getElementById('duoMissing'),list=document.getElementById('duoMissingList');
    missing.hidden=!duo?.missing.length;
    if(missing.dataset.playlist!==pl.id){missing.open=false;missing.dataset.playlist=pl.id;}
    list.value=(duo?.missing||[]).map(t=>[t.artist,t.title].filter(Boolean).join(' — ')).join('\n');
    list.setAttribute('aria-label',state.lang==='ru'?'Недостающие треки':'Missing tracks');
    document.getElementById('duoCopyMissing').onclick=async()=>{
      try{await navigator.clipboard.writeText(list.value);showToast(state.lang==='ru'?'Список скопирован — можно отправить другу.':'List copied — ready to send to your friend.');}
      catch(_){list.focus();list.select();showToast(state.lang==='ru'?'Список выделен. Нажмите Ctrl+C, чтобы скопировать.':'List selected. Press Ctrl+C to copy.');}
    };

    const plTracks = (pl.trackIds || []).map(id => state.tracks.find(t => t.id === id)).filter(Boolean);
    const contextInfo = { type: 'playlist', title: pl.name, id: pl.id };
    renderTracksTable(DOM.playlistTableBody, plTracks, !duo, contextInfo);
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

    DOM.bigTrackTitle.textContent = displayTrackTitle(track);
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
        const pct = Math.max(state.theme==='form'?0:4, Math.round((ms / maxH) * 85));
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

    // Shared accounting rules also used by the Android insights engine.
    const {streak:currentStreak,longestStreak}=details.behavior;

    if (DOM.statStreak) DOM.statStreak.textContent = isRu ? `${currentStreak} дн` : `${currentStreak} days`;
    if (DOM.statLongestStreak) DOM.statLongestStreak.textContent = isRu ? `Рекорд: ${longestStreak} дн` : `Best: ${longestStreak} days`;
    if (DOM.statStreakText) DOM.statStreakText.textContent = isRu ? `${currentStreak} дн подряд` : `${currentStreak} day streak`;

    // 6. Behavioral Habits & Completion Ratios
    const {completed,early,other,qualified,replayed,newPlays}=details.behavior;
    const ended=completed+early+other;
    const compPct=ended?Math.round(completed/ended*100):0;
    const earlyPct=ended?Math.round(early/ended*100):0;
    if (DOM.statCompletionRate) DOM.statCompletionRate.textContent = `${compPct}%`;
    if (DOM.statEarlySkips) DOM.statEarlySkips.textContent = `${earlyPct}%`;
    const trackCounts=details.behavior.counts;
    const uniqueCount=Object.keys(trackCounts).length,totalPlays=qualified;
    const replayPct=qualified?Math.round(replayed/qualified*100):0;
    const discoveryPct=qualified?Math.round(newPlays/qualified*100):0;
    if (DOM.statReplayRate) DOM.statReplayRate.textContent = `${replayPct}%`;
    if (DOM.statDiscoveryRate) DOM.statDiscoveryRate.textContent = `${discoveryPct}%`;
    for(const [element,value] of [[DOM.statCompletionRate,compPct],[DOM.statEarlySkips,earlyPct],[DOM.statReplayRate,replayPct],[DOM.statDiscoveryRate,discoveryPct]])
      element?.closest('.stat-card')?.style.setProperty('--form-ratio',value);

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
        const h = Math.max(state.theme==='form'?0:6, Math.round((ms / maxDayMs) * 90));
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

  // --- EQUAL-POWER DUAL-DECK CROSSFADE ENGINE ---
  function createEqualPowerCurves(numPoints = 64) {
    const fadeOut = new Float32Array(numPoints);
    const fadeIn = new Float32Array(numPoints);
    for (let i = 0; i < numPoints; i++) {
      const x = i / (numPoints - 1);
      // Cosine / Sine equal-power crossfade curve
      fadeOut[i] = Math.max(0.0001, Math.cos(x * 0.5 * Math.PI));
      fadeIn[i] = Math.max(0.0001, Math.sin(x * 0.5 * Math.PI));
    }
    return { fadeOut, fadeIn };
  }

  function crossfadeDecks(outgoingDeck, incomingDeck, durationSec = 1.5) {
    const curTimer = ++crossfadeTimerId;
    isCrossfading = true;

    if (!audioCtx || !gainNodeA || !gainNodeB) {
      if (outgoingDeck && outgoingDeck !== incomingDeck) {
        try { outgoingDeck.pause(); outgoingDeck.src = ''; } catch (_) {}
      }
      isCrossfading = false;
      return;
    }

    try {
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
      if (transitionGainNode) setTrackTransitionGain(1);
      const now = audioCtx.currentTime;
      const remainingOut = (outgoingDeck && outgoingDeck.duration > 0 && outgoingDeck.currentTime > 0)
        ? Math.max(0.25, outgoingDeck.duration - outgoingDeck.currentTime)
        : durationSec;
      const dur = Math.max(0.25, Math.min(4.0, Math.min(durationSec, remainingOut)));
      const outGain = (outgoingDeck === deckA) ? gainNodeA.gain : gainNodeB.gain;
      const inGain = (incomingDeck === deckA) ? gainNodeA.gain : gainNodeB.gain;

      const { fadeOut, fadeIn } = createEqualPowerCurves(64);

      if (typeof outGain.cancelAndHoldAtTime === 'function') outGain.cancelAndHoldAtTime(now);
      else { outGain.cancelScheduledValues(now); outGain.setValueAtTime(outGain.value || 1, now); }

      if (typeof inGain.cancelAndHoldAtTime === 'function') inGain.cancelAndHoldAtTime(now);
      else { inGain.cancelScheduledValues(now); inGain.setValueAtTime(0.0001, now); }

      outGain.setValueCurveAtTime(fadeOut, now, dur);
      inGain.setValueCurveAtTime(fadeIn, now, dur);

      setTimeout(() => {
        if (curTimer === crossfadeTimerId) {
          isCrossfading = false;
          if (outgoingDeck && outgoingDeck !== activeDeck) {
            try { outgoingDeck.pause(); outgoingDeck.src = ''; } catch (_) {}
            try {
              outGain.cancelScheduledValues(audioCtx.currentTime);
              outGain.setValueAtTime(0.0001, audioCtx.currentTime);
            } catch (_) {}
          }
          if (inGain) {
            try {
              inGain.cancelScheduledValues(audioCtx.currentTime);
              inGain.setValueAtTime(1.0, audioCtx.currentTime);
            } catch (_) {}
          }
        }
      }, Math.round(dur * 1000) + 60);
    } catch (e) {
      console.warn('Crossfade execution error:', e);
      isCrossfading = false;
    }
  }

  function setTrackTransitionGain(value, seconds = 0) {
    if (!audioCtx || !transitionGainNode) return;
    try {
      const now = audioCtx.currentTime;
      const gain = transitionGainNode.gain;
      const held = Math.max(0.0001, Math.min(1, gain.value));
      if (typeof gain.cancelAndHoldAtTime === 'function') gain.cancelAndHoldAtTime(now);
      else { gain.cancelScheduledValues(now); gain.setValueAtTime(held, now); }
      const target = Math.max(0.0001, Math.min(1, value));
      if (seconds > 0) gain.linearRampToValueAtTime(target, now + seconds);
      else {
        gain.setValueAtTime(target, now);
        gain.value = target;
      }
    } catch (_) {}
  }

  function startTrackObject(track, startPosition = 0) {
    if (!track) return;
    initAudioNodes();
    sampleListening();
    if (state.currentTrackId) recordTrackFinished(state.currentTrackId, true);
    const request = ++playbackRequest;
    state.currentTrackId = track.id;
    state.currentTrackIndex = state.tracks.findIndex(t => t.id === track.id);
    state.hasPrefetchedNext = false;
    beginListening(track);
    state.isPlaying = false;
    const durSec = Math.max(0, Number(track.duration) || 0) / 1000;
    DOM.currentTime.textContent = formatTime(startPosition);
    updateDurationLabel(durSec, startPosition);
    const startPct = durSec > 0 && startPosition > 0 ? Math.max(0, Math.min(100, (startPosition / durSec) * 100)) : 0;
    DOM.progressFill.style.width = `${startPct}%`;
    if (DOM.progressThumb) DOM.progressThumb.style.left = `${startPct}%`;

    playingTrackSnapshot = {...track};
    if (state.eq.auto) applyAutoEqualizer(track);

    const isReelActive = typeof momentsReel !== 'undefined' && momentsReel && momentsReel.getState().active;
    const hasActivePlaying = activeDeck && !activeDeck.paused && activeDeck.currentTime > 0 && activeDeck.src;
    const shouldCrossfade = hasActivePlaying && (state.trackTransition > 0 || isReelActive || isTrackFadingOut);
    const crossfadeDuration = isReelActive ? 1.5 : (state.trackTransition > 0 ? state.trackTransition : 0.35);

    isTrackFadingOut = false;

    if (shouldCrossfade && deckB) {
      // DUAL-DECK SEAMLESS OVERLAPPING CROSSFADE
      const outgoingDeck = activeDeck;
      const incomingDeck = (activeDeck === deckA) ? deckB : deckA;
      const incomingGain = (incomingDeck === deckA) ? gainNodeA : gainNodeB;
      if (incomingGain && audioCtx) {
        try {
          incomingGain.gain.cancelScheduledValues(audioCtx.currentTime);
          incomingGain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
        } catch (_) {}
      }

      if (transitionGainNode) setTrackTransitionGain(1);
      deckTrackSnapshots.set(incomingDeck, playingTrackSnapshot);
      incomingDeck.src = `/api/cached-track/${encodeURIComponent(track.id)}?phoneUrl=${encodeURIComponent(state.phoneUrl)}`;
      if (startPosition > 0) {
        const onLoaded = () => {
          try { incomingDeck.currentTime = startPosition; } catch (_) {}
          incomingDeck.removeEventListener('loadedmetadata', onLoaded);
        };
        incomingDeck.addEventListener('loadedmetadata', onLoaded);
        try { incomingDeck.currentTime = startPosition; } catch (_) {}
      }

      activeDeck = incomingDeck;
      standbyDeck = outgoingDeck;
      savePlaybackPosition(true);

      incomingDeck.play().then(() => {
        if (request === playbackRequest) {
          if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
          if (startPosition > 0) {
            try { incomingDeck.currentTime = startPosition; } catch (_) {}
          }
          crossfadeDecks(outgoingDeck, incomingDeck, crossfadeDuration);
          syncPlaybackState();
        }
      }).catch(async err => {
        if (request !== playbackRequest || err.name === 'AbortError') return;
        if (state.phoneUrl) {
          incomingDeck.src = `${state.phoneUrl.replace(/\/+$/, '')}/api/track/${encodeURIComponent(track.id)}`;
          try {
            await incomingDeck.play();
            if (request === playbackRequest) {
              if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
              if (startPosition > 0) {
                try { incomingDeck.currentTime = startPosition; } catch (_) {}
              }
              crossfadeDecks(outgoingDeck, incomingDeck, crossfadeDuration);
              syncPlaybackState();
            }
          } catch (e) {
            if (request === playbackRequest) console.warn('Audio unavailable:', e);
          }
        }
        if (request === playbackRequest) syncPlaybackState();
      });
    } else {
      // INITIAL START OR SINGLE DECK PLAYBACK
      pendingSeekTime = startPosition > 0 ? startPosition : null;
      if (gainNodeA && audioCtx) {
        try {
          gainNodeA.gain.cancelScheduledValues(audioCtx.currentTime);
          gainNodeA.gain.setValueAtTime(1.0, audioCtx.currentTime);
        } catch (_) {}
      }
      if (gainNodeB && audioCtx) {
        try {
          gainNodeB.gain.cancelScheduledValues(audioCtx.currentTime);
          gainNodeB.gain.setValueAtTime(0.0001, audioCtx.currentTime);
        } catch (_) {}
      }
      activeDeck = deckA;
      standbyDeck = deckB;
      deckTrackSnapshots.set(deckA, playingTrackSnapshot);
      deckA.src = `/api/cached-track/${encodeURIComponent(track.id)}?phoneUrl=${encodeURIComponent(state.phoneUrl)}`;
      savePlaybackPosition(true);
      deckA.play().then(() => {
        if (request === playbackRequest) {
          if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
          if (pendingSeekTime !== null) {
            try { deckA.currentTime = pendingSeekTime; } catch (_) {}
            pendingSeekTime = null;
          }
          syncPlaybackState();
        }
      }).catch(async err => {
        if (request !== playbackRequest || err.name === 'AbortError') return;
        if (state.phoneUrl) {
          deckA.src = `${state.phoneUrl.replace(/\/+$/, '')}/api/track/${encodeURIComponent(track.id)}`;
          try {
            await deckA.play();
            if (request === playbackRequest) {
              if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
              if (pendingSeekTime !== null) {
                try { deckA.currentTime = pendingSeekTime; } catch (_) {}
                pendingSeekTime = null;
              }
              syncPlaybackState();
            }
          } catch (e) {
            if (request === playbackRequest) console.warn('Audio unavailable:', e);
          }
        }
        if (request === playbackRequest) syncPlaybackState();
      });
    }

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

  function playTrackObject(track, startPosition = 0) {
    if (!track) return;
    pendingNextSkips = 0;
    isNavigatingNext = false;
    if (queue) queue.cancelPendingSelection();
    initAudioNodes();
    clearTimeout(trackTransitionTimer);
    ++trackTransitionRequest;
    startTrackObject(track, startPosition);
  }

  async function analyzeTrackBpmInBackground(track) {
    if (state.resourceSaver || document.hidden) return;
    if (!track || !track.id || !queue) return;
    if (queue.bpmCache && queue.bpmCache[track.id]) return;
    if (track._bpmAnalyzing) return;
    track._bpmAnalyzing = true;
    bpmAnalysisController?.abort();
    const controller = bpmAnalysisController = new AbortController();

    try {
      const srcUrl = `/api/cached-track/${encodeURIComponent(track.id)}?phoneUrl=${encodeURIComponent(state.phoneUrl)}`;
      const resp = await fetch(srcUrl, { headers: { Range: 'bytes=0-320000' }, signal: controller.signal });
      if (!resp.ok && resp.status !== 206) return;
      const arrayBuffer = await resp.arrayBuffer();

      if (controller.signal.aborted || state.resourceSaver || document.hidden) return;
      const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!OfflineCtx) return;
      const offlineCtx = new OfflineCtx(1, 44100 * 12, 44100);
      const audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer);
      if (state.resourceSaver || state.currentTrackId !== track.id) return;
      const pcmData = audioBuffer.getChannelData(0);
      const detectFn = QueueEngine?.detectBpmFromPcm || (QueueClass && QueueClass.detectBpmFromPcm);
      const detected = detectFn ? detectFn(pcmData, audioBuffer.sampleRate) : null;
      if (detected && detected >= 60 && detected <= 200) {
        queue.setTrackBpm(track.id, detected);
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

  function playTrackInContext(track, trackList, contextInfo, startPosition = 0) {
    if (!track) return;
    if (typeof momentsReel !== 'undefined' && momentsReel && momentsReel.getState().active && contextInfo?.type !== 'moments') {
      momentsReel.stop();
    }
    if (queue) {
      const list = Array.isArray(trackList) && trackList.length > 0 ? trackList : state.tracks;
      const idx = list.findIndex(t => t.id === track.id);
      queue.setContext(contextInfo?.type || 'library', list, idx !== -1 ? idx : 0, contextInfo?.title, !!contextInfo?.allowNew);
    }
    playTrackObject(track, startPosition);
  }

  function playTrackById(trackId, startPosition = 0) {
    if (queue) {
      const inQueue = queue.jumpToTrack(trackId);
      if (inQueue) {
        playTrackObject(inQueue, startPosition);
        return;
      }
    }
    const track = state.tracks.find(t => t.id === trackId);
    if (!track) return;
    if (queue) {
      const idx = state.tracks.findIndex(t => t.id === trackId);
      queue.setContext('library', state.tracks, idx !== -1 ? idx : 0, state.lang === 'ru' ? 'Фонотека' : 'Library', true);
    }
    playTrackObject(track, startPosition);
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

  function seekToTime(targetTime) {
    const time = Number(targetTime);
    if (!Number.isFinite(time) || time < 0) return;
    const dur = getCurrentTrackDuration();
    const clampedTime = dur > 0 ? Math.max(0, Math.min(dur, time)) : time;

    DOM.currentTime.textContent = formatTime(clampedTime);
    if (dur > 0) {
      const pct = Math.max(0, Math.min(100, (clampedTime / dur) * 100));
      DOM.progressFill.style.width = `${pct}%`;
      if (DOM.progressThumb) DOM.progressThumb.style.left = `${pct}%`;
    }

    isTrackFadingOut = false;
    isCrossfading = false;
    if (transitionGainNode) setTrackTransitionGain(1);
    if (audioCtx) {
      const activeGain = (activeDeck === deckA) ? gainNodeA : gainNodeB;
      const standbyGain = (activeDeck === deckA) ? gainNodeB : gainNodeA;
      if (activeGain) {
        try {
          activeGain.gain.cancelScheduledValues(audioCtx.currentTime);
          activeGain.gain.setValueAtTime(1.0, audioCtx.currentTime);
        } catch (_) {}
      }
      if (standbyGain) {
        try {
          standbyGain.gain.cancelScheduledValues(audioCtx.currentTime);
          standbyGain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
        } catch (_) {}
      }
      if (standbyDeck && standbyDeck !== activeDeck) {
        try { standbyDeck.pause(); standbyDeck.src = ''; } catch (_) {}
      }
    }

    if (audio.readyState >= 1) {
      try {
        audio.currentTime = clampedTime;
        pendingSeekTime = null;
      } catch (err) {
        console.warn('Audio currentTime seek error:', err);
        pendingSeekTime = clampedTime;
      }
    } else {
      pendingSeekTime = clampedTime;
    }
  }

  function seekToPercent(pct) {
    const dur = getCurrentTrackDuration();
    if (dur <= 0) return;
    const clampedPct = Math.max(0, Math.min(1, pct));
    seekToTime(clampedPct * dur);
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
    listening = state.saveHistory ? new ListeningLedger(track.id, Number(track.duration)||0) : null;
    if(queue)queue.currentStartedAt=listening?.started||Date.now();
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
    if(typeof HomeView!=='undefined')HomeView.setPlaying(state.isPlaying);
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
    DOM.bottomTrackTitle.textContent = displayTrackTitle(track);
    DOM.bottomTrackArtist.textContent = (track.artist || 'Unknown Artist') + (track.album ? ` · ${track.album}` : '');

    DOM.bottomCoverImg.src = getCoverUrl(track);
    DOM.bottomCoverImg.onerror = function() {
      this.onerror = null;
      this.src = getProceduralCoverSvg(track);
    };

    const durationSec = Math.max(0, Number(track.duration) || 0) / 1000;
    updateDurationLabel(durationSec);

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
      const jsonArr = JSON.stringify(Array.from(state.excludedRecommendations));
      localStorage.setItem('pain_excluded_recommendations', jsonArr);
      fetch('/api/excluded-tracks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: jsonArr
      }).catch(() => {});
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
    updateDataGuardStatusUI();
  }

  async function updateDataGuardStatusUI() {
    if (!DOM.dataGuardStatusHint) return;
    try {
      const res = await fetch('/api/backup/status');
      if (res.ok) {
        const info = await res.json();
        const ru = state.lang === 'ru';
        const count = info.snapshotCount || 0;
        let countStr = `${count} ${count === 1 ? 'снимок' : (count >= 2 && count <= 4 ? 'снимка' : 'снимков')}`;
        if (!ru) countStr = `${count} ${count === 1 ? 'snapshot' : 'snapshots'}`;
        DOM.dataGuardStatusHint.textContent = ru
          ? `Автозащита активна: ${countStr} на диске`
          : `Auto-protection active: ${countStr} on disk`;
      }
    } catch (_) {}
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

  // --- LIBRARY AUDIO ANALYSIS (BATCH ANALYZER) ---
  let batchAudioAnalyzer = null;

  function updateAudioAnalysisSettingsUI() {
    if (!DOM.audioAnalysisCountLabel) return;
    const ru = state.lang === 'ru';
    const tracks = state.tracks || [];
    const total = tracks.length;
    let analyzed = 0;
    for (const t of tracks) {
      const p = audioProfiles[t.id];
      if (typeof AudioAnalyzer !== 'undefined' && AudioAnalyzer.complete(p, t)) analyzed++;
    }
    const percent = total > 0 ? Math.round((analyzed / total) * 100) : 0;
    DOM.audioAnalysisCountLabel.textContent = ru
      ? `Анализировано: ${analyzed} / ${total} (${percent}%)`
      : `Analyzed: ${analyzed} / ${total} (${percent}%)`;

    if (DOM.audioAnalysisProgressBar) {
      DOM.audioAnalysisProgressBar.style.width = `${percent}%`;
    }

    if (batchAudioAnalyzer && batchAudioAnalyzer.status === 'running') {
      const cur = batchAudioAnalyzer.currentTrack;
      const title = cur ? `${cur.artist || '—'} - ${cur.title || '—'}` : '…';
      if (DOM.audioAnalysisCurrentTrack) {
        DOM.audioAnalysisCurrentTrack.textContent = ru
          ? `Анализируется: ${title}`
          : `Analyzing: ${title}`;
      }
      if (DOM.startAudioAnalysisBtn) DOM.startAudioAnalysisBtn.style.display = 'none';
      if (DOM.pauseAudioAnalysisBtn) {
        DOM.pauseAudioAnalysisBtn.style.display = 'inline-flex';
        DOM.pauseAudioAnalysisBtn.textContent = ru ? 'Пауза' : 'Pause';
      }
    } else if (batchAudioAnalyzer && batchAudioAnalyzer.status === 'paused') {
      if (DOM.audioAnalysisCurrentTrack) {
        DOM.audioAnalysisCurrentTrack.textContent = ru ? 'Анализ приостановлен' : 'Analysis paused';
      }
      if (DOM.startAudioAnalysisBtn) {
        DOM.startAudioAnalysisBtn.style.display = 'inline-flex';
        DOM.startAudioAnalysisBtn.textContent = ru ? 'Продолжить' : 'Resume';
      }
      if (DOM.pauseAudioAnalysisBtn) DOM.pauseAudioAnalysisBtn.style.display = 'none';
    } else {
      if (DOM.audioAnalysisCurrentTrack) {
        if (total > 0 && analyzed >= total) {
          DOM.audioAnalysisCurrentTrack.textContent = ru
            ? 'Все треки успешно проанализированы'
            : 'All tracks successfully analyzed';
        } else {
          const remaining = total - analyzed;
          DOM.audioAnalysisCurrentTrack.textContent = ru
            ? `Осталось проанализировать: ${remaining}`
            : `Remaining to analyze: ${remaining}`;
        }
      }
      if (DOM.startAudioAnalysisBtn) {
        DOM.startAudioAnalysisBtn.style.display = 'inline-flex';
        DOM.startAudioAnalysisBtn.textContent = total > 0 && analyzed >= total
          ? (ru ? 'Переанализировать всё' : 'Re-analyze all')
          : (ru ? 'Анализировать всё' : 'Analyze all tracks');
      }
      if (DOM.pauseAudioAnalysisBtn) DOM.pauseAudioAnalysisBtn.style.display = 'none';
    }
  }

  function initAudioAnalysisSettings() {
    if (!DOM.startAudioAnalysisBtn) return;
    if (!batchAudioAnalyzer && typeof AudioAnalyzer !== 'undefined' && AudioAnalyzer.BatchAnalyzer) {
      batchAudioAnalyzer = new AudioAnalyzer.BatchAnalyzer({ phoneUrl: state.phoneUrl });
    }

    DOM.startAudioAnalysisBtn.addEventListener('click', () => {
      if (!batchAudioAnalyzer) return;
      if (batchAudioAnalyzer.status === 'paused') {
        batchAudioAnalyzer.resume();
        updateAudioAnalysisSettingsUI();
        return;
      }
      const tracks = state.tracks || [];
      const total = tracks.length;
      let analyzed = 0;
      for (const t of tracks) {
        const p = audioProfiles[t.id];
        if (typeof AudioAnalyzer !== 'undefined' && AudioAnalyzer.complete(p, t)) analyzed++;
      }
      const overwrite = total > 0 && analyzed >= total;
      batchAudioAnalyzer.phoneUrl = state.phoneUrl;
      batchAudioAnalyzer.start(tracks, audioProfiles, {
        overwriteExisting: overwrite,
        onProgress: () => updateAudioAnalysisSettingsUI(),
        onTrackComplete: (track, profile, bpm) => {
          audioProfiles[track.id] = profile;
          queue?.setAudioProfile(track.id, profile);
          if (bpm) {
            queue?.setTrackBpm(track.id, bpm);
            schedulePersistBpmCache();
          }
          schedulePersistAudioProfiles();
          if (audioSyncTimer === null) {
            audioSyncTimer = setTimeout(() => { audioSyncTimer = null; syncSharedAudio(); }, 2500);
          }
        },
        onComplete: () => {
          schedulePersistAudioProfiles(true);
          schedulePersistBpmCache(true);
          syncSharedAudio();
          updateAudioAnalysisSettingsUI();
          const failed = batchAudioAnalyzer.failed || 0;
          showToast(failed
            ? (state.lang === 'ru' ? `Не удалось проанализировать: ${failed}. Можно повторить.` : `Analysis failed for ${failed} tracks. You can retry.`)
            : (state.lang === 'ru' ? 'Анализ фонотеки завершён' : 'Library analysis complete'), failed ? '⚠️' : '✓');
        }
      });
      updateAudioAnalysisSettingsUI();
    });

    if (DOM.pauseAudioAnalysisBtn) {
      DOM.pauseAudioAnalysisBtn.addEventListener('click', () => {
        if (!batchAudioAnalyzer) return;
        if (batchAudioAnalyzer.status === 'running') {
          batchAudioAnalyzer.pause();
        } else if (batchAudioAnalyzer.status === 'paused') {
          batchAudioAnalyzer.resume();
        }
        updateAudioAnalysisSettingsUI();
      });
    }
  }

  // --- FAVORITE MOMENTS (PER-TRACK BOOKMARK) ---
  function saveFavoriteMoments() {
    try {
      const data = typeof FavoriteMoments !== 'undefined'
        ? FavoriteMoments.serialize(state.favoriteMoments)
        : JSON.stringify(state.favoriteMoments || {});
      localStorage.setItem('pain_favorite_moments', data);
      fetch('/api/favorite-moments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: data
      }).catch(() => {});
    } catch (_) {}
  }
  // --- TRACK UPLOAD TO PHONE CONTROLLER ---
  let selectedUploadTrackFile = null;

  async function updateTrackUploadSettingsUI() {
    if (!DOM.trackUploadDeviceBadge) return;
    const ru = state.lang === 'ru';
    try {
      const res = await fetch('/api/upload-status');
      if (res.ok) {
        const data = await res.json();
        if (data.phoneConnected) {
          DOM.trackUploadDeviceBadge.className = 'upload-device-badge connected';
          DOM.trackUploadDeviceText.textContent = ru
            ? `Телефон на связи (${data.phoneIp})`
            : `Phone connected (${data.phoneIp})`;
        } else {
          DOM.trackUploadDeviceBadge.className = 'upload-device-badge offline';
          const queueText = data.pendingCount > 0 ? (ru ? ` · в очереди: ${data.pendingCount}` : ` · in queue: ${data.pendingCount}`) : '';
          DOM.trackUploadDeviceText.textContent = ru
            ? `Телефон не в сети (сохранение в очередь)${queueText}`
            : `Phone offline (will queue)${queueText}`;
        }
      }
    } catch (_) {}
  }

  function handleUploadFileSelection(file) {
    if (!file) return;
    const ru = state.lang === 'ru';
    const validExts = ['.mp3', '.flac', '.wav', '.m4a', '.ogg'];
    const lowerName = file.name.toLowerCase();
    const isAudio = validExts.some(ext => lowerName.endsWith(ext)) || (file.type && file.type.startsWith('audio/'));
    if (!isAudio) {
      showToast(ru ? 'Пожалуйста, выберите аудиофайл (MP3, FLAC, WAV, M4A, OGG)' : 'Please select an audio file (MP3, FLAC, WAV, M4A, OGG)', '⚠');
      return;
    }

    selectedUploadTrackFile = file;
    if (DOM.trackUploadFileName) DOM.trackUploadFileName.textContent = file.name;
    if (DOM.trackUploadFileSize) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      DOM.trackUploadFileSize.textContent = `${sizeMb} MB`;
    }

    // Auto-detect Title and Artist from filename: "Artist - Title.ext"
    const dotIdx = file.name.lastIndexOf('.');
    const nameWithoutExt = dotIdx > 0 ? file.name.substring(0, dotIdx) : file.name;
    let title = nameWithoutExt;
    let artist = '';
    if (nameWithoutExt.includes(' - ')) {
      const parts = nameWithoutExt.split(' - ');
      artist = parts[0].trim();
      title = parts.slice(1).join(' - ').trim();
    }
    if (DOM.trackUploadTitleInput) DOM.trackUploadTitleInput.value = title;
    if (DOM.trackUploadArtistInput) DOM.trackUploadArtistInput.value = artist;

    if (DOM.trackUploadPreviewCard) DOM.trackUploadPreviewCard.style.display = 'block';
    if (DOM.trackUploadProgressContainer) DOM.trackUploadProgressContainer.style.display = 'none';
    if (DOM.trackUploadSubmitBtn) DOM.trackUploadSubmitBtn.disabled = false;
  }

  function resetTrackUploadUI() {
    selectedUploadTrackFile = null;
    if (DOM.trackUploadFileInput) DOM.trackUploadFileInput.value = '';
    if (DOM.trackUploadPreviewCard) DOM.trackUploadPreviewCard.style.display = 'none';
    if (DOM.trackUploadProgressContainer) DOM.trackUploadProgressContainer.style.display = 'none';
    if (DOM.trackUploadSubmitBtn) DOM.trackUploadSubmitBtn.disabled = false;
  }

  async function submitTrackUpload() {
    if (!selectedUploadTrackFile) return;
    const ru = state.lang === 'ru';
    if (DOM.trackUploadSubmitBtn) DOM.trackUploadSubmitBtn.disabled = true;
    if (DOM.trackUploadProgressContainer) DOM.trackUploadProgressContainer.style.display = 'block';
    if (DOM.trackUploadProgressFill) DOM.trackUploadProgressFill.style.width = '30%';
    if (DOM.trackUploadStatusMsg) {
      DOM.trackUploadStatusMsg.textContent = ru ? 'Передача трека…' : 'Uploading track…';
      DOM.trackUploadStatusMsg.style.color = 'var(--text-secondary, #a1a1aa)';
    }

    try {
      const title = DOM.trackUploadTitleInput ? DOM.trackUploadTitleInput.value.trim() : '';
      const artist = DOM.trackUploadArtistInput ? DOM.trackUploadArtistInput.value.trim() : '';
      const uploadUrl = new URL('/api/upload-to-phone', window.location.origin);
      uploadUrl.searchParams.set('filename', selectedUploadTrackFile.name);
      if (title) uploadUrl.searchParams.set('title', title);
      if (artist) uploadUrl.searchParams.set('artist', artist);

      if (DOM.trackUploadProgressFill) DOM.trackUploadProgressFill.style.width = '65%';

      const res = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'Content-Type': selectedUploadTrackFile.type || 'audio/mpeg',
          'X-Filename': encodeURIComponent(selectedUploadTrackFile.name),
          'X-Title': encodeURIComponent(title),
          'X-Artist': encodeURIComponent(artist)
        },
        body: selectedUploadTrackFile
      });

      if (DOM.trackUploadProgressFill) DOM.trackUploadProgressFill.style.width = '100%';

      if (res.ok) {
        const data = await res.json();
        const successMsg = data.message || (ru ? 'Трек успешно загружен!' : 'Track uploaded successfully!');
        if (DOM.trackUploadStatusMsg) {
          DOM.trackUploadStatusMsg.textContent = successMsg;
          DOM.trackUploadStatusMsg.style.color = 'var(--accent, #7c4dff)';
        }
        showToast(successMsg, '✓', 4000);
        setTimeout(resetTrackUploadUI, 2200);
        updateTrackUploadSettingsUI();
        await loadLocalData();
        await loadCachedTracksList();
      } else {
        const err = await res.json().catch(() => ({ error: 'Upload failed' }));
        const errMsg = err.error || (ru ? 'Не удалось загрузить трек' : 'Track upload failed');
        if (DOM.trackUploadStatusMsg) {
          DOM.trackUploadStatusMsg.textContent = errMsg;
          DOM.trackUploadStatusMsg.style.color = '#ef4444';
        }
        showToast(errMsg, '⚠', 4000);
        if (DOM.trackUploadSubmitBtn) DOM.trackUploadSubmitBtn.disabled = false;
      }
    } catch (e) {
      if (DOM.trackUploadStatusMsg) {
        DOM.trackUploadStatusMsg.textContent = e.message;
        DOM.trackUploadStatusMsg.style.color = '#ef4444';
      }
      showToast(e.message, '⚠', 4000);
      if (DOM.trackUploadSubmitBtn) DOM.trackUploadSubmitBtn.disabled = false;
    }
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

  function seekToFavoriteMoment(trackId = state.currentTrackId, contextList = null, contextInfo = null) {
    if (!trackId) return;
    const moment = typeof FavoriteMoments !== 'undefined'
      ? FavoriteMoments.getMoment(state.favoriteMoments, trackId)
      : (state.favoriteMoments?.[trackId] ?? null);
    if (moment === null || moment === undefined || !Number.isFinite(moment)) return;

    if (state.currentTrackId === trackId) {
      seekToTime(moment);
      if (audio.paused) {
        audio.play().then(() => syncPlaybackState()).catch(() => {});
      }
    } else {
      const track = state.tracks.find(t => t.id === trackId);
      if (track) {
        playTrackInContext(track, contextList || state.tracks, contextInfo, moment);
      }
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

  const momentsReel = typeof MomentsReel !== 'undefined'
    ? MomentsReel.createController({
        initialSnippetSec: Number(localStorage.getItem('pain_moments_snippet_sec')) || 25,
        onAdvance: (item, idx, list) => {
          playTrackInContext(item.track, list.map(x => x.track), { type: 'moments', title: state.lang === 'ru' ? 'Микс лучших моментов' : 'Moments Reel' }, item.momentSec);
        },
        onFade: (remaining) => {
          if (!deckB) {
            const fadeSec = Math.min(1.8, Math.max(0.4, (remaining || 1.5) / Math.max(0.1, audio.playbackRate)));
            setTrackTransitionGain(0.0001, fadeSec);
          }
        },
        onStateChange: () => {
          if (state.currentView === 'home') renderHome();
        }
      })
    : null;

  function startMomentsReel(startTrackId = null, snippetSec = null) {
    if (!momentsReel) return;
    if (snippetSec !== null && snippetSec !== undefined) {
      localStorage.setItem('pain_moments_snippet_sec', snippetSec);
    }
    const started = momentsReel.start(state.tracks, state.favoriteMoments, startTrackId, snippetSec);
    if (!started) {
      showToast(state.lang === 'ru' ? 'Нет сохранённых моментов' : 'No saved moments', 'ℹ');
      return;
    }
    renderCurrentView();
    showToast(state.lang === 'ru' ? 'Микс лучших моментов запущен' : 'Moments reel started', '▶');
  }

  function stopMomentsReel() {
    if (!momentsReel) return;
    momentsReel.stop();
    setTrackTransitionGain(1);
    renderCurrentView();
  }

  function keepFullMomentsReel() {
    if (!momentsReel) return;
    momentsReel.keepFullTrack();
    setTrackTransitionGain(1);
    renderCurrentView();
    showToast(state.lang === 'ru' ? 'Трек играет целиком' : 'Playing full track', '✓');
  }

  function nextMomentsReel() {
    if (!momentsReel) return;
    momentsReel.next();
  }

  function setMomentsSnippetSec(sec) {
    if (!momentsReel) return;
    momentsReel.setSnippetSec(sec);
    localStorage.setItem('pain_moments_snippet_sec', sec);
    renderCurrentView();
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
    if(!state.saveHistory||!listening||listening.id!==trackId||listening.closed)return;
    const audible=listening.finish();
    if(!audible){
      if(explicitSkip && listening.heard>=1000 && listening.duration>0 && !listening._tasteRecorded){
        listening._tasteRecorded=true;
        const feedback={track:trackId,started:listening.started,heard:Math.round(listening.heard),
          media_heard:Math.round(listening.ranges.reduce((n,r)=>n+r[1]-r[0],0)*1000),duration:listening.duration,skipped:1,finished:0};
        let skips=readTasteSkips();
        skips.push(feedback);skips=skips.slice(-2000);
        try{localStorage.setItem('pain_taste_skips',JSON.stringify(skips));}catch(_){}
        if(queue)queue.setStats({plays:[...(state.stats.plays||[]),...skips]});
        // The phone needs the same explicit feedback. Qualification rules keep
        // these previews out of play counts, while preserving honest skip/time data.
        const play={...feedback,id:'pc_'+(globalThis.crypto?.randomUUID?.()||Date.now()+'_'+Math.random().toString(36).slice(2)),session:'pc_companion',
          finished:0};
        state.stats.plays.push(play);localSyncRevision++;
        try{await fetch('/api/sync-stats',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({play,phoneUrl:state.phoneUrl})});}catch(_){}
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
  async function prefetchNextTrack() {
    if (state.hasPrefetchedNext) return;
    state.hasPrefetchedNext = true;
    let nextTrack;
    if (queue && queue.shuffleMode === 'smart' && typeof queue.peekNextAsync === 'function') {
      try {
        nextTrack = await queue.peekNextAsync();
      } catch (_) {
        state.hasPrefetchedNext = false;
        return;
      }
    } else {
      nextTrack = getNextTrack();
    }
    if (!nextTrack) {
      state.hasPrefetchedNext = false;
      return;
    }

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

  let isNavigatingNext = false;
  let pendingNextSkips = 0;

  async function playNextTrack(isAutoAdvance = false) {
    isAutoAdvance = isAutoAdvance === true;
    sampleListening();
    // DOM click handlers pass an Event; only an explicit true means natural end.
    const explicitSkip = isAutoAdvance === true ? false : !audio.ended;
    if (state.currentTrackId) recordTrackFinished(state.currentTrackId, explicitSkip);
    if (typeof momentsReel !== 'undefined' && momentsReel && momentsReel.getState().active) {
      momentsReel.next();
      return;
    }

    if (!queue) {
      if (state.tracks.length === 0) return;
      let nextIdx;
      if (state.shuffle) {
        nextIdx = Math.floor(Math.random() * state.tracks.length);
      } else {
        nextIdx = state.currentTrackIndex + 1;
        if (nextIdx >= state.tracks.length) nextIdx = 0;
      }
      playTrackIndex(nextIdx);
      return;
    }

    if (isNavigatingNext) {
      if (!isAutoAdvance) {
        pendingNextSkips++;
      }
      return;
    }

    isNavigatingNext = true;
    try {
      while (true) {
        let nextTrack;
        if (queue.shuffleMode === 'smart' && typeof queue.nextAsync === 'function') {
          nextTrack = await queue.nextAsync();
        } else {
          nextTrack = queue.next();
        }

        if (nextTrack === undefined) {
          // Manual track selection or cancel superseded this calculation
          return;
        }

        if (pendingNextSkips > 0) {
          pendingNextSkips--;
          if (nextTrack) {
            continue;
          }
        }

        if (nextTrack) {
          playTrackObject(nextTrack);
        } else {
          isCrossfading = false;
          state.isPlaying = false;
          updatePlayBtnUI();
          DOM.vinylBigDisc.classList.remove('spinning');
          updatePlayingRowUI();
        }
        break;
      }
    } finally {
      isNavigatingNext = false;
      pendingNextSkips = 0;
    }
  }

  function playPrevTrack() {
    pendingNextSkips = 0;
    isNavigatingNext = false;
    if (queue) queue.cancelPendingSelection();
    if (typeof momentsReel !== 'undefined' && momentsReel && momentsReel.getState().active) {
      momentsReel.prev();
      return;
    }
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
    theme = ['paper', 'dark', 'studio', 'spotify', 'stereo', 'form'].includes(theme) ? theme : 'paper';
    state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    document.querySelectorAll('input[name="appearanceTheme"]').forEach(input => { input.checked = input.value === theme; });
    try {
      localStorage.setItem('pain_theme', theme);
    } catch (e) {}
    if (state.fluidColor && state.fluidColor.toLowerCase() !== '#7c4dff') {
      applyFluidColor(state.fluidColor);
    }
    if(theme!=='form'&&state.currentView==='home')switchView('library');
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
    updateTrackTransitionUI();
    updateAudioAnalysisSettingsUI();
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
      updateAudioAnalysisSettingsUI();
      updateTrackUploadSettingsUI();
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
    const notes = document.getElementById('updateReleaseNotes');
    notes.hidden = !status?.available || !status?.notes;
    notes.textContent = notes.hidden ? '' : status.notes;
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
        showToast((state.lang === 'ru' ? `Доступно обновление ${updateStatus.latestVersion}` : `Update ${updateStatus.latestVersion} is available`) + (updateStatus.notes ? ': ' + updateStatus.notes.slice(0, 240) : ''), '↑', 9000);
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

        const isDark = ['dark', 'spotify', 'stereo'].includes(state.theme) || ['dark', 'spotify', 'stereo'].includes(root.getAttribute('data-theme'));
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

  function displayTrackTitle(track) {
    const title = track.title || 'Untitled';
    return state.cleanTitles ? ComfortUtils.cleanTitle(title) : title;
  }

  async function initDesktopPreferences() {
    const status = document.getElementById('desktopPreferencesStatus');
    const switches = [['autostartSwitch', 'autostart', 'canAutostart'], ['traySwitch', 'tray', 'canTray']];
    function render(settings) {
      for (const [id, key, capability] of switches) {
        const input = document.getElementById(id);
        input.checked = settings[key] === true;
        input.disabled = settings[capability] !== true;
      }
      status.textContent = settings.canTray ? '' : (state.lang === 'ru' ? 'Откройте PAIN через меню приложений или команду pain: эти настройки доступны в окне приложения.' : 'Open PAIN from the application menu or the pain command to use these settings.');
    }
    try {
      const response = await fetch('/api/desktop-preferences');
      if (!response.ok) throw new Error();
      let settings = await response.json();
      render(settings);
      for (const [id, key] of switches) document.getElementById(id).addEventListener('change', async e => {
        const value = e.target.checked;
        for (const [control] of switches) document.getElementById(control).disabled = true;
        try {
          const result = await fetch('/api/desktop-preferences', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pain-Update': 'preferences' }, body: JSON.stringify({ [key]: value }) });
          if (!result.ok) throw new Error();
          settings = await result.json(); render(settings);
        } catch (_) {
          render(settings);
          status.textContent = state.lang === 'ru' ? 'Не удалось применить настройку. Попробуйте ещё раз.' : 'Could not apply this setting. Try again.';
        }
      });
    } catch (_) { status.textContent = state.lang === 'ru' ? 'Настройки запуска доступны в локальном приложении.' : 'Startup settings require the local app.'; }
  }

  function applyPerformanceMode(value) {
    state.performanceMode = PerformanceMode.normalize(value);
    state.resourceSaver = PerformanceMode.get(value).saver;
    if (state.resourceSaver) bpmAnalysisController?.abort();
    updateAudioObservers();
    localStorage.setItem('pain_performance_mode', state.performanceMode);
    document.documentElement.dataset.performanceMode = state.performanceMode;
    document.documentElement.toggleAttribute('data-resource-saver', state.resourceSaver);
    document.getElementById('performanceMode').value = state.performanceMode;
    const hints = {
      full: ['Все эффекты и фоновый анализ. Обложки загружаются по мере просмотра.', 'All effects and background analysis. Covers load as you browse.'],
      balanced: ['Без декоративных анимаций и дополнительного анализа BPM. Реже проверяет телефон и новые обложки.', 'No decorative animation or extra BPM decoding. Fewer device and cover checks.'],
      maximum: ['Без анимаций, размытия, фонового анализа звука и автоиндексации. Новые обложки — только для текущей песни. Активный поиск телефона отключён; ручная синхронизация доступна.', 'No animation, blur, background audio analysis or auto-indexing. New covers only for the current song. Active phone discovery off; manual sync available.']
    };
    document.getElementById('performanceModeHint').textContent = hints[state.performanceMode][state.lang === 'ru' ? 0 : 1];
    fetch('/api/resource-saver', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: state.performanceMode }) }).catch(() => {});
    window.dispatchEvent(new CustomEvent('pain:performance', { detail: state.performanceMode }));
  }

  function initSettingsUI() {
    document.getElementById('cleanTitlesSwitch').checked = state.cleanTitles;
    applyPerformanceMode(state.performanceMode);
    initDesktopPreferences();
    document.getElementById('volumeLimitSlider').value = state.volumeLimit;
    document.getElementById('volumeLimitValue').textContent = state.volumeLimit + '%';
    document.getElementById('trackTransitionSlider').value = state.trackTransition;
    updateTrackTransitionUI();
    document.getElementById('reducedMotionSwitch').checked = state.reducedMotion;
    document.getElementById('onlineCoversSwitch').checked = localStorage.getItem('pain_online_covers') === 'true';
    document.getElementById('saveHistorySwitch').checked = state.saveHistory;
    const homeMomentsEl = document.getElementById('homeMomentsSwitch');
    if (homeMomentsEl) homeMomentsEl.checked = state.homeMomentsEnabled;
    document.documentElement.toggleAttribute('data-reduced-motion', state.reducedMotion);
    document.getElementById('smartVolumeSwitch').checked = state.smartVolume;
    document.getElementById('backgroundDuckSwitch').checked = state.backgroundDuck;
    updateAutoEqualizerUI();
    applyFluidColor(state.fluidColor);
    if (DOM.fluidBpmSyncSwitch) {
      DOM.fluidBpmSyncSwitch.checked = state.fluidBpmSync;
    }
    updateFluidBpmTempo();
  }

  function updateTrackTransitionUI() {
    const output = document.getElementById('trackTransitionValue');
    if (!output) return;
    output.textContent = state.trackTransition === 0
      ? (state.lang === 'ru' ? 'Выкл.' : 'Off')
      : `${state.trackTransition.toLocaleString(state.lang === 'ru' ? 'ru-RU' : 'en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${state.lang === 'ru' ? 'с' : 's'}`;
  }

  // --- DISCOVERY & ZERO-TOUCH AUTO-SYNC ---
  function startDiscoveryPolling() {
    let lastPoll = 0;
    setInterval(async () => {
      if (document.hidden || Date.now() - lastPoll < PerformanceMode.get(state.performanceMode).discoveryMs) return;
      lastPoll = Date.now();
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
            if (!syncBusy && Date.now() - lastSyncAttempt > 180000) syncAll({background:true});
          }
        }
      } catch (ignored) {}
    }, 4000);
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

  function isStatsDiffer(oldStats, newStats) {
    if (!oldStats || !newStats) return true;
    const op = oldStats.plays || [], np = newStats.plays || [];
    if (op.length !== np.length) return true;
    if (op.length > 0) {
      const lo = op[op.length - 1], ln = np[np.length - 1];
      if (lo?.id !== ln?.id || lo?.started !== ln?.started) return true;
      const fo = op[0], fn = np[0];
      if (fo?.id !== fn?.id || fo?.started !== fn?.started) return true;
    }
    const os = oldStats.slices || [], ns = newStats.slices || [];
    return os.length !== ns.length;
  }

  function isLibraryDiffer(oldTracks, newTracks) {
    if (!oldTracks || !newTracks) return true;
    if (oldTracks.length !== newTracks.length) return true;
    if (oldTracks.length > 0) {
      if (oldTracks[0]?.id !== newTracks[0]?.id || oldTracks[oldTracks.length - 1]?.id !== newTracks[newTracks.length - 1]?.id) return true;
    }
    return false;
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
      const {library: libData, stats, djState} = await result.json();
      mergeSharedAudio(djState);
      if (!Array.isArray(libData?.tracks) || !Array.isArray(stats?.plays)) throw new Error('Invalid sync snapshot');
      // A local click/play during the exchange must not be rolled back by its response.
      if (revision !== localSyncRevision) { lastSyncAttempt = 0; return; }
      const libraryChanged = isLibraryDiffer(state.tracks, libData.tracks);
      const statsChanged = isStatsDiffer(state.stats, stats);
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
        if (!background || (state.currentView === 'library' || state.currentView === 'home')) {
          renderCurrentView();
        }
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











  // --- EVENT LISTENERS SETUP ---

  function setupEventListeners() {
    // Nav Items
    DOM.navItems.forEach(item => {
      item.setAttribute('role','button');item.tabIndex=0;
      item.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();item.click();}});
      item.addEventListener('click', () => {
        switchView(item.dataset.view);
      });
    });
    document.querySelectorAll('[data-form-view]').forEach(button=>button.addEventListener('click',()=>{
      if(button.dataset.formView==='language')DOM.langToggle.click();else switchView(button.dataset.formView);
      document.getElementById('formNavigation').open=false;
    }));

    // Pinned Liked Songs Tile
    DOM.sidebarLikedSongsTile.addEventListener('click', () => {
      switchView('favorites');
    });

    // Language & Theme
    DOM.langToggle.addEventListener('click', () => {
      applyLang(state.lang === 'en' ? 'ru' : 'en');
    });

    document.querySelectorAll('input[name="appearanceTheme"]').forEach(input => {
      input.addEventListener('change', () => { if (input.checked) { applyTheme(input.value); if(input.value==='form')switchView('home'); } });
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
      searchTimer = setTimeout(() => { if(state.theme==='form'&&state.currentView!=='library')switchView('library');else renderLibrary(); }, 120);
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
        if(state.theme==='form')switchView('library');else renderLibrary();
      });
    });

    // Sort Selector
    DOM.sortSelect.addEventListener('change', (e) => {
      state.sortOption = e.target.value;
      state.libraryDirty = true;
      if(state.theme==='form')switchView('library');else renderLibrary();
    });

    // View Mode Toggles (Grid vs List)
    DOM.viewModeGridBtn.addEventListener('click', () => {applyViewMode('grid');if(state.theme==='form')switchView('library');});
    DOM.viewModeListBtn.addEventListener('click', () => {applyViewMode('list');if(state.theme==='form')switchView('library');});

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

    if (DOM.progressMomentMarker) {
      DOM.progressMomentMarker.addEventListener('click', (e) => {
        e.stopPropagation();
        seekToFavoriteMoment();
      });
    }

    DOM.bottomVinylToggleBtn.addEventListener('click', () => {
      switchView('player');
    });

    // Volume & Mute
    try {
      const saved = JSON.parse(localStorage.getItem('pain_volume'));
      if (saved && Number.isFinite(saved.volume) && saved.volume >= 0 && saved.volume <= 1) {
        audio.volume = Math.min(saved.volume, state.volumeLimit / 100);
        state.isMuted = saved.volume === 0;
        state.lastVolume = Number.isFinite(saved.lastVolume) && saved.lastVolume > 0 && saved.lastVolume <= 1
          ? saved.lastVolume : (saved.volume || 1);
      }
    } catch (_) { /* Invalid or unavailable storage must not prevent playback. */ }
    audio.volume = Math.min(audio.volume, state.volumeLimit / 100);
    DOM.volumeSlider.max = state.volumeLimit / 100;
    DOM.volumeSlider.value = audio.volume;
    updateVolumeIcon(audio.volume);

    DOM.volumeSlider.addEventListener('wheel', e => {
      if (e.ctrlKey || e.metaKey || !e.deltaY) return;
      e.preventDefault();
      const next = Number(DOM.volumeSlider.value) - Math.sign(e.deltaY) * Number(DOM.volumeSlider.step);
      DOM.volumeSlider.value = Math.max(0, Math.min(Number(DOM.volumeSlider.max), next)).toFixed(2);
      DOM.volumeSlider.dispatchEvent(new Event('input', {bubbles:true}));
    }, {passive:false});
    DOM.totalTime.addEventListener('click', () => {
      state.showRemaining = !state.showRemaining;
      try { localStorage.setItem('pain_remaining_time', String(state.showRemaining)); } catch (_) {}
      updateDurationLabel(getCurrentTrackDuration());
    });
    updateDurationLabel(getCurrentTrackDuration());

    function saveVolume() {
      try {
        localStorage.setItem('pain_volume', JSON.stringify({volume: audio.volume, lastVolume: state.lastVolume}));
      } catch (_) {}
    }

    DOM.volumeSlider.addEventListener('input', (e) => {
      const val = Math.min(parseFloat(e.target.value), state.volumeLimit / 100);
      audio.volume = val;
      if (val > 0) state.lastVolume = val;
      state.isMuted = val === 0;
      updateVolumeIcon(val);
      saveVolume();
    });

    DOM.bottomMuteBtn.addEventListener('click', () => {
      if (state.isMuted) {
        audio.volume = Math.min(state.lastVolume > 0 ? state.lastVolume : 1.0, state.volumeLimit / 100);
        DOM.volumeSlider.value = audio.volume;
        state.isMuted = false;
      } else {
        state.lastVolume = audio.volume;
        audio.volume = 0;
        DOM.volumeSlider.value = 0;
        state.isMuted = true;
      }
      updateVolumeIcon(audio.volume);
      saveVolume();
    });

    function updateVolumeIcon(vol) {
      DOM.volumeSlider.title = `${Math.round(vol * 100)}% · ${state.lang === 'ru' ? 'Колёсико — точная громкость' : 'Scroll for precise volume'}`;
      DOM.volumeSlider.setAttribute('aria-label', state.lang === 'ru' ? 'Громкость' : 'Volume');
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

    audio.addEventListener('playing',()=>{
      if(listening?.closed){const track=state.tracks[state.currentTrackIndex];if(track)beginListening(track);}
      listening?.anchor(performance.now(),audio.currentTime,!audio.muted&&audio.volume>0);
      syncPlaybackState();
    });
    audio.addEventListener('pause',()=>{
      isTrackFadingOut = false;
      if (transitionGainNode) setTrackTransitionGain(1);
      savePlaybackPosition(true);
      sampleListening(true);
      listening?.anchor(performance.now(),audio.currentTime,false);
      syncPlaybackState();
    });
    audio.addEventListener('waiting',()=>{
      if (!isTrackFadingOut) {
        setTrackTransitionGain(1);
      }
      sampleListening(true);listening?.anchor(performance.now(),audio.currentTime,false);
    });
    audio.addEventListener('seeking',()=>{
      const dur = getCurrentTrackDuration();
      const remaining = dur > 0 ? dur - audio.currentTime : 0;
      if (remaining > state.trackTransition + 0.5) {
        isTrackFadingOut = false;
        if (transitionGainNode) setTrackTransitionGain(1);
      }
      listening?.anchor(performance.now(),audio.currentTime,false);
    });
    audio.addEventListener('seeked',()=>{
      const dur = getCurrentTrackDuration();
      const remaining = dur > 0 ? dur - audio.currentTime : 0;
      if (remaining > state.trackTransition + 0.5) {
        isTrackFadingOut = false;
        if (transitionGainNode) setTrackTransitionGain(1);
      }
      savePlaybackPosition(true);
    });
    audio.addEventListener('seeked',()=>listening?.anchor(performance.now(),audio.currentTime,!audio.paused&&!audio.muted&&audio.volume>0));
    window.addEventListener('pagehide',()=>{savePlaybackPosition(true);sampleListening();if(state.currentTrackId)recordTrackFinished(state.currentTrackId);});
    audio.addEventListener('error',()=>{state.isPlaying=false;updatePlayBtnUI();DOM.vinylBigDisc.classList.remove('spinning');});
    audio.addEventListener('volumechange',()=>listening?.anchor(performance.now(),audio.currentTime,!audio.paused&&!audio.muted&&audio.volume>0));
    audio.addEventListener('ratechange',()=>{
      isTrackFadingOut = false;
      setTrackTransitionGain(1);
      listening?.anchor(performance.now(),audio.currentTime,!audio.paused);
    });

    // Audio Metadata & Buffering
    audio.addEventListener('loadedmetadata', () => {
      const dur = getCurrentTrackDuration();
      if (dur > 0) updateDurationLabel(dur);
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

      if (typeof momentsReel !== 'undefined' && momentsReel && momentsReel.getState().active) {
        const isAudioPlaying = !audio.paused && !audio.seeking && audio.readyState >= 2;
        const check = momentsReel.checkTime(cur, dur, isAudioPlaying, state.currentTrackId);
        const nowMs = Date.now();
        if (check.shouldAdvance && (nowMs - lastReelAdvanceTime > 1500)) {
          lastReelAdvanceTime = nowMs;
          momentsReel.next();
          return;
        }
      }

      if (deckB && state.trackTransition > 0 && dur > 0 && !audio.paused && !audio.ended && !isCrossfading) {
        const remaining = dur - cur;
        const isRepeatOne = state.loopMode === 'one' || (queue && queue.getLoopMode() === 'one');
        if (remaining > 0 && remaining <= state.trackTransition && !isRepeatOne) {
          const upcoming = getNextTrack();
          if (upcoming) {
            isCrossfading = true;
            playNextTrack(true);
            return;
          }
          prefetchNextTrack();
        }
      } else if (!deckB && state.trackTransition > 0 && dur > 0 && !audio.paused && !audio.ended) {
        const remaining = dur - cur;
        if (remaining > 0 && remaining <= state.trackTransition) {
          if (!isTrackFadingOut) {
            isTrackFadingOut = true;
            setTrackTransitionGain(0.0001, remaining / Math.max(0.1, audio.playbackRate));
          }
        } else if (isTrackFadingOut && remaining > state.trackTransition + 0.5) {
          isTrackFadingOut = false;
          setTrackTransitionGain(1, 0.2);
        }
      }

      DOM.currentTime.textContent = formatTime(cur);
      if (dur > 0) {
        updateDurationLabel(dur);
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
      isTrackFadingOut = false;
      sampleListening(true);
      if (state.currentTrackId) {
        recordTrackFinished(state.currentTrackId);
      }

      if (typeof momentsReel !== 'undefined' && momentsReel && momentsReel.getState().active) {
        const nowMs = Date.now();
        if (nowMs - lastReelAdvanceTime > 1500) {
          lastReelAdvanceTime = nowMs;
          momentsReel.next();
        }
        return;
      }

      if (state.loopMode === 'one' || (queue && queue.getLoopMode() === 'one')) {
        audio.currentTime = 0;
        audio.play().catch(() => {});
      } else {
        // Events are already restricted to the active deck. It can end while
        // fading in (short track/seek); ignoring that event leaves playback stuck.
        ++crossfadeTimerId;
        isCrossfading = false;
        playNextTrack(true);
      }
    });

    const seekPreview = document.getElementById('seekPreview');
    function previewSeek(e) {
      const duration = getCurrentTrackDuration();
      seekPreview.hidden = !(duration > 0);
      if (seekPreview.hidden) return;
      const pct = getScrubPercent(e);
      seekPreview.textContent = formatTime(pct * duration);
      seekPreview.style.left = `${pct * 100}%`;
    }
    DOM.progressTrack.addEventListener('pointermove', previewSeek);
    DOM.progressTrack.addEventListener('pointerdown', previewSeek);
    DOM.progressTrack.addEventListener('pointerleave', () => { seekPreview.hidden = true; });
    DOM.progressTrack.addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') seekPreview.hidden = true; });
    DOM.progressTrack.addEventListener('pointercancel', () => { seekPreview.hidden = true; });
    window.addEventListener('pain:track', () => { seekPreview.hidden = true; });

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

    // Track Upload to Phone Dropzone & Controls
    if (DOM.trackUploadDropzone) {
      DOM.trackUploadDropzone.addEventListener('click', (e) => {
        if (e.target !== DOM.trackUploadFileInput && DOM.trackUploadFileInput) {
          DOM.trackUploadFileInput.click();
        }
      });
      DOM.trackUploadDropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        DOM.trackUploadDropzone.classList.add('dragover');
      });
      DOM.trackUploadDropzone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        DOM.trackUploadDropzone.classList.remove('dragover');
      });
      DOM.trackUploadDropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        DOM.trackUploadDropzone.classList.remove('dragover');
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          handleUploadFileSelection(e.dataTransfer.files[0]);
        }
      });
    }

    if (DOM.trackUploadFileInput) {
      DOM.trackUploadFileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
          handleUploadFileSelection(e.target.files[0]);
        }
      });
    }

    if (DOM.trackUploadCancelBtn) {
      DOM.trackUploadCancelBtn.addEventListener('click', resetTrackUploadUI);
    }

    if (DOM.trackUploadSubmitBtn) {
      DOM.trackUploadSubmitBtn.addEventListener('click', submitTrackUpload);
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

    document.getElementById('volumeLimitSlider').addEventListener('input', e => {
      state.volumeLimit = Number(e.target.value);
      document.getElementById('volumeLimitValue').textContent = state.volumeLimit + '%';
      DOM.volumeSlider.max = state.volumeLimit / 100;
      audio.volume = Math.min(audio.volume, state.volumeLimit / 100);
      DOM.volumeSlider.value = audio.volume;
      updateVolumeIcon(audio.volume);
      try { localStorage.setItem('pain_volume_limit', String(state.volumeLimit)); } catch (_) {}
      saveVolume();
    });
    document.getElementById('trackTransitionSlider').addEventListener('input', e => {
      state.trackTransition = Math.max(0, Math.min(4, Number(e.target.value) || 0));
      isTrackFadingOut = false;
      setTrackTransitionGain(1);
      updateTrackTransitionUI();
      try { localStorage.setItem('pain_track_transition', String(state.trackTransition)); } catch (_) {}
    });
    document.getElementById('performanceMode').addEventListener('change', e => applyPerformanceMode(e.target.value));
    const cleanTitlesInput = document.getElementById('cleanTitlesSwitch');
    if (cleanTitlesInput) {
      cleanTitlesInput.addEventListener('change', e => {
        state.cleanTitles = e.target.checked;
        try { localStorage.setItem('pain_clean_titles', String(state.cleanTitles)); } catch (_) {}
        state.libraryDirty = true;
        renderCurrentView();
        const track = state.tracks.find(t => t.id === state.currentTrackId);
        if (track) updatePlayerBarUI(track, false);
      });
    }
    document.getElementById('reducedMotionSwitch').addEventListener('change', e => {
      state.reducedMotion = e.target.checked;
      document.documentElement.toggleAttribute('data-reduced-motion', state.reducedMotion);
      try { localStorage.setItem('pain_reduced_motion', String(state.reducedMotion)); } catch (_) {}
    });
    const coverSwitch = document.getElementById('onlineCoversSwitch');
    const refreshedCovers = new Set();
    const setCoverSearch = enabled => fetch(`/api/online-covers?enabled=${enabled ? 1 : 0}`, { method: 'POST' }).catch(() => {});
    setCoverSearch(localStorage.getItem('pain_online_covers') === 'true');
    coverSwitch.addEventListener('change', async e => {
      const enabled = e.target.checked;
      localStorage.setItem('pain_online_covers', String(enabled));
      await setCoverSearch(enabled);
      // Refresh only rendered images; keep lazy off-screen covers lazy.
      document.querySelectorAll('img[src*="/api/cover/"]').forEach(img => {
        const url = new URL(img.src);
        url.searchParams.set('online', enabled ? '1' : '0');
        url.searchParams.set('priority', decodeURIComponent(url.pathname.slice('/api/cover/'.length)) === state.currentTrackId ? '1' : '0');
        img.src = url.href;
      });
    });
    let checkingCovers = false, lastCoverPoll = 0;
    setInterval(async () => {
      if (checkingCovers || document.hidden || Date.now()-lastCoverPoll < PerformanceMode.get(state.performanceMode).coverPollMs) return;
      lastCoverPoll = Date.now();
      checkingCovers = true;
      try {
        const response = await fetch('/api/online-covers', { signal: AbortSignal.timeout(3000) });
        if (!response.ok) return;
        const { completed = [] } = await response.json();
        const fresh = new Set(completed.filter(id => !refreshedCovers.has(id)));
        if (!fresh.size) return;
        document.querySelectorAll('img[src*="/api/cover/"]').forEach(img => {
          const url = new URL(img.src);
          const id = decodeURIComponent(url.pathname.slice('/api/cover/'.length));
          if (fresh.has(id)) { url.searchParams.set('cached', '1'); img.src = url.href; }
        });
        fresh.forEach(id => refreshedCovers.add(id));
      } catch (_) {} finally { checkingCovers = false; }
    }, 5000);
    document.getElementById('saveHistorySwitch').addEventListener('change', e => {
      // Close only the audible part before the change; private listening never
      // becomes a skip or gets backfilled when history is enabled again.
      sampleListening();
      if (state.currentTrackId) recordTrackFinished(state.currentTrackId);
      state.saveHistory = e.target.checked;
      const track = state.tracks.find(t => t.id === state.currentTrackId);
      listening = null;
      if (track && state.saveHistory) { beginListening(track); sampleListening(); }
      try { localStorage.setItem('pain_save_history', String(state.saveHistory)); } catch (_) {}
    });
    const homeMomentsInput = document.getElementById('homeMomentsSwitch');
    if (homeMomentsInput) {
      homeMomentsInput.addEventListener('change', e => {
        state.homeMomentsEnabled = e.target.checked;
        try { localStorage.setItem('pain_home_moments_enabled', String(state.homeMomentsEnabled)); } catch (_) {}
        if (state.currentView === 'home') renderHome();
      });
    }

    for (const [id, key, storageKey] of [
      ['smartVolumeSwitch', 'smartVolume', 'pain_smart_volume'],
      ['backgroundDuckSwitch', 'backgroundDuck', 'pain_background_duck']
    ]) {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', e => {
        state[key] = e.target.checked;
        try { localStorage.setItem(storageKey, String(state[key])); } catch (_) {}
        applySmartVolume();
        updateAutoEqualizerUI();
      });
    }
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
          fetch('/api/excluded-tracks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '[]'
          }).catch(() => {});
        } catch(e) {}
        updateExcludedButtonsUI();
        updateSettingsExcludedSection();
        showToast(state.lang === 'ru' ? 'Все треки возвращены в рекомендации' : 'All tracks restored to recommendations');
      });
    }

    if (DOM.updateActionBtn) DOM.updateActionBtn.addEventListener('click', handleUpdateAction);

    // DataGuard Backup & Restore UI
    if (DOM.exportBackupBtn) {
      DOM.exportBackupBtn.addEventListener('click', () => {
        window.location.href = '/api/backup/export';
        showToast(state.lang === 'ru' ? 'Резервная копия скачивается…' : 'Downloading backup…');
      });
    }

    if (DOM.importBackupBtn && DOM.importBackupFileInput) {
      DOM.importBackupBtn.addEventListener('click', () => {
        DOM.importBackupFileInput.click();
      });

      DOM.importBackupFileInput.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
          const text = await file.text();
          const bundle = JSON.parse(text);
          if (!bundle || !bundle.files) {
            showToast(state.lang === 'ru' ? 'Неверный формат файла бэкапа' : 'Invalid backup format');
            return;
          }
          const res = await fetch('/api/backup/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: text
          });
          if (res.ok) {
            showToast(state.lang === 'ru' ? 'Резервная копия успешно восстановлена!' : 'Backup restored successfully!');
            await syncExcludedTracksFromServer();
            await syncFavoriteMomentsFromServer();
            await loadLocalData();
            updateDataGuardStatusUI();
          } else {
            showToast(state.lang === 'ru' ? 'Ошибка при импорте бэкапа' : 'Import failed');
          }
        } catch (err) {
          showToast(state.lang === 'ru' ? 'Ошибка чтения файла бэкапа' : 'Error reading backup file');
        } finally {
          DOM.importBackupFileInput.value = '';
        }
      });
    }

    initAudioAnalysisSettings();

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
      if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || e.isComposing) return;
      if (e.target.closest('input, textarea, select, button, a, [role="button"], [role="slider"], [contenteditable]:not([contenteditable="false"])')) return;
      if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) togglePlay(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (!audio.getAttribute('src')) return;
        e.preventDefault();
        seekToTime(Math.max(0, (pendingSeekTime ?? audio.currentTime ?? 0) + (e.key === 'ArrowRight' ? 5 : -5)));
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
