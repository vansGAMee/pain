(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FavoriteMoments = factory();
})(globalThis, () => {
  const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

  function normalize(seconds, duration) {
    if (seconds === null || seconds === undefined || seconds === '') return null;
    const sec = Number(seconds);
    if (!Number.isFinite(sec) || sec < 0) return null;
    const dur = Number(duration);
    if (Number.isFinite(dur) && dur > 0) {
      return Math.round(clamp(sec, 0, dur) * 10) / 10;
    }
    return Math.round(sec * 10) / 10;
  }

  function getMoment(store, trackId) {
    if (!store || typeof store !== 'object' || !trackId) return null;
    const val = store[String(trackId)];
    return typeof val === 'number' && Number.isFinite(val) && val >= 0 ? val : null;
  }

  function setMoment(store, trackId, seconds, duration) {
    if (!store || typeof store !== 'object' || !trackId) return null;
    const normalized = normalize(seconds, duration);
    if (normalized === null) return null;
    store[String(trackId)] = normalized;
    return normalized;
  }

  function removeMoment(store, trackId) {
    if (!store || typeof store !== 'object' || !trackId) return false;
    const key = String(trackId);
    if (key in store) {
      delete store[key];
      return true;
    }
    return false;
  }

  function serialize(store) {
    try {
      return JSON.stringify(store || {});
    } catch (_) {
      return '{}';
    }
  }

  function deserialize(raw) {
    if (!raw || typeof raw !== 'string') return {};
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const clean = {};
      for (const [key, val] of Object.entries(parsed)) {
        const num = Number(val);
        if (Number.isFinite(num) && num >= 0) clean[key] = Math.round(num * 10) / 10;
      }
      return clean;
    } catch (_) {
      return {};
    }
  }

  function formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '0:00';
    const total = Math.floor(sec);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  return {
    normalize,
    getMoment,
    setMoment,
    removeMoment,
    serialize,
    deserialize,
    formatTime
  };
});
