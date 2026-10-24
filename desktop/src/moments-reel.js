/**
 * MomentsReel: Manages sequential highlight snippet playback of favorite moments.
 * Solves the single-timestamp problem by creating an engaging highlight reel / snippet radio
 * with customizable window lengths (15s, 25s, 45s, or full track) and seamless transitions.
 */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MomentsReel = factory();
})(globalThis, () => {
  'use strict';

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  function createController(options = {}) {
    let active = false;
    let snippetSec = Number(options.initialSnippetSec ?? 25);
    let playlist = [];
    let currentIndex = -1;
    let currentMomentSec = 0;
    let isFading = false;
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

      currentIndex = idx;
      active = true;
      isFading = false;
      const current = playlist[currentIndex];
      currentMomentSec = current.momentSec;
      onAdvance(current, currentIndex, playlist);
      onStateChange(getState());
      return current;
    }

    function next() {
      if (!active || !playlist.length) return null;
      currentIndex = (currentIndex + 1) % playlist.length;
      isFading = false;
      const current = playlist[currentIndex];
      currentMomentSec = current.momentSec;
      onAdvance(current, currentIndex, playlist);
      onStateChange(getState());
      return current;
    }

    function prev() {
      if (!active || !playlist.length) return null;
      currentIndex = (currentIndex - 1 + playlist.length) % playlist.length;
      isFading = false;
      const current = playlist[currentIndex];
      currentMomentSec = current.momentSec;
      onAdvance(current, currentIndex, playlist);
      onStateChange(getState());
      return current;
    }

    function stop() {
      if (!active) return;
      active = false;
      isFading = false;
      onStateChange(getState());
    }

    function keepFullTrack() {
      if (!active) return;
      active = false;
      isFading = false;
      onStateChange(getState());
    }

    function checkTime(currentTime, durationSec = 0) {
      if (!active) return { shouldAdvance: false, shouldFade: false, elapsed: 0, remaining: 0 };
      
      const cur = Number(currentTime) || 0;
      // If snippetSec is 0, user chose "full song from moment"
      if (snippetSec <= 0) {
        return { shouldAdvance: false, shouldFade: false, elapsed: Math.max(0, cur - currentMomentSec), remaining: 0 };
      }

      // If playback position jumped backwards (user sought), re-anchor
      if (cur < currentMomentSec) {
        currentMomentSec = cur;
      }

      const elapsed = Math.max(0, cur - currentMomentSec);
      const remaining = Math.max(0, snippetSec - elapsed);

      if (remaining <= 0) {
        return { shouldAdvance: true, shouldFade: false, elapsed, remaining: 0 };
      }

      const fadeWindow = Math.min(2.5, snippetSec / 4);
      if (remaining <= fadeWindow && !isFading) {
        isFading = true;
        onFade(remaining);
        return { shouldAdvance: false, shouldFade: true, elapsed, remaining };
      }

      return { shouldAdvance: false, shouldFade: false, elapsed, remaining };
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
        currentTrackId: current?.track?.id || null,
        momentSec: currentMomentSec,
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
