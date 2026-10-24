/**
 * MomentsReel: Manages sequential highlight snippet playback of favorite moments.
 * Accurately tracks audible playback time to eliminate skipping, respects track loading,
 * and coordinates smooth crossfading transitions between moments.
 */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MomentsReel = factory();
})(globalThis, () => {
  'use strict';

  function createController(options = {}) {
    let active = false;
    let snippetSec = Number(options.initialSnippetSec ?? 25);
    let playlist = [];
    let currentIndex = -1;
    let isFading = false;

    // Playback tracking state for active snippet
    let activeTrackId = null;
    let targetMomentSec = 0;
    let hasReachedMoment = false;

    const onAdvance = typeof options.onAdvance === 'function' ? options.onAdvance : () => {};
    const onFade = typeof options.onFade === 'function' ? options.onFade : () => {};
    const onStateChange = typeof options.onStateChange === 'function' ? options.onStateChange : () => {};

    function setSnippetSec(sec) {
      const parsed = Number(sec);
      snippetSec = Number.isFinite(parsed) && parsed >= 0 ? Math.min(300, parsed) : 25;
      onStateChange(getState());
      return snippetSec;
    }

    function buildPlaylist(tracks = [], momentsStore = {}) {
      if (!Array.isArray(tracks) || !momentsStore || typeof momentsStore !== 'object') return [];
      const list = [];
      for (const track of tracks) {
        if (!track || track.id == null) continue;
        const key = String(track.id);
        const val = momentsStore[key];
        const num = Number(val);
        if (Number.isFinite(num) && num >= 0) {
          const durMs = Number(track.duration) || 0;
          const durSec = durMs > 0 ? durMs / 1000 : 0;
          const safeMoment = durSec > 0 ? Math.min(num, Math.max(0, durSec - 1)) : num;
          list.push({
            track,
            momentSec: Math.round(safeMoment * 10) / 10,
            durationMs: durMs,
            durationSec: durSec
          });
        }
      }
      return list;
    }

    function activateTrack(index) {
      if (!playlist.length || index < 0 || index >= playlist.length) return null;
      currentIndex = index;
      const current = playlist[currentIndex];
      activeTrackId = String(current.track.id);
      targetMomentSec = current.momentSec;
      hasReachedMoment = false;
      isFading = false;
      onAdvance(current, currentIndex, playlist);
      onStateChange(getState());
      return current;
    }

    function start(tracks = [], momentsStore = {}, startTrackId = null, customSnippetSec = null) {
      if (customSnippetSec !== null && customSnippetSec !== undefined) {
        setSnippetSec(customSnippetSec);
      }
      playlist = buildPlaylist(tracks, momentsStore);
      if (!playlist.length) {
        stop();
        return null;
      }

      let idx = 0;
      if (startTrackId != null) {
        const found = playlist.findIndex(item => String(item.track.id) === String(startTrackId));
        if (found >= 0) idx = found;
      }

      active = true;
      return activateTrack(idx);
    }

    function next() {
      if (!active || !playlist.length) return null;
      const nextIdx = (currentIndex + 1) % playlist.length;
      return activateTrack(nextIdx);
    }

    function prev() {
      if (!active || !playlist.length) return null;
      const prevIdx = (currentIndex - 1 + playlist.length) % playlist.length;
      return activateTrack(prevIdx);
    }

    function stop() {
      if (!active) return;
      active = false;
      isFading = false;
      hasReachedMoment = false;
      onStateChange(getState());
    }

    function keepFullTrack() {
      if (!active) return;
      active = false;
      isFading = false;
      hasReachedMoment = false;
      onStateChange(getState());
    }

    function checkTime(currentTime, durationSec = 0, isPlaying = true, currentTrackId = null) {
      if (!active || !playlist.length) {
        return { shouldAdvance: false, shouldFade: false, elapsed: 0, remaining: 0 };
      }

      // If playback is not on the target track yet, wait
      if (currentTrackId && activeTrackId && String(currentTrackId) !== activeTrackId) {
        return { shouldAdvance: false, shouldFade: false, elapsed: 0, remaining: snippetSec };
      }

      if (isPlaying === false) {
        return { shouldAdvance: false, shouldFade: false, elapsed: 0, remaining: snippetSec };
      }

      const cur = Number(currentTime) || 0;

      // If snippetSec is 0, user chose "full song from moment"
      if (snippetSec <= 0) {
        return { shouldAdvance: false, shouldFade: false, elapsed: Math.max(0, cur - targetMomentSec), remaining: 0 };
      }

      // Check if audio has arrived at or near the target moment snippet window
      // (Protects against 0s seek delay / buffering where cur is 0 before seeking to e.g. 52s)
      if (!hasReachedMoment) {
        const startWindow = Math.max(0, targetMomentSec - 0.75);
        const endWindow = targetMomentSec + Math.max(4.0, snippetSec);
        if (cur >= startWindow && cur <= endWindow) {
          hasReachedMoment = true;
        } else {
          // Still seeking or loading
          return { shouldAdvance: false, shouldFade: false, elapsed: 0, remaining: snippetSec };
        }
      }

      // If user manually scrubbed backwards before the target moment, re-anchor
      if (cur < targetMomentSec - 1.0) {
        targetMomentSec = cur;
      }

      const elapsed = Math.max(0, cur - targetMomentSec);
      const remaining = Math.max(0, snippetSec - elapsed);

      if (remaining <= 0 && elapsed >= Math.min(snippetSec, 1.0)) {
        return { shouldAdvance: true, shouldFade: false, elapsed, remaining: 0 };
      }

      const fadeWindow = Math.min(2.0, Math.max(1.0, snippetSec / 5));
      if (remaining <= fadeWindow && !isFading && elapsed >= 1.0) {
        isFading = true;
        onFade(remaining);
        return { shouldAdvance: false, shouldFade: true, elapsed, remaining };
      }

      return { shouldAdvance: false, shouldFade: isFading, elapsed, remaining };
    }

    function getState() {
      const current = (playlist.length > 0 && currentIndex >= 0 && currentIndex < playlist.length)
        ? playlist[currentIndex]
        : null;
      return {
        active,
        snippetSec,
        playlistLength: playlist.length,
        currentIndex,
        currentTrack: current ? current.track : null,
        currentTrackId: activeTrackId,
        momentSec: targetMomentSec,
        hasReachedMoment,
        isFading
      };
    }

    return {
      start,
      next,
      prev,
      stop,
      keepFullTrack,
      setSnippetSec,
      checkTime,
      getState,
      buildPlaylist
    };
  }

  return { createController };
});
