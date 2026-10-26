#!/usr/bin/env node
'use strict';

// Read-only offline evaluation. Does not import the server, Electron or any store.
// JSON on stdout contains aggregate metrics only, never titles, paths or track IDs.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');

const DEFAULTS = Object.freeze({ trainFraction: 0.8, topK: [10, 50], queueStarts: 8, queueLength: 30 });
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const isComplete = play => play.finished === 1 || play.finished === true || play.completed === 1 || play.completed === true;
const stamp = play => Number(play.started || play.timestamp || 0);
const outcomeTime = play => {
  const started = stamp(play), recorded = Number(play.at || play.timestamp);
  return Number.isFinite(recorded) && recorded > started ? recorded : started + Math.max(0, Number(play.heard) || 0);
};
const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

function parseArgs(argv) {
  const result = { dataDir: path.resolve(__dirname, '../data'), sourceDir: path.resolve(__dirname, '../src'), ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help') { result.help = true; continue; }
    if (!['--data-dir', '--source-dir', '--train-fraction'].includes(arg) || !argv[i + 1]) throw new Error(`Unknown or incomplete option: ${arg}`);
    const value = argv[++i];
    if (arg === '--data-dir') result.dataDir = path.resolve(value);
    if (arg === '--source-dir') result.sourceDir = path.resolve(value);
    if (arg === '--train-fraction') result.trainFraction = Number(value);
  }
  if (!(result.trainFraction > 0 && result.trainFraction < 1)) throw new Error('--train-fraction must be between 0 and 1');
  return result;
}

function snapshot(directory) {
  const result = {};
  for (const name of fs.readdirSync(directory).sort()) {
    const file = path.join(directory, name);
    if (fs.statSync(file).isFile()) result[name] = hash(fs.readFileSync(file));
  }
  return result;
}

