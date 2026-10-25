const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const Audio = require('../src/audio-profile');
const available = !spawnSync('ffmpeg', ['-version']).error && !spawnSync('ffprobe', ['-version']).error;

test('analysis endpoint uses saved identity, persists reanalysis, validates source changes and leaves music files alone', { skip: !available }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pain-analysis-server-'));
  fs.mkdirSync(path.join(root, 'data')); fs.mkdirSync(path.join(root, 'downloads'));
  const track = { id: 'song', title: 'Tone', artist: 'Fixture', duration: 30000, bytes: 2646078, path: '/music/tone.wav' };
  fs.writeFileSync(path.join(root, 'data/library.json'), JSON.stringify({ tracks: [track] }));
  const file = path.join(root, 'downloads/Fixture - Tone.wav');
  const generated = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=30', '-ar', '44100', file]);
  assert.equal(generated.status, 0);
  const before = fs.readFileSync(file);
  const reservation = http.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, [path.join(__dirname, '../src/server.js')], {
    env: { ...process.env, PAIN_DATA_DIR: root, PAIN_DISCOVERY: 'false', OPEN_BROWSER: 'false', PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(async () => { if (child.exitCode === null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited; } fs.rmSync(root, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => {
    let output = ''; const timeout = setTimeout(() => reject(new Error('Server did not start')), 5000);
    child.stdout.on('data', data => { output += data; if (output.includes('Web UI:')) { clearTimeout(timeout); resolve(); } });
    child.once('error', reject);
  });
  const endpoint = `http://127.0.0.1:${port}/api/analyze-track/song`;
  const analyze = (payload = { track }, suffix = '') => fetch(endpoint + suffix, { method: 'POST', body: JSON.stringify(payload) });
  let response = await analyze({ track: { ...track, duration: 1, bytes: 1 } });
  assert.equal(response.status, 200);
  const first = await response.json();
  assert.equal(first.profile.signature, Audio.signature(track), 'client metadata must not relabel the saved file');
  assert.equal(first.cached, undefined);
  assert.equal(fs.existsSync(path.join(root, 'cache/song.mp3')), false, 'analysis must not copy/link downloads into cache');
  assert.deepEqual(fs.readFileSync(file), before);
  response = await analyze(); assert.equal((await response.json()).cached, true);
  response = await analyze({ track }, '?force=1'); assert.equal(response.status, 200);
  const refreshed = await response.json();
  assert.ok(refreshed.profile.updatedAt > first.profile.updatedAt);
  const saved = JSON.parse(fs.readFileSync(path.join(root, 'data/dj-state.json')));
  assert.equal(saved.profiles.song.updatedAt, refreshed.profile.updatedAt, 'same-size reanalysis must persist');
  response = await analyze({ track: { ...track, id: 'another' } }); assert.equal(response.status, 400);
  fs.utimesSync(file, new Date(), new Date(Date.now() + 2000));
  response = await analyze(); assert.equal(response.status, 200);
  assert.equal((await response.json()).cached, undefined, 'changed source stat must invalidate cache');
  assert.deepEqual(fs.readFileSync(file), before);
  // A missing file without prior measurements must not become invented audio.
  await fetch(`http://127.0.0.1:${port}/api/save-library`, {method:'POST',body:JSON.stringify({tracks:[{id:'missing',title:'Missing',duration:30000}]})});
  const unavailable=await fetch(`http://127.0.0.1:${port}/api/analyze-track/missing`,{method:'POST',body:'{}'});
  assert.equal(unavailable.status,404);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'data/dj-state.json'))).profiles.missing,undefined);
});
