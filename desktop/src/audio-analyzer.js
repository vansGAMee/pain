/* Offline and batch audio analyzer for PAIN.
 * Samples measured acoustic descriptors across the complete decoded track:
 * - 6D fundamental acoustic shape & variance
 * - 12D MFCC timbre & variance
 * - 7D spectral contrast and short-time envelope detail
 * - Peak-onset tempo (BPM) detection
 */
(function(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("./audio-profile"),
      require("./audio-timbre"),
      require("./queue-engine")
    );
  } else {
    root.AudioAnalyzer = factory(
      root.AudioProfile,
      root.AudioTimbre,
      root.QueueEngine
    );
  }
})(globalThis, (AudioProfile, AudioTimbre, QueueModule) => {
  const Queue = QueueModule?.QueueEngine || QueueModule || globalThis.QueueEngine;
  const N = 2048;
  const cosTable = new Float32Array(N / 2);
  const sinTable = new Float32Array(N / 2);
  for (let i = 0; i < N / 2; i++) {
    cosTable[i] = Math.cos(-2 * Math.PI * i / N);
    sinTable[i] = Math.sin(-2 * Math.PI * i / N);
  }
  const blackman = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    blackman[i] = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / N) + 0.08 * Math.cos(4 * Math.PI * i / N);
  }
  const bitRev = new Uint16Array(N);
  for (let i = 0; i < N; i++) {
    let rev = 0;
    for (let j = 0; j < 11; j++) {
      if ((i >> j) & 1) rev |= (1 << (10 - j));
    }
    bitRev[i] = rev;
  }

  function computeSpectrumDb(samples) {
    if (!samples || samples.length < N) return null;
    const real = new Float32Array(N);
    const imag = new Float32Array(N);
    let mean = 0;
    for (let i = 0; i < N; i++) { if (!Number.isFinite(samples[i])) return null; mean += samples[i]; }
    mean /= N;
    for (let i = 0; i < N; i++) real[bitRev[i]] = (samples[i] - mean) * blackman[i];
    for (let len = 2; len <= N; len <<= 1) {
      const half = len >> 1;
      const step = N / len;
      for (let i = 0; i < N; i += len) {
        for (let j = 0; j < half; j++) {
          const k = j * step;
          const c = cosTable[k];
          const s = sinTable[k];
          const uR = real[i + j];
          const uI = imag[i + j];
          const vR = real[i + j + half] * c - imag[i + j + half] * s;
          const vI = real[i + j + half] * s + imag[i + j + half] * c;
          real[i + j] = uR + vR;
          imag[i + j] = uI + vI;
          real[i + j + half] = uR - vR;
          imag[i + j + half] = uI - vI;
        }
      }
    }
    const outDb = new Float32Array(N / 2);
    for (let i = 0; i < N / 2; i++) {
      const mag = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]) / N;
      outDb[i] = mag > 1e-6 ? 20 * Math.log10(mag) : -120;
    }
    return outDb;
  }

  // Resource budgets, not musical labels or relevance-score parameters.
  const MAX_WINDOWS = 72;
  const WINDOW_SECONDS = 0.5;
  const MAX_DETAIL_WINDOWS = 24;
  const MAX_POSITION_BINS = 360; // Same position grid as playback profile v4.

  function planWindows(sampleCount, sampleRate) {
    if (!Number.isSafeInteger(sampleCount) || sampleCount < N || !Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 384000) return null;
    const duration = sampleCount / sampleRate;
    const step = Math.max(WINDOW_SECONDS, Math.ceil(duration / MAX_POSITION_BINS / WINDOW_SECONDS) * WINDOW_SECONDS);
    const windowSamples = Math.min(sampleCount, Math.floor(WINDOW_SECONDS * sampleRate));
    const lastPosition = Math.floor((sampleCount - windowSamples) / (step * sampleRate));
    const count = Math.min(MAX_WINDOWS, lastPosition + 1);
    const windows = Array.from({ length: count }, (_, i) => {
      const position = count === 1 ? 0 : Math.round(i * lastPosition / (count - 1));
      return { position, sourceStart: Math.floor(position * step * sampleRate), sampleCount: windowSamples };
    });
    return { duration, step, windows };
  }

  function moments(size) {
    return { count: 0, mean: Array(size).fill(0), variance: Array(size).fill(0) };
  }
  function addMoment(stats, values) {
    const count = ++stats.count;
    for (let i = 0; i < stats.mean.length; i++) {
      const delta = values[i] - stats.mean[i];
      stats.mean[i] += delta / count;
      stats.variance[i] = Math.max(0, (stats.variance[i] * (count - 1) + delta * (values[i] - stats.mean[i])) / count);
    }
  }

  // sampling is provided only by the streaming server decoder. Its input PCM
  // contains the planned windows packed together, with original positions kept.
  function analyzePcm(left, right, sampleRate, track, sampling = null) {
    if (!left || left.length < N) return null;
    const plan = sampling || planWindows(left.length, sampleRate);
    if (!plan || !Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 384000) return null;
    const acoustic = moments(6), tone = moments(12), accepted = [];
    let analyzedSamples = 0, analyzedFftFrames = 0;

    for (const window of plan.windows) {
      const start = window.packedStart ?? window.sourceStart;
      const end = Math.min(left.length, start + window.sampleCount);
      let samples = 0;
      const contrast = moments(7);
      for (let offset = start; offset + N <= end; offset += N) {
        const channels = [left.subarray(offset, offset + N)];
        if (right && right.length >= offset + N) channels.push(right.subarray(offset, offset + N));
        let vector = null, timbre = null, detail = null, power = 0, tonePower = 0, detailPower = 0;
        for (const channel of channels) {
          const db = computeSpectrumDb(channel);
          const v = db && AudioProfile.frame(channel, db, sampleRate);
          if (!v) continue;
          let p = 0; for (const x of channel) p += x * x;
          const t = AudioTimbre?.frame(db, sampleRate);
          const d = AudioTimbre?.detail(channel, db, sampleRate);
          vector = vector ? vector.map((x, i) => (x * power + v[i] * p) / (power + p)) : v;
          power += p;
          if (t) { timbre = timbre ? timbre.map((x, i) => (x * tonePower + t[i] * p) / (tonePower + p)) : t; tonePower += p; }
          if (d) { detail = detail ? detail.map((x, i) => (x * detailPower + d[i] * p) / (detailPower + p)) : d; detailPower += p; }
        }
        if (!vector) continue;
        addMoment(acoustic, vector);
        if (timbre) addMoment(tone, timbre);
        if (detail) addMoment(contrast, detail);
        samples += N;
        analyzedFftFrames++;
      }
      if (!samples) continue;
      analyzedSamples += samples;
      accepted.push({ ...window, samples, contrast });
    }
    if (accepted.length < 4) return null;

    const availableDetails = accepted.filter(w => w.contrast.count);
    const detailCount = Math.min(MAX_DETAIL_WINDOWS, availableDetails.length);
    const details = moments(7), detailPositions = [];
    let detailSeconds = 0;
    for (let i = 0; i < detailCount; i++) {
      const index = detailCount === 1 ? 0 : Math.round(i * (availableDetails.length - 1) / (detailCount - 1));
      const window = availableDetails[index];
      addMoment(details, window.contrast.mean);
      detailPositions.push(Math.floor(window.sourceStart / sampleRate / WINDOW_SECONDS));
      detailSeconds += window.sampleCount ? window.sampleCount / sampleRate : WINDOW_SECONDS;
    }
    const profile = {
      version: 4,
      signature: AudioProfile.signature(track),
      vector: acoustic.mean,
      variance: acoustic.variance,
      timbre: tone.count ? tone.mean : null,
      timbreVariance: tone.count ? tone.variance : null,
      frames: accepted.length,
      // Actual non-overlapping PCM measured, not time elapsed between snapshots.
      seconds: analyzedSamples / sampleRate,
      positions: accepted.map(w => w.position),
      detail: { version: 1, mean: details.mean, frames: detailCount, seconds: detailSeconds, positions: detailPositions },
      analysis: {
        method: "stratified-pcm-v1", sampleRate, fftSize: N,
        fftFrames: analyzedFftFrames, duration: plan.duration,
        firstSecond: accepted[0].sourceStart / sampleRate,
        lastSecond: (accepted.at(-1).sourceStart + accepted.at(-1).sampleCount) / sampleRate
      },
      updatedAt: Date.now()
    };

    // Concatenated excerpts have artificial boundaries; never infer tempo from
    // their joins. Server results leave BPM unknown instead of fabricating it.
    let bpm = null;
    if (!sampling && typeof Queue?.detectBpmFromPcm === "function") {
      try { const detected = Queue.detectBpmFromPcm(left, sampleRate); if (Number.isFinite(detected) && detected > 0) bpm = Math.round(detected); } catch (_) {}
    }
    return { profile, bpm };
  }

  function complete(profile, track) {
    if (!profile || !track) return false;
    if (!AudioProfile.get({ [track.id]: profile }, track)) return false;
    const hasTexture = !!AudioProfile.texture(profile);
    const hasDetail = !!AudioProfile.detail(profile);
    return hasTexture && hasDetail;
  }

  class BatchAnalyzer {
    constructor(options = {}) {
      this.phoneUrl = options.phoneUrl || "";
      this.status = "idle";
      this.currentTrack = null;
      this.total = this.completed = this.succeeded = this.failed = 0;
      this.queue = [];
      this.timer = null;
      this.callbacks = {};
      this._generation = 0;
      this._inFlight = null;
    }
    getStatus() {
      return {
        status: this.status, isRunning: this.status === "running", isPaused: this.status === "paused",
        currentTrack: this.currentTrack, completed: this.completed, total: this.total,
        succeeded: this.succeeded, failed: this.failed,
        percent: this.total > 0 ? Math.round(this.completed / this.total * 100) : 0
      };
    }
    start(tracks, existingProfiles = {}, callbacks = {}) {
      if (this.status === "running" || this.status === "paused") return;
      this._generation++;
      this.callbacks = callbacks;
      this.queue = (tracks || []).filter(t => t && t.id != null && (callbacks.overwriteExisting || !complete(existingProfiles[t.id], t)));
      this.total = this.queue.length;
      this.completed = this.succeeded = this.failed = 0;
      this.status = "running";
      this._notifyProgress();
      this._processNext();
    }
    pause() {
      if (this.status !== "running") return;
      this.status = "paused";
      clearTimeout(this.timer); this.timer = null;
      this._notifyProgress();
    }
    resume() {
      if (this.status !== "paused") return;
      this.status = "running";
      this._notifyProgress();
      this._processNext();
    }
    stop() {
      this._generation++;
      this._inFlight?.controller.abort();
      this._inFlight = null;
      this.status = "idle";
      clearTimeout(this.timer); this.timer = null;
      this.currentTrack = null;
      this.queue = [];
      this._notifyProgress();
    }
    _notifyProgress() {
      try { this.callbacks.onProgress?.(this.getStatus()); } catch (_) {}
    }
    _finish() {
      this.status = this.failed && !this.succeeded ? "error" : "done";
      this.currentTrack = null;
      this._notifyProgress();
      try { this.callbacks.onComplete?.(this.getStatus()); } catch (_) {}
    }
    async _processNext() {
      if (this.status !== "running" || this._inFlight) return;
      if (!this.queue.length) { this._finish(); return; }
      const track = this.queue.shift();
      const run = { generation: this._generation, controller: new AbortController() };
      const callbacks = this.callbacks;
      this._inFlight = run;
      this.currentTrack = track;
      this._notifyProgress();
      const active = () => this._generation === run.generation && this._inFlight === run;
      let result = null, failure = null;
      try {
        const force = callbacks.overwriteExisting ? "?force=1" : "";

        // 1. Prefer server-side analysis via ffmpeg.
        // The server streams audio with bounded memory (<= 16MB) and extracts only
        // the 72 necessary FFT windows, preventing OOM crashes on long tracks or large files.
        try {
          const response = await fetch("/api/analyze-track/" + encodeURIComponent(track.id) + force, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ track }), signal: run.controller.signal
          });
          if (response.ok && active()) {
            const data = await response.json();
            if (complete(data?.profile, track)) {
              result = data;
            }
          } else if (response.status !== 404 && response.status !== 502) {
            let errJson;
            try { errJson = await response.json(); } catch (_) {}
            failure = new Error(errJson?.error || "Audio analysis failed (HTTP " + response.status + ")");
          }
        } catch (error) {
          if (error.name === "AbortError") throw error;
          failure = error;
        }

        if (!active()) return;

        // 2. If the track was not yet cached on the server disk (404), fetch it so the server
        // writes it into cache, then re-try server analysis.
        if (!result && (!failure || failure.message?.includes("404"))) {
          try {
            const cacheResponse = await fetch("/api/cached-track/" + encodeURIComponent(track.id) + "?phoneUrl=" + encodeURIComponent(this.phoneUrl), { signal: run.controller.signal });
            if (cacheResponse.ok && active()) {
              // Now that the file is written to server cache, re-attempt server analysis
              try {
                const srvRetry = await fetch("/api/analyze-track/" + encodeURIComponent(track.id) + force, {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ track }), signal: run.controller.signal
                });
                if (srvRetry.ok && active()) {
                  const srvData = await srvRetry.json();
                  if (complete(srvData?.profile, track)) {
                    result = srvData;
                  }
                }
              } catch (_) {}

              // 3. Fallback: in-browser OfflineAudioContext (only for serverless web environments)
              if (!result && active()) {
                const OfflineCtx = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
                const isTooLarge = (track.duration && track.duration > 15 * 60 * 1000) ||
                                   (track.bytes && track.bytes > 30 * 1024 * 1024);
                if (OfflineCtx && !isTooLarge) {
                  const bytes = await cacheResponse.arrayBuffer();
                  if (active() && bytes && bytes.byteLength <= 30 * 1024 * 1024) {
                    const context = new OfflineCtx(2, 1, 44100);
                    const buffer = await context.decodeAudioData(bytes);
                    if (active()) {
                      result = analyzePcm(buffer.getChannelData(0), buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null, buffer.sampleRate, track);
                    }
                  }
                }
              }
            }
          } catch (error) {
            if (error.name === "AbortError") throw error;
            failure = error;
          }
        }

        if (!active()) return;
        if (!complete(result?.profile, track)) {
          throw failure || new Error("Audio analysis returned insufficient or stale evidence");
        }
        this.succeeded++;
        try { callbacks.onTrackComplete?.(track, result.profile, result.bpm ?? null); } catch (_) {}
      } catch (error) {
        if (!active()) return;
        failure = error;
        this.failed++;
        try { callbacks.onTrackError?.(track, failure); } catch (_) {}
      } finally {
        if (active()) {
          this._inFlight = null;
          this.completed++;
          this.currentTrack = null;
          this._notifyProgress();
          if (this.status === "running") {
            if (!this.queue.length) this._finish();
            else this.timer = setTimeout(() => { this.timer = null; this._processNext(); }, 0);
          }
        }
      }
    }
  }

  return {
    N,
    computeSpectrumDb,
    planWindows,
    complete,
    analyzePcm,
    BatchAnalyzer
  };
});
