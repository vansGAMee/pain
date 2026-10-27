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
    const preferred=known.filter(r => matching.norm(r.title) === matching.norm(track.title));
    const originals=known.filter(r => matching.norm(r.title) === matching.norm(meta.title));
    const pool=preferred.length?preferred:originals.length?originals:known;
    return pool.sort((a,b)=>{
      const album=r=>!!meta.album&&(r.releases||[]).some(x=>matching.norm(x.title)===matching.norm(meta.album));
      const distance=r=>track.duration>0&&r.length>0?Math.abs(r.length-track.duration):Infinity;
      return Number(album(b))-Number(album(a))||distance(a)-distance(b);
    })[0]||null;
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
  function requestJson(url,signal,plain=false) {
    const job=tail.then(async()=>{
      await require('node:timers/promises').setTimeout(Math.max(0,next-Date.now()),undefined,{signal});
      signal?.throwIfAborted();next=Date.now()+1100;
      const response=await requestSource(url,{headers:{'User-Agent':agent},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(6000)]):AbortSignal.timeout(6000)});
      if(!response.ok)throw Error('MusicBrainz unavailable');
      return plain?response.text():response.json();
    });
    tail=job.catch(()=>{});return job;
  }
  async function entity(type,id,signal){
    if(!/^[0-9a-f-]{36}$/i.test(id||''))return null;
    const key=`genres-tags-${type}-${id}`,file=path.join(dir,'music-catalog',key+'.json');
    if(pending.has(key))return pending.get(key);
    const job=(async()=>{
      let cached;try{cached=JSON.parse(await fs.readFile(file,'utf8'));if(Date.now()-cached.at<30*86400000)return cached.value;}catch(_){}
      try{
        const value=await requestJson(`https://musicbrainz.org/ws/2/${type}/${id}?inc=genres+tags&fmt=json`,signal);
        await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify({at:Date.now(),value}));return value;
      }catch(error){if(cached)return cached.value;throw error;}
    })().finally(()=>pending.delete(key));pending.set(key,job);return job;
  }
  async function lookup(track, { signal } = {}) {
    const meta = matching.metadata(track), name = meta?.title || matching.title(track.title);
    if (!name || !/\p{L}/u.test(name)) return null;
    const key = createHash('sha256').update(JSON.stringify([4,track.title,name,meta?.artist,meta?.album,track.duration])).digest('hex');
    if (pending.has(key)) return pending.get(key);
    const file = path.join(dir, 'music-catalog', key + '.json');
    const job = (async () => {
      let cached;
      try { cached = JSON.parse(await fs.readFile(file,'utf8')); if (Date.now()-cached.at < (cached.value ? 30 : 1)*86400000) return cached.value; } catch (_) {}
      try {
        const request = (async () => {
          const quote = v => '"'+String(v).replace(/[\\"]/g,'\\$&')+'"';
          const query = `recording:${quote(name)}${meta ? ' AND ('+matching.artists(meta.artist).slice(0,3).map(a=>'artist:'+quote(a)).join(' OR ')+')' : ''}`;
          const url = 'https://musicbrainz.org/ws/2/recording/?'+new URLSearchParams({query,fmt:'json',limit:'25'});
          const result = choose((await requestJson(url,signal)).recordings || [],track);
          return result ? { ...result, possible: !meta, relatedVersion: matching.norm(result.title) !== matching.norm(track.title), artist: artist(result), source: `https://musicbrainz.org/recording/${result.id}` } : null;
        })();
        const value = await request;
        await fs.mkdir(path.dirname(file),{recursive:true});
        await fs.writeFile(file,JSON.stringify({at:Date.now(),value}));
        return value;
      } catch (_) { return cached?.value || null; }
    })().finally(()=>pending.delete(key));
    pending.set(key,job); return job;
  }
  async function genres(track,{signal}={}){
    const record=await lookup(track,{signal});signal?.throwIfAborted();
    if(!record||record.possible)return null;
    // Original-song genres can describe an edit; never borrow a different remix's genre.
    if(record.relatedVersion&&matching.norm(record.title)!==matching.norm(matching.title(track.title)))return null;
    const names=data=>[...new Set((data?.genres||[]).filter(g=>Number(g.count)>0).map(g=>g.name).filter(Boolean))];
    const recording=await entity('recording',record.id,signal);
    const direct=names(recording),tags=data=>[...new Set((data?.tags||[]).filter(t=>Number(t.count)>0).map(t=>t.name).filter(Boolean))];
    const ownTags=tags(recording),base={names:direct,tags:ownTags,scope:record.relatedVersion?'original':'recording',source:record.source};
    if(direct.length)return base;
    const releases=record.releases||[];
    const album=releases.find(r=>matching.norm(r.title)===matching.norm(track.album)&&r['release-group']?.id)||releases.find(r=>{
      const group=r['release-group'];return group?.id&&group['primary-type']==='Album'&&!(group['secondary-types']||[]).includes('Compilation');
    });
    if(album){
      const id=album['release-group'].id,data=await entity('release-group',id,signal),found=names(data);
      if(found.length)return {names:found,tags:ownTags.length?ownTags:tags(data),tagSource:ownTags.length?record.source:`https://musicbrainz.org/release-group/${id}`,scope:'album',source:`https://musicbrainz.org/release-group/${id}`};
    }
    return ownTags.length?base:null;
  }
  let bulk={},genreRevision=0;
  const bulkReady=fs.readFile(path.join(dir,'track-catalog-genres.json'),'utf8').then(JSON.parse).then(data=>{bulk=data;}).catch(()=>{});
  const bulkKey=t=>JSON.stringify([matching.norm(t.artist),matching.norm(t.rawTitle||t.title)]);
  const cachedGenres=t=>{const row=bulk[bulkKey(t)];return row&&(row.names?.length||row.tags?.length)?row:null;};
  async function prefetchGenres(tracks,{signal}={}){
    await bulkReady;
    let vocabulary;
    const vocabularyFile=path.join(dir,'genre-vocabulary.json');
    try{const saved=JSON.parse(await fs.readFile(vocabularyFile,'utf8'));if(Date.now()-saved.at<30*86400000)vocabulary=saved.names;}catch(_){}
    if(!vocabulary){
      const text=await requestJson('https://musicbrainz.org/ws/2/genre/all?fmt=txt',signal,true);
      vocabulary=text.split('\n').map(s=>s.trim()).filter(Boolean);
      await fs.mkdir(dir,{recursive:true});await fs.writeFile(vocabularyFile,JSON.stringify({at:Date.now(),names:vocabulary}));
    }
    const genreNames=new Map(vocabulary.map(s=>[matching.norm(s),s]));
    const pendingTracks=[...new Map(tracks.filter(t=>!bulk[bulkKey(t)]||Date.now()-bulk[bulkKey(t)].at>(bulk[bulkKey(t)].names?.length?30:1)*86400000).map(t=>[bulkKey(t),t])).values()];
    const quote=v=>'"'+String(v).replace(/[\\"]/g,'\\$&')+'"';
    for(let i=0;i<pendingTracks.length;i+=10){
      signal?.throwIfAborted();const batch=pendingTracks.slice(i,i+10);
      const query=batch.map(t=>`(recording:${quote(matching.title(t.title))} AND (${matching.artists(t.artist).map(a=>'artist:'+quote(a)).join(' OR ')}))`).join(' OR ');
      const data=await requestJson('https://musicbrainz.org/ws/2/recording/?'+new URLSearchParams({query,fmt:'json',limit:'100'}),signal);
      for(const track of batch){
        const record=choose(data.recordings||[],{...track,title:track.rawTitle||track.title});
        if(!record)continue;
        const related=matching.norm(record.title)!==matching.norm(track.rawTitle||track.title);
        if(related&&matching.norm(record.title)!==matching.norm(matching.title(track.title)))continue;
        const tags=(record.tags||[]).filter(t=>Number(t.count)>0).map(t=>t.name).filter(Boolean);
        const names=[...new Set(tags.map(t=>genreNames.get(matching.norm(t))).filter(Boolean))];
        const row={names,tags,scope:related?'original':'recording',source:`https://musicbrainz.org/recording/${record.id}`,at:Date.now(),metadataVersion:2};
        if(names.length||tags.length)bulk[bulkKey(track)]=row;
      }
      genreRevision++;
      const target=path.join(dir,'track-catalog-genres.json');await fs.writeFile(target+'.tmp',JSON.stringify(bulk));await fs.rename(target+'.tmp',target);
    }
  }
  return { lookup, genres, prefetchGenres, cachedGenres, bulkReady, genreRevision:()=>genreRevision };
};
module.exports.choose = choose;
