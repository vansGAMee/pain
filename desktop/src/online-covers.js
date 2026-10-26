'use strict';
const fs = require('node:fs/promises');
const matching = require('./cover-matching');
const searchCache = new Map();
let tail = Promise.resolve();
let nextSearch = 0;
const misses = new Map();
const pending = new Map();
const completed = new Set();
let enabled = true;
let generation = 0;
let controller = new AbortController();
// One search at a time, at most 20/minute (the provider's documented limit).
module.exports = function findCover(track, file, alive = () => true) {
  if (!enabled) return Promise.resolve(false);
  const token = generation;
  const signal = controller.signal;
  const wanted = () => enabled && generation === token && alive();
  const metadata = matching.metadata(track);
  if (!metadata || misses.get(file) > Date.now()) return Promise.resolve(false);
  if (pending.has(file)) return pending.get(file);
  const job = tail.then(async () => {
    if (!wanted()) return false;
    try { await fs.access(file); return true; } catch (_) {}
    try {
      let match;
      for (const query of matching.queries(metadata)) {
        const key = JSON.stringify(query);
        let results = searchCache.get(key);
        if (!results) {
          await new Promise(resolve => setTimeout(resolve, Math.max(0, nextSearch - Date.now())));
          if (!wanted()) return false;
          nextSearch = Date.now() + 3100;
          const url = new URL('https://itunes.apple.com/search');
          url.search = new URLSearchParams({ ...query, limit: '50' });
          const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]) });
          if (!response.ok) throw new Error('Search unavailable');
          results = (await response.json()).results || [];
          if (searchCache.size >= 512) searchCache.delete(searchCache.keys().next().value);
          searchCache.set(key, results);
        }
        if (!wanted()) return false;
        // Prefer the exact recording before trying a cleaned title or its album.
        match = results.find(item => item.artworkUrl100 && matching.norm(item.artistName) === matching.norm(metadata.artist) && matching.norm(item.trackName) === matching.norm(metadata.title));
        match ||= results.find(item => item.artworkUrl100 && matching.matches(item, metadata, query.entity === 'album'));
        if (match) break;
      }
      if (!match) { misses.set(file, Date.now() + 86400000); return false; }
      const artwork = new URL(match.artworkUrl100);
      if (artwork.protocol !== 'https:' || !artwork.hostname.endsWith('.mzstatic.com')) return false;
      const image = await fetch(artwork, { signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]) });
      if (!image.ok || !image.headers.get('content-type')?.startsWith('image/')) return false;
      const bytes = Buffer.from(await image.arrayBuffer());
      if (bytes.length > 2 * 1024 * 1024 || !wanted()) return false;
      // Never replace a cover saved manually while the search was running.
      await fs.writeFile(file, bytes, { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
      if (track.id) completed.add(track.id);
      return true;
    } catch (_) { if (wanted()) misses.set(file, Date.now() + 60000); return false; }
  });
  tail = job.catch(() => {});
  pending.set(file, job);
  return job.finally(() => pending.delete(file));
};

module.exports.setEnabled = value => {
  enabled = value;
  if (!enabled) {
    generation++;
    controller.abort();
    controller = new AbortController();
  }
};
module.exports.status = () => [...completed];
