'use strict';
const fs = require('node:fs/promises');
const matching = require('./cover-matching');
const store=require('./store-search');
const requestSource = require('./source-fetch')();
const misses = new Map(), pending = new Map(), completed = new Set();
let enabled = true, mode = 'balanced', controller = new AbortController(), running = false;
let localMedia, catalog, activeJob;
const intervals = { full: 3100, balanced: 6000, maximum: 15000 };
async function saveImage(url, file, signal) {
  const image = await requestSource(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]) });
  if (!image.ok || !image.headers.get('content-type')?.startsWith('image/')) return false;
  const chunks = []; let size = 0;
  for await (const chunk of image.body) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) return false;
    chunks.push(chunk);
  }
  signal.throwIfAborted();
  if (!size) return false;
  await fs.writeFile(file, Buffer.concat(chunks), { flag: 'wx' }).catch(e => { if (e.code !== 'EEXIST') throw e; });
  return true;
}
async function work(job) {
  const { file, signal } = job;
  const wanted = () => !signal.aborted && job.alive() && (mode !== 'maximum' || job.priority);
  if (!wanted()) return false;
  try { await fs.access(file); return true; } catch (_) {}
  const local = localMedia ? await localMedia.read(job.track) : { track: job.track };
  if (!wanted()) return false;
  if (localMedia && await localMedia.cover(local, file, signal)) return true;
  if (!enabled || !job.online) return false;
  const track = local.track, metadata = matching.metadata(track);
  let match;
  if (metadata) {
    for (const query of matching.queries(metadata)) {
      try {
        const results=await store.search(query,{signal,interval:intervals[mode]});
        if (!wanted()) return false;
        match = results.find(item => item.artworkUrl100 && matching.norm(item.artistName) === matching.norm(metadata.artist) && matching.norm(item.trackName) === matching.norm(metadata.title));
        match ||= results.find(item => item.artworkUrl100 && matching.matches(item, metadata, query.entity === 'album'));
        if (match) break;
      } catch (_) { break; }
    }
  }
  if (!wanted() || !enabled) return false;
  if (match) {
    try {
      const artwork = new URL(match.artworkUrl100);
      if (artwork.protocol === 'https:' && artwork.hostname.endsWith('.mzstatic.com') && await saveImage(artwork,file,signal)) return true;
    } catch (_) {}
  }
  const record = await catalog?.lookup(track, { signal });
  if (!record || record.possible || !wanted() || !enabled) return false;
  // Use release artwork only after the recording and performer were identified.
  const releases = [...(record.releases || [])].sort((a,b) => Number(matching.norm(b.title) === matching.norm(metadata?.album)) - Number(matching.norm(a.title) === matching.norm(metadata?.album)));
  const sizes = mode === 'maximum' ? [250] : [500,250];
  const candidates=[];
  for (const release of releases.slice(0,2)) {
    if (/^[0-9a-f-]{36}$/i.test(release.id)) for (const size of sizes) candidates.push(`https://coverartarchive.org/release/${release.id}/front-${size}`);
    const group=release['release-group']?.id;
    if (/^[0-9a-f-]{36}$/i.test(group)) candidates.push(`https://coverartarchive.org/release-group/${group}/front-${sizes[0]}`);
  }
  for (const url of [...new Set(candidates)]) {
    if (!wanted()) return false;
    try { if (await saveImage(url,file,signal)) return true; } catch (_) {}
  }
  return false;
}
async function pump() {
  if (running) return;
  const jobs = [...pending.values()].filter(j => !j.started);
  const job = jobs.find(j => j.priority) || jobs[0]; if (!job) return;
  running = true; job.started = true; activeJob = job;
  let result = false;
  try { result = await work(job); } catch (_) {}
  if (result) completed.add(job.track.id);
  else if (!job.signal.aborted && job.online && (mode !== 'maximum' || job.priority)) misses.set(job.file, Date.now()+60000);
  pending.delete(job.file); job.resolve(result); running = false; activeJob = null;
  setImmediate(pump);
}
function findCover(track,file,alive=()=>true,options={}) {
  const priority = !!options.priority, online = options.online !== false;
  if (pending.has(file)) { const job = pending.get(file); job.priority ||= priority; job.online ||= online; if (priority && activeJob && activeJob !== job) activeJob.abort.abort(); return job.promise; }
  if (misses.get(file)>Date.now() || (mode==='maximum'&&!priority) || pending.size>=64&&!priority) return Promise.resolve(false);
  // A newly playing song may preempt an old thumbnail search immediately.
  if (priority && activeJob) activeJob.abort.abort();
  const abort = new AbortController();
  let resolve; const promise = new Promise(r => { resolve=r; });
  pending.set(file,{ track,file,alive,priority,online,promise,resolve,abort,signal:AbortSignal.any([controller.signal,abort.signal]) });
  setImmediate(pump); return promise;
}
findCover.setEnabled = value => {
  enabled = value;
  if (!enabled) {
    // Local embedded artwork is still allowed with internet search disabled.
    for (const job of pending.values()) if (!job.started) job.online = false;
    controller.abort(); controller = new AbortController();
    for (const job of pending.values()) if (!job.started) job.signal = AbortSignal.any([controller.signal,job.abort.signal]);
  }
};
findCover.setMode = value => { if (Object.hasOwn(intervals,value)) { mode=value; if (mode==='maximum' && activeJob && !activeJob.priority) activeJob.abort.abort(); } };
findCover.configure = services => { localMedia=services.localMedia; catalog=services.catalog; store.configure(services.dataDir); };
findCover.status = () => [...completed];
module.exports = findCover;
