/**
 * Pain Audio Companion — Presence Engine: Presence Memory Module
 * Manages lifetime anti-repeat hash storage, near-repeat detection,
 * structural fingerprint tracking, detector fatigue, and lexical cooldowns.
 * Strictly respects Rules #14, #15, #16, #20, #21, #30, #31, #58, #59.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PresenceMemory = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STORAGE_KEY = 'pain_presence_memory';
  const MAX_RECENT_MESSAGES = 40;
  const MAX_SHOWN_HASHES = 3000;

  const FATIGUE_MARKERS = ['снова', 'опять', 'кажется', 'похоже', 'сегодня', 'явно', 'вернулся'];

  /**
   * Fast 32-bit FNV-1a Hash for string deduplication
   */
  function fnv1a(str) {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  /**
   * Normalize text for deduplication: lowercase, strip punctuation and extra spaces
   */
  function normalizeText(text) {
    if (!text) return '';
    return text.toLowerCase().replace(/[.,—:!?]/g, '').trim().replace(/\s+/g, ' ');
  }

  /**
   * Jaccard word similarity between two normalized strings
   */
  function jaccardSimilarity(textA, textB) {
    const wordsA = new Set(textA.split(' ').filter(w => w.length > 2));
    const wordsB = new Set(textB.split(' ').filter(w => w.length > 2));
    if (wordsA.size === 0 || wordsB.size === 0) return 0;

    let intersection = 0;
    for (const w of wordsA) {
      if (wordsB.has(w)) intersection++;
    }
    const union = wordsA.size + wordsB.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  /**
   * Safe localStorage helper with in-memory fallback
   */
  class MemoryStore {
    constructor() {
      this.isBrowser = typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
      this.state = this._load();
    }

    _load() {
      if (this.isBrowser) {
        try {
          const raw = window.localStorage.getItem(STORAGE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            return {
              shownHashes: Array.isArray(parsed.shownHashes) ? parsed.shownHashes : [],
              recentMessages: Array.isArray(parsed.recentMessages) ? parsed.recentMessages : [],
              detectorCooldowns: parsed.detectorCooldowns || {},
              lastTopic: parsed.lastTopic || null
            };
          }
        } catch (_) {}
      }
      return {
        shownHashes: [],
        recentMessages: [],
        detectorCooldowns: {},
        lastTopic: null
      };
    }

    _save() {
      if (!this.isBrowser) return;
      try {
        // Enforce bounds before saving (Rule #59: bounded memory)
        if (this.state.shownHashes.length > MAX_SHOWN_HASHES) {
          this.state.shownHashes = this.state.shownHashes.slice(-MAX_SHOWN_HASHES);
        }
        if (this.state.recentMessages.length > MAX_RECENT_MESSAGES) {
          this.state.recentMessages = this.state.recentMessages.slice(0, MAX_RECENT_MESSAGES);
        }
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      } catch (_) {}
    }

    /**
     * Check if normalized text has ever been shown (Lifetime Anti-Repeat, Rule #16)
     */
    hasExactHash(text) {
      const h = fnv1a(normalizeText(text));
      return this.state.shownHashes.includes(h);
    }

    /**
     * Evaluate near-repeat and fatigue penalties for a candidate:
     * - Jaccard lexical overlap with last 10 messages
     * - Structural repetition (same intent + same syntactic form)
     * - Marker word overuse ("снова", "опять", etc.)
     * @returns {number} penalty (0.0 to 1.5)
     */
    computeNearRepeatPenalty(candidate) {
      let penalty = 0.0;
      const norm = normalizeText(candidate.text);
      const hash = fnv1a(norm);

      // 1. Lifetime exact match check
      if (this.state.shownHashes.includes(hash)) {
        return 999.0; // Hard rejection
      }

      // 2. Lexical Jaccard similarity with recent messages
      const recent = this.state.recentMessages.slice(0, 10);
      for (let i = 0; i < recent.length; i++) {
        const sim = jaccardSimilarity(norm, normalizeText(recent[i].text));
        if (sim >= 0.7) {
          penalty += (sim * 1.2); // high near-duplicate penalty
        } else if (sim >= 0.45) {
          penalty += (sim * 0.5);
        }
      }

      // 3. Structural repetition: same intent & form back-to-back
      if (this.state.recentMessages.length > 0) {
        const last = this.state.recentMessages[0];
        if (last.intent === candidate.plan.intent) {
          penalty += 0.4;
          if (last.form === candidate.form) {
            penalty += 0.5; // same intent + same syntactic form in a row
          }
        }
      }

      // 4. Lexical fatigue on marker words (Rule #31)
      const candWords = norm.split(' ');
      for (let m = 0; m < FATIGUE_MARKERS.length; m++) {
        const marker = FATIGUE_MARKERS[m];
        if (candWords.includes(marker)) {
          // Count marker occurrences in last 5 messages
          let markerOccurrences = 0;
          for (let r = 0; r < Math.min(5, this.state.recentMessages.length); r++) {
            if (this.state.recentMessages[r].text.toLowerCase().includes(marker)) {
              markerOccurrences++;
            }
          }
          if (markerOccurrences >= 2) {
            penalty += 0.45 * markerOccurrences;
          }
        }
      }

      // 5. Detector cooldown penalty (Rule #30)
      const lastDetectorTs = this.state.detectorCooldowns[candidate.plan.intent] || 0;
      const elapsedMs = Date.now() - lastDetectorTs;
      if (elapsedMs < 15 * 60 * 1000 && lastDetectorTs > 0) {
        // Shown in the last 15 minutes
        penalty += 0.35;
      }

      return Number(penalty.toFixed(3));
    }

    /**
     * Record a selected candidate into memory
     */
    recordShown(candidate) {
      if (!candidate || !candidate.text) return;
      const norm = normalizeText(candidate.text);
      const hash = fnv1a(norm);

      if (!this.state.shownHashes.includes(hash)) {
        this.state.shownHashes.push(hash);
      }

      const entry = {
        text: candidate.text,
        hash,
        intent: candidate.plan ? candidate.plan.intent : 'unknown',
        form: candidate.form || 'DIRECT',
        timestamp: Date.now()
      };

      this.state.recentMessages.unshift(entry);
      if (candidate.plan) {
        this.state.detectorCooldowns[candidate.plan.intent] = Date.now();
        this.state.lastTopic = candidate.plan.intent;
      }

      this._save();
    }

    /**
     * Clear memory (useful for test resets)
     */
    clear() {
      this.state = {
        shownHashes: [],
        recentMessages: [],
        detectorCooldowns: {},
        lastTopic: null
      };
      if (this.isBrowser) {
        try {
          window.localStorage.removeItem(STORAGE_KEY);
        } catch (_) {}
      }
    }
  }

  return {
    fnv1a,
    normalizeText,
    jaccardSimilarity,
    MemoryStore
  };
});
