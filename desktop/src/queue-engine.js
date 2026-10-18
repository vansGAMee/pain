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
   * Estimates a realistic BPM (72 - 164) if audio has not been decoded yet.
   */
  function estimateBpm(track) {
    if (!track) return 120;
    if (typeof track.bpm === 'number' && track.bpm > 40 && track.bpm < 240) {
      return Math.round(track.bpm);
    }
    const seedStr = `${track.artist || ''}::${track.title || ''}::${track.duration || 0}`;
    const h = hashString(seedStr);
    // Common music tempo range: 75 to 160 BPM
    const bpm = 75 + (h % 86);
    return bpm;
  }

  /**
   * Analyzes raw audio PCM (Float32Array) to compute actual beats per minute.
   * Uses energy peak detection and inter-peak interval autocorrelation.
   */
  function detectBpmFromPcm(samples, sampleRate) {
    if (!samples || samples.length === 0 || !sampleRate) return 120;

    // Decimate to roughly 4000-8000 Hz for fast onset energy calculation
    const downsampleStep = Math.max(1, Math.floor(sampleRate / 4410));
    const decimatedRate = sampleRate / downsampleStep;
    const decimatedLen = Math.floor(samples.length / downsampleStep);

    // Compute short-time energy
    const windowSize = Math.floor(decimatedRate * 0.04); // 40ms window
    const hopSize = Math.floor(windowSize / 2);
    const numFrames = Math.floor((decimatedLen - windowSize) / hopSize);

    if (numFrames < 10) return 120;

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

    if (peakIndices.length < 4) return 120;

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

    if (maxCount === 0) return 120;

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
    const curBpm = (bpmStore && bpmStore[currentTrack.id]) || currentTrack.bpm || estimateBpm(currentTrack);
    const candBpm = (bpmStore && bpmStore[candidate.id]) || candidate.bpm || estimateBpm(candidate);

    const dist = harmonicBpmDistance(curBpm, candBpm);
    const reasons = [];

    // 1. Base Tempo Score (0 to 100)
    let score = Math.max(0, 100 - dist * 3.5);
    if (dist <= 3) {
      reasons.push(candBpm === curBpm ? `Темп ${candBpm} BPM` : `Близкий темп (${candBpm} BPM)`);
    } else if (dist <= 8) {
      reasons.push(`Гармоничный темп (${candBpm} BPM)`);
    }

    // Energy progression: slight lift keeps flow dynamic and engaging
    const bpmDiff = candBpm - curBpm;
    if (bpmDiff >= 1 && bpmDiff <= 6) {
      score += 15;
      reasons.push(`Подъём энергии (+${bpmDiff} BPM)`);
    } else if (dist === 0 && Math.abs(curBpm - candBpm) > 20) {
      score += 20;
      reasons.push(`Гармонический скачок (${candBpm} BPM)`);
    } else if (dist > 25) {
      score -= 30;
    }

    // 2. Multi-track Artist Spacing
    const curArtist = (currentTrack.artist || '').trim().toLowerCase();
    const candArtist = (candidate.artist || '').trim().toLowerCase();
    const recentArtists = contextOptions.recentArtists || [];

    if (candArtist && curArtist) {
      if (candArtist === curArtist) {
        score -= 45; // Do not repeat same artist immediately
      } else {
        const recentIdx = recentArtists.lastIndexOf(candArtist);
        if (recentIdx !== -1) {
          const songsAgo = recentArtists.length - recentIdx;
          if (songsAgo <= 2) {
            score -= 25;
          } else if (songsAgo <= 4) {
            score -= 10;
          } else {
            score += 25;
            reasons.push(`Смена артиста (${candidate.artist})`);
          }
        } else {
          score += 40;
          reasons.push(`Смена артиста (${candidate.artist})`);
        }
      }
    }

    // 3. Album Diversity
    if (candidate.album && currentTrack.album && candidate.album.toLowerCase() === currentTrack.album.toLowerCase()) {
      if (candArtist === curArtist) {
        score -= 15;
      }
    }

    // 4. Vibe & Mood Affinity
    const curVibe = detectTrackVibe(currentTrack);
    const candVibe = detectTrackVibe(candidate);
    if (curVibe !== VIBE_MOODS.NEUTRAL && candVibe !== VIBE_MOODS.NEUTRAL) {
      if (curVibe === candVibe) {
        score += 18;
        reasons.push(`Вайб: ${candVibe}`);
      }
    }

    // 5. Circadian / Time-of-Day Rhythm
    const hour = typeof contextOptions.hour === 'number' ? contextOptions.hour : (new Date()).getHours();
    const circadian = getCircadianVibe(hour);
    if (circadian.phase === 'night') {
      if (candBpm >= 70 && candBpm <= 110) {
        score += 15;
        reasons.push('Ночной чилл');
      } else if (candBpm > 135 && !candidate.favorite) {
        score -= 20;
      }
    } else if (circadian.phase === 'evening') {
      if (candidate.favorite || candBpm >= 115) {
        score += 12;
      }
    }

    // 6. Favorite Bonus
    if (candidate.favorite) {
      score += 20;
      reasons.push('Любимый трек');
    }

    // 7. Listening Stats & Skip Intelligence
    if (stats && Array.isArray(stats.plays)) {
      const plays = stats.plays.filter(p => p.track === candidate.id);
      if (plays.length > 0) {
        const fullPlays = plays.filter(p => p.completed || p.coverage >= 0.75).length;
        const completionRate = fullPlays / plays.length;
        score += completionRate * 25;
        if (completionRate >= 0.8) {
          reasons.push('Высокая дослушиваемость');
        }

        // Replay bonus
        if (plays.length >= 3) {
          score += Math.min(20, plays.length * 4);
          reasons.push('Часто слушают');
        }

        // Early skip penalty
        const earlySkips = plays.filter(p => !p.completed && (p.coverage || 0) < 0.25).length;
        if (earlySkips > 0) {
          const skipRatio = earlySkips / plays.length;
          score -= skipRatio * 35;
        }
      } else {
        // Discovery bonus for tracks never played
        score += 12;
        reasons.push('Свежая находка');
      }
    }

    return {
      score: Math.round(score * 10) / 10,
      bpm: candBpm,
      dist,
      reasons: reasons.slice(0, 3)
    };
  }

  /**
   * Main QueueEngine class
   */
  class QueueEngine {
    constructor(options = {}) {
      this.context = {
        type: 'library', // 'library' | 'favorites' | 'playlist' | 'album' | 'search'
        id: null,
        title: 'Фонотека'
      };
      this.tracks = [];
      this.currentIndex = -1;
      this.shuffleMode = options.shuffleMode || 'off'; // 'off' | 'random' | 'smart'
      this.loopMode = options.loopMode || 'all'; // 'off' | 'all' | 'one'
      this.playedHistory = [];
      this.recentArtists = [];
      this.lastTransition = null;
      this.unplayedIndices = new Set();
      this.bpmCache = options.bpmCache || {};
      this.stats = options.stats || null;
      this.onQueueChange = options.onQueueChange || null;
    }

    setStats(stats) {
      this.stats = stats;
    }

    setBpmCache(cache) {
      this.bpmCache = Object.assign(this.bpmCache, cache);
    }

    setTrackBpm(trackId, bpm) {
      if (trackId && Number.isFinite(bpm)) {
        this.bpmCache[trackId] = Math.round(bpm);
      }
    }

    getTrackBpm(track) {
      if (!track) return 120;
      return this.bpmCache[track.id] || track.bpm || estimateBpm(track);
    }

    getLastTransition() {
      return this.lastTransition;
    }

    /**
     * Initializes or switches the active context and tracks.
     */
    setContext(contextType, trackList, startIndex = 0, title = null) {
      this.context = {
        type: contextType,
        id: contextType === 'playlist' ? title : null,
        title: title || (contextType === 'favorites' ? 'Избранное' : 'Фонотека')
      };

      this.tracks = Array.isArray(trackList) ? [...trackList] : [];
      this.resetCycle();

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

    resetCycle() {
      this.unplayedIndices = new Set();
      for (let i = 0; i < this.tracks.length; i++) {
        this.unplayedIndices.add(i);
      }
      this.playedHistory = [];
    }

    markPlayed(index) {
      this.unplayedIndices.delete(index);
      this.playedHistory.push(index);
      if (this.playedHistory.length > 500) {
        this.playedHistory.shift();
      }
      const trk = this.tracks[index];
      if (trk && trk.artist) {
        this.recentArtists.push(trk.artist.trim().toLowerCase());
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
          labelRu: 'Умный по BPM и стилю',
          labelEn: 'Smart BPM & Vibe',
          badge: 'BPM'
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

      // Check if current cycle exhausted
      if (this.unplayedIndices.size === 0) {
        if (this.loopMode === 'off') {
          // If in linear mode and reached end of queue
          if (this.shuffleMode === 'off' && this.currentIndex >= this.tracks.length - 1) {
            return null;
          }
        }
        this.resetCycle();
      }

      let nextIndex = -1;

      if (this.shuffleMode === 'random') {
        // Pick random from unplayed indices
        const pool = Array.from(this.unplayedIndices).filter(idx => idx !== this.currentIndex);
        if (pool.length > 0) {
          nextIndex = pool[Math.floor(Math.random() * pool.length)];
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
          const contextOpts = {
            recentArtists: (this.recentArtists || []).slice(-10),
            hour: (new Date()).getHours()
          };

          // Score all candidates with multi-factor engine
          const scored = candidates.map(idx => {
            const cand = this.tracks[idx];
            const result = scoreSmartTransition(current, cand, this.stats, this.bpmCache, contextOpts);
            return { index: idx, ...result };
          });

          // Sort descending by score
          scored.sort((a, b) => b.score - a.score);

          // Score-weighted choice among top candidates for natural DJ feel
          const topSlice = scored.slice(0, Math.min(3, scored.length));
          const weights = [0.65, 0.25, 0.10].slice(0, topSlice.length);
          const r = Math.random();
          let cum = 0;
          let chosen = topSlice[0];
          for (let i = 0; i < topSlice.length; i++) {
            cum += weights[i];
            if (r <= cum) {
              chosen = topSlice[i];
              break;
            }
          }
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
        const contextOpts = {
          recentArtists: (this.recentArtists || []).slice(-10),
          hour: (new Date()).getHours()
        };
        let best = candidates[0];
        let bestScore = -Infinity;
        for (const idx of candidates) {
          const { score } = scoreSmartTransition(current, this.tracks[idx], this.stats, this.bpmCache, contextOpts);
          if (score > bestScore) {
            bestScore = score;
            best = idx;
          }
        }
        return this.tracks[best];
      }

      return this.tracks[candidates[0]];
    }

    /**
     * Navigates to the previous track.
     */
    prev() {
      if (this.tracks.length === 0) return null;

      if (this.playedHistory.length > 1) {
        // Pop current
        this.playedHistory.pop();
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
