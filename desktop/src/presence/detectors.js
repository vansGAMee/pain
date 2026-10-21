/**
 * Pain Audio Companion — Presence Engine: Observation Detectors Module
 * Implements compound, behavioral, and time-aware observation detectors.
 * Computes surprise score and produces formal SemanticMessagePlans.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const Evidence = require('./evidence');
    module.exports = factory(Evidence);
  } else {
    root.PresenceDetectors = factory(root.PresenceEvidence);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (PresenceEvidence) {
  'use strict';

  /**
   * Calculate Surprise Score:
   * surprise = deviation * confidence * recency * rarity * relevance
   */
  function computeSurprise(deviation, confidence, recency, rarity, relevance) {
    const d = Math.max(0.1, Math.min(2.5, deviation || 1.0));
    const c = Math.max(0.2, Math.min(1.0, confidence || 0.8));
    const rec = Math.max(0.2, Math.min(1.0, recency || 0.9));
    const rar = Math.max(0.1, Math.min(1.0, rarity || 0.5));
    const rel = Math.max(0.2, Math.min(1.0, relevance || 0.8));

    // Normalized to 0..1 scale
    const raw = (d / 2.0) * c * rec * rar * rel;
    return Math.max(0.05, Math.min(0.99, Number(raw.toFixed(3))));
  }

  /**
   * Run all observation detectors against current signals, personal baseline, and memory.
   * Produces an array of candidate SemanticMessagePlans.
   */
  function detectObservations(signals, baseline, memory) {
    const plans = [];
    const ledger = PresenceEvidence ? PresenceEvidence.createLedger() : null;

    const familiarity = baseline.familiarity;
    const hour = signals.hour;
    const isLateNight = hour >= 23 || hour < 5;
    const isEarlyMorning = hour >= 5 && hour < 9;
    const todayCount = signals.today.count;
    const sessionCount = signals.session.count;
    const streakDays = signals.streakDays;
    const gapDays = signals.gapDays;

    // 0. NEW USER DETECTOR (Rule #23: "пока только знакомимся")
    if (familiarity === 'new') {
      plans.push({
        intent: 'new_user',
        subject: { type: 'library', size: signals.libraryTracksCount },
        facts: { totalPlays: signals.totalPlaysCount, hour },
        secondaryFact: null,
        confidence: 0.9,
        surprise: 0.5,
        tone: { warmth: 0.6, dryness: 0.5, playfulness: 0.3, verbosity: 'short' },
        emphasis: 'greeting',
        relationToPast: 'first_time'
      });
      // New user gets focused calm plans
      return plans;
    }

    // 1. COMPOUND DETECTOR: Late Night + Artist Monopoly (Rule #8: «снова поздно. и снова Летов»)
    const todayTopArtist = signals.today.topArtist;
    const sessionTopArtist = signals.session.topArtist;
    const activeTopArtist = (sessionTopArtist && sessionTopArtist.count >= 3)
      ? sessionTopArtist
      : todayTopArtist;
    const artistPeriod = activeTopArtist === sessionTopArtist && sessionTopArtist ? 'session' : 'today';
    const artistTotal = artistPeriod === 'session' ? sessionCount : todayCount;

    if (isLateNight && activeTopArtist) {
      const artVal = PresenceEvidence
        ? PresenceEvidence.validateArtistMonopoly(activeTopArtist, artistTotal, baseline.normalTopArtistConcentration)
        : { valid: activeTopArtist.count >= 4 && activeTopArtist.share >= 0.5 };

      if (artVal.valid) {
        const surprise = computeSurprise(
          baseline.deviations.artistConcentrationFold * 1.4,
          artVal.confidence,
          1.0,
          0.85,
          0.95
        );
        plans.push({
          intent: 'compound_night_and_artist',
          subject: {
            type: 'artist',
            name: activeTopArtist.artist,
            count: activeTopArtist.count,
            share: activeTopArtist.share
          },
          facts: {
            artist: activeTopArtist.artist,
            period: artistPeriod,
            count: activeTopArtist.count,
            hour,
            timeContext: 'night'
          },
          secondaryFact: {
            type: 'time',
            isLateNight: true
          },
          confidence: artVal.confidence,
          surprise,
          tone: { warmth: 0.5, dryness: 0.75, playfulness: 0.2, verbosity: 'short' },
          emphasis: 'compound',
          relationToPast: 'recurring'
        });
      }
    }

    // 2. COMPOUND DETECTOR: Consecutive Days Track (Rule #8: «третий день к ней возвращаешься»)
    const topTrackToday = signals.today.topTrack;
    if (topTrackToday && signals.playsByDate) {
      const trackDaysVal = PresenceEvidence
        ? PresenceEvidence.validateConsecutiveDaysTrack(topTrackToday.id, topTrackToday.title, topTrackToday.artist, signals.playsByDate)
        : { valid: false };

      if (trackDaysVal.valid && trackDaysVal.facts.dayCount >= 2) {
        const surprise = computeSurprise(
          trackDaysVal.facts.dayCount * 0.6,
          trackDaysVal.confidence,
          0.95,
          0.8,
          0.9
        );
        plans.push({
          intent: 'compound_consecutive_days_track',
          subject: {
            type: 'track',
            id: topTrackToday.id,
            title: topTrackToday.title,
            artist: topTrackToday.artist
          },
          facts: {
            title: topTrackToday.title,
            artist: topTrackToday.artist,
            dayCount: trackDaysVal.facts.dayCount,
            todayCount: topTrackToday.count
          },
          secondaryFact: {
            type: 'streak',
            days: trackDaysVal.facts.dayCount
          },
          confidence: trackDaysVal.confidence,
          surprise,
          tone: { warmth: 0.55, dryness: 0.6, playfulness: 0.25, verbosity: 'short' },
          emphasis: 'track',
          relationToPast: 'multi_day_habit'
        });
      }
    }

    // 3. COMPOUND DETECTOR: Streak + Pace (Rule #8: «пятый день подряд, и темп не сбавляешь»)
    if (streakDays >= 3 && todayCount >= 5) {
      const paceFold = baseline.avgDailyTracks > 0 ? (todayCount / baseline.avgDailyTracks) : 1;
      const surprise = computeSurprise(
        (streakDays / 3) * 0.8,
        0.9,
        0.9,
        0.75,
        0.85
      );
      plans.push({
        intent: 'compound_streak_and_pace',
        subject: { type: 'streak', days: streakDays },
        facts: {
          streakDays,
          todayCount,
          paceFold
        },
        secondaryFact: {
          type: 'pace',
          todayCount
        },
        confidence: 0.92,
        surprise,
        tone: { warmth: 0.6, dryness: 0.65, playfulness: 0.3, verbosity: 'short' },
        emphasis: 'streak',
        relationToPast: 'sustained_habit'
      });
    }

    // 4. COMPOUND DETECTOR: Gap + Familiar Artist Return («возвращение после паузы, и сразу к {artist}»)
    if (gapDays >= 2 && activeTopArtist && activeTopArtist.count >= 2) {
      const allTimeArtist = signals.allTime.artists.get(activeTopArtist.artist);
      if (allTimeArtist && allTimeArtist.count >= 5) {
        plans.push({
          intent: 'compound_gap_and_return',
          subject: { type: 'artist', name: activeTopArtist.artist },
          facts: {
            artist: activeTopArtist.artist,
            gapDays,
            count: activeTopArtist.count
          },
          secondaryFact: { type: 'gap', gapDays },
          confidence: 0.88,
          surprise: 0.78,
          tone: { warmth: 0.5, dryness: 0.7, playfulness: 0.2, verbosity: 'short' },
          emphasis: 'return',
          relationToPast: 'reconnection'
        });
      }
    }

    // 5. SINGLE TRACK LOOP (Rule #38: same track repeated >= 3 times)
    const sessionTopTrack = signals.session.topTrack;
    const focusTrack = (sessionTopTrack && sessionTopTrack.count >= 3)
      ? sessionTopTrack
      : topTrackToday;
    const trackPeriod = focusTrack === sessionTopTrack && sessionTopTrack ? 'session' : 'today';

    if (focusTrack) {
      const trackVal = PresenceEvidence
        ? PresenceEvidence.validateSingleTrackLoop(focusTrack, trackPeriod === 'session' ? sessionCount : todayCount)
        : { valid: focusTrack.count >= 3 };

      if (trackVal.valid) {
        const surprise = computeSurprise(
          focusTrack.count >= 5 ? 1.8 : 1.2,
          trackVal.confidence,
          1.0,
          trackVal.rarity,
          0.95
        );
        plans.push({
          intent: 'single_track_loop',
          subject: {
            type: 'track',
            id: focusTrack.id,
            title: focusTrack.title,
            artist: focusTrack.artist,
            count: focusTrack.count
          },
          facts: {
            title: focusTrack.title,
            period: trackPeriod,
            artist: focusTrack.artist,
            count: focusTrack.count,
            totalPlays: todayCount
          },
          secondaryFact: null,
          confidence: trackVal.confidence,
          surprise,
          tone: { warmth: 0.5, dryness: 0.65, playfulness: 0.35, verbosity: 'short' },
          emphasis: 'track',
          relationToPast: 'loop'
        });
      }
    }

    // 6. ARTIST MONOPOLY (Rule #38: one artist represents >= 50% of today / session)
    if (activeTopArtist) {
      const artVal = PresenceEvidence
        ? PresenceEvidence.validateArtistMonopoly(activeTopArtist, artistTotal, baseline.normalTopArtistConcentration)
        : { valid: activeTopArtist.count >= 4 && activeTopArtist.share >= 0.5 };

      if (artVal.valid) {
        const surprise = computeSurprise(
          baseline.deviations.artistConcentrationFold,
          artVal.confidence,
          0.95,
          artVal.rarity,
          0.9
        );
        plans.push({
          intent: 'artist_monopoly',
          subject: {
            type: 'artist',
            name: activeTopArtist.artist,
            count: activeTopArtist.count,
            share: activeTopArtist.share
          },
          facts: {
            artist: activeTopArtist.artist,
            count: activeTopArtist.count,
            share: activeTopArtist.share,
            period: artistPeriod,
            timeContext: signals.timeBucket
          },
          secondaryFact: null,
          confidence: artVal.confidence,
          surprise,
          tone: { warmth: 0.5, dryness: 0.7, playfulness: 0.25, verbosity: 'short' },
          emphasis: 'artist',
          relationToPast: 'dominant'
        });
      }
    }

    // 7. ARTIST RETURN (Rule #38: artist with >= 3 historical plays hadn't been played in >= 4 days)
    if (activeTopArtist && signals.allTime.artists) {
      const allTimeArtist = signals.allTime.artists.get(activeTopArtist.artist);
      if (allTimeArtist && signals.playsByDate) {
        const retVal = PresenceEvidence
          ? PresenceEvidence.validateArtistReturn(activeTopArtist.artist, allTimeArtist, signals.now, signals.playsByDate)
          : { valid: false };

        if (retVal.valid) {
          plans.push({
            intent: 'artist_return',
            subject: { type: 'artist', name: activeTopArtist.artist },
            facts: {
              artist: activeTopArtist.artist,
              gapDays: retVal.facts.gapDays,
              historicalPlays: retVal.facts.historicalPlays
            },
            secondaryFact: null,
            confidence: retVal.confidence,
            surprise: 0.82,
            tone: { warmth: 0.55, dryness: 0.65, playfulness: 0.2, verbosity: 'short' },
            emphasis: 'artist',
            relationToPast: 'revisited'
          });
        }
      }
    }

    // 8. HEAVY SESSION / UNUSUAL VOLUME (Rule #38)
    if (todayCount >= 14 && baseline.avgDailyTracks > 0) {
      const fold = todayCount / baseline.avgDailyTracks;
      if (fold >= 1.6) {
        plans.push({
          intent: 'heavy_session',
          subject: { type: 'volume', count: todayCount },
          facts: {
            todayCount,
            avgDailyTracks: baseline.avgDailyTracks,
            fold: Number(fold.toFixed(1))
          },
          secondaryFact: null,
          confidence: 0.9,
          surprise: Math.min(0.95, 0.6 + fold * 0.15),
          tone: { warmth: 0.5, dryness: 0.7, playfulness: 0.2, verbosity: 'short' },
          emphasis: 'volume',
          relationToPast: 'deviation'
        });
      }
    }

    // 9. LATE NIGHT LISTENING (Rule #38)
    if (isLateNight) {
      const isUnusual = baseline.isUnusualHour ? baseline.isUnusualHour(hour) : false;
      plans.push({
        intent: 'late_night',
        subject: { type: 'time', hour },
        facts: { hour, isUnusual },
        secondaryFact: null,
        confidence: 0.95,
        surprise: isUnusual ? 0.85 : 0.65,
        tone: { warmth: 0.45, dryness: 0.8, playfulness: 0.15, verbosity: 'short' },
        emphasis: 'time',
        relationToPast: isUnusual ? 'unusual_time' : 'habitual_night'
      });
    }

    // 10. EARLY MORNING (Rule #38)
    if (isEarlyMorning) {
      plans.push({
        intent: 'early_morning',
        subject: { type: 'time', hour },
        facts: { hour, todayCount },
        secondaryFact: null,
        confidence: 0.95,
        surprise: 0.6,
        tone: { warmth: 0.55, dryness: 0.7, playfulness: 0.2, verbosity: 'short' },
        emphasis: 'time',
        relationToPast: 'routine'
      });
    }

    // 11. WELCOME BACK (Rule #38: gap >= 2 days of absence before today)
    if (gapDays >= 2 && todayCount <= 4) {
      plans.push({
        intent: 'welcome_back',
        subject: { type: 'absence', gapDays },
        facts: { gapDays },
        secondaryFact: null,
        confidence: 0.95,
        surprise: Math.min(0.9, 0.5 + gapDays * 0.1),
        tone: { warmth: 0.6, dryness: 0.6, playfulness: 0.2, verbosity: 'short' },
        emphasis: 'absence',
        relationToPast: 'return_after_gap'
      });
    }

    // 12. SKIP STREAK / SEARCHING (Rule #38 & #39)
    if (signals.sequence && signals.sequence.rapidSkipsCount >= 3) {
      plans.push({
        intent: 'skip_streak',
        subject: { type: 'behavior', skips: signals.sequence.rapidSkipsCount },
        facts: { skipsCount: signals.sequence.rapidSkipsCount },
        secondaryFact: null,
        confidence: 0.85,
        surprise: 0.75,
        tone: { warmth: 0.45, dryness: 0.75, playfulness: 0.3, verbosity: 'short' },
        emphasis: 'behavior',
        relationToPast: 'restless'
      });
    }

    // 13. DEEP FOCUS / STEADY FLOW (Rule #38 & #39)
    if (sessionCount >= 6 && signals.session.skipRate <= 0.15) {
      plans.push({
        intent: 'deep_focus',
        subject: { type: 'behavior', sessionCount },
        facts: { sessionCount, durationMs: signals.session.durationMs },
        secondaryFact: null,
        confidence: 0.88,
        surprise: 0.6,
        tone: { warmth: 0.5, dryness: 0.7, playfulness: 0.1, verbosity: 'short' },
        emphasis: 'flow',
        relationToPast: 'steady'
      });
    }

    // 14. SESSION REVISIT (Rule #28: returning later on the same day)
    if (signals.session.isActive && todayCount > sessionCount && todayCount >= 6) {
      plans.push({
        intent: 'session_revisit',
        subject: { type: 'session', totalToday: todayCount },
        facts: { todayCount, sessionCount },
        secondaryFact: null,
        confidence: 0.9,
        surprise: 0.55,
        tone: { warmth: 0.5, dryness: 0.7, playfulness: 0.2, verbosity: 'minimal' },
        emphasis: 'session',
        relationToPast: 'revisit'
      });
    }

    // 15. NEUTRAL PRESENCE / CALM FALLBACK (Rule #29: Silence Engine)
    // Always present as a grounded baseline when nothing dramatic happened
    plans.push({
      intent: 'neutral_presence',
      subject: { type: 'time', bucket: signals.timeBucket },
      facts: {
        timeBucket: signals.timeBucket,
        hour,
        isWeekend: signals.isWeekend
      },
      secondaryFact: null,
      confidence: 1.0,
      surprise: 0.2, // low surprise, pure presence
      tone: { warmth: 0.5, dryness: 0.8, playfulness: 0.1, verbosity: 'minimal' },
      emphasis: 'time',
      relationToPast: 'neutral'
    });

    return plans;
  }

  return {
    computeSurprise,
    detectObservations
  };
});
