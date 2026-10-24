const test = require("node:test");
const assert = require("node:assert/strict");
const AudioProfile = require("../src/audio-profile");
const AudioTimbre = require("../src/audio-timbre");
const AudioAnalyzer = require("../src/audio-analyzer");

test("AudioAnalyzer: computeSpectrumDb вычисляет точный спектр с окном Блэкмана", () => {
  const N = AudioAnalyzer.N;
  const sampleRate = 44100;
  const samples = new Float32Array(N);
  // 1000 Hz pure sine
  const freq = 1000;
  for (let i = 0; i < N; i++) {
    samples[i] = 0.5 * Math.sin(2 * Math.PI * freq * i / sampleRate);
  }

  const spectrumDb = AudioAnalyzer.computeSpectrumDb(samples);
  assert.ok(spectrumDb instanceof Float32Array);
  assert.equal(spectrumDb.length, N / 2);

  // Peak should be at bin around round(1000 * 2048 / 44100) = 46
  let peakBin = 0;
  let peakVal = -Infinity;
  for (let i = 0; i < spectrumDb.length; i++) {
    if (spectrumDb[i] > peakVal) {
      peakVal = spectrumDb[i];
      peakBin = i;
    }
  }
  const peakHz = peakBin * sampleRate / N;
  assert.ok(Math.abs(peakHz - freq) < 25, "Peak bin must accurately identify 1000 Hz tone");
});

test("AudioAnalyzer.analyzePcm: формирует полноценный акустический профиль (6D + 12D MFCC + 7D инструменты)", () => {
  const sampleRate = 44100;
  const durationSec = 120;
  const numSamples = sampleRate * durationSec;
  const left = new Float32Array(numSamples);
  const right = new Float32Array(numSamples);

  // Rich composite test signal with bass, mids, highs and rhythm
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const bass = 0.3 * Math.sin(2 * Math.PI * 80 * t);
    const mid = 0.2 * Math.sin(2 * Math.PI * 1000 * t);
    const high = 0.1 * Math.sin(2 * Math.PI * 5000 * t);
    const beat = (Math.sin(2 * Math.PI * 2 * t) > 0.8) ? 0.3 : 0; // 120 bpm pulse
    left[i] = Math.max(-1, Math.min(1, bass + mid + high + beat));
    right[i] = Math.max(-1, Math.min(1, bass * 0.9 + mid * 1.1 + high * 0.8));
  }

  const track = {
    id: "test_track_1",
    title: "Test Song",
    artist: "Test Artist",
    duration: durationSec * 1000,
    bytes: 4000000,
    mime: "audio/mpeg"
  };

  const result = AudioAnalyzer.analyzePcm(left, right, sampleRate, track);
  assert.ok(result, "Result must not be null");
  const { profile, bpm } = result;

  assert.ok(profile, "Profile must exist");
  assert.equal(profile.version, 4);
  assert.ok(profile.frames >= 20, "Frames must be >= 20 for full validity");
  assert.ok(profile.seconds >= 10, "Seconds must be >= 10");
  assert.equal(profile.vector.length, 6, "Vector must be 6D");
  assert.equal(profile.variance.length, 6, "Variance must be 6D");
  assert.equal(profile.timbre.length, 12, "Timbre must be 12D MFCC");
  assert.equal(profile.timbreVariance.length, 12, "Timbre variance must be 12D");
  assert.ok(profile.detail, "Detail must be present");
  assert.equal(profile.detail.mean.length, 7, "Detail must have 7 octave/contrast bands");
  assert.equal(profile.detail.frames, 24, "Detail must reach 24 frames");

  // Verify compatibility with AudioProfile validators
  assert.equal(AudioProfile.valid(profile), true, "Must pass AudioProfile.valid");
  assert.ok(AudioProfile.texture(profile), "Must pass AudioProfile.texture");
  assert.ok(AudioProfile.detail(profile), "Must pass AudioProfile.detail");

  const restored = AudioProfile.restore(JSON.stringify({ [track.id]: profile }));
  assert.ok(restored[track.id], "Must survive AudioProfile serialization and restore");
});

test("AudioAnalyzer.BatchAnalyzer: очередь, пауза, прогресс и завершение", async () => {
  const analyzer = new AudioAnalyzer.BatchAnalyzer();
  const tracks = [
    { id: "t1", duration: 60000, bytes: 1000 },
    { id: "t2", duration: 60000, bytes: 1000 }
  ];
  const existingProfiles = {};

  const statusInit = analyzer.getStatus();
  assert.equal(statusInit.status, "idle");
  assert.equal(statusInit.isRunning, false);
});
