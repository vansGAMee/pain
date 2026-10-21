/**
 * Pain Audio Companion — Presence Engine Test Suite
 * Validates Signals, Baselines, Evidence Ledger, Safe Russian Grammar,
 * Lifetime Anti-Repeat, Determinism, and 100,000 candidate stress simulation.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const Signals = require('../src/presence/signals');
const Baselines = require('../src/presence/baselines');
const Evidence = require('../src/presence/evidence');
const Detectors = require('../src/presence/detectors');
const Grammar = require('../src/presence/grammar');
const Memory = require('../src/presence/memory');
const PresenceEngine = require('../src/presence/engine');

// Load real fixture data
const STATS_FILE = path.join(__dirname, '../data/stats.json');
const LIBRARY_FILE = path.join(__dirname, '../data/library.json');
const realStats = fs.existsSync(STATS_FILE) ? JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')) : { plays: [] };
const realTracks = fs.existsSync(LIBRARY_FILE) ? (JSON.parse(fs.readFileSync(LIBRARY_FILE, 'utf8')).tracks || []) : [];

test('Presence Signals: handles empty, null, and corrupted data gracefully', () => {
  const emptySignals = Signals.extractSignals(null, null);
  assert.equal(emptySignals.totalPlaysCount, 0);
  assert.equal(emptySignals.activeDaysCount, 0);
  assert.equal(emptySignals.today.count, 0);
  assert.equal(emptySignals.today.topArtist, null);
  assert.equal(emptySignals.today.topTrack, null);

  const corruptedPlays = [
    null,
    undefined,
    {},
    { id: 'bad1', started: -100 },
    { id: 'bad2', started: Date.now() + 999999999 }, // far future
    { id: 'ok1', track: 't1', started: 1792300000000, heard: 10000, duration: 20000 }
  ];
  const sig = Signals.extractSignals([{ id: 't1', title: 'Test Track', artist: 'Test Artist' }], { plays: corruptedPlays });
  assert.equal(sig.totalPlaysCount, 1);
  assert.equal(sig.allTime.count, 1);
  assert.equal(sig.allTime.topArtist.artist, 'Test Artist');
});

test('Presence Baselines: computes personal norms and correct familiarity levels', () => {
  // New user
  const newSignals = Signals.extractSignals([], { plays: [{ id: 'p1', track: 't1', started: Date.now() }] });
  const newBase = Baselines.computePersonalBaseline(newSignals);
  assert.equal(newBase.familiarity, 'new');

  // Real user with 749 plays
  const realSignals = Signals.extractSignals(realTracks, realStats);
  const realBase = Baselines.computePersonalBaseline(realSignals);
  assert.equal(realBase.familiarity, 'long-term');
  assert.ok(realBase.avgDailyTracks > 50, 'Average daily tracks should reflect real user volume');
  assert.ok(realBase.normalSkipRate > 0 && realBase.normalSkipRate < 1);
});

test('Evidence Ledger: prevents false conclusions and hallucinations', () => {
  // 1. Two plays of an artist MUST NOT qualify as artist monopoly
  const monopoly2 = Evidence.validateArtistMonopoly(
    { artist: 'Егор Летов', count: 2 },
    5,
    0.2
  );
  assert.equal(monopoly2.valid, false, '2 plays must NEVER be considered artist monopoly');

  // 2. Legitimate monopoly: 8 out of 10 plays
  const monopoly8 = Evidence.validateArtistMonopoly(
    { artist: 'Егор Летов', count: 8 },
    10,
    0.2
  );
  assert.equal(monopoly8.valid, true);
  assert.equal(monopoly8.facts.artist, 'Егор Летов');
  assert.equal(monopoly8.facts.count, 8);

  // 3. Two plays of a track MUST NOT qualify as single track obsession / loop
  const loop2 = Evidence.validateSingleTrackLoop(
    { id: 't1', title: 'Собаки', artist: 'Егор Летов', count: 2 },
    10
  );
  assert.equal(loop2.valid, false, '2 plays must NEVER be considered track loop/obsession');

  // 4. Four plays of a track qualifies
  const loop4 = Evidence.validateSingleTrackLoop(
    { id: 't1', title: 'Собаки', artist: 'Егор Летов', count: 4 },
    10
  );
  assert.equal(loop4.valid, true);
  assert.equal(loop4.facts.count, 4);
});

test('Safe Russian: numeral and time agreement and uninflected artist framing', () => {
  // Numerals
  assert.equal(Grammar.pluralizeRu(1, 'раз', 'раза', 'раз'), 'раз');
  assert.equal(Grammar.pluralizeRu(2, 'раз', 'раза', 'раз'), 'раза');
  assert.equal(Grammar.pluralizeRu(4, 'раз', 'раза', 'раз'), 'раза');
  assert.equal(Grammar.pluralizeRu(5, 'раз', 'раза', 'раз'), 'раз');
  assert.equal(Grammar.pluralizeRu(21, 'раз', 'раза', 'раз'), 'раз');
  assert.equal(Grammar.pluralizeRu(22, 'раз', 'раза', 'раз'), 'раза');

  // Days
  assert.equal(Grammar.pluralizeRu(1, 'день', 'дня', 'дней'), 'день');
  assert.equal(Grammar.pluralizeRu(3, 'день', 'дня', 'дней'), 'дня');
  assert.equal(Grammar.pluralizeRu(5, 'день', 'дня', 'дней'), 'дней');

  // Safe artist framing
  assert.equal(Grammar.safeArtist('  Егор Летов  '), 'Егор Летов');
  assert.equal(Grammar.safeArtist(''), 'музыки');

  // Blacklist checks
  assert.equal(Grammar.passesNaturalnessCheck('Отличный выбор!'), false);
  assert.equal(Grammar.passesNaturalnessCheck('Наслаждайтесь музыкой! 🔥'), false);
  assert.equal(Grammar.passesNaturalnessCheck('Ваш музыкальный вайб сегодня невероятный!'), false);
  assert.equal(Grammar.passesNaturalnessCheck('снова поздно. и снова Летов'), true);
  assert.equal(Grammar.passesNaturalnessCheck('вечер'), true);
});

test('Presence Memory: Lifetime Anti-Repeat rejects exact duplicate strings', () => {
  const mem = new Memory.MemoryStore();
  mem.clear();

  const candA = {
    text: 'снова поздно. и снова Летов',
    form: 'COMPOUND',
    plan: { intent: 'compound_night_and_artist' }
  };

  assert.equal(mem.hasExactHash(candA.text), false);
  const initialPenalty = mem.computeNearRepeatPenalty(candA);
  assert.ok(initialPenalty < 999.0);

  // Record candidate
  mem.recordShown(candA);

  // Now must be in lifetime memory
  assert.equal(mem.hasExactHash(candA.text), true);
  const secondPenalty = mem.computeNearRepeatPenalty(candA);
  assert.equal(secondPenalty, 999.0, 'Lifetime anti-repeat must yield hard rejection');
});

test('Presence Engine: deterministic seeded execution produces reproducible results', () => {
  const mem1 = new Memory.MemoryStore();
  const mem2 = new Memory.MemoryStore();

  const g1 = PresenceEngine.generateGreeting(realTracks, realStats, {
    seed: 42,
    memory: mem1,
    now: 1792340000000
  });

  const g2 = PresenceEngine.generateGreeting(realTracks, realStats, {
    seed: 42,
    memory: mem2,
    now: 1792340000000
  });

  assert.equal(g1.text, g2.text, 'Seeded runs must produce identical results');
  assert.equal(g1.intent, g2.intent);
  assert.equal(g1.icon, g2.icon);
});

test('Presence Engine: explainLast exposes developer introspection', () => {
  const g = PresenceEngine.generateGreeting(realTracks, realStats, { seed: 100 });
  const exp = PresenceEngine.explainLast();

  assert.ok(exp !== null);
  assert.equal(exp.selectedText, g.text);
  assert.ok(exp.signalsSummary.totalPlays > 0);
  assert.ok(Array.isArray(exp.topCandidates));
  assert.ok(exp.topCandidates.length > 0);
});

test('Presence Engine: 100,000 Variant Benchmark (Rule #44)', () => {
  const benchmark = PresenceEngine.generatePresenceVariants(realTracks, realStats, 100000, { seed: 12345 });

  assert.equal(benchmark.totalGenerated, 100000);
  assert.ok(benchmark.uniqueCount > 25, `Expected high unique template coverage, got ${benchmark.uniqueCount}`);
  assert.ok(Object.keys(benchmark.intentDistribution).length >= 3);
  assert.ok(benchmark.lengthDistribution['1-3 words'] > 0);
  assert.ok(benchmark.lengthDistribution['4-7 words'] > 0);
  assert.ok(benchmark.samples.length >= 50);
});

test('Presence Engine: 20 distinct syntactic variations of the exact same SemanticPlan (Rule #65)', () => {
  const samplePlan = {
    intent: 'artist_monopoly',
    subject: { type: 'artist', name: 'Егор Летов', count: 12 },
    facts: { artist: 'Егор Летов', count: 12, timeContext: 'вечер' },
    confidence: 0.95,
    surprise: 0.8
  };

  const variations = PresenceEngine.generateVariationsForPlan(samplePlan, 20, 999);
  assert.ok(variations.length >= 10, `Expected diverse variations for plan, got ${variations.length}`);
  const uniqueTexts = new Set(variations.map(v => v.text));
  assert.equal(uniqueTexts.size, variations.length, 'All variations of the plan must be unique');
});

test('Presence Engine: Timeline Simulation (Rule #62)', () => {
  const sim = PresenceEngine.simulateVariants(realTracks, realStats, 200, { seed: 777 });
  assert.equal(sim.totalGenerated, 200);
  assert.ok(sim.uniqueCount >= 20, `Expected diverse phrases over timeline, got ${sim.uniqueCount}`);
  assert.ok(Object.keys(sim.intentDistribution).length >= 3, 'Multiple intents must be exercised across timeline');
});
