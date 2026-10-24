// Full-file decoding with bounded retained PCM. Only the analysis windows are
// kept; a long recording cannot allocate a full decoded copy in the server.
const { spawn, execFile } = require('node:child_process');
const { planWindows } = require('./audio-analyzer');

const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const BYTES_PER_SAMPLE = Float32Array.BYTES_PER_ELEMENT;
const FRAME_BYTES = CHANNELS * BYTES_PER_SAMPLE;
// Operational limits, independent of the recommendation model.
const DECODE_TIMEOUT_MS = 120000;
const PROBE_TIMEOUT_MS = 15000;
const MAX_RETAINED_BYTES = 16 * 1024 * 1024;

function probeDuration(file, signal) {
  return new Promise((resolve, reject) => {
    execFile('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'format=duration', '-of', 'json', file],
      { timeout: PROBE_TIMEOUT_MS, maxBuffer: 65536, signal, windowsHide: true }, (error, stdout) => {
        if (error) { reject(error); return; }
        try {
          const duration = Number(JSON.parse(stdout).format?.duration);
          if (!Number.isFinite(duration) || duration <= 0) throw new Error('Audio duration is unavailable');
          resolve(duration);
        } catch (error) { reject(error); }
      });
  });
}

async function decodePcmServer(file, { signal } = {}) {
  const duration = await probeDuration(file, signal);
  const sampling = planWindows(Math.floor(duration * SAMPLE_RATE), SAMPLE_RATE);
  if (!sampling) throw new Error('Audio is too short for analysis');
  const bytesToRetain = sampling.windows.reduce((sum, w) => sum + w.sampleCount * FRAME_BYTES, 0);
  if (bytesToRetain > MAX_RETAINED_BYTES) throw new Error('Analysis PCM budget exceeded');
  return new Promise((resolve, reject) => {
    const windows = sampling.windows.map(w => ({ ...w, bytes: Buffer.alloc(w.sampleCount * FRAME_BYTES), received: 0 }));
    const process = spawn('ffmpeg', ['-nostdin', '-v', 'error', '-i', file, '-map', '0:a:0', '-f', 'f32le', '-ac', String(CHANNELS), '-ar', String(SAMPLE_RATE), 'pipe:1'],
      { signal, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let offset = 0, index = 0, errorText = '', settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => { process.kill(); finish(new Error('Audio decoding timed out')); }, DECODE_TIMEOUT_MS);
    process.on('error', error => finish(error));
    process.stderr.on('data', chunk => { if (errorText.length < 65536) errorText += chunk.toString(); });
    process.stdout.on('data', chunk => {
      const end = offset + chunk.length;
      while (index < windows.length) {
        const w = windows[index], start = w.sourceStart * FRAME_BYTES, stop = start + w.bytes.length;
        if (start >= end) break;
        const from = Math.max(offset, start), to = Math.min(end, stop);
        if (to > from) { chunk.copy(w.bytes, from - start, from - offset, to - offset); w.received += to - from; }
        if (stop <= end) index++; else break;
      }
      offset = end;
    });
    process.on('close', code => {
      if (code !== 0) { finish(new Error('Audio decode failed: ' + (errorText.trim() || 'ffmpeg exit ' + code))); return; }
      // Metadata can overestimate duration. Partial windows must never be
      // padded with fake silence or counted as fully measured evidence.
      const complete = windows.filter(w => w.received === w.bytes.length);
      if (complete.length < 4) { finish(new Error('Insufficient decoded audio')); return; }
      const count = complete.reduce((n, w) => n + w.sampleCount, 0);
      const left = new Float32Array(count), right = new Float32Array(count);
      let packedStart = 0;
      const packedWindows = complete.map(w => {
        for (let i = 0; i < w.sampleCount; i++) {
          left[packedStart + i] = w.bytes.readFloatLE(i * FRAME_BYTES);
          right[packedStart + i] = w.bytes.readFloatLE(i * FRAME_BYTES + BYTES_PER_SAMPLE);
        }
        const packed = { position: w.position, sourceStart: w.sourceStart, sampleCount: w.sampleCount, packedStart };
        packedStart += w.sampleCount;
        return packed;
      });
      finish(null, { left, right, sampleRate: SAMPLE_RATE,
        sampling: { ...sampling, duration: offset / FRAME_BYTES / SAMPLE_RATE, windows: packedWindows } });
    });
  });
}

module.exports = { decodePcmServer };
