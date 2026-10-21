/**
 * Pain Audio Companion — Presence Engine: Signal Extraction Module
 * Extracts multi-timescale signals from honest listening history and library.
 * Zero external calls, zero telemetry, zero hallucinations.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PresenceSignals = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SESSION_GAP_MS = 35 * 60 * 1000; // 35 minutes inactivity = new session
  const QUICK_SKIP_MAX_MS = 15 * 1000;   // <15s listened = quick skip

  /**
   * Helper to normalize track lookup from library tracks array
   */
  function buildTrackMap(tracks) {
    const map = new Map();
    if (!Array.isArray(tracks)) return map;
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      if (!t || !t.id) continue;
      const cleanArtist = String(t.artist || '').trim() || 'Unknown Artist';
      const cleanTitle = String(t.title || '').trim() || 'Unknown Track';
      map.set(String(t.id), {
        id: String(t.id),
        title: cleanTitle,
        artist: cleanArtist,
        album: String(t.album || '').trim(),
        duration: Number(t.duration) || 0
      });
    }
    return map;
  }

  /**
   * Safe date format YYYY-MM-DD in local time
   */
  function getLocalDateKey(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /**
   * Parse timestamp safely
   */
  function getPlayTimestamp(p) {
    if (!p) return 0;
    const raw = p.started || p.timestamp || p.at;
    const num = Number(raw);
    return Number.isFinite(num) && num > 0 ? num : 0;
  }

  /**
   * Compute aggregated metrics for an array of normalized plays
   */
  function aggregatePlayList(plays, trackMap) {
    const count = plays.length;
    if (count === 0) {
      return {
        count: 0,
        totalHeardMs: 0,
        completedCount: 0,
        skippedCount: 0,
        skipRate: 0,
        completionRate: 0,
        topTrack: null,
        topArtist: null,
        uniqueTracksCount: 0,
        uniqueArtistsCount: 0,
        tracks: new Map(),
        artists: new Map()
      };
    }

    let totalHeardMs = 0;
    let completedCount = 0;
    let skippedCount = 0;
    const trackStats = new Map();
    const artistStats = new Map();

    for (let i = 0; i < count; i++) {
      const p = plays[i];
      const heard = Math.max(0, Number(p.heard || p.media_heard || 0));
      totalHeardMs += heard;
      if (p.finished === 1 || p.finished === true) completedCount++;
      if (p.skipped === 1 || p.skipped === true) skippedCount++;

      const trackMeta = trackMap.get(p.trackId) || {
        id: p.trackId,
        title: p.title || 'Unknown Track',
        artist: p.artist || 'Unknown Artist',
        duration: p.duration || 0
      };

      // Track aggregation
      let tEntry = trackStats.get(p.trackId);
      if (!tEntry) {
        tEntry = {
          id: p.trackId,
          title: trackMeta.title,
          artist: trackMeta.artist,
          count: 0,
          totalHeardMs: 0,
          skips: 0,
          lastPlayed: p.timestamp
        };
        trackStats.set(p.trackId, tEntry);
      }
      tEntry.count++;
      tEntry.totalHeardMs += heard;
      if (p.skipped) tEntry.skips++;
      if (p.timestamp > tEntry.lastPlayed) tEntry.lastPlayed = p.timestamp;

      // Artist aggregation
      const artistName = trackMeta.artist;
      let aEntry = artistStats.get(artistName);
      if (!aEntry) {
        aEntry = {
          artist: artistName,
          count: 0,
          totalHeardMs: 0,
          tracks: new Set(),
          lastPlayed: p.timestamp
        };
        artistStats.set(artistName, aEntry);
      }
      aEntry.count++;
      aEntry.totalHeardMs += heard;
      aEntry.tracks.add(p.trackId);
      if (p.timestamp > aEntry.lastPlayed) aEntry.lastPlayed = p.timestamp;
    }

    // Determine top track
    let topTrack = null;
    let maxTrackCount = 0;
    for (const [id, entry] of trackStats) {
      if (entry.count > maxTrackCount) {
        maxTrackCount = entry.count;
        topTrack = {
          id,
          title: entry.title,
          artist: entry.artist,
          count: entry.count,
          share: count > 0 ? entry.count / count : 0,
          lastPlayed: entry.lastPlayed
        };
      }
    }

    // Determine top artist
    let topArtist = null;
    let maxArtistCount = 0;
    for (const [name, entry] of artistStats) {
      if (entry.count > maxArtistCount) {
        maxArtistCount = entry.count;
        topArtist = {
          artist: name,
          count: entry.count,
          share: count > 0 ? entry.count / count : 0,
          tracksCount: entry.tracks.size,
          lastPlayed: entry.lastPlayed
        };
      }
    }

    return {
      count,
      totalHeardMs,
      completedCount,
      skippedCount,
      skipRate: count > 0 ? skippedCount / count : 0,
      completionRate: count > 0 ? completedCount / count : 0,
      topTrack,
      topArtist,
      uniqueTracksCount: trackStats.size,
      uniqueArtistsCount: artistStats.size,
      tracks: trackStats,
      artists: artistStats
    };
  }

  /**
   * Main function: extractSignals
   * @param {Array} tracks - library tracks
   * @param {Object} stats - raw stats with plays array
   * @param {Object} options - { now, sessionGapMs }
   */
  function extractSignals(tracks, stats, options = {}) {
    const now = typeof options.now === 'number' ? options.now : Date.now();
    const nowDate = new Date(now);
    const sessionGap = options.sessionGapMs || SESSION_GAP_MS;

    const trackMap = buildTrackMap(tracks);
    const rawPlays = (stats && Array.isArray(stats.plays)) ? stats.plays : [];

    // 1. Sanitize, normalize and filter valid plays
    const validPlays = [];
    for (let i = 0; i < rawPlays.length; i++) {
      const p = rawPlays[i];
      if (!p) continue;
      const ts = getPlayTimestamp(p);
      if (ts <= 0 || ts > now + 3600000) continue; // ignore far future corrupted timestamps
      const rawTrackId = String(p.track || p.trackId || p.id || '').trim();
      if (!rawTrackId) continue;

      const trackInfo = trackMap.get(rawTrackId);
      validPlays.push({
        id: p.id || `play_${ts}_${i}`,
        trackId: rawTrackId,
        title: trackInfo ? trackInfo.title : String(p.title || 'Unknown Track').trim(),
        artist: trackInfo ? trackInfo.artist : String(p.artist || 'Unknown Artist').trim(),
        timestamp: ts,
        heard: Math.max(0, Number(p.heard || p.media_heard || 0)),
        duration: Math.max(0, Number(p.duration || 0)),
        finished: p.finished === 1 || p.finished === true,
        skipped: p.skipped === 1 || p.skipped === true
      });
    }

    // Sort chronologically ascending
    validPlays.sort((a, b) => a.timestamp - b.timestamp);

    // 2. Identify listening dates and streaks/gaps
    const activeDatesSet = new Set();
    const playsByDate = new Map();
    for (let i = 0; i < validPlays.length; i++) {
      const p = validPlays[i];
      const dKey = getLocalDateKey(new Date(p.timestamp));
      activeDatesSet.add(dKey);
      let list = playsByDate.get(dKey);
      if (!list) {
        list = [];
        playsByDate.set(dKey, list);
      }
      list.push(p);
    }

    const todayKey = getLocalDateKey(nowDate);
    const yesterdayDate = new Date(now - 86400000);
    const yesterdayKey = getLocalDateKey(yesterdayDate);

    // Calculate streak days (consecutive days leading up to today or yesterday)
    let streakDays = 0;
    let checkDate = new Date(nowDate);
    // If user hasn't played today yet, check if streak from yesterday is active
    if (!activeDatesSet.has(todayKey) && activeDatesSet.has(yesterdayKey)) {
      checkDate = yesterdayDate;
    }
    while (true) {
      const k = getLocalDateKey(checkDate);
      if (activeDatesSet.has(k)) {
        streakDays++;
        checkDate = new Date(checkDate.getTime() - 86400000);
      } else {
        break;
      }
    }

    // Calculate gap days (inactivity before today's session)
    let gapDays = 0;
    if (validPlays.length > 0) {
      // Find latest play strictly before today 00:00:00
      const startOfToday = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime();
      let lastPreviousPlayTs = 0;
      for (let i = validPlays.length - 1; i >= 0; i--) {
        if (validPlays[i].timestamp < startOfToday) {
          lastPreviousPlayTs = validPlays[i].timestamp;
          break;
        }
      }
      if (lastPreviousPlayTs > 0) {
        const diffMs = startOfToday - lastPreviousPlayTs;
        gapDays = Math.floor(diffMs / 86400000);
      }
    }

    // 3. Multi-timescale partitioning
    const startOfTodayMs = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime();
    const startOfYesterdayMs = startOfTodayMs - 86400000;
    const past72hMs = now - 72 * 3600000;
    const past7dMs = now - 7 * 86400000;
    const past30dMs = now - 30 * 86400000;

    const todayPlays = [];
    const yesterdayPlays = [];
    const last72hPlays = [];
    const last7dPlays = [];
    const last30dPlays = [];

    for (let i = 0; i < validPlays.length; i++) {
      const p = validPlays[i];
      const ts = p.timestamp;
      if (ts >= startOfTodayMs && ts <= now) todayPlays.push(p);
      if (ts >= startOfYesterdayMs && ts < startOfTodayMs) yesterdayPlays.push(p);
      if (ts >= past72hMs && ts <= now) last72hPlays.push(p);
      if (ts >= past7dMs && ts <= now) last7dPlays.push(p);
      if (ts >= past30dMs && ts <= now) last30dPlays.push(p);
    }

    // 4. Group plays into distinct listening sessions
    const sessions = [];
    let currentSessionPlays = [];
    for (let i = 0; i < validPlays.length; i++) {
      const p = validPlays[i];
      if (currentSessionPlays.length === 0) {
        currentSessionPlays.push(p);
      } else {
        const prev = currentSessionPlays[currentSessionPlays.length - 1];
        if (p.timestamp - prev.timestamp <= sessionGap) {
          currentSessionPlays.push(p);
        } else {
          sessions.push(currentSessionPlays);
          currentSessionPlays = [p];
        }
      }
    }
    if (currentSessionPlays.length > 0) {
      sessions.push(currentSessionPlays);
    }

    // Latest session
    const lastSessionPlays = sessions.length > 0 ? sessions[sessions.length - 1] : [];
    const lastSessionEndTs = lastSessionPlays.length > 0
      ? lastSessionPlays[lastSessionPlays.length - 1].timestamp
      : 0;
    const isCurrentSessionActive = (now - lastSessionEndTs) <= sessionGap;
    const sessionDurationMs = lastSessionPlays.length > 1
      ? (lastSessionPlays[lastSessionPlays.length - 1].timestamp - lastSessionPlays[0].timestamp)
      : (lastSessionPlays.length === 1 ? lastSessionPlays[0].heard : 0);

    // 5. Sequence dynamics: rapid skips and consecutive repeats
    let rapidSkipsCount = 0;
    for (let i = validPlays.length - 1; i >= 0 && i >= validPlays.length - 8; i--) {
      const p = validPlays[i];
      if (p.skipped && p.heard < QUICK_SKIP_MAX_MS) {
        rapidSkipsCount++;
      } else {
        break; // stop on first non-skip or normal listen
      }
    }

    // Back-to-back repetition of the same track in recent plays
    let consecutiveSameTrackCount = 0;
    let consecutiveSameTrackId = null;
    if (validPlays.length > 0) {
      const lastTrackId = validPlays[validPlays.length - 1].trackId;
      consecutiveSameTrackId = lastTrackId;
      for (let i = validPlays.length - 1; i >= 0; i--) {
        if (validPlays[i].trackId === lastTrackId) {
          consecutiveSameTrackCount++;
        } else {
          break;
        }
      }
    }

    // Time of day features
    const hour = nowDate.getHours();
    const dayOfWeek = nowDate.getDay(); // 0 = Sun, 6 = Sat
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    let timeBucket = 'afternoon';
    if (hour >= 0 && hour < 5) timeBucket = 'night';
    else if (hour >= 5 && hour < 9) timeBucket = 'early_morning';
    else if (hour >= 9 && hour < 12) timeBucket = 'morning';
    else if (hour >= 12 && hour < 17) timeBucket = 'afternoon';
    else if (hour >= 17 && hour < 23) timeBucket = 'evening';
    else timeBucket = 'night';

    // 6. Multi-timescale summary objects
    const sessionSummary = aggregatePlayList(lastSessionPlays, trackMap);
    const todaySummary = aggregatePlayList(todayPlays, trackMap);
    const yesterdaySummary = aggregatePlayList(yesterdayPlays, trackMap);
    const last72hSummary = aggregatePlayList(last72hPlays, trackMap);
    const last7dSummary = aggregatePlayList(last7dPlays, trackMap);
    const last30dSummary = aggregatePlayList(last30dPlays, trackMap);
    const allTimeSummary = aggregatePlayList(validPlays, trackMap);

    return {
      now,
      nowDate,
      hour,
      dayOfWeek,
      isWeekend,
      timeBucket,
      activeDaysCount: activeDatesSet.size,
      streakDays,
      gapDays,
      totalPlaysCount: validPlays.length,
      libraryTracksCount: trackMap.size,
      session: {
        ...sessionSummary,
        isActive: isCurrentSessionActive,
        durationMs: sessionDurationMs,
        playsCount: lastSessionPlays.length,
        plays: lastSessionPlays
      },
      today: todaySummary,
      yesterday: yesterdaySummary,
      last72h: last72hSummary,
      last7d: last7dSummary,
      last30d: last30dSummary,
      allTime: allTimeSummary,
      sequence: {
        rapidSkipsCount,
        consecutiveSameTrackCount,
        consecutiveSameTrackId,
        recentPlays: validPlays.slice(-10)
      },
      trackMap,
      playsByDate
    };
  }

  return {
    extractSignals,
    buildTrackMap,
    getLocalDateKey,
    SESSION_GAP_MS
  };
});
