'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), { createHash } = require('node:crypto');
const matching = require('./cover-matching');
const agent = 'PAIN/1.7.8 (https://github.com/vansGAMee/pain)';
const artist = record => (record['artist-credit'] || []).map(c => c.name || c.artist?.name || '').join(', ');
function choose(records, track) {
  const meta = matching.metadata(track);
  const candidates = records.filter(r => matching.norm(matching.title(r.title)) === matching.norm(matching.title(meta?.title || track.title)));
  if (meta) {
    const known = candidates.filter(r => matching.matches({ artistName: artist(r), trackName: r.title }, meta));
    return known.find(r => matching.norm(r.title) === matching.norm(track.title)) ||
      known.find(r => matching.norm(r.title) === matching.norm(meta.title)) || known[0] || null;
  }
  // A bare title can be shared by unrelated artists: require matching duration
  // at whole-second precision and a single artist identity, not just first hit.
  if (!(track.duration > 0)) return null;
  const timed = candidates.filter(r => r.length > 0 && Math.round(r.length / 1000) === Math.round(track.duration / 1000));
  return new Set(timed.map(r => matching.norm(artist(r)))).size === 1 ? timed[0] : null;
}
module.exports = function createCatalog(dir, { fetcher = fetch } = {}) {
  let tail = Promise.resolve(), next = 0;
  const pending = new Map();
  const requestSource = require('./source-fetch')({ fetcher });
  async function lookup(track, { signal } = {}) {
    const meta = matching.metadata(track), name = meta?.title || matching.title(track.title);
    if (!name || !/\p{L}/u.test(name)) return null;
    const key = createHash('sha256').update(JSON.stringify([3,track.title,name,meta?.artist,track.duration])).digest('hex');
    if (pending.has(key)) return pending.get(key);
    const file = path.join(dir, 'music-catalog', key + '.json');
    const job = (async () => {
      let cached;
      try { cached = JSON.parse(await fs.readFile(file,'utf8')); if (Date.now()-cached.at < (cached.value ? 30 : 1)*86400000) return cached.value; } catch (_) {}
      try {
        const request = tail.then(async () => {
          await new Promise(r => setTimeout(r, Math.max(0,next-Date.now())));
          signal?.throwIfAborted(); next = Date.now()+1100;
          const quote = v => '"'+String(v).replace(/[\\"]/g,'\\$&')+'"';
          const query = `recording:${quote(name)}${meta ? ' AND ('+matching.artists(meta.artist).slice(0,3).map(a=>'artist:'+quote(a)).join(' OR ')+')' : ''}`;
          const url = 'https://musicbrainz.org/ws/2/recording/?'+new URLSearchParams({query,fmt:'json',limit:'25'});
          const response = await requestSource(url, { headers:{'User-Agent':agent},signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(6000)]) : AbortSignal.timeout(6000) });
          if (!response.ok) throw Error('MusicBrainz unavailable');
          const result = choose((await response.json()).recordings || [],track);
          return result ? { ...result, possible: !meta, relatedVersion: matching.norm(result.title) !== matching.norm(track.title), artist: artist(result), source: `https://musicbrainz.org/recording/${result.id}` } : null;
        });
        tail = request.catch(()=>{});
        const value = await request;
        await fs.mkdir(path.dirname(file),{recursive:true});
        await fs.writeFile(file,JSON.stringify({at:Date.now(),value}));
        return value;
      } catch (_) { return cached?.value || null; }
    })().finally(()=>pending.delete(key));
    pending.set(key,job); return job;
  }
  return { lookup };
};
module.exports.choose = choose;
