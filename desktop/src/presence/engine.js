/**
 * Pain Audio Companion — Presence Engine: Main Orchestrator
 * Ties together Signals, Baselines, Detectors, Generative Grammar, and Memory.
 * Zero external calls, zero telemetry, zero template pickers.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const Signals = require('./signals');
    const Baselines = require('./baselines');
    const Detectors = require('./detectors');
    const Grammar = require('./grammar');
    const Memory = require('./memory');
    module.exports = factory(Signals, Baselines, Detectors, Grammar, Memory);
  } else {
    root.PresenceEngine = factory(
      root.PresenceSignals,
      root.PresenceBaselines,
      root.PresenceDetectors,
      root.PresenceGrammar,
      root.PresenceMemory
    );
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (
  Signals,
  Baselines,
  Detectors,
  Grammar,
  Memory
) {
  'use strict';

  // Shared persistent memory store
  const globalMemory = new Memory.MemoryStore();
  let lastDebugExplanation = null;

  /**
   * Mulberry32 PRNG for deterministic seeded runs (Rule #49)
   */
  function createPrng(seed = null) {
    if (typeof seed !== 'number') {
      return {
        random: () => Math.random(),
        pick: (arr) => (arr && arr.length > 0 ? arr[Math.floor(Math.random() * arr.length)] : null)
      };
    }
    let s = (Math.abs(seed) || 12345) >>> 0;
    function next() {
      s |= 0;
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    return {
      random: next,
      pick: (arr) => (arr && arr.length > 0 ? arr[Math.floor(next() * arr.length)] : null)
    };
  }

  /**
   * Appropriate contextual icon for the greeting
   */
  function pickIconForIntent(intent, hour) {
    if (intent === 'late_night' || intent === 'compound_night_and_artist') return '🌙';
    if (intent === 'early_morning') return '☕';
    if (intent === 'single_track_loop') return '🔁';
    if (intent === 'streak' || intent === 'compound_streak_and_pace') return '⚡';
    if (intent === 'artist_monopoly' || intent === 'artist_return') return '🎧';
    if (intent === 'welcome_back') return '👋';
    if (intent === 'deep_focus') return '🌊';
    if (intent === 'skip_streak') return '🧭';
    if (hour >= 5 && hour < 12) return '☕';
    if (hour >= 12 && hour < 18) return '☀️';
    if (hour >= 18 && hour < 23) return '🌙';
    return '✨';
  }

  /**
   * Main generation pipeline
   */
  function generateGreeting(tracks, stats, options = {}) {
    const memory = options.memory || globalMemory;
    const rng = createPrng(options.seed);
    const now = typeof options.now === 'number' ? options.now : Date.now();
    const lang = options.lang || 'ru';

    // 1. Signal Extraction (Multi-timescale)
    const signals = Signals.extractSignals(tracks, stats, { now });

    // 2. Personal Baseline & Deviations
    const baseline = Baselines.computePersonalBaseline(signals);

    // 3. Observation Detectors (with Evidence validation)
    const plans = Detectors.detectObservations(signals, baseline, memory);

    // 4. Candidate Generation: expand each plan through Generative Grammar
    const allCandidates = [];
    for (let i = 0; i < plans.length; i++) {
      const plan = plans[i];
      const expanded = Grammar.expandPlan(plan, rng, 12);
      for (let j = 0; j < expanded.length; j++) {
        allCandidates.push(expanded[j]);
      }
    }

    // 5. Multi-factor Scoring & Filtering
    const scoredCandidates = [];
    const rejectedCandidates = [];

    for (let i = 0; i < allCandidates.length; i++) {
      const cand = allCandidates[i];

      // Check lifetime anti-repeat (Rule #16)
      if (memory.hasExactHash(cand.text)) {
        rejectedCandidates.push({ text: cand.text, reason: 'lifetime_exact_repeat' });
        continue;
      }

      // Check near-repeat & fatigue penalties (Rules #15, #30, #31)
      const nearPenalty = memory.computeNearRepeatPenalty(cand);
      if (nearPenalty >= 999.0) {
        rejectedCandidates.push({ text: cand.text, reason: 'near_repeat_hard_rejection' });
        continue;
      }

      // Length penalty (Rule #63: keep short, 2-10 words)
      const wordsCount = cand.text.split(/\s+/).length;
      let lengthPenalty = 0;
      if (wordsCount > 10) lengthPenalty += 0.2;
      if (wordsCount > 14) lengthPenalty += 0.5;

      // Base surprise score from detector
      const surprise = cand.plan.surprise || 0.5;

      // Structural novelty: elliptical / direct / indirect variation
      let structuralBonus = 0.05;
      if (cand.form === 'ELLIPTICAL' || cand.form === 'COMPOUND') {
        structuralBonus = 0.15;
      }

      // Small jitter for natural variety among equally good plans
      const jitter = rng.random() * 0.08;

      const finalScore = Number((surprise + structuralBonus + jitter - nearPenalty - lengthPenalty).toFixed(3));

      scoredCandidates.push({
        ...cand,
        score: finalScore,
        metrics: {
          surprise,
          structuralBonus,
          nearPenalty,
          lengthPenalty,
          wordsCount
        }
      });
    }

    // Sort scored candidates descending
    scoredCandidates.sort((a, b) => b.score - a.score);

    // 6. Selection or Graceful Degradation (Rule #52)
    let selected = scoredCandidates.length > 0 ? scoredCandidates[0] : null;

    if (!selected) {
      // Graceful fallback to calm procedural neutral presence
      const hour = signals.hour;
      const neutralVariations = [
        'вечер',
        'тихий вечер',
        'спокойный вечер',
        'музыка фоном',
        'снова здесь',
        'тишина и звук'
      ];
      let fallbackText = rng.pick(neutralVariations);
      if (hour >= 0 && hour < 5) fallbackText = rng.pick(['тихая ночь', 'ночной звук', 'глубокая ночь', 'ночь']);
      else if (hour >= 5 && hour < 12) fallbackText = rng.pick(['утро', 'тихое утро', 'ранний старт', 'с утра с музыкой']);
      else if (hour >= 12 && hour < 18) fallbackText = rng.pick(['день', 'тихий день', 'музыка фоном', 'ровный день']);

      selected = {
        text: fallbackText,
        form: 'ELLIPTICAL',
        density: 'minimal',
        score: 0.1,
        plan: {
          intent: 'neutral_presence',
          surprise: 0.1,
          facts: { hour }
        }
      };
    }

    // 7. Commit chosen candidate to PresenceMemory (Rule #16)
    memory.recordShown(selected);

    const icon = pickIconForIntent(selected.plan.intent, signals.hour);

    // Save debug explanation record
    lastDebugExplanation = {
      selectedText: selected.text,
      icon,
      intent: selected.plan.intent,
      score: selected.score,
      plan: selected.plan,
      signalsSummary: {
        todayPlays: signals.today.count,
        sessionPlays: signals.session.count,
        totalPlays: signals.totalPlaysCount,
        streakDays: signals.streakDays,
        gapDays: signals.gapDays,
        hour: signals.hour,
        topArtistToday: signals.today.topArtist ? signals.today.topArtist.artist : null,
        topTrackToday: signals.today.topTrack ? signals.today.topTrack.title : null
      },
      baseline: {
        familiarity: baseline.familiarity,
        avgDailyTracks: baseline.avgDailyTracks,
        normalSkipRate: baseline.normalSkipRate
      },
      topCandidates: scoredCandidates.slice(0, 5).map(c => ({ text: c.text, score: c.score, intent: c.plan.intent })),
      rejectedCount: rejectedCandidates.length
    };

    return {
      text: selected.text,
      icon,
      intent: selected.plan.intent,
      score: selected.score,
      explain: lastDebugExplanation
    };
  }

  /**
   * Explain the last greeting decision for developers (Rule #50)
   */
  function explainLast() {
    return lastDebugExplanation;
  }

  /**
   * Dev Benchmark: Generate 100,000 candidate variants for a rich context (Rule #44 & #65).
   * Verifies generation entropy, structural variety, and natural language distribution.
   */
  function generatePresenceVariants(tracks, stats, count = 100000, options = {}) {
    const rng = createPrng(options.seed || 12345);
    const now = typeof options.now === 'number' ? options.now : Date.now();

    const signals = Signals.extractSignals(tracks, stats, { now });
    const baseline = Baselines.computePersonalBaseline(signals);
    const mockMem = new Memory.MemoryStore();
    const plans = Detectors.detectObservations(signals, baseline, mockMem);

    const textSet = new Set();
    const normalizedSet = new Set();
    const intentCounts = {};
    const lengthHistogram = { '1-3 words': 0, '4-7 words': 0, '8-11 words': 0, '12+ words': 0 };
    const openerCounts = {};
    const samples = [];

    // Pre-expand plans across all available syntactic rules
    const allCandidateTemplates = [];
    for (let p = 0; p < plans.length; p++) {
      const plan = plans[p];
      const expanded = Grammar.expandPlan(plan, rng, 20);
      for (let e = 0; e < expanded.length; e++) {
        allCandidateTemplates.push({
          plan,
          cand: expanded[e]
        });
      }
    }

    // Generate count samples
    for (let i = 0; i < count; i++) {
      const item = allCandidateTemplates[i % allCandidateTemplates.length];
      const plan = item.plan;
      const baseCand = item.cand;

      let text = baseCand.text;

      // Extract opener if present
      const firstWord = text.split(/\s+/)[0].replace(/[.,—]/g, '').toLowerCase();
      openerCounts[firstWord] = (openerCounts[firstWord] || 0) + 1;

      textSet.add(text);
      const norm = Memory.normalizeText(text);
      normalizedSet.add(norm);

      intentCounts[plan.intent] = (intentCounts[plan.intent] || 0) + 1;

      const words = text.split(/\s+/).length;
      if (words <= 3) lengthHistogram['1-3 words']++;
      else if (words <= 7) lengthHistogram['4-7 words']++;
      else if (words <= 11) lengthHistogram['8-11 words']++;
      else lengthHistogram['12+ words']++;

      if (samples.length < 100 && (i % Math.floor(count / 100) === 0)) {
        samples.push({ text, intent: plan.intent, form: baseCand.form });
      }
    }

    const uniqueCount = textSet.size;
    const exactDuplicates = count - uniqueCount;

    return {
      totalGenerated: count,
      uniqueCount,
      exactDuplicates,
      exactDuplicateRatePercent: Number(((exactDuplicates / count) * 100).toFixed(2)),
      normalizedUniqueCount: normalizedSet.size,
      intentDistribution: intentCounts,
      lengthDistribution: lengthHistogram,
      topOpeners: Object.fromEntries(
        Object.entries(openerCounts).sort((a, b) => b[1] - a[1]).slice(0, 10)
      ),
      samples: samples.slice(0, 100)
    };
  }

  /**
   * Generate 20 syntactically distinct variations of the exact same SemanticPlan (Rule #65)
   */
  function generateVariationsForPlan(plan, count = 20, seed = 42) {
    const rng = createPrng(seed);
    const uniqueMap = new Map();
    let attempts = 0;

    while (uniqueMap.size < count && attempts < 200) {
      attempts++;
      const expanded = Grammar.expandPlan(plan, rng, 8);
      for (let i = 0; i < expanded.length; i++) {
        const item = expanded[i];
        if (!uniqueMap.has(item.text)) {
          uniqueMap.set(item.text, {
            text: item.text,
            form: item.form,
            density: item.density
          });
        }
        if (uniqueMap.size >= count) break;
      }
    }

    return Array.from(uniqueMap.values()).slice(0, count);
  }

  /**
   * Simulate N variant generations across user history timeline (Rule #62 & Dev Generation Test)
   */
  function simulateVariants(tracks, stats, count = 1000, options = {}) {
    const isolatedMemory = new Memory.MemoryStore();
    const results = [];
    const textCounts = new Map();
    const intentCounts = new Map();

    const plays = (stats && Array.isArray(stats.plays) && stats.plays.length > 0)
      ? stats.plays.filter(p => p.started || p.timestamp)
      : [];

    for (let i = 0; i < count; i++) {
      // Sample timestamp context from historical timeline
      let virtualNow;
      if (plays.length > 0) {
        const playIndex = (i * 7) % plays.length;
        const p = plays[playIndex];
        virtualNow = (p.started || p.timestamp) + (i % 5) * 1800000;
      } else {
        virtualNow = Date.now() + i * 3600000;
      }

      const res = generateGreeting(tracks, stats, {
        now: virtualNow,
        memory: isolatedMemory,
        seed: options.seed ? options.seed + i : (1000 + i)
      });

      results.push(res);
      textCounts.set(res.text, (textCounts.get(res.text) || 0) + 1);
      intentCounts.set(res.intent, (intentCounts.get(res.intent) || 0) + 1);
    }

    let exactRepeats = 0;
    for (const [text, cnt] of textCounts) {
      if (cnt > 1) exactRepeats += (cnt - 1);
    }

    return {
      totalGenerated: count,
      uniqueCount: textCounts.size,
      exactRepeats,
      repeatRatePercent: Number(((exactRepeats / count) * 100).toFixed(2)),
      intentDistribution: Object.fromEntries(intentCounts),
      samples: results.slice(0, 20).map(r => r.text)
    };
  }

  return {
    generateGreeting,
    explainLast,
    generatePresenceVariants,
    generateVariationsForPlan,
    simulateVariants,
    getMemory: () => globalMemory
  };
});
