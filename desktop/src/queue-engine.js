/**
 * Pain Audio - Context-Aware Queue & Smart BPM Engine
 * 
 * Provides:
 * 1. Context isolation: Favorites, Library, Playlists, Albums loop and play within their own set.
 * 2. Multi-mode shuffle:
 *    - 'off': Sequential playback within context.
 *    - 'random': True unrepeated random shuffle within context.
 *    - 'smart': Smart harmonic BPM matching, artist alternating, and engagement weighting.
 * 3. BPM detection and acoustic estimation.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.QueueEngine = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const Taste = typeof module === 'object' && module.exports ? require('./taste-model') : globalThis.TasteModel;

  /**
   * Deterministic fast hash string -> number
   */
  function hashString(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  /**
   * Returns only measured or tagged BPM; unknown tempo stays unknown.
   */
  function estimateBpm(track) {
    return track ? Taste.knownBpm(track,{}) : null;
  }

  /**
   * Analyzes raw audio PCM (Float32Array) to compute actual beats per minute.
   * Uses energy peak detection and inter-peak interval autocorrelation.
   */
  function detectBpmFromPcm(samples, sampleRate) {
    if (!samples || samples.length === 0 || !sampleRate) return null;

    // Decimate to roughly 4000-8000 Hz for fast onset energy calculation
    const downsampleStep = Math.max(1, Math.floor(sampleRate / 4410));
    const decimatedRate = sampleRate / downsampleStep;
    const decimatedLen = Math.floor(samples.length / downsampleStep);

    // Compute short-time energy
    const windowSize = Math.floor(decimatedRate * 0.04); // 40ms window
    const hopSize = Math.floor(windowSize / 2);
    const numFrames = Math.floor((decimatedLen - windowSize) / hopSize);

    if (numFrames < 10) return null;

    const energies = new Float32Array(numFrames);
    for (let f = 0; f < numFrames; f++) {
      let sum = 0;
      const start = f * hopSize * downsampleStep;
      for (let i = 0; i < windowSize; i++) {
        const val = samples[start + i * downsampleStep] || 0;
        sum += val * val;
      }
      energies[f] = sum / windowSize;
    }

    // Energy spectral flux / onset peaks
    const onsets = new Float32Array(numFrames);
    for (let i = 1; i < numFrames; i++) {
      const diff = energies[i] - energies[i - 1];
      if (diff > 0) onsets[i] = diff;
    }

    // Inter-onset interval histogram in BPM range 60 to 180
    const frameRate = decimatedRate / hopSize;
    const minBpm = 60;
    const maxBpm = 185;
    const minInterval = Math.floor((60 / maxBpm) * frameRate);
    const maxInterval = Math.ceil((60 / minBpm) * frameRate);

    const histogram = new Float32Array(maxInterval + 1);

    // Peak threshold
    let avgOnset = 0;
    for (let i = 0; i < numFrames; i++) avgOnset += onsets[i];
    avgOnset /= numFrames;
    const threshold = avgOnset * 1.4;

    const peakIndices = [];
    for (let i = 1; i < numFrames - 1; i++) {
      if (onsets[i] > threshold && onsets[i] > onsets[i - 1] && onsets[i] >= onsets[i + 1]) {
        peakIndices.push(i);
      }
    }

    if (peakIndices.length < 4) return null;

    for (let i = 0; i < peakIndices.length; i++) {
      for (let j = i + 1; j < peakIndices.length; j++) {
        const interval = peakIndices[j] - peakIndices[i];
        if (interval >= minInterval && interval <= maxInterval) {
          histogram[interval] += 1;
        } else if (interval > maxInterval) {
          break;
        }
      }
    }

    let bestInterval = minInterval;
    let maxCount = 0;
    for (let int = minInterval; int <= maxInterval; int++) {
      if (histogram[int] > maxCount) {
        maxCount = histogram[int];
        bestInterval = int;
      }
    }

    if (maxCount === 0) return null;

    let detectedBpm = Math.round((60 * frameRate) / bestInterval);
    // Keep in canonical 70-160 range
    while (detectedBpm < 70) detectedBpm *= 2;
    while (detectedBpm > 175) detectedBpm = Math.round(detectedBpm / 2);

    return detectedBpm;
  }

  /**
   * Calculates harmonic tempo similarity between two BPM values.
   * Checks direct match, double-time, half-time, and 3:2 / 2:3 polyrhythms.
   */
  function harmonicBpmDistance(bpmA, bpmB) {
    if (!bpmA || !bpmB) return 50;
    const d1 = Math.abs(bpmA - bpmB);
    const d2 = Math.abs(bpmA * 2 - bpmB);
    const d3 = Math.abs(bpmA - bpmB * 2);
    const d4 = Math.abs(bpmA * 1.5 - bpmB);
    const d5 = Math.abs(bpmA - bpmB * 1.5);
    return Math.min(d1, d2, d3, d4, d5);
  }

  const VIBE_MOODS = {
    CHILL: 'chill',
    ENERGETIC: 'energy',
    LIVE: 'live',
    NEUTRAL: 'neutral'
  };

  /**
   * Detects track mood / atmosphere based on tags, title, and metadata.
   */
  function detectTrackVibe(track) {
    if (!track) return VIBE_MOODS.NEUTRAL;
    const str = `${track.title || ''} ${track.album || ''} ${track.artist || ''}`.toLowerCase();
    if (/\b(acoustic|unplugged|piano|lo-?fi|chill|ambient|slow|slowed|sleep|quiet|calm|ballad)\b/i.test(str)) {
      return VIBE_MOODS.CHILL;
    }
    if (/\b(phonk|remix|club|speed|fast|hard|bass|drop|dance|rave|drill|electro|house|techno|trap)\b/i.test(str)) {
      return VIBE_MOODS.ENERGETIC;
    }
    if (/\b(live|concert|tour|acoustic version)\b/i.test(str)) {
      return VIBE_MOODS.LIVE;
    }
    return VIBE_MOODS.NEUTRAL;
  }

  /**
   * Circadian rhythm profiling: adjusts flow based on time of day.
   */
  function getCircadianVibe(hour = (new Date()).getHours()) {
    if (hour >= 23 || hour < 6) {
      return { phase: 'night', preferredBpmRange: [70, 110], labelRu: 'Ночной чилл', labelEn: 'Late Night Chill' };
    }
    if (hour >= 6 && hour < 11) {
      return { phase: 'morning', preferredBpmRange: [95, 128], labelRu: 'Утренний подъём', labelEn: 'Morning Flow' };
    }
    if (hour >= 11 && hour < 18) {
      return { phase: 'day', preferredBpmRange: [100, 135], labelRu: 'Дневной фокус', labelEn: 'Daytime Groove' };
    }
    return { phase: 'evening', preferredBpmRange: [110, 150], labelRu: 'Вечерний вайб', labelEn: 'Evening Anthems' };
  }

  /**
   * Multi-dimensional Smart DJ transition scoring: currentTrack -> candidateTrack.
   * Considers harmonic BPM, energy progression, multi-track artist spacing, vibe match,
   * circadian context, listen completion rates, and skip penalties.
   */
  function scoreSmartTransition(currentTrack, candidate, stats, bpmStore, contextOptions = {}) {
    return new Taste([currentTrack,candidate],stats?.plays||[]).score(currentTrack,candidate,bpmStore,contextOptions);
  }

  /**
   * Main QueueEngine class
   */
  class QueueEngine {
    constructor(options = {}) {
      this.context = {
        allowNew: true,
        type: 'library', // 'library' | 'favorites' | 'playlist' | 'album' | 'search'
        id: null,
        title: 'Фонотека'
      };
      this.tracks = [];
      this.currentIndex = -1;
      this.shuffleMode = options.shuffleMode || 'off'; // 'off' | 'random' | 'smart'
      this.loopMode = options.loopMode || 'all'; // 'off' | 'all' | 'one'
      this.playedHistory = [];
      this.forwardHistory = [];
      this.now = typeof options.now === 'function' ? options.now : Date.now;
      this.recentArtists = [];
      this.lastTransition = null;
      this.smartStep=0;this.smartSeed=Math.floor(Math.random()*0xffffffff);
      this.unplayedIndices = new Set();
      this.bpmCache = options.bpmCache || {};
      this.audioProfiles=options.audioProfiles||{};
      this.stats = options.stats || null;
      this.onQueueChange = options.onQueueChange || null;
    }

    setStats(stats) {
      this.stats = stats;
      this._taste = null;
    }

    smartScore(current, candidate, context) {
      const now = this.now();
      if (!this._taste || this._tasteTracks !== this.tracks || now-this._taste.now>=60000 || now<this._taste.now) {
        this._taste = new Taste(this.tracks, this.stats?.plays || [], now,this.audioProfiles);
        this._tasteTracks = this.tracks;
      }
      return this._taste.score(current,candidate,this.bpmCache,context);
    }

    smartChoose(current, indices) {
      this.smartScore(current,this.tracks[indices[0]],{});
      const chosen=this._taste.choose(current,indices.map(i=>this.tracks[i]),this.bpmCache,{
        recentArtists:this.recentArtists.slice(-10),recentTrackIds:this.playedHistory.slice(-4).reverse().map(i=>this.tracks[i]?.id),step:this.smartStep,
        seed:(this.smartSeed+Math.imul(this.smartStep,2654435761))>>>0
      });
      return {...chosen,index:indices.find(i=>this.tracks[i]===chosen.track)};
    }

    randomChoice(indices) {
      let z=(this.smartSeed+Math.imul(this.smartStep,2654435761)+0x6d2b79f5)>>>0;
      z=Math.imul(z^(z>>>15),z|1);z^=z+Math.imul(z^(z>>>7),z|61);
      return indices[Math.floor((((z^(z>>>14))>>>0)/4294967296)*indices.length)];
    }

    setAudioProfile(id,profile){this.audioProfiles[id]=profile;this._taste=null;}

    setBpmCache(cache) {
      this.bpmCache = Object.assign(this.bpmCache, cache);
    }

    setTrackBpm(trackId, bpm) {
      if (trackId && Number.isFinite(bpm)) {
        this.bpmCache[trackId] = Math.round(bpm);
      }
    }

    getTrackBpm(track) {
      if (!track) return null;
      return this.bpmCache[track.id] || track.bpm || estimateBpm(track);
    }

    getLastTransition() {
      return this.lastTransition;
    }

    /**
     * Initializes or switches the active context and tracks.
     */
    setContext(contextType, trackList, startIndex = 0, title = null, allowNew = false) {
      this.context = {
        type: contextType,
        allowNew: contextType === 'library' && allowNew,
        id: contextType === 'playlist' ? title : null,
        title: title || (contextType === 'favorites' ? 'Избранное' : 'Фонотека')
      };

      const rows=Array.isArray(trackList)?trackList:[],seen=new Set();
      const requested=rows[Math.trunc(Number(startIndex)||0)]?.id;
      this.tracks=rows.filter(track=>{
        if(!track||track.id==null||String(track.id)===''||seen.has(String(track.id)))return false;
        seen.add(String(track.id));return true;
      });
      const selected=this.tracks.findIndex(track=>String(track.id)===String(requested));
      startIndex=selected>=0?selected:Math.trunc(Number(startIndex)||0);
      this.resetCycle();
      this.lastTransition = null;

      if (this.tracks.length > 0) {
        const idx = Math.max(0, Math.min(startIndex, this.tracks.length - 1));
        this.currentIndex = idx;
        this.markPlayed(idx);
      } else {
        this.currentIndex = -1;
      }

      this._notify();
      return this.getCurrentTrack();
    }

    // Keep listened/unplayed identities when a device sync replaces track objects.
    refreshLibrary(library, includeNew = false) {
      const old=this.tracks,current=this.getCurrentTrack()?.id;
      const live=new Map((Array.isArray(library)?library:[]).filter(t=>t&&t.id!=null&&String(t.id)!=='').map(t=>[String(t.id),t]));
      const oldIds=new Set(old.map(t=>String(t.id)));
      const selected=old.map(t=>live.get(String(t.id))).filter(Boolean);
      if(includeNew)selected.push(...[...live.values()].filter(t=>!oldIds.has(String(t.id))));
      const indices=new Map(selected.map((t,i)=>[String(t.id),i]));
      const remap=index=>indices.get(String(old[index]?.id));
      const previousIds=new Set(old.map(t=>String(t.id)));
      this.unplayedIndices=new Set([...this.unplayedIndices].map(remap).filter(i=>i!==undefined));
      selected.forEach((t,i)=>{if(!previousIds.has(String(t.id)))this.unplayedIndices.add(i);});
      this.playedHistory=this.playedHistory.map(remap).filter(i=>i!==undefined);
      this.forwardHistory=this.forwardHistory.map(remap).filter(i=>i!==undefined);
      this.tracks=selected;this.currentIndex=indices.get(String(current))??-1;
      if(!old.length&&selected.length){this.currentIndex=0;this.markPlayed(0);}
      this.lastTransition=null;this._taste=null;this._notify();
    }

    resetCycle(clearHistory = true) {
      this.unplayedIndices = new Set();
      for (let i = 0; i < this.tracks.length; i++) {
        this.unplayedIndices.add(i);
      }
      if(clearHistory){this.playedHistory=[];this.forwardHistory=[];}
    }

    markPlayed(index, clearForward = true) {
      if(clearForward)this.forwardHistory=[];
      this.smartStep++;
      this.unplayedIndices.delete(index);
      this.playedHistory.push(index);
      if (this.playedHistory.length > 500) {
        this.playedHistory.shift();
      }
      const trk = this.tracks[index];
      const artist=trk&&Taste.artistIdentity(trk);
      if (artist) {
        this.recentArtists.push(artist);
        if (this.recentArtists.length > 30) {
          this.recentArtists.shift();
        }
      }
    }

    getCurrentTrack() {
      if (this.currentIndex >= 0 && this.currentIndex < this.tracks.length) {
        return this.tracks[this.currentIndex];
      }
      return null;
    }

    getCurrentIndex() {
      return this.currentIndex;
    }

    getTracks() {
      return this.tracks;
    }

    getContext() {
      return this.context;
    }

    getShuffleMode() {
      return this.shuffleMode;
    }

    getLoopMode() {
      return this.loopMode;
    }

    setLoopMode(mode) {
      if (['off', 'all', 'one'].includes(mode)) {
        this.loopMode = mode;
        this._notify();
      }
    }

    setShuffleMode(mode) {
      if (['off', 'random', 'smart'].includes(mode)) {
        this.shuffleMode = mode;
        this.resetCycle();
        if (this.currentIndex >= 0) {
          this.markPlayed(this.currentIndex);
        }
        this._notify();
      }
    }

    /**
     * Cycles through shuffle modes: off -> random -> smart -> off
     */
    cycleShuffleMode() {
      let nextMode = 'off';
      if (this.shuffleMode === 'off') nextMode = 'random';
      else if (this.shuffleMode === 'random') nextMode = 'smart';
      else nextMode = 'off';

      this.setShuffleMode(nextMode);

      const descriptors = {
        off: {
          mode: 'off',
          labelRu: 'По порядку',
          labelEn: 'In order',
          badge: ''
        },
        random: {
          mode: 'random',
          labelRu: 'Случайный порядок',
          labelEn: 'Random shuffle',
          badge: '🔀'
        },
        smart: {
          mode: 'smart',
          labelRu: 'По вашему вкусу',
          labelEn: 'Learns your taste',
          badge: 'DJ'
        }
      };

      return descriptors[nextMode];
    }

    /**
     * Advances to the next track according to current shuffleMode and loopMode.
     * Returns null if end of playlist reached and loop is off.
     */
    next() {
      if (this.tracks.length === 0) return null;

      // Repeat One
      if (this.loopMode === 'one' && this.currentIndex >= 0) {
        return this.tracks[this.currentIndex];
      }

      // Going back and then forward should replay the same navigation path.
      if(this.forwardHistory.length){
        this.lastTransition=null;
        this.currentIndex=this.forwardHistory.pop();
        this.markPlayed(this.currentIndex,false);this._notify();
        return this.getCurrentTrack();
      }

      // Check if current cycle exhausted
      if (this.unplayedIndices.size === 0) {
        if (this.loopMode === 'off') return null;
        this.resetCycle(false);
      }

      let nextIndex = -1;

      if (this.shuffleMode === 'random') {
        // Pick random from unplayed indices
        const pool = Array.from(this.unplayedIndices).filter(idx => idx !== this.currentIndex);
        if (pool.length > 0) {
          nextIndex = this.randomChoice(pool);
        } else if (this.unplayedIndices.size > 0) {
          nextIndex = Array.from(this.unplayedIndices)[0];
        } else {
          nextIndex = Math.floor(Math.random() * this.tracks.length);
        }
      } else if (this.shuffleMode === 'smart') {
        const current = this.getCurrentTrack();
        const pool = Array.from(this.unplayedIndices).filter(idx => idx !== this.currentIndex);
        const candidates = (pool.length > 0 ? pool : this.tracks.map((_, i) => i)).filter(idx => idx !== this.currentIndex);

        if (candidates.length === 0) {
          nextIndex = this.currentIndex;
        } else if (!current) {
          nextIndex = candidates[0];
        } else {
          const chosen = this.smartChoose(current,candidates);
          nextIndex = chosen.index;
          this.lastTransition = {
            fromTrack: current,
            toTrack: this.tracks[nextIndex],
            reasons: chosen.reasons || [],
            bpm: chosen.bpm
          };
        }
      } else {
        // Sequential (off)
        if (this.currentIndex < this.tracks.length - 1) {
          nextIndex = this.currentIndex + 1;
        } else if (this.loopMode === 'all') {
          nextIndex = 0;
        } else {
          return null; // Stop
        }
      }

      if (nextIndex >= 0 && nextIndex < this.tracks.length) {
        this.currentIndex = nextIndex;
        this.markPlayed(nextIndex);
        this._notify();
        return this.tracks[nextIndex];
      }

      return null;
    }

    /**
     * Non-destructive lookahead for next track (e.g. for preloading/prefetching).
     */
    peekNext() {
      if (this.tracks.length === 0) return null;
      if (this.loopMode === 'one' && this.currentIndex >= 0) {
        return this.tracks[this.currentIndex];
      }
      if(this.forwardHistory.length)return this.tracks[this.forwardHistory.at(-1)];
      if (this.loopMode === 'off' && this.unplayedIndices.size === 0) return null;
      if (this.shuffleMode === 'off') {
        if (this.currentIndex < this.tracks.length - 1) {
          return this.tracks[this.currentIndex + 1];
        } else if (this.loopMode === 'all') {
          return this.tracks[0];
        }
        return null;
      }

      const pool = Array.from(this.unplayedIndices).filter(idx => idx !== this.currentIndex);
      const candidates = pool.length > 0 ? pool : this.tracks.map((_, i) => i).filter(idx => idx !== this.currentIndex);
      if (candidates.length === 0) return this.getCurrentTrack();

      if (this.shuffleMode === 'smart') {
        const current = this.getCurrentTrack();
        if (!current) return this.tracks[candidates[0]];
        return this.tracks[this.smartChoose(current,candidates).index];
      }

      return this.tracks[this.randomChoice(candidates)];
    }

    /**
     * Navigates to the previous track.
     */
    prev() {
      if (this.tracks.length === 0) return null;
      this.lastTransition=null;

      if (this.playedHistory.length > 1) {
        // Pop current
        this.forwardHistory.push(this.playedHistory.pop());
        const prevIdx = this.playedHistory[this.playedHistory.length - 1];
        if (prevIdx >= 0 && prevIdx < this.tracks.length) {
          this.currentIndex = prevIdx;
          this._notify();
          return this.tracks[prevIdx];
        }
      }

      // Fallback: previous sequential track in current context
      let prevIndex = this.currentIndex - 1;
      if (prevIndex < 0) {
        prevIndex = this.loopMode === 'all' ? this.tracks.length - 1 : 0;
      }

      this.currentIndex = prevIndex;
      this.markPlayed(prevIndex);
      this._notify();
      return this.tracks[prevIndex];
    }

    /**
     * Directly jumps to a track in the current context by id or index.
     */
    jumpToTrack(trackId) {
      const idx = this.tracks.findIndex(t => t.id === trackId);
      if (idx !== -1) {
        this.lastTransition=null;
        this.currentIndex = idx;
        this.markPlayed(idx);
        this._notify();
        return this.tracks[idx];
      }
      return null;
    }

    _notify() {
      if (typeof this.onQueueChange === 'function') {
        try {
          this.onQueueChange({
            context: this.context,
            track: this.getCurrentTrack(),
            index: this.currentIndex,
            total: this.tracks.length,
            shuffleMode: this.shuffleMode,
            loopMode: this.loopMode
          });
        } catch (_) {}
      }
    }
  }

  QueueEngine.QueueEngine = QueueEngine;
  QueueEngine.estimateBpm = estimateBpm;
  QueueEngine.detectBpmFromPcm = detectBpmFromPcm;
  QueueEngine.harmonicBpmDistance = harmonicBpmDistance;
  QueueEngine.scoreSmartTransition = scoreSmartTransition;
  QueueEngine.detectTrackVibe = detectTrackVibe;
  QueueEngine.getCircadianVibe = getCircadianVibe;

  return QueueEngine;
});
