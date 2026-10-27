'use strict';
const fs = require('node:fs/promises'), path = require('node:path');
const { promisify } = require('node:util'), { execFile } = require('node:child_process');
const run = promisify(execFile);
const matching = require('./cover-matching');
// Metadata probes are serialized and never run on the renderer or Electron main thread.
module.exports = function createLocalMedia(dir, resolveFile, getTracks = () => []) {
  const pending = new Map(); let tail = Promise.resolve();
  async function inspect(track) {
    const file = resolveFile(track.id); if (!file) return { track };
    const stat = await fs.stat(file);
    const key = require('node:crypto').createHash('sha256').update(file + ':' + stat.size + ':' + stat.mtimeMs).digest('hex');
    if (pending.has(key)) return pending.get(key);
    const cache = path.join(dir, 'media-metadata', key + '.json');
    const job = tail.then(async () => {
      try { return { ...(JSON.parse(await fs.readFile(cache, 'utf8'))), file }; } catch (_) {}
      const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format_tags:stream=index,codec_name,sample_rate,bit_rate,channels:stream_disposition=attached_pic', '-of', 'json', file], { timeout: 5000, maxBuffer: 256 * 1024, windowsHide: true });
      const data = JSON.parse(stdout), tags = {};
      for (const [k,v] of Object.entries(data.format?.tags || {})) tags[k.toLowerCase()] = v;
      const audio = (data.streams || []).find(s => s.sample_rate);
      const embedded = (data.streams || []).find(s => s.disposition?.attached_pic === 1);
      const meta = {};
      for (const [key, tag] of [['title','title'],['artist','artist'],['album','album'],['year','date'],['genre','genre']]) if (tags[tag]) meta[key] = String(tags[tag]).slice(0,500);
      const result = { metadata: meta, audio: audio ? { codec: audio.codec_name, sampleRate: Number(audio.sample_rate), bitrate: Number(audio.bit_rate) || null, channels: audio.channels } : null, picture: embedded?.index };
      await fs.mkdir(path.dirname(cache), { recursive: true });
      await fs.writeFile(cache, JSON.stringify(result));
      return { ...result, file };
    });
    tail = job.catch(() => {}); pending.set(key, job);
    return job.finally(() => pending.delete(key));
  }
  async function read(track) {
    try {
      const result = await inspect(track), merged = { ...track };
      for (const [key,value] of Object.entries(result.metadata || {})) {
        if (key === 'title' || matching.unknown(merged[key])) merged[key] = value;
      }
      return { ...result, track: matching.fromFilename(merged, getTracks().map(t => t.artist)) };
    } catch (_) { return { track: matching.fromFilename(track, getTracks().map(t => t.artist)) }; }
  }
  async function cover(result, target, signal) {
    if (result.picture === undefined || !result.file || signal?.aborted) return false;
    try {
      const { stdout } = await run('ffmpeg', ['-nostdin', '-v', 'error', '-threads', '1', '-i', result.file, '-map', `0:${result.picture}`, '-frames:v', '1', '-vf', 'scale=500:500:force_original_aspect_ratio=decrease', '-threads', '1', '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1'], { encoding: 'buffer', timeout: 5000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, signal });
      if (signal?.aborted || !stdout.length) return false;
      await fs.writeFile(target, stdout, { flag: 'wx' }).catch(e => { if (e.code !== 'EEXIST') throw e; });
      return true;
    } catch (_) { return false; }
  }
  return { read, cover };
};
