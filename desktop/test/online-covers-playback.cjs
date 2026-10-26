// Real Electron / real library; all writes are confined to a temporary profile.
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const root = fs.mkdtempSync(path.resolve(__dirname, '../.cover-playback-'));
  const source = path.resolve(__dirname, '../data');
  const library = JSON.parse(fs.readFileSync(path.join(source, 'library.json')));
  fs.mkdirSync(path.join(root, 'data'));
  fs.mkdirSync(path.join(root, 'cache'));
  for (const name of fs.readdirSync(source)) if (name.endsWith('.json')) fs.copyFileSync(path.join(source, name), path.join(root, 'data', name));
  for (const name of fs.readdirSync(path.resolve(__dirname, '../cache'))) if (name.endsWith('.mp3')) fs.linkSync(path.resolve(__dirname, '../cache', name), path.join(root, 'cache', name));
  let app;
  try {
    const env = { ...process.env, PAIN_DATA_DIR: root, PAIN_USER_DATA_DIR: path.join(root, 'profile'), PAIN_DISCOVERY: 'false', PAIN_PULSEFLOW_AUTO_INDEX: 'false', PORT: '3199' };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: require('electron'), args: [path.resolve(__dirname, '..')], env });
    const page = await app.firstWindow();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.waitForFunction(n => window.painQueue?.tracks.length === n, library.tracks.length);
    await page.evaluate(() => { location.hash = 'library'; });
    await page.evaluate(() => {
      const toggle = document.getElementById('onlineCoversSwitch');
      toggle.checked = true; toggle.dispatchEvent(new Event('change'));
    });
    // More than Chromium's six connections: this previously blocked music.
    const elapsed = await page.evaluate(async ids => {
      const start = performance.now();
      await Promise.all(ids.map(id => fetch(`/api/cover/${encodeURIComponent(id)}?online=1`, { signal: AbortSignal.timeout(4000) }).then(r => r.arrayBuffer())));
      return performance.now() - start;
    }, library.tracks.slice(0, 24).map(t => t.id));
    assert.ok(elapsed < 4000, `Cover replies took ${elapsed}ms`);
    const tracks = library.tracks.filter(t => t.mime === 'audio/mpeg').slice(0, 2);
    for (const track of tracks) {
      await page.locator(`tr[data-track-id="${track.id}"]`).click();
      await page.waitForFunction(id => window.painQueue.getCurrentTrack()?.id === id && [...document.querySelectorAll('audio')].some(a => !a.paused && a.currentTime > 0.5 && a.readyState >= 2), track.id, { timeout: 8000 });
    }
    await page.evaluate(() => {
      const toggle = document.getElementById('onlineCoversSwitch');
      toggle.checked = false; toggle.dispatchEvent(new Event('change'));
    });
    await page.waitForTimeout(1000);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('audio')].some(a => !a.paused && a.currentTime > 1)), true);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ tracks: library.tracks.length, coverReplyMs: Math.round(elapsed), playbackAndSwitching: 'passed', disablingWhilePlaying: 'passed', errors }));
  } finally {
    if (app) await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
