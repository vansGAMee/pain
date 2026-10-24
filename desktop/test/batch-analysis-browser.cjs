const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));

    const tracks = [
      { id: "trk1", title: "Track One", artist: "Artist A", duration: 30000, bytes: 40000 },
      { id: "trk2", title: "Track Two", artist: "Artist B", duration: 30000, bytes: 40000 },
      { id: "trk3", title: "Track Three", artist: "Artist C", duration: 30000, bytes: 40000 }
    ];

    const wav = Buffer.alloc(44 + 16000 * 30 * 2);
    wav.write("RIFF");
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(16000, 24);
    wav.writeUInt32LE(32000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(wav.length - 44, 40);
    for (let i = 0; i < 16000 * 30; i++) {
      wav.writeInt16LE(Math.round(2000 * Math.sin(i * 2 * Math.PI * 440 / 16000)), 44 + i * 2);
    }

    await page.route("**/*", async route => {
      const u = new URL(route.request().url());
      if (u.pathname.startsWith("/api/cached-track/")) {
        return route.fulfill({ status: 200, contentType: "audio/wav", body: wav });
      }
      if (u.pathname.startsWith("/api/")) {
        let data = [];
        if (u.pathname === "/api/saved-library") data = { tracks };
        else if (u.pathname === "/api/dj-state") data = { version: 1, profiles: {} };
        else if (u.pathname === "/api/saved-stats") data = { plays: [], slices: [] };
        else if (u.pathname === "/api/cached-tracks") data = { cached: ["trk1", "trk2", "trk3"] };
        else if (u.pathname === "/api/desktop-preferences") data = { autostart: false, tray: false };
        return route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
      }
      if (u.origin !== "http://pain.test") return route.abort();
      const file = u.pathname.startsWith("/assets/")
        ? path.join(__dirname, "..", u.pathname)
        : path.join(__dirname, "../src", u.pathname === "/" ? "index.html" : u.pathname);
      const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".ttf": "font/ttf" };
      try {
        await route.fulfill({ contentType: mime[path.extname(file)] || "application/octet-stream", body: await fs.readFile(file) });
      } catch (_) {
        await route.fulfill({ status: 404, body: "" });
      }
    });

    await page.addInitScript(() => {
      localStorage.setItem("pain_lang", "ru");
      localStorage.removeItem("pain_audio_profiles_v4");
    });

    await page.goto("http://pain.test");
    await page.waitForFunction(() => window.painQueue?.tracks?.length === 3);

    // Open Settings Modal
    await page.click("#settingsToggleBtn");
    await page.waitForSelector("#audioAnalysisSettingsSection", { state: "visible" });

    // Check initial state
    const label = await page.locator("#audioAnalysisCountLabel").textContent();
    assert.ok(label.includes("0 / 3"), "Initial label must indicate 0 / 3 analyzed");

    const startBtn = page.locator("#startAudioAnalysisBtn");
    const pauseBtn = page.locator("#pauseAudioAnalysisBtn");
    assert.ok(await startBtn.isVisible(), "Start button must be visible");

    // Click Analyze All
    await startBtn.click();

    // Check pause button appears while running
    await page.waitForFunction(() => {
      const p = document.getElementById("pauseAudioAnalysisBtn");
      return p && p.style.display !== "none";
    }, {}, { timeout: 5000 });

    // Click pause
    await pauseBtn.click();
    const pausedHint = await page.locator("#audioAnalysisCurrentTrack").textContent();
    assert.equal(pausedHint, "Анализ приостановлен");
    assert.equal(await startBtn.textContent(), "Продолжить");

    // Resume
    await startBtn.click();

    // Wait until analysis finishes (all 3 tracks)
    await page.waitForFunction(() => {
      const el = document.getElementById("audioAnalysisCountLabel");
      return el && el.textContent.includes("3 / 3 (100%)");
    }, {}, { timeout: 15000 });

    const finalLabel = await page.locator("#audioAnalysisCountLabel").textContent();
    assert.ok(finalLabel.includes("3 / 3 (100%)"), "Label must reach 3 / 3 (100%)");

    const finalHint = await page.locator("#audioAnalysisCurrentTrack").textContent();
    assert.equal(finalHint, "Все треки успешно проанализированы");

    const btnText = await startBtn.textContent();
    assert.equal(btnText, "Переанализировать всё");

    // Verify localStorage has profiles
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("pain_audio_profiles_v4") || "{}"));
    assert.ok(stored.trk1 && stored.trk1.frames >= 20, "trk1 profile must be persisted in localStorage");
    assert.ok(stored.trk2 && stored.trk2.frames >= 20, "trk2 profile must be persisted in localStorage");
    assert.ok(stored.trk3 && stored.trk3.frames >= 20, "trk3 profile must be persisted in localStorage");

    // Verify language toggle
    await page.click("#settingsDoneBtn");
    await page.click("#langToggle");
    await page.click("#settingsToggleBtn");

    const enLabel = await page.locator("#audioAnalysisCountLabel").textContent();
    assert.ok(enLabel.includes("Analyzed: 3 / 3 (100%)"), "EN label must be formatted in English");

    const enHint = await page.locator("#audioAnalysisCurrentTrack").textContent();
    assert.equal(enHint, "All tracks successfully analyzed");

    assert.equal(errors.length, 0, "No page errors should occur: " + errors.join("; "));
    console.log("PASS: batch audio analysis settings UI, pause/resume, progress bar, persistence and bilingual switching");
  } finally {
    await browser.close();
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
