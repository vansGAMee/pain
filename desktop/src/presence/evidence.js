/**
 * Pain Audio Companion — Presence Engine: Evidence Ledger
 * Validates every single claim against verified facts and personal baselines.
 * Strictly respects Rule #3: Zero invented facts / zero false conclusions.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PresenceEvidence = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * Evidence Ledger creates validated observation claims
   */
  function createLedger() {
    const claims = [];

    return {
      addClaim(type, isValid, facts, metrics = {}) {
        if (!isValid) return; // Only proved facts enter the ledger
        claims.push({
          type,
          facts,
          metrics: {
            confidence: Math.max(0, Math.min(1, metrics.confidence || 0.8)),
            rarity: Math.max(0, Math.min(1, metrics.rarity || 0.5)),
            recency: Math.max(0, Math.min(1, metrics.recency || 0.9)),
            surprise: Math.max(0, Math.min(1, metrics.surprise || 0.5))
          }
        });
      },
      getClaims() {
        return claims;
      },
      has(type) {
        return claims.some(c => c.type === type);
      },
      get(type) {
        return claims.find(c => c.type === type) || null;
      }
    };
  }

  /**
   * Validate artist monopoly claim
   */
  function validateArtistMonopoly(topArtist, totalPlays, normalConcentration) {
    if (!topArtist || !topArtist.artist) return { valid: false };
    const artist = topArtist.artist.trim();
    if (!artist || /unknown|неизвестн/i.test(artist)) return { valid: false };

    const count = topArtist.count || 0;
    const share = totalPlays > 0 ? count / totalPlays : 0;

    // Hard truth: at least 4 plays of the artist, at least 6 total plays, and >= 50% share
    const valid = count >= 4 && totalPlays >= 6 && share >= 0.50;
    return {
      valid,
      facts: {
        artist,
        count,
        totalPlays,
        share,
        normalConcentration
      },
      confidence: Math.min(1, (count / 6) * 0.8 + (share >= 0.7 ? 0.2 : 0)),
      rarity: share >= 0.75 ? 0.9 : 0.6
    };
  }

  /**
   * Validate single track loop claim
   */
  function validateSingleTrackLoop(topTrack, totalPlays) {
    if (!topTrack || !topTrack.id) return { valid: false };
    const title = (topTrack.title || '').trim();
    if (!title || title === 'Unknown Track') return { valid: false };

    const count = topTrack.count || 0;
    // Strict truth: count >= 3 plays. (2 plays never qualifies as obsession / loop)
    const valid = count >= 3;
    return {
      valid,
      facts: {
        trackId: topTrack.id,
        title,
        artist: topTrack.artist,
        count,
        totalPlays,
        share: totalPlays > 0 ? count / totalPlays : 0
      },
      confidence: Math.min(1, 0.7 + (count >= 5 ? 0.3 : 0.1 * (count - 3))),
      rarity: count >= 5 ? 0.95 : 0.75
    };
  }

  /**
   * Validate consecutive days track listening
   */
  function validateConsecutiveDaysTrack(trackId, title, artist, playsByDate) {
    if (!trackId || !playsByDate || playsByDate.size < 2) return { valid: false };
    const cleanTitle = (title || '').trim();
    if (!cleanTitle || cleanTitle === 'Unknown Track') return { valid: false };

    const activeDays = [];
    for (const [dateKey, dayPlays] of playsByDate) {
      if (dayPlays.some(p => p.trackId === trackId)) {
        activeDays.push(dateKey);
      }
    }
    activeDays.sort();

    // Only the uninterrupted suffix supports a claim of consecutive days.
    const consecutive = activeDays.slice(-1);
    for (let i = activeDays.length - 2; i >= 0; i--) {
      if (Date.parse(consecutive[0]) - Date.parse(activeDays[i]) !== 86400000) break;
      consecutive.unshift(activeDays[i]);
    }
    const valid = consecutive.length >= 2;
    return {
      valid,
      facts: {
        trackId,
        title: cleanTitle,
        artist,
        dayCount: consecutive.length,
        days: consecutive
      },
      confidence: Math.min(1, 0.75 + (consecutive.length >= 3 ? 0.25 : 0)),
      rarity: consecutive.length >= 3 ? 0.9 : 0.7
    };
  }

  /**
   * Validate artist return after a break
   */
  function validateArtistReturn(artistName, allTimeArtist, now, playsByDate) {
    if (!artistName || !allTimeArtist) return { valid: false };
    const artist = artistName.trim();
    if (!artist || /unknown|неизвестн/i.test(artist)) return { valid: false };

    // Must have at least 3 historical plays total
    if (allTimeArtist.count < 3) return { valid: false };

    // Find previous plays strictly before today
    let previousPlayTs = 0;
    const nowStartOfDay = new Date(new Date(now).setHours(0, 0, 0, 0)).getTime();
    const historicalPlays = [...playsByDate.values()].flat().filter(p => p.timestamp < nowStartOfDay && (p.artist || '').trim() === artist).length;
    if (historicalPlays < 3) return { valid: false };

    // Iterate dates backwards before today
    const sortedDates = Array.from(playsByDate.keys()).sort().reverse();
    for (const dKey of sortedDates) {
      const dayPlays = playsByDate.get(dKey);
      const isPastDay = dayPlays.some(p => p.timestamp < nowStartOfDay);
      if (isPastDay) {
        for (let i = dayPlays.length - 1; i >= 0; i--) {
          const p = dayPlays[i];
          if (p.timestamp < nowStartOfDay && (p.artist || '').trim() === artist) {
            previousPlayTs = p.timestamp;
            break;
          }
        }
        if (previousPlayTs > 0) break;
      }
    }

    if (previousPlayTs === 0) return { valid: false };

    const today = new Date(now), previous = new Date(previousPlayTs);
    const gapDays = Math.max(0, (Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
      - Date.UTC(previous.getFullYear(), previous.getMonth(), previous.getDate())) / 86400000 - 1);

    // Rule: break must be at least 4 full days
    const valid = gapDays >= 4;
    return {
      valid,
      facts: {
        artist,
        gapDays,
        historicalPlays
      },
      confidence: 0.88,
      rarity: gapDays >= 10 ? 0.95 : 0.8
    };
  }

  return {
    createLedger,
    validateArtistMonopoly,
    validateSingleTrackLoop,
    validateConsecutiveDaysTrack,
    validateArtistReturn
  };
});