function readJson(directory, name, fallback) {
  const file = path.join(directory, name);
  if (!fs.existsSync(file)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Required input is missing: ${name}`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Deduplicate synchronised copies before splitting. A newer copy must not enter
// training while the same underlying play remains in the held-out suffix.
function canonicalEvents(plays, tracks) {
  const byId = new Set(tracks.map(track => String(track.id)));
  const events = new Map();
  const diagnostics = { input: plays.length, unknownTrack: 0, invalidTime: 0, duplicates: 0 };
  for (const play of plays) {
    if (!play || !byId.has(String(play.track))) { diagnostics.unknownTrack++; continue; }
    const started = stamp(play);
    if (!Number.isFinite(started) || started <= 0) { diagnostics.invalidTime++; continue; }
    const id = String(play.track), key = JSON.stringify([id, started]), old = events.get(key);
    const event = { ...play, track: id, started };
    if (old) {
      diagnostics.duplicates++;
      event.finished = Number(isComplete(old) || isComplete(play));
      for (const field of ['heard', 'media_heard', 'duration']) {
        const values = [old[field], play[field]].map(Number).filter(Number.isFinite);
        if (values.length) event[field] = Math.max(...values);
      }
      event.skipped = Number(old.skipped === 1 || old.skipped === true || play.skipped === 1 || play.skipped === true);
    }
    events.set(key, event);
  }
  return { events: [...events.values()].sort((a, b) => a.started - b.started || a.track.localeCompare(b.track)), diagnostics };
}

function temporalSplit(events, fraction) {
  if (events.length < 2) return null;
  const index = Math.min(events.length - 1, Math.max(1, Math.floor(events.length * fraction)));
  const cutoff = events[index].started;
  return { cutoff, train: events.filter(event => event.started < cutoff), test: events.filter(event => event.started >= cutoff) };
}

function rankMetrics(rank, candidateCount, topK) {
  const result = {};
  for (const k of topK) {
    result[`hit@${k}`] = rank > 0 && rank <= k ? 1 : 0;
    result[`ndcg@${k}`] = rank > 0 && rank <= k ? 1 / Math.log2(rank + 1) : 0;
    result[`mrr@${k}`] = rank > 0 && rank <= k ? 1 / rank : 0;
  }
  result.meanRank = rank;
  result.candidates = candidateCount;
  return result;
}

function randomMetrics(candidateCount, topK) {
  const result = {};
  for (const k of topK) {
    const n = Math.min(k, candidateCount);
    result[`hit@${k}`] = n / candidateCount;
    result[`ndcg@${k}`] = Array.from({ length: n }, (_, i) => 1 / Math.log2(i + 2)).reduce((a, b) => a + b, 0) / candidateCount;
    result[`mrr@${k}`] = Array.from({ length: n }, (_, i) => 1 / (i + 1)).reduce((a, b) => a + b, 0) / candidateCount;
  }
  result.meanRank = (candidateCount + 1) / 2;
  result.candidates = candidateCount;
  return result;
}

function aggregate(rows, topK) {
  if (!rows.length) return { queries: 0, metrics: null };
  const names = Object.keys(rows[0].metrics);
  const result = { queries: rows.length, metrics: Object.fromEntries(names.map(name => [name, mean(rows.map(row => row.metrics[name]))])) };
  for (const k of topK) {
    if (!rows.every(row => row.metrics[`hit@${k}`] === 0 || row.metrics[`hit@${k}`] === 1)) continue;
    const p = result.metrics[`hit@${k}`], n = rows.length, z = 1.959963984540054;
    const center = (p + z * z / (2 * n)) / (1 + z * z / n);
    const radius = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n);
    result[`hit@${k}Wilson95`] = [Math.max(0, center - radius), Math.min(1, center + radius)];
  }
  return result;
}

function evaluateHoldout({ tracks, events, profiles, excluded, Taste, Audio, options }) {
  const split = temporalSplit(events, options.trainFraction);
  if (!split || !split.train.length) return { status: 'insufficient-history' };
  const { cutoff, train, test } = split;
  // Favourite/exclusion change logs and past profile versions are not stored.
  // Mask current likes, retain current exclusions as an explicit evaluation scope,
  // and use only measurements already available at the training cutoff.
  const catalog = tracks.filter(track => !excluded.has(String(track.id)) && (!Number.isFinite(Number(track.added)) || Number(track.added) <= cutoff))
    .map(track => ({ ...track, id: String(track.id), favorite: false }));
  const historicalProfiles = Object.fromEntries(Object.entries(profiles).filter(([, profile]) => Number.isFinite(profile.updatedAt) && profile.updatedAt < cutoff));
  const byId = new Map(catalog.map(track => [track.id, track]));
  const training = train.filter(event => byId.has(event.track) && outcomeTime(event) < cutoff);
  const model = new Taste(catalog, training, cutoff - 1, historicalProfiles, { excludedTracks: excluded });
  const positiveCounts = new Map(), lastAccepted = new Map(), everHeard = new Set();
  for (const event of training) {
    everHeard.add(event.track);
    if (isComplete(event)) {
      positiveCounts.set(event.track, (positiveCounts.get(event.track) || 0) + 1);
      lastAccepted.set(event.track, event.started);
    }
  }
  const tieBreakers = new Map(catalog.map(track => [track.id, hash(track.id)]));
  const methods = { model: [], completedCount: [], lastCompleted: [], randomExpected: [] };
  const topIds = new Set();
  const invalid = { nonFiniteScores: 0, emptyReasons: 0, unsupportedAcousticReasons: 0 };
  const omitted = { notCompleted: 0, outsideCutoffCatalog: 0, immediateRepeat: 0, noCandidates: 0 };
  const latencies = [];
  let previous = train.at(-1);
  for (const event of test) {
    const current = byId.get(previous?.track) || null;
    previous = event;
    if (!isComplete(event)) { omitted.notCompleted++; continue; }
    if (!byId.has(event.track)) { omitted.outsideCutoffCatalog++; continue; }
    if (current?.id === event.track) { omitted.immediateRepeat++; continue; }
    const candidates = catalog.filter(track => track.id !== current?.id);
    if (!candidates.length) { omitted.noCandidates++; continue; }
    const started = performance.now();
    const scored = candidates.map(track => ({ track, ...model.score(current, track, {}, { hour: new Date(event.started).getHours() }) }));
    latencies.push(performance.now() - started);
    for (const row of scored) {
      if (!Number.isFinite(row.score)) invalid.nonFiniteScores++;
      if (!Array.isArray(row.reasons) || !row.reasons.length) invalid.emptyReasons++;
      if (row.reasons?.some(reason => /Близкое звучание|Звучание сохранённого вайба/.test(reason)) && row.soundSimilarity == null) invalid.unsupportedAcousticReasons++;
    }
    const rankBy = score => [...scored].sort((a, b) => score(b) - score(a) || tieBreakers.get(a.track.id).localeCompare(tieBreakers.get(b.track.id)));
    const ordered = {
      model: rankBy(row => row.score),
      completedCount: rankBy(row => positiveCounts.get(row.track.id) || 0),
      lastCompleted: rankBy(row => lastAccepted.get(row.track.id) || 0)
    };
    ordered.model.slice(0, options.topK[0]).forEach(row => topIds.add(row.track.id));
    for (const [name, rows] of Object.entries(ordered)) methods[name].push({ seen: everHeard.has(event.track), metrics: rankMetrics(rows.findIndex(row => row.track.id === event.track) + 1, candidates.length, options.topK) });
    methods.randomExpected.push({ seen: everHeard.has(event.track), metrics: randomMetrics(candidates.length, options.topK) });
  }
  latencies.sort((a, b) => a - b);
  return {
    status: 'evaluated', cutoff: new Date(cutoff).toISOString(), trainingEvents: training.length, heldOutEvents: test.length,
    excludedTrainingOutcomesAfterCutoff: train.filter(event => outcomeTime(event) >= cutoff).length,
    candidateCatalog: catalog.length, historicalAudioProfiles: catalog.filter(track => Audio.get(historicalProfiles, track)).length,
    targetDefinition: 'Explicit finished/completed flag only; other events supply preceding-track context, never held-out training labels.',
    omitted, invalid, top10CatalogCoverage: catalog.length ? topIds.size / catalog.length : null,
    scoreAllCandidatesMilliseconds: { median: latencies[Math.floor(latencies.length / 2)] ?? null, p95: latencies[Math.floor(latencies.length * 0.95)] ?? null },
    methods: Object.fromEntries(Object.entries(methods).map(([name, rows]) => [name, {
      all: aggregate(rows, options.topK), previouslyHeard: aggregate(rows.filter(row => row.seen), options.topK),
      unheard: aggregate(rows.filter(row => !row.seen), options.topK)
    }]))
  };
}

function evaluateQueue({ tracks, events, profiles, excluded, Taste, QueueEngine, options }) {
  const allowed = tracks.filter(track => !excluded.has(String(track.id)));
  if (!allowed.length) return { status: 'empty-catalog' };
  const now = (events.at(-1)?.started || Date.now()) + 1;
  const catalogIds = new Set(tracks.map(track => String(track.id))), chosenIds = new Set(), artists = new Set();
  const checks = { transitions: 0, previewMismatches: 0, exclusionViolations: 0, outOfCatalog: 0, repeatedWithinCycle: 0, immediateArtistRepeats: 0, missingExplanations: 0, nonFiniteScores: 0 };
  for (let i = 0; i < Math.min(options.queueStarts, allowed.length); i++) {
    const start = allowed[Math.floor(i * allowed.length / Math.min(options.queueStarts, allowed.length))];
    const queue = new QueueEngine({ shuffleMode: 'smart', loopMode: 'all', stats: { plays: events }, audioProfiles: profiles, excludedTracks: excluded, now: () => now });
    queue.smartSeed = i + 1;
    queue.setContext('library', tracks, tracks.indexOf(start), 'Evaluation', true);
    const seen = new Set([String(start.id)]);
    let previous = start;
    for (let step = 0; step < Math.min(options.queueLength, allowed.length - 1); step++) {
      const decision = queue.smartChoose(queue.getCurrentTrack(), queue.smartCandidates());
      const preview = queue.peekNext(), next = queue.next();
      checks.transitions++;
      if (!next) { checks.outOfCatalog++; break; }
      const id = String(next.id);
      if (preview?.id !== next.id) checks.previewMismatches++;
      if (excluded.has(id)) checks.exclusionViolations++;
      if (!catalogIds.has(id)) checks.outOfCatalog++;
      if (seen.has(id)) checks.repeatedWithinCycle++;
      const artist = Taste.artistIdentity(next);
      if (artist && artist === Taste.artistIdentity(previous)) checks.immediateArtistRepeats++;
      if (artist) artists.add(artist);
      if (!decision?.reasons?.length) checks.missingExplanations++;
      if (!Number.isFinite(decision?.score)) checks.nonFiniteScores++;
      seen.add(id); chosenIds.add(id); previous = next;
    }
  }
  return { status: 'evaluated', ...checks, uniqueTracks: chosenIds.size, uniqueArtists: artists.size, catalogCoverage: chosenIds.size / allowed.length,
    interpretation: 'Current-state functional and diversity checks, not listening satisfaction or offline relevance metrics.' };
}

function evaluate(options) {
  const before = snapshot(options.dataDir);
  const Taste = require(path.join(options.sourceDir, 'recommendation-model.js'));
  const Audio = require(path.join(options.sourceDir, 'audio-profile.js'));
  const { QueueEngine } = require(path.join(options.sourceDir, 'queue-engine.js'));
  const tracks = readJson(options.dataDir, 'library.json').tracks || [];
  const rawPlays = readJson(options.dataDir, 'stats.json', { plays: [] }).plays || [];
  const rawProfiles = readJson(options.dataDir, 'dj-state.json', { profiles: {} }).profiles || {};
  const profiles = Audio.restore(JSON.stringify(rawProfiles));
  const exclusions = readJson(options.dataDir, 'excluded-tracks.json', []);
  const excluded = new Set((Array.isArray(exclusions) ? exclusions : exclusions.tracks || []).map(String));
  const { events, diagnostics } = canonicalEvents(rawPlays, tracks);
  const context = { tracks, events, profiles, excluded, Taste, Audio, QueueEngine, options };
  const report = {
    protocolVersion: 1, configuration: { trainFraction: options.trainFraction, topK: options.topK, queueStarts: options.queueStarts, queueLength: options.queueLength, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    sourceSha256: Object.fromEntries(['recommendation-model.js', 'audio-profile.js', 'queue-engine.js', 'session-graph.js'].map(name => [name, hash(fs.readFileSync(path.join(options.sourceDir, name)))])),
    data: { tracks: tracks.length, allowedTracks: tracks.filter(track => !excluded.has(String(track.id))).length, events: events.length, ...diagnostics,
      completedEvents: events.filter(isComplete).length, mediaCoverageEvents: events.filter(event => event.media_heard != null).length,
      firstEvent: events.length ? new Date(events[0].started).toISOString() : null, lastEvent: events.length ? new Date(events.at(-1).started).toISOString() : null },
    audio: { rawProfiles: Object.keys(rawProfiles).length, validStoredProfiles: Object.keys(profiles).length,
      signatureMatchingProfiles: tracks.filter(track => Audio.get(profiles, track)).length,
      timbreProfiles: tracks.filter(track => Audio.texture(Audio.get(profiles, track))).length,
      detailProfiles: tracks.filter(track => Audio.detail(Audio.get(profiles, track))).length,
      limitation: 'Schema, file signature and finite-vector checks only; no claim that a profile captures perceived musical similarity.' },
    holdout: evaluateHoldout(context), queue: evaluateQueue(context),
    limitations: [
      'A single listener and a short observation window do not establish quality for other listeners or parity with Spotify.',
      'Logged completions are implicit outcomes, not labels for unplayed songs; next-track retrieval is only a proxy for recommendation quality.',
      'The historical policy, manual selections and repeated sessions bias these logs; this is not a randomized comparison or causal estimate.',
      'The temporal test does not train on held-out events. Current favourites are masked; current exclusions define scope; only pre-cutoff audio profiles are used.',
      'Training outcomes recorded after the cutoff are omitted. Where an event has no completion timestamp, started + heard is the available proxy; unlogged pauses cannot be reconstructed.',
      'Rank metrics evaluate score(), while queue invariants exercise choose()/QueueEngine. Stochastic playback ranking is not equivalent to deterministic retrieval.',
      'Wilson intervals describe event counts only and ignore dependence between events from the same listener/session.',
      'Input integrity covers the top-level files in the supplied data directory. The evaluator never writes user state or touches media files.'
    ]
  };
  const after = snapshot(options.dataDir);
  report.integrity = { verifiedFiles: Object.keys(before).length, unchanged: JSON.stringify(before) === JSON.stringify(after), snapshotSha256: hash(JSON.stringify(before)) };
  if (!report.integrity.unchanged) throw new Error('Input data changed during evaluation; no result can be certified. Another running client may have written it.');
  return report;
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) console.log('node desktop/test/evaluate-recommendations.cjs [--data-dir DIR] [--source-dir DIR] [--train-fraction 0.8]\nRead-only; aggregate JSON report on stdout. Source directory must contain pure recommendation modules.');
    else console.log(JSON.stringify(evaluate(options), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { canonicalEvents, temporalSplit, rankMetrics, randomMetrics, parseArgs, evaluate };
