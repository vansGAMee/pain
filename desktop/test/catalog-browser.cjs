// Fully intercepted browser fixtures; never starts the server or reads user data.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    const tracks = Array.from({ length: 8 }, (_, i) => ({ id: String(i), title: `Song ${i}`, artist: `Artist ${i}`, duration: 180000 }));
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://localhost') return route.abort();
      if (url.pathname.startsWith('/joint-model/')) return route.fulfill({ status: 404, body: '' });
      if (url.pathname.startsWith('/api/')) {
        let data = {};
        if (url.pathname === '/api/saved-library') data = { tracks };
        else if (url.pathname === '/api/saved-stats') data = { plays: [], slices: [] };
        else if (url.pathname === '/api/cached-tracks') data = { cached: [] };
        else if (['/api/playlists', '/api/devices'].includes(url.pathname)) data = [];
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
      }
      const file = url.pathname.startsWith('/assets/') ? path.join(__dirname, '..', url.pathname) : path.join(__dirname, '../src', url.pathname === '/' ? 'index.html' : url.pathname);
      const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.png': 'image/png' };
      try { return route.fulfill({ contentType: types[path.extname(file)] || 'application/octet-stream', body: await fs.readFile(file) }); }
      catch (_) { return route.fulfill({ status: 404, body: '' }); }
    });
    await page.addInitScript(() => localStorage.setItem('pain_lang', 'ru'));
    await page.goto('http://localhost');
    await page.waitForFunction(() => window.painQueue?.tracks.length === 8);
    await page.click('.nav-item[data-view="joint-ai"]');
    await page.fill('#jointSeedInput', 'Artist 0 - Song 0');
    await page.click('#jointAddSeedBtn');
    await page.selectOption('#jointFilterLocalOnly', 'local_only');
    await page.click('#jointGenerateBtn');
    await page.waitForFunction(() => document.querySelectorAll('.joint-track-row').length === 7);
    assert.match(await page.locator('#jointModelBadgeText').textContent(), /вашей библиотеке/);
    assert.doesNotMatch(await page.locator('#jointResultsList').textContent(), /% match|CLAP 512D/);
    assert.equal(await page.locator('.joint-play-btn').count(), 7);
    await page.selectOption('#jointFilterAudioOnly', 'audio_only');
    await page.click('#jointGenerateBtn');
    await page.waitForFunction(() => document.querySelector('#jointResultsMeta').textContent.includes('0 треков'));
    assert.equal(await page.locator('.joint-track-row').count(), 0, 'select value actually reaches the audio filter');
    await page.selectOption('#jointFilterAudioOnly', 'all');
    await page.selectOption('#jointFilterLocalOnly', 'all');
    await page.click('#jointGenerateBtn');
    await page.waitForFunction(() => document.querySelectorAll('.joint-track-row').length === 7);
    assert.match(await page.locator('#jointResultsMeta').textContent(), /Использована локальная библиотека/);
    assert.deepEqual(errors, []);
    console.log('PASS: local recommendations, strict audio filter, honest missing-catalog fallback, no invented percentages or browser errors');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
