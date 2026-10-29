'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const { norm, unknown, artists } = require('./cover-matching');
const { version } = require('../package.json');
const modes = new Set(['auto', 'regional', 'primary']);
const providerRevision = 2;

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
  let enabled = true, mode = 'auto', initialized, tail = Promise.resolve(), generation = 0;
  const nextRequest = { primary: 0, regional: 0 };
  const controllers = new Set();
  initialized = fs.readFile(prefsFile, 'utf8').then(s => { const p = JSON.parse(s); enabled = p.enabled !== false; if (modes.has(p.mode)) mode = p.mode; }).catch(() => {});
  async function request(endpoint, params, provider = 'primary') {
    if (!enabled) throw new Error('Lyrics search disabled');
    const wait = nextRequest[provider] - Date.now();
    if (wait > 1000) throw new Error('Lyrics provider is rate limited; retry later');
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    if (!enabled) throw new Error('Lyrics search disabled');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
    controllers.add(controller);
    try {
      const origin = provider === 'primary' ? 'https://lrclib.net/api/' : 'https://lyrics.kugou.com/';
      const response = await fetchImpl(origin + endpoint + '?' + new URLSearchParams(params), {
        signal: controller.signal, headers: { 'User-Agent': `PAIN/${version} (https://github.com/vansGAMee/pain)`, Accept: 'application/json' }
      });
      nextRequest[provider] = Date.now() + delay;
      if (response.status === 429 || response.status === 503) {
        const retry = response.headers.get('retry-after'), seconds = Number(retry);
        nextRequest[provider] = Math.max(nextRequest[provider], Number.isFinite(seconds) && seconds > 0 ? Date.now()+seconds*1000 : Date.parse(retry) || Date.now()+60000);
        throw Object.assign(new Error('Lyrics provider is busy; retry later'), { providerHttp: true });
      }
      if (response.status === 404) return null;
      if (!response.ok) throw Object.assign(new Error('Lyrics provider HTTP ' + response.status), { providerHttp: true });
      const chunks = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length; chunks.push(Buffer.from(chunk));
        if (size > 2 * 1024 * 1024) { controller.abort(); throw new Error('Lyrics response too large'); }
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } finally { clearTimeout(timer); controllers.delete(controller); }
  }
  async function primary(meta) {
    const params = { track_name: meta.title, artist_name: meta.artist };
    if (meta.album) params.album_name = meta.album;
    if (meta.duration >= 1 && meta.duration <= 3600) params.duration = Math.round(meta.duration);
    let exact;
    try { exact = await request('get', params); }
    catch (error) { if (!error.providerHttp) throw error; }
    let found = select(exact ? [exact] : [], meta);
    if (found?.synced || found?.instrumental) return found;
    // Search ignores unreliable album tags and can locate a synced edition.
    let records;
    try { records = await request('search', { track_name: meta.title, artist_name: meta.artist }); }
    catch (error) { if (found) return found; throw error; }
    return select(Array.isArray(records) ? records : [], meta) || found || { lines: [], state: 'not-found' };
  }
  async function regional(meta) {
    const data = await request('search', { ver: 1, man: 'yes', client: 'pc', keyword: meta.artist + ' ' + meta.title, duration: Math.round(meta.duration * 1000) }, 'regional');
    const credits = artists(meta.artist).map(norm);
    const candidates = (Array.isArray(data?.candidates) ? data.candidates : []).filter(r =>
      /^\d+$/.test(String(r.id)) && /^[a-z0-9]+$/i.test(r.accesskey || '') && norm(r.song) === norm(meta.title) &&
      (norm(r.singer) === norm(meta.artist) || artists(r.singer).some(a => credits.includes(norm(a)))));
    candidates.sort((a,b) => Math.abs(a.duration / 1000 - meta.duration) - Math.abs(b.duration / 1000 - meta.duration));
    const candidate = candidates[0];
    if (!candidate) return { lines: [], state: 'not-found' };
    const body = await request('download', { ver: 1, client: 'pc', id: candidate.id, accesskey: candidate.accesskey, fmt: 'lrc', charset: 'utf8' }, 'regional');
    if (typeof body?.content !== 'string' || body.content.length > 300000) return { lines: [], state: 'not-found' };
    const found = select([{ id: Number(candidate.id), trackName: candidate.song, artistName: candidate.singer, duration: candidate.duration / 1000, syncedLyrics: Buffer.from(body.content, 'base64').toString('utf8') }], meta);
    return found ? { ...found, source: { name: 'KuGou', url: 'https://www.kugou.com/' } } : { lines: [], state: 'not-found' };
  }
  async function lookup(meta, run) {
    const providers = mode === 'primary' ? [primary] : mode === 'regional' ? [regional, primary] : [primary, regional];
    let plain, answered = false;
    for (const provider of providers) {
      if (!enabled || run !== generation) throw new Error('Lyrics settings changed');
      try {
        const found = await provider(meta); answered = true;
        if (found.synced || found.instrumental) return found;
        if (found.lines?.length && !plain) plain = found;
      } catch (_) { /* Independent providers have independent failure and rate-limit state. */ }
    }
    if (plain) return plain;
    return { lines: [], state: answered ? 'not-found' : 'error' };
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
    if (saved && (!refresh || !enabled) && (saved.lines?.length || saved.instrumental || (saved.state === 'not-found' && saved.lookupMode === mode && saved.providerRevision === providerRevision && Date.now()-saved.updatedAt < 86400000))) return saved;
    if (!enabled) return saved || { lines: [], state: 'disabled' };
    const run = generation;
    const pendingKey = key + ':' + run;
    if (pending.has(pendingKey)) return pending.get(pendingKey);
    const job = tail.then(async () => {
      if (!enabled || run !== generation) return { lines: [], state: 'disabled' };
      const resolved = localMedia ? (await localMedia.read(track)).track : track;
      const meta = metadata(resolved);
      if (!meta) return { lines: [], state: 'missing-metadata' };
      try {
        const result = { ...await lookup(meta, run), updatedAt: Date.now(), lookupMode: mode, providerRevision };
        if (run !== generation) return { lines: [], state: 'disabled' };
        await fs.mkdir(path.dirname(file), { recursive: true });
        const temp = file + '.' + crypto.randomUUID() + '.tmp';
        await fs.writeFile(temp, JSON.stringify(result)); await fs.rename(temp, file);
        return result;
      } catch (_) { return saved || { lines: [], state: enabled ? 'error' : 'disabled' }; }
    });
    pending.set(pendingKey, job); tail = job.catch(() => {});
    return job.finally(() => pending.delete(pendingKey));
  }
  async function settings(req, res) {
    await initialized;
    if (req.method === 'POST') {
      if (req.headers['x-pain-update'] !== 'lyrics') { res.writeHead(403); res.end('{}'); return; }
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 1000) throw new Error('Request too large'); }
      const value = JSON.parse(body);
      if ((!('enabled' in value) && !('mode' in value)) || ('enabled' in value && typeof value.enabled !== 'boolean') || ('mode' in value && !modes.has(value.mode))) throw new Error('Invalid setting');
      if ('enabled' in value) enabled = value.enabled;
      if ('mode' in value) mode = value.mode;
      generation++; for (const controller of controllers) controller.abort();
      await fs.mkdir(dataDir, { recursive: true }); await fs.writeFile(prefsFile, JSON.stringify({ enabled, mode }));
    } else if (req.method !== 'GET') { res.writeHead(405); res.end('{}'); return; }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ enabled, mode }));
  }
  return { get, settings };
};
module.exports.parseLrc = parseLrc;
module.exports.select = select;
module.exports.metadata = metadata;
