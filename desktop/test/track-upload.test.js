const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const delay = ms => new Promise(r => setTimeout(r, ms));

test('reverse track upload: saves track to downloads, updates library, and queues when offline or pushes when online', async t => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'pain-upload-test-'));
  const dummyAudio = Buffer.alloc(8192);
  for (let i = 0; i < dummyAudio.length; i++) dummyAudio[i] = (i * 7) % 256;

  let phoneReceivedUpload = null;
  const phone = http.createServer((req, res) => {
    if (req.url.startsWith('/api/upload-track') && req.method === 'POST') {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        const bodyBytes = Buffer.concat(chunks);
        phoneReceivedUpload = {
          url: req.url,
          filename: req.headers['x-filename'],
          title: req.headers['x-title'],
          artist: req.headers['x-artist'],
          bytesLength: bodyBytes.length
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          trackId: 'pc_upload_simulated_123',
          title: decodeURIComponent(req.headers['x-title'] || 'My Track'),
          artist: decodeURIComponent(req.headers['x-artist'] || 'Artist')
        }));
      });
      return;
    }
    if (req.url === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', appName: 'Pain', device: 'Android', tracks: 10 }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise(r => phone.listen(0, '127.0.0.1', r));
  const phonePort = phone.address().port;

  const reserve = http.createServer();
  await new Promise(r => reserve.listen(0, '127.0.0.1', r));
  const port = reserve.address().port;
  await new Promise(r => reserve.close(r));

  const child = spawn(process.execPath, [path.join(__dirname, '../src/server.js')], {
    env: {
      ...process.env,
      PAIN_DATA_DIR: data,
      PAIN_DISCOVERY: 'false',
      OPEN_BROWSER: 'false',
      PORT: String(port)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  t.after(async () => {
    child.kill();
    await new Promise(r => child.once('exit', r));
    await new Promise(r => phone.close(r));
    fs.rmSync(data, { recursive: true, force: true });
  });

  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Server startup timeout')), 5000);
    child.stdout.on('data', b => {
      output += b;
      if (output.includes('Web UI:')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once('error', reject);
  });

  const root = `http://127.0.0.1:${port}`;

  // 1. Initial upload-status when offline
  const initialStatusRes = await fetch(`${root}/api/upload-status`);
  assert.equal(initialStatusRes.status, 200);
  const initialStatus = await initialStatusRes.json();
  assert.equal(initialStatus.pendingCount, 0);

  // 2. Upload track when phone is offline (no phone connected yet)
  const uploadUrl = `${root}/api/upload-to-phone?filename=Queen+-+Bohemian+Rhapsody.mp3&title=Bohemian+Rhapsody&artist=Queen`;
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'audio/mpeg',
      'X-Filename': encodeURIComponent('Queen - Bohemian Rhapsody.mp3'),
      'X-Title': encodeURIComponent('Bohemian Rhapsody'),
      'X-Artist': encodeURIComponent('Queen')
    },
    body: dummyAudio
  });

  assert.equal(uploadRes.status, 200);
  const uploadJson = await uploadRes.json();
  assert.equal(uploadJson.status, 'ok');
  assert.equal(uploadJson.phoneOnline, false);
  assert.equal(uploadJson.track.title, 'Bohemian Rhapsody');
  assert.equal(uploadJson.track.artist, 'Queen');

  // Verify file was saved to downloads folder
  const savedFilePath = path.join(data, 'downloads', 'Queen - Bohemian Rhapsody.mp3');
  assert.equal(fs.existsSync(savedFilePath), true);
  assert.equal(fs.statSync(savedFilePath).size, 8192);

  // Verify track is in desktop library.json
  const libRes = await fetch(`${root}/api/saved-library`);
  const libData = await libRes.json();
  assert.equal(libData.tracks.some(t => t.title === 'Bohemian Rhapsody' && t.artist === 'Queen'), true);

  // Verify upload is queued in pending-uploads.json
  const queuedStatusRes = await fetch(`${root}/api/upload-status`);
  const queuedStatus = await queuedStatusRes.json();
  assert.equal(queuedStatus.pendingCount, 1);
  assert.equal(queuedStatus.pending[0].filename, 'Queen - Bohemian Rhapsody.mp3');

  // Replacing a local file preserves its identity/heart and refreshes cached bytes.
  await fetch(`${root}/api/sync-like`, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({trackId:uploadJson.track.id,favorite:1}) });
  const replacement=Buffer.alloc(9000,42);
  const replaced=await (await fetch(`${root}/api/upload-to-phone?filename=${encodeURIComponent('Queen - Bohemian Rhapsody.mp3')}`,{method:'POST',body:replacement})).json();
  assert.equal(replaced.track.id,uploadJson.track.id);
  assert.equal(replaced.track.favorite,1);
  assert.deepEqual(fs.readFileSync(path.join(data,'cache',uploadJson.track.id+'.mp3')),replacement);
  assert.equal((await(await fetch(`${root}/api/upload-status`)).json()).pendingCount,1);

  // 3. Reject corrupted / tiny audio file
  const badRes = await fetch(`${root}/api/upload-to-phone?filename=corrupt.mp3`, {
    method: 'POST',
    headers: { 'Content-Type': 'audio/mpeg' },
    body: Buffer.from('too short')
  });
  assert.equal(badRes.status, 400);

  const malformed = await fetch(`${root}/api/upload-to-phone`, {
    method: 'POST', headers: { 'X-Filename': '%broken' }, body: dummyAudio
  });
  assert.equal(malformed.status, 400, 'malformed metadata must not crash the server');
  await fetch(`${root}/api/save-library`, { method: 'POST', body: JSON.stringify({tracks:[]}) });
  const preserved = await (await fetch(`${root}/api/saved-library`)).json();
  assert.equal(preserved.tracks.length, 1, 'an empty phone snapshot must retain the pending PC upload');
  assert.equal(preserved.tracks[0].id, uploadJson.track.id);
});
