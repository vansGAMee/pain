/* Offline and batch audio analyzer for PAIN.
 * Computes complete, honest 72-frame acoustic profiles:
 * - 6D fundamental acoustic shape & variance
 * - 12D MFCC timbre & variance
 * - 7D octave-band instrument / spectral contrast detail
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
    for (let i = 0; i < N; i++) {
      real[bitRev[i]] = (samples[i] || 0) * blackman[i];
    }
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

  function analyzePcm(left, right, sampleRate, track) {
    if (!left || left.length < N || !sampleRate) return null;
    const duration = left.length / sampleRate;
    const step = Number.isFinite(duration) && duration > 0 ? Math.max(0.5, Math.ceil(duration / 360 * 2) / 2) : 0.5;
    const bodyPos = Number.isFinite(duration) && duration >= 40 ? Math.ceil(Math.max(20, duration * 0.35) / step) : Infinity;

    const positions = [];
    for (let i = 0; i < 48; i++) {
      if (i * step < duration) positions.push(i);
    }
    if (bodyPos !== Infinity) {
      for (let i = 0; i < 24; i++) {
        const p = bodyPos + i;
        if (p * step < duration && !positions.includes(p)) positions.push(p);
      }
    }

    let vector = [0, 0, 0, 0, 0, 0];
    let variance = [0, 0, 0, 0, 0, 0];
    let timbre = null;
    let timbreVariance = null;
    let frames = 0;
    let seconds = 0;

    const detailPositions = [];
    let detailMean = Array(7).fill(0);
    let detailFrames = 0;
    let detailSeconds = 0;

    const leftSlice = new Float32Array(N);
    const rightSlice = right && right.length >= left.length ? new Float32Array(N) : null;

    for (const pos of positions) {
      const sampleIdx = Math.floor(pos * step * sampleRate);
      if (sampleIdx + N > left.length) break;
      leftSlice.set(left.subarray(sampleIdx, sampleIdx + N));
      if (rightSlice) rightSlice.set(right.subarray(sampleIdx, sampleIdx + N));

      const channels = rightSlice ? [leftSlice, rightSlice] : [leftSlice];
      let frameVec = null, frameTone = null, frameInst = null;
      let totalP = 0, toneP = 0, instP = 0;

      for (const ch of channels) {
        let p = 0;
        for (let i = 0; i < N; i++) p += ch[i] * ch[i];
        if (p < 1e-7) continue;
        const db = computeSpectrumDb(ch);
        if (!db) continue;
        const v = AudioProfile.frame(ch, db, sampleRate);
        if (!v) continue;
        const tone = AudioTimbre ? AudioTimbre.frame(db, sampleRate) : null;
        const extra = detailFrames < 24 && AudioTimbre ? AudioTimbre.detail(ch, db, sampleRate) : null;

        if (!frameVec) frameVec = v;
        else frameVec = frameVec.map((x, j) => (x * totalP + v[j] * p) / (totalP + p));
        totalP += p;

        if (tone) {
          if (!frameTone) frameTone = tone;
          else frameTone = frameTone.map((x, j) => (x * toneP + tone[j] * p) / (toneP + p));
          toneP += p;
        }
        if (extra) {
          if (!frameInst) frameInst = extra;
          else frameInst = frameInst.map((x, j) => (x * instP + extra[j] * p) / (instP + p));
          instP += p;
        }
      }

      if (!frameVec) continue;

      const n = frames + 1;
      const mean = vector.map((v, i) => v + (frameVec[i] - v) / n);
      variance = variance.map((v, i) => Math.max(0, Math.min(0.25, (v * frames + (frameVec[i] - vector[i]) * (frameVec[i] - mean[i])) / n)));
      vector = mean;

      if (frameTone) {
        if (!frames) {
          timbre = frameTone;
          timbreVariance = Array(12).fill(0);
        } else if (timbre) {
          const next = timbre.map((v, i) => v + (frameTone[i] - v) / n);
          timbreVariance = timbreVariance.map((v, i) => Math.max(0, Math.min(0.25, (v * frames + (frameTone[i] - timbre[i]) * (frameTone[i] - next[i])) / n)));
          timbre = next;
        }
      }

      if (frameInst && detailFrames < 24) {
        const dPos = Math.floor(pos * step * 2);
        if (!detailPositions.includes(dPos)) {
          detailPositions.push(dPos);
          detailFrames++;
          detailSeconds += 0.5;
          detailMean = detailMean.map((v, i) => v + (frameInst[i] - v) / detailFrames);
        }
      }

      frames++;
      seconds += 0.5;
    }

    if (frames < 4) return null;

    const profile = {
      version: 4,
      signature: AudioProfile.signature(track),
      vector: vector.map(n => Math.round(n * 100000) / 100000),
      variance,
      timbre: timbre || null,
      timbreVariance: timbreVariance || null,
      frames,
      seconds,
      positions: positions.slice(0, frames),
      detail: {
        version: 1,
        mean: detailMean,
        frames: detailFrames,
        seconds: detailSeconds,
        positions: detailPositions
      },
      updatedAt: Date.now()
    };

    let bpm = null;
    const detectBpm = Queue?.detectBpmFromPcm;
    if (typeof detectBpm === "function") {
      try {
        const detected = detectBpm(left, sampleRate);
        if (detected && detected >= 60 && detected <= 200) bpm = Math.round(detected);
      } catch (_) {}
    }

    return { profile, bpm };
  }

  class BatchAnalyzer {
    constructor(options = {}) {
      this.phoneUrl = options.phoneUrl || "";
      this.status = "idle"; // idle, running, paused, done, error
      this.currentTrack = null;
      this.total = 0;
      this.completed = 0;
      this.queue = [];
      this.timer = null;
      this._stopRequested = false;
    }

    getStatus() {
      return {
        status: this.status,
        isRunning: this.status === "running",
        isPaused: this.status === "paused",
        currentTrack: this.currentTrack,
        completed: this.completed,
        total: this.total,
        percent: this.total > 0 ? Math.round((this.completed / this.total) * 100) : 0
      };
    }

    start(tracks, existingProfiles = {}, callbacks = {}) {
      if (this.status === "running") return;
      this._stopRequested = false;
      this.callbacks = callbacks;
      const overwrite = !!callbacks.overwriteExisting;

      // Filter tracks that need analysis
      this.queue = (tracks || []).filter(t => {
        if (!t || !t.id) return false;
        if (overwrite) return true;
        const p = existingProfiles[t.id];
        return !p || !AudioProfile.valid(p) || !AudioProfile.texture(p) || (p.detail?.frames || 0) < 20;
      });

      this.total = this.queue.length;
      this.completed = 0;
      this.status = this.total > 0 ? "running" : "done";

      if (this.total === 0) {
        if (this.callbacks.onComplete) this.callbacks.onComplete({ total: 0, completed: 0 });
        return;
      }

      this._notifyProgress();
      this._processNext();
    }

    pause() {
      if (this.status === "running") {
        this.status = "paused";
        clearTimeout(this.timer);
        this.timer = null;
        this._notifyProgress();
      }
    }

    resume() {
      if (this.status === "paused") {
        this.status = "running";
        this._notifyProgress();
        this._processNext();
      }
    }

    stop() {
      this._stopRequested = true;
      this.status = "idle";
      clearTimeout(this.timer);
      this.timer = null;
      this.currentTrack = null;
      this.queue = [];
      this._notifyProgress();
    }

    _notifyProgress() {
      if (this.callbacks.onProgress) {
        try { this.callbacks.onProgress(this.getStatus()); } catch (_) {}
      }
    }

    async _processNext() {
      if (this.status !== "running" || this._stopRequested) return;
      if (this.queue.length === 0) {
        this.status = "done";
        this.currentTrack = null;
        this._notifyProgress();
        if (this.callbacks.onComplete) {
          try { this.callbacks.onComplete({ total: this.total, completed: this.completed }); } catch (_) {}
        }
        return;
      }

      const track = this.queue.shift();
      this.currentTrack = track;
      this._notifyProgress();

      try {
        let profile = null;
        let bpm = null;
        const OfflineCtx = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
        const srcUrl = "/api/cached-track/" + encodeURIComponent(track.id) + "?phoneUrl=" + encodeURIComponent(this.phoneUrl || "");

        if (OfflineCtx) {
          try {
            const resp = await fetch(srcUrl);
            if (resp.ok || resp.status === 206) {
              const arrayBuffer = await resp.arrayBuffer();
              const maxSeconds = 90;
              const offlineCtx = new OfflineCtx(2, 44100 * maxSeconds, 44100);
              const audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer);
              const left = audioBuffer.getChannelData(0);
              const right = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : null;
              const result = analyzePcm(left, right, audioBuffer.sampleRate, track);
              if (result && result.profile) {
                profile = result.profile;
                bpm = result.bpm;
              }
            }
          } catch (_) {}
        }

        // Server fallback: if browser decode was unavailable or failed
        if (!profile && typeof fetch === "function") {
          try {
            const fallbackResp = await fetch("/api/analyze-track/" + encodeURIComponent(track.id), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ track })
            });
            if (fallbackResp.ok) {
              const data = await fallbackResp.json();
              if (data && data.profile) {
                profile = data.profile;
                bpm = data.bpm;
              }
            }
          } catch (_) {}
        }

        if (profile && this.callbacks.onTrackComplete) {
          try { this.callbacks.onTrackComplete(track, profile, bpm); } catch (_) {}
        }
      } catch (err) {
        // Individual decode errors do not abort the entire batch
      }

      this.completed++;
      if (this.queue.length === 0) {
        this.status = "done";
        this.currentTrack = null;
        this._notifyProgress();
        if (this.callbacks.onComplete) {
          try { this.callbacks.onComplete({ total: this.total, completed: this.completed }); } catch (_) {}
        }
        return;
      }
      this._notifyProgress();

      if (this.status === "running" && !this._stopRequested) {
        this.timer = setTimeout(() => this._processNext(), 20);
      }
    }
  }

  return {
    N,
    computeSpectrumDb,
    analyzePcm,
    BatchAnalyzer
  };
});
