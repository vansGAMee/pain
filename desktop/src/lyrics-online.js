'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const { norm, unknown, artists } = require('./cover-matching');
const { version } = require('../package.json');

function parseLrc(text, { allowEmpty = false } = {}) {
  if (typeof text !== 'string' || text.length > 200000) return [];
  const offset = Number(text.match(/\[offset:\s*([+-]?\d+)\]/i)?.[1] || 0) / 1000;
  const lines = [];
  for (const row of text.split(/\r?\n/)) {
    const stamps = [...row.matchAll(/\[(\d+):(\d{2}(?:\.\d+)?)\]/g)];
    const words = row.replace(/\[[^\]]*\]|<\d+:\d+(?:\.\d+)?>/g, '').trim();
    if (words.length > 2000) return [];
    for (const stamp of stamps) {
      const time = Number(stamp[1]) * 60 + Number(stamp[2]) - offset;
      if (Number(stamp[2]) >= 60 || !Number.isFinite(time) || time >= 86400) return [];
      // Empty timed lines clear the highlight during an instrumental break.
      lines.push({ text: words, time: Math.max(0, time) });
    }
  }
  return lines.length <= 2000 && (allowEmpty || lines.some(l => l.text)) ? lines.sort((a,b) => a.time-b.time) : [];
}
function metadata(track) {
  let title = String(track.title || track.filename || '').replace(/\.(mp3|flac|m4a|wav|ogg|opus)$/i, '').trim();
  let artist = String(track.artist || '').trim();
  if (unknown(artist)) {
    const parts = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    if (!parts) return null;
    [,artist,title] = parts;
  }
  // Preserve slowed, live and remix editions: their clocks differ.
  title = title.replace(/[([](?:official\s+)?(?:audio|music video|video|lyrics?)[)\]]/ig, '').trim();
  if (!title || unknown(artist)) return null;
  return { title, artist, album: unknown(track.album) ? '' : String(track.album), duration: Number(track.duration) / 1000 || 0 };
}
function select(records, meta) {
  const credits = artists(meta.artist).map(norm);
  const matches = records.filter(r => r && Number.isSafeInteger(r.id) && norm(r.trackName) === norm(meta.title) &&
    (norm(r.artistName) === norm(meta.artist) || artists(r.artistName).some(a => credits.includes(norm(a)))));
  const timed = matches.filter(r => meta.duration > 0 && Math.abs(Number(r.duration) - meta.duration) <= 2);
  const ordered = [...timed, ...matches.filter(r => !timed.includes(r))];
  ordered.sort((a,b) => Number(timed.includes(b))-Number(timed.includes(a)) ||
    Number(Boolean(b.syncedLyrics))-Number(Boolean(a.syncedLyrics)) ||
    Number(norm(b.albumName)===norm(meta.album))-Number(norm(a.albumName)===norm(meta.album)));
  for (const record of ordered) {
    const sync = timed.includes(record) ? parseLrc(record.syncedLyrics) : [];
    const plain = typeof record.plainLyrics === 'string' && record.plainLyrics.length <= 200000
      ? record.plainLyrics.split(/\r?\n/).map(text => ({ text: text.trim(), time: null })).filter(l => l.text)
      : parseLrc(record.syncedLyrics).filter(l => l.text).map(l => ({ text: l.text, time: null }));
    const lines = sync.length ? sync : plain;
    if (lines.length > 2000 || lines.some(l => l.text.length > 2000)) continue;
    if (lines.length || (record.instrumental && timed.includes(record))) return {
      lines, synced: sync.length > 0, instrumental: Boolean(record.instrumental),
      source: { name: 'LRCLIB', url: 'https://lrclib.net/api/get/' + Number(record.id), id: record.id }
    };
  }
  return null;
}

