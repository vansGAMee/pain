// Complete phone downloads shared by analysis jobs. Never buffers a song in RAM.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { pipeline } = require('node:stream/promises');
const matching = require('./cover-matching');
function replacement(track, tracks) {
  if (!track || matching.unknown(track.artist) || !track.title || !(track.bytes > 0) || !(track.duration > 0)) return null;
  const candidates = tracks.filter(t => String(t.id) !== String(track.id) && t.available !== 0 &&
    matching.norm(t.title) === matching.norm(track.title) && matching.norm(t.artist) === matching.norm(track.artist) &&
    Number(t.bytes) === Number(track.bytes) && Number(t.duration) === Number(track.duration));
  return candidates.length === 1 ? candidates[0] : null;
}
const failure = (code,message) => Object.assign(new Error(message),{code});
module.exports = function audioDownload({ cacheDir, resolveAudio, phoneBase, getTrack, availabilityFile }) {
  const pending = new Map();
  let issues = {}, persist = Promise.resolve(), remoteCache;
  try { if (availabilityFile) issues = JSON.parse(fs.readFileSync(availabilityFile,'utf8')); } catch (_) {}
  const signature = id => {const t=getTrack?.(id);return JSON.stringify([t?.title,t?.artist,t?.bytes,t?.duration]);};
  function record(id,error,base) {
    if (error) issues[id] = {code:['AUDIO_NOT_ON_PHONE','AUDIO_PHONE_UNREADABLE'].includes(error.code)?error.code:'PHONE_UNAVAILABLE',checkedAt:Date.now(),base,signature:signature(id)};
    else delete issues[id];
    if (availabilityFile) {const text=JSON.stringify(issues);persist=persist.catch(()=>{}).then(async()=>{
      await fs.promises.mkdir(path.dirname(availabilityFile),{recursive:true});
      const temp=availabilityFile+'.tmp';await fs.promises.writeFile(temp,text);await fs.promises.rename(temp,availabilityFile);
    }).catch(()=>{});}
  }
  function open(url, signal) {
    return new Promise((resolve,reject) => {
      const timer = setTimeout(()=>request.destroy(new Error('Phone connection timed out')),5000);
      const request=http.get(url,{signal},response=>{clearTimeout(timer);resolve(response);});
      request.setTimeout(15000,()=>request.destroy(new Error('Phone transfer stalled')));
      request.on('error',error=>{clearTimeout(timer);reject(error);});
    });
  }
  function remoteTracks(base,signal) {
    if (remoteCache?.base === base && Date.now()-remoteCache.at < 30000) return remoteCache.job;
    const job=(async()=>{
      const response=await open(new URL('/api/library',base),signal);
      if(response.statusCode!==200){response.resume();throw Error('Phone library unavailable');}
      const chunks=[];let size=0;
      for await(const chunk of response){size+=chunk.length;if(size>32*1024*1024){response.destroy();throw Error('Phone library too large');}chunks.push(chunk);}
      const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!Array.isArray(data.tracks))throw Error('Invalid phone library');
      return data.tracks;
    })();
    remoteCache={base,at:Date.now(),job};job.catch(()=>{if(remoteCache?.job===job)remoteCache=null;});return job;
  }
  function waitFor(job, signal) {
    if (!signal) return job;
    if (signal.aborted) return Promise.reject(new Error('Download cancelled'));
    return new Promise((resolve,reject) => {
      const cancel = () => reject(new Error('Download cancelled'));
      signal.addEventListener('abort',cancel,{once:true});
      job.then(resolve,reject).finally(()=>signal.removeEventListener('abort',cancel));
    });
  }
  function ensureAudio(id, { signal } = {}) {
    if (signal?.aborted) return Promise.reject(new Error('Download cancelled'));
    const existing = resolveAudio(id); if (existing) {if(issues[id])record(id,null);return Promise.resolve(existing);}
    if (pending.has(id)) return waitFor(pending.get(id),signal);
    const job = (async () => {
      const target = path.join(cacheDir, id.replace(/[/\\?%*:|"<>]/g, '_') + '.mp3');
      const temp = target + '.' + require('node:crypto').randomUUID() + '.tmp';
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 120000);
      const base=phoneBase();
      try {
        let url = new URL('/api/track/' + encodeURIComponent(id), base);
        if (url.protocol !== 'http:') throw new Error('Phone URL must use HTTP');
        let response = await open(url,controller.signal);
        if (response.statusCode === 404) {
          let text='';for await(const chunk of response){text+=chunk.toString();if(text.length>1024){response.destroy();break;}}
          const code=/File unreadable/i.test(text)?'AUDIO_PHONE_UNREADABLE':'AUDIO_NOT_ON_PHONE';
          let candidate;
          // Android may change MediaStore IDs after rescanning. Recover only a
          // unique exact title/artist/duration/byte-size match; never guess.
          if (code==='AUDIO_NOT_ON_PHONE' && getTrack?.(id)) {
            try { candidate=replacement(getTrack(id),await remoteTracks(base,controller.signal)); } catch (_) {}
          }
          if(!candidate)throw failure(code,code==='AUDIO_NOT_ON_PHONE'?'This track is absent from the phone library (HTTP 404).':'The phone cannot read this audio file (HTTP 404).');
          url=new URL('/api/track/'+encodeURIComponent(candidate.id),base);
          response=await open(url,controller.signal);
        }
        if (response.statusCode !== 200) { const status=response.statusCode;response.resume();throw failure(status===404?'AUDIO_NOT_ON_PHONE':'PHONE_UNAVAILABLE','Phone returned HTTP '+status); }
        await fs.promises.mkdir(cacheDir, { recursive: true });
        await pipeline(response, fs.createWriteStream(temp, { flags: 'wx' }), { signal: controller.signal });
        const { size } = await fs.promises.stat(temp), expected = Number(response.headers['content-length']);
        if (!response.complete || size < 4096 || (expected && expected !== size)) throw new Error('Incomplete audio download');
        await fs.promises.rename(temp, target);
        record(id,null);
        return target;
      } catch(error) {record(id,error,base);throw error;}
      finally { clearTimeout(timer); await fs.promises.unlink(temp).catch(() => {}); }
    })();
    const completion = job.finally(() => pending.delete(id));
    pending.set(id, completion);
    return waitFor(completion,signal);
  }
  ensureAudio.getStatus=id=>{const issue=issues[id];return issue&&issue.base===phoneBase()&&issue.signature===signature(id)?{code:issue.code,checkedAt:issue.checkedAt}:null;};
  return ensureAudio;
};
module.exports.replacement=replacement;
