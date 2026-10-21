/**
 * Pain Audio Companion — Presence Engine: Personal Baseline Module
 * Calculates user's personal norms, relationship age, and statistical deviations.
 * Strictly respects Rule #4 (Personal Baseline) & Rule #23 (Relationship Age).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PresenceBaselines = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * Determine Relationship Age / Familiarity Level
   * @param {number} totalPlays - total valid historical plays
   * @param {number} activeDays - number of distinct listening dates
   * @returns {'new' | 'learning' | 'familiar' | 'long-term'}
   */
  function computeFamiliarityLevel(totalPlays, activeDays) {
    if (totalPlays < 15 || activeDays <= 1) {
      return 'new';
    }
    if (totalPlays >= 250 && activeDays >= 5) {
      return 'long-term';
    }
    if (totalPlays >= 60 || activeDays >= 5) {
      return 'familiar';
    }
    return 'learning';
  }

  /**
   * Compute personal baseline metrics from extracted signals
   * @param {Object} signals - output of PresenceSignals.extractSignals
   * @returns {Object} personal baseline object
   */
  function computePersonalBaseline(signals) {
    const totalPlays = signals.totalPlaysCount || 0;
    const activeDaysCount = Math.max(1, signals.activeDaysCount || 1);
    const familiarity = computeFamiliarityLevel(totalPlays, activeDaysCount);

    // Group plays by date (excluding today if today is still unfolding and has < avg plays)
    const playsByDate = signals.playsByDate || new Map();
    const todayKey = signals.nowDate ? PresenceSignals_getLocalDateKey(signals.nowDate) : '';

    let pastDaysCount = 0;
    let sumPastDailyPlays = 0;
    let sumPastDailyHeardMs = 0;
    let sumTopArtistShares = 0;
    const hourHistogram = new Array(24).fill(0);

    for (const [dKey, dayPlays] of playsByDate) {
      // Accumulate hour distribution across all plays
      for (let i = 0; i < dayPlays.length; i++) {
        const d = new Date(dayPlays[i].timestamp);
        const h = d.getHours();
        if (h >= 0 && h < 24) hourHistogram[h]++;
      }

      // Daily metrics
      if (dKey !== todayKey || playsByDate.size === 1) {
        pastDaysCount++;
        sumPastDailyPlays += dayPlays.length;
        let dayHeard = 0;
        const artistCounts = new Map();
        for (let i = 0; i < dayPlays.length; i++) {
          dayHeard += dayPlays[i].heard;
          const art = dayPlays[i].artist || 'Unknown';
          artistCounts.set(art, (artistCounts.get(art) || 0) + 1);
        }
        sumPastDailyHeardMs += dayHeard;

        let maxCount = 0;
        for (const cnt of artistCounts.values()) {
          if (cnt > maxCount) maxCount = cnt;
        }
        const topShare = dayPlays.length > 0 ? maxCount / dayPlays.length : 0;
        sumTopArtistShares += topShare;
      }
    }

    const baselineDays = Math.max(1, pastDaysCount);
    const avgDailyTracks = Math.round(sumPastDailyPlays / baselineDays) || Math.max(1, Math.round(totalPlays / activeDaysCount));
    const avgDailyHeardMs = Math.round(sumPastDailyHeardMs / baselineDays) || 0;
    const normalTopArtistConcentration = pastDaysCount > 0
      ? (sumTopArtistShares / pastDaysCount)
      : (signals.allTime.topArtist ? signals.allTime.topArtist.share : 0.3);

    const normalSkipRate = signals.allTime ? signals.allTime.skipRate : 0.25;

    // Normalize hourly histogram into probabilities
    const hourDistribution = new Array(24);
    for (let h = 0; h < 24; h++) {
      hourDistribution[h] = totalPlays > 0 ? hourHistogram[h] / totalPlays : 1 / 24;
    }

    // Identify peak hours
    const hourRanks = hourHistogram
      .map((count, h) => ({ hour: h, count }))
      .sort((a, b) => b.count - a.count);
    const topHoursSet = new Set(hourRanks.slice(0, 8).map(x => x.hour));

    /**
     * Helper to test if a given hour is typical for this listener
     */
    function isUsualHour(h) {
      if (totalPlays < 20) return true; // neutral when new
      return topHoursSet.has(h);
    }

    /**
     * Helper to test if a given hour is unusually rare for this listener
     */
    function isUnusualHour(h) {
      if (totalPlays < 40) return false;
      return hourDistribution[h] < 0.03; // less than 3% of history
    }

    // Calculate deviations for current context
    const todayCount = signals.today ? signals.today.count : 0;
    const todayHeardMs = signals.today ? signals.today.totalHeardMs : 0;
    const todayTrackFold = avgDailyTracks > 0 ? (todayCount / avgDailyTracks) : 1;
    const todayHeardFold = avgDailyHeardMs > 0 ? (todayHeardMs / avgDailyHeardMs) : 1;

    const todaySkipRate = signals.today ? signals.today.skipRate : normalSkipRate;
    const skipRateDeviation = todaySkipRate - normalSkipRate;

    const todayTopArtist = signals.today ? signals.today.topArtist : null;
    const todayArtistShare = todayTopArtist ? todayTopArtist.share : 0;
    const artistConcentrationFold = normalTopArtistConcentration > 0
      ? (todayArtistShare / normalTopArtistConcentration)
      : 1;

    return {
      familiarity,
      totalPlays,
      activeDaysCount,
      avgDailyTracks,
      avgDailyHeardMs,
      normalSkipRate,
      normalTopArtistConcentration,
      hourDistribution,
      isUsualHour,
      isUnusualHour,
      deviations: {
        todayTrackFold,
        todayHeardFold,
        skipRateDeviation,
        todayArtistShare,
        artistConcentrationFold
      }
    };
  }

  function PresenceSignals_getLocalDateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  return {
    computeFamiliarityLevel,
    computePersonalBaseline
  };
});