module.exports = function createOnlineLyrics(dataDir, { getTrack, localMedia, fetchImpl = fetch, delay = 350 } = {}) {
  const pending = new Map(), prefsFile = path.join(dataDir, 'lyrics-preferences.json');
  let enabled = true, initialized, tail = Promise.resolve(), nextRequest = 0, generation = 0;
  const controllers = new Set();
  initialized = fs.readFile(prefsFile, 'utf8').then(s => { enabled = JSON.parse(s).enabled !== false; }).catch(() => {});
  async function request(endpoint, params) {
    if (!enabled) throw new Error('Lyrics search disabled');
    const wait = nextRequest - Date.now();
    if (wait > 1000) throw new Error('Lyrics provider is rate limited; retry later');
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    if (!enabled) throw new Error('Lyrics search disabled');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
    controllers.add(controller);
    try {
      const response = await fetchImpl('https://lrclib.net/api/' + endpoint + '?' + new URLSearchParams(params), {
        signal: controller.signal, headers: { 'User-Agent': `PAIN/${version} (https://github.com/vansGAMee/pain)`, Accept: 'application/json' }
      });
      nextRequest = Date.now() + delay;
      if (response.status === 429 || response.status === 503) {
        const retry = response.headers.get('retry-after'), seconds = Number(retry);
        nextRequest = Math.max(nextRequest, Number.isFinite(seconds) && seconds > 0 ? Date.now()+seconds*1000 : Date.parse(retry) || Date.now()+60000);
        throw new Error('Lyrics provider is busy; retry later');
      }
      if (response.status === 404) return null;
      if (!response.ok) throw new Error('Lyrics provider HTTP ' + response.status);
      const chunks = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length; chunks.push(Buffer.from(chunk));
        if (size > 2 * 1024 * 1024) { controller.abort(); throw new Error('Lyrics response too large'); }
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } finally { clearTimeout(timer); controllers.delete(controller); }
  }
  async function lookup(meta) {
    const params = { track_name: meta.title, artist_name: meta.artist };
    if (meta.album) params.album_name = meta.album;
    if (meta.duration >= 1 && meta.duration <= 3600) params.duration = Math.round(meta.duration);
    let exact;
    try { exact = await request('get', params); }
    catch (_) { /* An overloaded signature lookup can still have cached search results. */ }
    let found = select(exact ? [exact] : [], meta);
    if (found?.synced || found?.instrumental) return found;
    // Search ignores unreliable album tags and can locate a synced edition.
    let records;
    try { records = await request('search', { track_name: meta.title, artist_name: meta.artist }); }
    catch (error) { if (found) return found; throw error; }
    return select(Array.isArray(records) ? records : [], meta) || found || { lines: [], state: 'not-found' };
  }
  async function get(id, { refresh = false } = {}) {
    await initialized;
    const track = getTrack?.(id);
    if (!track) return { lines: [], state: 'not-found' };
    const signature = JSON.stringify([track.title, track.artist, track.album, track.duration]);
    const key = crypto.createHash('sha256').update(id + signature).digest('hex');
    const file = path.join(dataDir, 'lyrics-online', key + '.json');
    let saved;
    try { saved = JSON.parse(await fs.readFile(file, 'utf8')); } catch (_) {}
    if (saved && (!refresh || !enabled) && (saved.lines?.length || saved.instrumental || Date.now()-saved.updatedAt < 86400000)) return saved;
    if (!enabled) return saved || { lines: [], state: 'disabled' };
    if (pending.has(key)) return pending.get(key);
    const run = generation;
    const job = tail.then(async () => {
      if (!enabled || run !== generation) return { lines: [], state: 'disabled' };
      const resolved = localMedia ? (await localMedia.read(track)).track : track;
      const meta = metadata(resolved);
      if (!meta) return { lines: [], state: 'missing-metadata' };
      try {
        const result = { ...await lookup(meta), updatedAt: Date.now() };
        if (run !== generation) return { lines: [], state: 'disabled' };
        await fs.mkdir(path.dirname(file), { recursive: true });
        const temp = file + '.' + crypto.randomUUID() + '.tmp';
        await fs.writeFile(temp, JSON.stringify(result)); await fs.rename(temp, file);
        return result;
      } catch (_) { return saved || { lines: [], state: enabled ? 'error' : 'disabled' }; }
    });
    pending.set(key, job); tail = job.catch(() => {});
    return job.finally(() => pending.delete(key));
  }
  async function settings(req, res) {
    await initialized;
    if (req.method === 'POST') {
      if (req.headers['x-pain-update'] !== 'lyrics') { res.writeHead(403); res.end('{}'); return; }
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 1000) throw new Error('Request too large'); }
      const value = JSON.parse(body); if (typeof value.enabled !== 'boolean') throw new Error('Invalid setting');
      enabled = value.enabled; generation++;
      if (!enabled) for (const controller of controllers) controller.abort();
      await fs.mkdir(dataDir, { recursive: true }); await fs.writeFile(prefsFile, JSON.stringify({ enabled }));
    } else if (req.method !== 'GET') { res.writeHead(405); res.end('{}'); return; }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ enabled }));
  }
  return { get, settings };
};
module.exports.parseLrc = parseLrc;
module.exports.select = select;
module.exports.metadata = metadata;
