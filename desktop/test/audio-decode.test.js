const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { decodePcmServer } = require('../src/audio-decode');
const Analyzer = require('../src/audio-analyzer');

const ffmpegAvailable = !spawnSync('ffmpeg', ['-version']).error && !spawnSync('ffprobe', ['-version']).error;
function wav(file, duration) {
  const rate = 44100, samples = rate * duration, data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(12000 * Math.sin(2 * Math.PI * (i / rate < 90 ? 100 : 5000) * i / rate)), 44 + i * 2);
  fs.writeFileSync(file, data);
}

test('server decoder retains bounded windows from the whole recording, including after 90 seconds', { skip: !ffmpegAvailable }, async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'pain-audio-decode-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const file = path.join(folder, 'sections.wav'); wav(file, 120);
  const before = fs.statSync(file);
  const pcm = await decodePcmServer(file);
  assert.equal(pcm.sampling.duration, 120);
  assert.equal(pcm.sampling.windows.length, 72);
  assert.ok(pcm.left.byteLength + pcm.right.byteLength <= 16 * 1024 * 1024);
  assert.ok(pcm.sampling.windows.at(-1).sourceStart / pcm.sampleRate > 119);
  const track = { id: 'sections', duration: 120000 };
  const { profile, bpm } = Analyzer.analyzePcm(pcm.left, pcm.right, pcm.sampleRate, track, pcm.sampling);
  assert.equal(Analyzer.complete(profile, track), true);
  assert.equal(profile.analysis.lastSecond, 120);
  assert.ok(profile.vector[3] > .2, 'treble in the final 30 seconds must be measured');
  assert.equal(bpm, null, 'joined excerpts cannot establish BPM');
  assert.equal(fs.statSync(file).mtimeMs, before.mtimeMs);
  assert.equal(fs.statSync(file).size, before.size);
});

test('aborted decoding fails without launching a lasting decoder process', { skip: !ffmpegAvailable }, async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(decodePcmServer('/not-used.wav', { signal: controller.signal }), error => error.name === 'AbortError');
});
