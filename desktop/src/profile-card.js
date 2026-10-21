/**
 * Pain Audio Companion — Music Profile Share Card Module
 * Aggregates honest listening stats, renders visual card (HTML preview & high-DPI Canvas export),
 * and handles PNG download, image clipboard copy, and link sharing.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./listening-insights'));
  } else {
    root.ProfileCard = factory(root.ListeningInsights);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ListeningInsights) {
  'use strict';

  const DAY_MS = 86400000;

  /**
   * Helper to format duration in minutes/hours honestly.
   */
  function formatListeningTime(ms, isRu) {
    if (!ms || ms <= 0) return isRu ? '0 мин' : '0 min';
    const totalMinutes = Math.floor(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (hours > 0) {
      return isRu ? `${hours} ч ${mins} мин` : `${hours} h ${mins} min`;
    }
    return isRu ? `${mins} мин` : `${mins} min`;
  }

  /**
   * Format date into localized human-readable string.
   */
  function formatDateKey(dayKey, isRu) {
    if (!dayKey) return '';
    try {
      const d = new Date(dayKey + 'T12:00:00');
      return d.toLocaleDateString(isRu ? 'ru-RU' : 'en-US', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });
    } catch (_) {
      return dayKey;
    }
  }

  /**
   * Pure function to collect and honestly format all statistics for the profile card.
   */
  function collectProfileData(tracks = [], stats = {}, lang = 'ru', now = Date.now()) {
    const isRu = lang === 'ru';
    const insights = ListeningInsights && typeof ListeningInsights.build === 'function'
      ? ListeningInsights.build(tracks, stats, now)
      : {
          plays: Array.isArray(stats?.plays) ? stats.plays : [],
          totalMs: 0,
          days: new Map(),
          hours: Array(24).fill(0),
          calendar: [],
          ritual: null,
          record: null
        };

    const plays = Array.isArray(insights.plays) ? insights.plays : [];
    const trackMap = new Map((tracks || []).filter(t => t && t.id != null).map(t => [String(t.id), t]));
    const nowDate = new Date(now);

    // 1. Total Listening Time
    const totalMs = insights.totalMs || 0;
    const totalFormatted = formatListeningTime(totalMs, isRu);

    // 2. Today Listening Time
    const todayStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime();
    const todayKey = ListeningInsights?.dayKey
      ? ListeningInsights.dayKey(todayStart)
      : `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, '0')}-${String(nowDate.getDate()).padStart(2, '0')}`;
    const todayMs = (insights.days && typeof insights.days.get === 'function' ? insights.days.get(todayKey) : 0) || 0;
    const todayMinutes = Math.round(todayMs / 60000);
    const todayFormatted = isRu
      ? `Это ${todayMinutes} ${getRussianMinutesPlural(todayMinutes)} сегодня`
      : `That's ${todayMinutes} min today`;

    // 3. Unique Tracks & Plays
    const trackCounts = {};
    plays.forEach(p => {
      if (p && p.track != null) {
        trackCounts[p.track] = (trackCounts[p.track] || 0) + 1;
      }
    });
    const uniqueTracks = Object.keys(trackCounts).length;
    const totalPlays = plays.length;

    // 4. Streak Calculation
    const activeDays = insights.days && typeof insights.days.keys === 'function'
      ? new Set(insights.days.keys())
      : new Set();
    const sortedDays = Array.from(activeDays).sort();

    let currentStreak = 0;
    let longestStreak = 0;
    let streakCount = 0;

    if (sortedDays.length > 0) {
      longestStreak = 1;
      streakCount = 1;
      for (let i = 1; i < sortedDays.length; i++) {
        const prev = new Date(sortedDays[i - 1] + 'T12:00:00');
        const curr = new Date(sortedDays[i] + 'T12:00:00');
        const diffDays = Math.round((curr - prev) / DAY_MS);
        if (diffDays === 1) {
          streakCount++;
          if (streakCount > longestStreak) longestStreak = streakCount;
        } else if (diffDays > 1) {
          streakCount = 1;
        }
      }
      const todayStr = todayKey;
      const yesterday = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() - 1);
      const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
      if (activeDays.has(todayStr) || activeDays.has(yesterdayStr)) {
        currentStreak = streakCount;
      }
    }

    // 7-day flame history (last 7 days ending today)
    const streakFlames = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const active = (insights.days && typeof insights.days.get === 'function' && (insights.days.get(key) || 0) > 0) || false;
      streakFlames.push(active);
    }

    const streakFormatted = isRu
      ? `${currentStreak} ${getRussianDaysPlural(currentStreak)}`
      : `${currentStreak} ${currentStreak === 1 ? 'day' : 'days'}`;
    const streakSubFormatted = isRu
      ? `${currentStreak} ${getRussianDaysPlural(currentStreak)} подряд`
      : `${currentStreak} day streak`;

    // 5. Record Day
    let recordDay = null;
    if (insights.record && insights.record.ms > 0) {
      recordDay = {
        day: insights.record.day,
        ms: insights.record.ms,
        formattedTime: formatListeningTime(insights.record.ms, isRu),
        formattedDate: formatDateKey(insights.record.day, isRu)
      };
    }

    // 6. Behavioral Metrics
    let completedCount = 0;
    plays.forEach(p => {
      if (p.finished === 1 || p.finished === true) completedCount++;
    });
    const completionRate = totalPlays > 0 ? Math.round((completedCount / totalPlays) * 100) : 0;
    const discoveryRate = totalPlays > 0 ? Math.round((uniqueTracks / totalPlays) * 100) : 0;
    const replayedCount = Object.values(trackCounts).filter(c => c > 1).length;
    const repeatRate = uniqueTracks > 0 ? Math.round((replayedCount / uniqueTracks) * 100) : 0;

    // 7. Peak Hour & 24h Distribution
    const hours = Array.isArray(insights.hours) ? insights.hours : Array(24).fill(0);
    let peakHour = -1;
    let maxHourMs = 0;
    hours.forEach((ms, h) => {
      if (ms > maxHourMs) {
        maxHourMs = ms;
        peakHour = h;
      }
    });
    const peakHourFormatted = peakHour >= 0 && maxHourMs > 0 ? `${String(peakHour).padStart(2, '0')}:00` : '—';
    const maxH = Math.max(...hours, 60000);
    const hoursDistribution = hours.map((ms, h) => ({
      hour: h,
      ms,
      isPeak: h === peakHour && ms > 0,
      heightPct: Math.max(8, Math.round((ms / maxH) * 100))
    }));

    // 8. Top 5 Artists
    const artistTimes = {};
    const artistSampleTrack = {};
    plays.forEach(p => {
      const t = trackMap.get(String(p.track));
      const artist = (t && t.artist) || (isRu ? 'Неизвестный исполнитель' : 'Unknown Artist');
      artistTimes[artist] = (artistTimes[artist] || 0) + (p.heard || 60000);
      if (!artistSampleTrack[artist] && t) {
        artistSampleTrack[artist] = t;
      }
    });

    const topArtists = Object.entries(artistTimes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, ms], idx) => {
        const mins = Math.round(ms / 60000);
        return {
          rank: idx + 1,
          name,
          ms,
          minutes: mins,
          formattedTime: isRu ? `${mins} мин` : `${mins} min`,
          sampleTrack: artistSampleTrack[name] || null
        };
      });

    // 9. Ritual Track
    let ritual = null;
    if (insights.ritual && insights.ritual.track) {
      const t = trackMap.get(String(insights.ritual.track));
      ritual = {
        trackId: String(insights.ritual.track),
        title: t?.title || (isRu ? 'Трек-ритуал' : 'Ritual track'),
        artist: t?.artist || (isRu ? 'Исполнитель' : 'Artist'),
        days: insights.ritual.days,
        formattedSub: isRu
          ? `${insights.ritual.days} ${getRussianDaysPlural(insights.ritual.days)} за 28 дней`
          : `${insights.ritual.days} days in last 28 days`,
        track: t || null
      };
    }

    // 10. Top 3 Tracks
    const topTracks = Object.entries(trackCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([trackId, count], idx) => {
        const t = trackMap.get(String(trackId));
        return {
          rank: idx + 1,
          trackId: String(trackId),
          title: t?.title || (isRu ? 'Без названия' : 'Untitled'),
          artist: t?.artist || (isRu ? 'Неизвестный исполнитель' : 'Unknown Artist'),
          plays: count,
          formattedPlays: isRu ? `${count} воспр.` : `${count} plays`,
          track: t || null
        };
      });

    // 11. Share summary text
    const shareText = isRu
      ? `🎵 Мой музыкальный профиль • Pain Audio Companion\n` +
        `⏱ Всего прослушано: ${totalFormatted} (${todayFormatted})\n` +
        `🔥 Серия прослушиваний: ${streakFormatted} подряд\n` +
        `🎧 Уникальных треков: ${uniqueTracks}\n` +
        (topTracks[0] ? `🏆 Главный трек: ${topTracks[0].artist} — ${topTracks[0].title} (${topTracks[0].formattedPlays})\n` : '') +
        (ritual ? `🔁 Трек-ритуал: ${ritual.artist} — ${ritual.title} (${ritual.formattedSub})\n` : '') +
        `✨ Слушай музыку в Pain: http://localhost:3000/?view=insights#profile`
      : `🎵 My Music Profile • Pain Audio Companion\n` +
        `⏱ Total listening: ${totalFormatted} (${todayFormatted})\n` +
        `🔥 Streak: ${streakFormatted}\n` +
        `🎧 Unique tracks: ${uniqueTracks}\n` +
        (topTracks[0] ? `🏆 Top track: ${topTracks[0].artist} — ${topTracks[0].title} (${topTracks[0].formattedPlays})\n` : '') +
        (ritual ? `🔁 Ritual track: ${ritual.artist} — ${ritual.title} (${ritual.formattedSub})\n` : '') +
        `✨ Listen with Pain: http://localhost:3000/?view=insights#profile`;

    return {
      lang,
      isRu,
      now,
      totalMs,
      totalFormatted,
      todayMinutes,
      todayFormatted,
      uniqueTracks,
      totalPlays,
      currentStreak,
      longestStreak,
      streakFlames,
      streakFormatted,
      streakSubFormatted,
      recordDay,
      completionRate,
      discoveryRate,
      repeatRate,
      peakHour,
      peakHourFormatted,
      hoursDistribution,
      topArtists,
      ritual,
      topTracks,
      shareText,
      shareUrl: 'http://localhost:3000/?view=insights#profile'
    };
  }

  function getRussianMinutesPlural(n) {
    const abs = Math.abs(n) % 100;
    const rem = abs % 10;
    if (abs > 10 && abs < 20) return 'минут';
    if (rem > 1 && rem < 5) return 'минуты';
    if (rem === 1) return 'минута';
    return 'минут';
  }

  function getRussianDaysPlural(n) {
    const abs = Math.abs(n) % 100;
    const rem = abs % 10;
    if (abs > 10 && abs < 20) return 'дней';
    if (rem > 1 && rem < 5) return 'дня';
    if (rem === 1) return 'день';
    return 'дней';
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Generates DOM HTML string for the live in-app preview card.
   */
  function renderProfileCardHtml(data, getCoverUrlFn) {
    const isRu = data.isRu;
    const coverUrl = track => {
      if (!track) return '';
      if (typeof getCoverUrlFn === 'function') return getCoverUrlFn(track);
      return `/api/cover/${encodeURIComponent(String(track.id).replace(/[/\\?%*:|"<>]/g, '_'))}`;
    };

    // Render waveform bars for hero card
    const heroWaveBars = Array.from({ length: 30 }, (_, i) => {
      const h = Math.round(18 + Math.sin(i * 0.45) * 14 + Math.cos(i * 0.9) * 8);
      return `<div class="share-wave-bar" style="height:${Math.max(6, h)}px;"></div>`;
    }).join('');

    // Render 7 flames
    const flameBadges = data.streakFlames.map(active => {
      return `<span class="share-flame-item ${active ? 'active' : 'dim'}">🔥</span>`;
    }).join('');

    // Render mini waveform for cards
    const miniWave = (count = 6) => {
      return `<div class="share-mini-wave">` +
        Array.from({ length: count }, (_, i) => {
          const h = [8, 16, 12, 20, 14, 10][i % 6];
          return `<div class="share-mini-bar" style="height:${h}px;"></div>`;
        }).join('') +
        `</div>`;
    };

    // Circular progress ring SVG helper
    const circularRing = (pct) => {
      const radius = 26;
      const circ = 2 * Math.PI * radius;
      const offset = circ - (pct / 100) * circ;
      return `
        <svg class="share-ring-svg" width="68" height="68" viewBox="0 0 68 68">
          <circle class="share-ring-bg" cx="34" cy="34" r="${radius}" />
          <circle class="share-ring-fill" cx="34" cy="34" r="${radius}"
            stroke-dasharray="${circ}" stroke-dashoffset="${offset}" />
        </svg>
      `;
    };

    // 24h mini histogram bars
    const histogramBars = data.hoursDistribution.map(h => {
      const barH = Math.round((h.heightPct / 100) * 32);
      return `<div class="share-hist-bar ${h.isPeak ? 'peak' : ''}" style="height:${Math.max(4, barH)}px;" title="${h.hour}:00"></div>`;
    }).join('');

    // Top artists HTML
    const artistsHtml = data.topArtists.length > 0
      ? data.topArtists.map(a => `
          <div class="share-artist-row">
            <span class="share-rank">#${a.rank}</span>
            <div class="share-artist-avatar">
              <img src="${coverUrl(a.sampleTrack)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
              <div class="share-artist-fallback" style="display:none;">${escapeHtml(a.name.slice(0, 2).toUpperCase())}</div>
            </div>
            <div class="share-artist-info">
              <div class="share-artist-name">${escapeHtml(a.name)}</div>
              <div class="share-artist-sub">${isRu ? 'Исполнитель' : 'Artist'} • ${a.formattedTime}</div>
            </div>
          </div>
        `).join('')
      : `<div class="share-empty-sub">${isRu ? 'Пока нет данных' : 'No data yet'}</div>`;

    // Ritual card HTML
    const ritualHtml = data.ritual
      ? `
        <div class="share-ritual-card">
          <div class="share-block-label">${isRu ? 'ТРЕК-РИТУАЛ' : 'DAILY RITUAL'}</div>
          <div class="share-ritual-body">
            <div class="share-track-thumb">
              <img src="${coverUrl(data.ritual.track)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
              <div class="share-track-fallback" style="display:none;">🎵</div>
            </div>
            <div class="share-ritual-info">
              <div class="share-track-title">${escapeHtml(data.ritual.title)}</div>
              <div class="share-track-artist">${escapeHtml(data.ritual.artist)}</div>
              <div class="share-ritual-badge">${escapeHtml(data.ritual.formattedSub)}</div>
            </div>
          </div>
        </div>
      `
      : `
        <div class="share-ritual-card">
          <div class="share-block-label">${isRu ? 'ТРЕК-РИТУАЛ' : 'DAILY RITUAL'}</div>
          <div class="share-empty-sub">${isRu ? 'Появится, когда вернётесь к треку в другой день' : 'Revisit a song on another day to see it here'}</div>
        </div>
      `;

    // Top tracks HTML
    const topTracksHtml = data.topTracks.length > 0
      ? data.topTracks.map(t => `
          <div class="share-track-row">
            <span class="share-rank">#${t.rank}</span>
            <div class="share-track-thumb">
              <img src="${coverUrl(t.track)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
              <div class="share-track-fallback" style="display:none;">🎵</div>
            </div>
            <div class="share-track-info">
              <div class="share-track-title">${escapeHtml(t.title)}</div>
              <div class="share-track-artist">${escapeHtml(t.artist)}</div>
            </div>
            <div class="share-track-badge">${escapeHtml(t.formattedPlays)}</div>
          </div>
        `).join('')
      : `<div class="share-empty-sub">${isRu ? 'Пока нет треков' : 'No tracks yet'}</div>`;

    return `
      <div class="share-profile-poster" id="sharePosterRoot">
        <!-- Floating artistic cursive quotes in background -->
        <div class="share-floating-quote quote-1">${isRu ? 'Музыка всегда рядом ♡' : 'Music is always near ♡'}</div>
        <div class="share-floating-quote quote-2">${isRu ? 'Твои истории звучат по-особенному ♡' : 'Your stories sound special ♡'}</div>
        <div class="share-floating-quote quote-3">${isRu ? 'Хорошая музыка делает дни ярче ♡' : 'Good music makes days brighter ♡'}</div>
        <div class="share-floating-quote quote-4">${isRu ? 'Слушай. Открывай. Чувствуй. ♡' : 'Listen. Discover. Feel. ♡'}</div>

        <!-- Poster Header -->
        <header class="share-poster-header">
          <div class="share-brand-pill">
            <img src="/assets/app-icon.png" class="share-brand-leaf" alt="Pain">
            <span class="share-brand-text">Pain <strong>AUDIO COMPANION</strong></span>
          </div>
          <div class="share-subtitle-tag">${isRu ? 'БОЛЬШЕ ЧЕМ ПРОСТО МУЗЫКА' : 'MORE THAN JUST MUSIC'}</div>
          <h1 class="share-poster-title">${isRu ? 'Мой музыкальный профиль' : 'My Music Profile'}</h1>
          <div class="share-period-badge">${isRu ? 'Pain Audio Companion • последние 28 дней' : 'Pain Audio Companion • last 28 days'}</div>
        </header>

        <!-- Hero Card: Total Listening & Vinyl Record -->
        <section class="share-hero-card">
          <div class="share-hero-left">
            <div class="share-card-meta-label">${isRu ? 'ВСЕГО ПРОСЛУШАНО' : 'TOTAL LISTENING'}</div>
            <div class="share-hero-bignum">${escapeHtml(data.totalFormatted)}</div>
            <div class="share-hero-wave">${heroWaveBars}</div>
            <div class="share-hero-sub">${escapeHtml(data.todayFormatted)}</div>
          </div>
          <div class="share-hero-right">
            <div class="share-vinyl-wrapper">
              <div class="share-vinyl-disc">
                <div class="share-vinyl-sheen"></div>
                <div class="share-vinyl-grooves"></div>
                <div class="share-vinyl-label">
                  <img src="/assets/app-icon.png" class="share-vinyl-logo" alt="">
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- Row 1: 3 Stat Cards -->
        <section class="share-row-three">
          <!-- Unique Tracks -->
          <div class="share-stat-card">
            <div class="share-card-meta-label">${isRu ? 'УНИКАЛЬНЫХ ТРЕКОВ' : 'UNIQUE TRACKS'}</div>
            <div class="share-stat-bignum">${data.uniqueTracks}</div>
            ${miniWave(6)}
          </div>

          <!-- Streak Card -->
          <div class="share-stat-card">
            <div class="share-card-meta-label">${isRu ? 'СЕРИЯ ПРОСЛУШИВАНИЙ' : 'LISTENING STREAK'}</div>
            <div class="share-stat-bignum">${escapeHtml(data.streakFormatted)}</div>
            <div class="share-flame-row">${flameBadges}</div>
            <div class="share-sub-text">${escapeHtml(data.streakSubFormatted)}</div>
          </div>

          <!-- Record Day Card -->
          <div class="share-stat-card">
            <div class="share-card-meta-label">${isRu ? 'САМЫЙ МУЗЫКАЛЬНЫЙ ДЕНЬ' : 'BIGGEST MUSIC DAY'}</div>
            <div class="share-stat-bignum">${data.recordDay ? escapeHtml(data.recordDay.formattedTime) : '—'}</div>
            <div class="share-sub-text">${data.recordDay ? escapeHtml(data.recordDay.formattedDate) : (isRu ? 'Пока нет данных' : 'No data')}</div>
            ${miniWave(6)}
          </div>
        </section>

        <!-- Row 2: 4 Circular & Graph Cards -->
        <section class="share-row-four">
          <!-- Completed -->
          <div class="share-circle-card">
            <div class="share-card-meta-label">${isRu ? 'ДОСЛУШАНО ДО КОНЦА' : 'COMPLETED'}</div>
            <div class="share-ring-box">
              ${circularRing(data.completionRate)}
              <span class="share-ring-value">${data.completionRate}%</span>
            </div>
          </div>

          <!-- Discovery -->
          <div class="share-circle-card">
            <div class="share-card-meta-label">${isRu ? 'ОТКРЫТИЕ НОВОГО' : 'DISCOVERY'}</div>
            <div class="share-ring-box">
              ${circularRing(data.discoveryRate)}
              <span class="share-ring-value">${data.discoveryRate}%</span>
            </div>
          </div>

          <!-- Repeat -->
          <div class="share-circle-card">
            <div class="share-card-meta-label">${isRu ? 'НА ПОВТОРЕ' : 'ON REPEAT'}</div>
            <div class="share-ring-box">
              ${circularRing(data.repeatRate)}
              <span class="share-ring-value">${data.repeatRate}%</span>
            </div>
          </div>

          <!-- Peak Hour -->
          <div class="share-circle-card">
            <div class="share-card-meta-label">${isRu ? 'ПИКОВОЕ ВРЕМЯ' : 'PEAK HOUR'}</div>
            <div class="share-peak-box">
              <div class="share-peak-value">${escapeHtml(data.peakHourFormatted)}</div>
              <div class="share-hist-row">${histogramBars}</div>
            </div>
          </div>
        </section>

        <!-- Row 3: Top Artists & (Ritual + Top Tracks) -->
        <section class="share-row-two-col">
          <!-- Left Column: Top Artists -->
          <div class="share-col-card">
            <div class="share-col-header">
              <div class="share-block-label">${isRu ? 'ЛЮБИМЫЕ ИСПОЛНИТЕЛИ' : 'TOP ARTISTS'}</div>
            </div>
            <div class="share-artists-list">
              ${artistsHtml}
            </div>
          </div>

          <!-- Right Column: Ritual Track + Top Tracks -->
          <div class="share-col-card-split">
            ${ritualHtml}

            <div class="share-top-tracks-box">
              <div class="share-block-label">${isRu ? 'ГЛАВНЫЕ ТРЕКИ' : 'TOP TRACKS'}</div>
              <div class="share-tracks-list">
                ${topTracksHtml}
              </div>
            </div>
          </div>
        </section>

        <!-- Poster Footer -->
        <footer class="share-poster-footer">
          <div class="share-footer-pill">
            <img src="/assets/app-icon.png" class="share-footer-leaf" alt="">
            <span>Pain AUDIO COMPANION</span>
          </div>
        </footer>
      </div>
    `;
  }

  /**
   * Helper to draw a rounded rectangle on Canvas 2D.
   */
  function roundRect(ctx, x, y, width, height, radius) {
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(x, y, width, height, radius);
      return;
    }
    let r = radius;
    if (typeof r === 'number') {
      r = { tl: r, tr: r, br: r, bl: r };
    } else {
      r = Object.assign({ tl: 0, tr: 0, br: 0, bl: 0 }, r);
    }
    ctx.beginPath();
    ctx.moveTo(x + r.tl, y);
    ctx.lineTo(x + width - r.tr, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r.tr);
    ctx.lineTo(x + width, y + height - r.br);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r.br, y + height);
    ctx.lineTo(x + r.bl, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r.bl);
    ctx.lineTo(x, y + r.tl);
    ctx.quadraticCurveTo(x, y, x + r.tl, y);
    ctx.closePath();
  }

  /**
   * Helper to load an image into an HTMLImageElement asynchronously.
   */
  function loadImage(src) {
    return new Promise(resolve => {
      if (!src) return resolve(null);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  /**
   * High-resolution Canvas 2D renderer for downloading and copying the poster.
   * Renders at 1080 × 1350 px (Instagram / HD portrait ratio).
   */
  async function renderProfileCardCanvas(data, getCoverUrlFn) {
    const W = 1080;
    const H = 1350;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    const isRu = data.isRu;

    // Load leaf logo image
    const logoImg = await loadImage('/assets/app-icon.png');

    // Preload top covers
    const coverPromises = [];
    const coverMap = new Map();

    const fetchCover = async (track) => {
      if (!track || !track.id) return null;
      const url = typeof getCoverUrlFn === 'function'
        ? getCoverUrlFn(track)
        : `/api/cover/${encodeURIComponent(String(track.id).replace(/[/\\?%*:|"<>]/g, '_'))}`;
      const img = await loadImage(url);
      if (img) coverMap.set(String(track.id), img);
      return img;
    };

    if (data.ritual && data.ritual.track) {
      coverPromises.push(fetchCover(data.ritual.track));
    }
    data.topTracks.forEach(t => {
      if (t.track) coverPromises.push(fetchCover(t.track));
    });
    data.topArtists.forEach(a => {
      if (a.sampleTrack) coverPromises.push(fetchCover(a.sampleTrack));
    });

    try {
      await Promise.all(coverPromises);
    } catch (_) {}

    // 1. Background deep gradient
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#0a0815');
    bgGrad.addColorStop(0.35, '#120c22');
    bgGrad.addColorStop(0.7, '#160d2a');
    bgGrad.addColorStop(1, '#080611');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // Ambient radial glow orbs
    const glow1 = ctx.createRadialGradient(240, 260, 20, 240, 260, 420);
    glow1.addColorStop(0, 'rgba(147, 51, 234, 0.16)');
    glow1.addColorStop(1, 'rgba(147, 51, 234, 0)');
    ctx.fillStyle = glow1;
    ctx.fillRect(0, 0, W, H);

    const glow2 = ctx.createRadialGradient(880, 520, 20, 880, 520, 380);
    glow2.addColorStop(0, 'rgba(217, 70, 239, 0.12)');
    glow2.addColorStop(1, 'rgba(217, 70, 239, 0)');
    ctx.fillStyle = glow2;
    ctx.fillRect(0, 0, W, H);

    const glow3 = ctx.createRadialGradient(400, 1100, 30, 400, 1100, 480);
    glow3.addColorStop(0, 'rgba(99, 102, 241, 0.13)');
    glow3.addColorStop(1, 'rgba(99, 102, 241, 0)');
    ctx.fillStyle = glow3;
    ctx.fillRect(0, 0, W, H);

    // 2. Artistic Cursive Floating Quotes in Background
    ctx.save();
    ctx.font = 'italic 26px "Caveat", "Segoe Script", "Comfortaa", cursive, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';

    // Quote 1: Top-Left
    ctx.save();
    ctx.translate(140, 150);
    ctx.rotate(-0.16);
    ctx.fillText(isRu ? 'Музыка всегда рядом ♡' : 'Music is always near ♡', 0, 0);
    ctx.restore();

    // Quote 2: Mid-Right
    ctx.save();
    ctx.translate(760, 420);
    ctx.rotate(0.12);
    ctx.fillText(isRu ? 'Твои истории звучат по-особенному ♡' : 'Your stories sound special ♡', 0, 0);
    ctx.restore();

    // Quote 3: Mid-Left
    ctx.save();
    ctx.translate(60, 710);
    ctx.rotate(-0.08);
    ctx.fillText(isRu ? 'Хорошая музыка делает дни ярче ♡' : 'Good music makes days brighter ♡', 0, 0);
    ctx.restore();

    // Quote 4: Bottom-Right
    ctx.save();
    ctx.translate(720, 1280);
    ctx.rotate(-0.10);
    ctx.fillText(isRu ? 'Слушай. Открывай. Чувствуй. ♡' : 'Listen. Discover. Feel. ♡', 0, 0);
    ctx.restore();

    ctx.restore();

    // 3. Header Section
    // Brand Pill (Pain AUDIO COMPANION)
    const pillW = 220;
    const pillH = 34;
    const pillX = (W - pillW) / 2;
    const pillY = 38;

    roundRect(ctx, pillX, pillY, pillW, pillH, 17);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.lineWidth = 1;
    ctx.stroke();

    if (logoImg) {
      ctx.drawImage(logoImg, pillX + 14, pillY + 7, 20, 20);
    }
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Pain', pillX + 40, pillY + 22);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('AUDIO COMPANION', pillX + 74, pillY + 22);

    // Subtitle Tag
    ctx.textAlign = 'center';
    ctx.font = '700 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = 'rgba(192, 132, 252, 0.9)';
    ctx.fillText(isRu ? 'БОЛЬШЕ ЧЕМ ПРОСТО МУЗЫКА' : 'MORE THAN JUST MUSIC', W / 2, 96);

    // Main Title
    ctx.font = 'bold 36px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(isRu ? 'Мой музыкальный профиль' : 'My Music Profile', W / 2, 138);

    // Period Tag
    const tagW = 280;
    const tagH = 26;
    const tagX = (W - tagW) / 2;
    const tagY = 152;
    roundRect(ctx, tagX, tagY, tagW, tagH, 13);
    ctx.fillStyle = 'rgba(168, 85, 247, 0.15)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(168, 85, 247, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.font = '500 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#e9d5ff';
    ctx.fillText(isRu ? 'Pain Audio Companion • последние 28 дней' : 'Pain Audio Companion • last 28 days', W / 2, 169);

    // 4. Hero Card (Total Listening & Vinyl)
    const heroX = 40;
    const heroY = 196;
    const heroW = W - 80;
    const heroH = 194;

    // Card background
    roundRect(ctx, heroX, heroY, heroW, heroH, 20);
    const heroBg = ctx.createLinearGradient(heroX, heroY, heroX + heroW, heroY + heroH);
    heroBg.addColorStop(0, 'rgba(28, 20, 48, 0.85)');
    heroBg.addColorStop(1, 'rgba(18, 12, 32, 0.92)');
    ctx.fillStyle = heroBg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Hero Left Text
    ctx.textAlign = 'left';
    ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.fillText(isRu ? 'ВСЕГО ПРОСЛУШАНО' : 'TOTAL LISTENING', heroX + 32, heroY + 38);

    ctx.font = '800 44px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(data.totalFormatted, heroX + 32, heroY + 92);

    // Waveform bars
    const waveX = heroX + 32;
    const waveY = heroY + 114;
    const numWaveBars = 28;
    for (let i = 0; i < numWaveBars; i++) {
      const bh = Math.round(14 + Math.sin(i * 0.45) * 12 + Math.cos(i * 0.9) * 8);
      const barGrad = ctx.createLinearGradient(0, waveY + 24 - bh, 0, waveY + 24);
      barGrad.addColorStop(0, '#c084fc');
      barGrad.addColorStop(1, '#7c3aed');
      ctx.fillStyle = barGrad;
      roundRect(ctx, waveX + i * 11, waveY + 24 - bh, 5, bh, 2.5);
      ctx.fill();
    }

    ctx.font = '500 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.fillText(data.todayFormatted, heroX + 32, heroY + 168);

    // Vinyl Record (Hero Right)
    const vinylCenterX = heroX + heroW - 105;
    const vinylCenterY = heroY + heroH / 2;
    const vinylR = 76;

    // Dark Vinyl Disc
    ctx.save();
    ctx.beginPath();
    ctx.arc(vinylCenterX, vinylCenterY, vinylR, 0, Math.PI * 2);
    const vinylGrad = ctx.createRadialGradient(vinylCenterX, vinylCenterY, 5, vinylCenterX, vinylCenterY, vinylR);
    vinylGrad.addColorStop(0, '#111018');
    vinylGrad.addColorStop(0.35, '#1e1c2a');
    vinylGrad.addColorStop(0.7, '#13111d');
    vinylGrad.addColorStop(1, '#0a0910');
    ctx.fillStyle = vinylGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Concentric Grooves
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    [32, 40, 48, 56, 64, 70].forEach(r => {
      ctx.beginPath();
      ctx.arc(vinylCenterX, vinylCenterY, r, 0, Math.PI * 2);
      ctx.stroke();
    });

    // Vinyl Light Sheen (glossy reflections)
    const sheenGrad = ctx.createConicGradient(-0.8, vinylCenterX, vinylCenterY);
    sheenGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
    sheenGrad.addColorStop(0.12, 'rgba(255, 255, 255, 0.12)');
    sheenGrad.addColorStop(0.25, 'rgba(255, 255, 255, 0)');
    sheenGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
    sheenGrad.addColorStop(0.62, 'rgba(255, 255, 255, 0.12)');
    sheenGrad.addColorStop(0.75, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = sheenGrad;
    ctx.beginPath();
    ctx.arc(vinylCenterX, vinylCenterY, vinylR - 2, 0, Math.PI * 2);
    ctx.fill();

    // Center Label
    ctx.beginPath();
    ctx.arc(vinylCenterX, vinylCenterY, 26, 0, Math.PI * 2);
    ctx.fillStyle = '#8b5cf6';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    if (logoImg) {
      ctx.drawImage(logoImg, vinylCenterX - 13, vinylCenterY - 13, 26, 26);
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('P', vinylCenterX, vinylCenterY + 4);
    }

    // Center spindle hole
    ctx.beginPath();
    ctx.arc(vinylCenterX, vinylCenterY, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#0a0910';
    ctx.fill();
    ctx.restore();

    // 5. Row 1: 3 Stat Cards
    const row1Y = 404;
    const cardGap = 16;
    const cardW = (W - 80 - cardGap * 2) / 3;
    const cardH = 120;

    // Card 1: Unique Tracks
    const c1X = 40;
    roundRect(ctx, c1X, row1Y, cardW, cardH, 16);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.fillText(isRu ? 'УНИКАЛЬНЫХ ТРЕКОВ' : 'UNIQUE TRACKS', c1X + 20, row1Y + 30);

    ctx.font = '800 36px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(data.uniqueTracks), c1X + 20, row1Y + 76);

    // Mini wave
    for (let i = 0; i < 6; i++) {
      const bh = [8, 18, 12, 22, 14, 10][i];
      ctx.fillStyle = '#a855f7';
      roundRect(ctx, c1X + cardW - 70 + i * 8, row1Y + 76 - bh, 4, bh, 2);
      ctx.fill();
    }

    // Card 2: Streak
    const c2X = c1X + cardW + cardGap;
    roundRect(ctx, c2X, row1Y, cardW, cardH, 16);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.stroke();

    ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.fillText(isRu ? 'СЕРИЯ ПРОСЛУШИВАНИЙ' : 'LISTENING STREAK', c2X + 20, row1Y + 30);

    ctx.font = '800 32px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(data.streakFormatted, c2X + 20, row1Y + 70);

    // Flames row
    data.streakFlames.forEach((active, idx) => {
      ctx.font = '16px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
      ctx.fillStyle = active ? '#f97316' : 'rgba(255, 255, 255, 0.2)';
      ctx.fillText('🔥', c2X + 20 + idx * 22, row1Y + 96);
    });

    ctx.font = '500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.fillText(data.streakSubFormatted, c2X + 20 + 7 * 22 + 4, row1Y + 95);

    // Card 3: Record Day
    const c3X = c2X + cardW + cardGap;
    roundRect(ctx, c3X, row1Y, cardW, cardH, 16);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.stroke();

    ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.fillText(isRu ? 'САМЫЙ МУЗЫКАЛЬНЫЙ ДЕНЬ' : 'BIGGEST MUSIC DAY', c3X + 20, row1Y + 30);

    ctx.font = '800 30px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(data.recordDay ? data.recordDay.formattedTime : '—', c3X + 20, row1Y + 70);

    ctx.font = '500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.fillText(data.recordDay ? data.recordDay.formattedDate : (isRu ? 'Пока нет данных' : 'No data'), c3X + 20, row1Y + 95);

    // 6. Row 2: 4 Circular & Metric Cards
    const row2Y = 538;
    const card4Gap = 16;
    const card4W = (W - 80 - card4Gap * 3) / 4;
    const card4H = 136;

    const renderCircleCard = (x, label, pct) => {
      roundRect(ctx, x, row2Y, card4W, card4H, 16);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.fillText(label, x + card4W / 2, row2Y + 28);

      const ringCenterX = x + card4W / 2;
      const ringCenterY = row2Y + 80;
      const ringR = 30;

      // Ring background
      ctx.beginPath();
      ctx.arc(ringCenterX, ringCenterY, ringR, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 5;
      ctx.stroke();

      // Ring progress
      const startAngle = -Math.PI / 2;
      const endAngle = startAngle + (pct / 100) * (Math.PI * 2);
      ctx.beginPath();
      ctx.arc(ringCenterX, ringCenterY, ringR, startAngle, endAngle);
      const ringGrad = ctx.createLinearGradient(x, row2Y, x + card4W, row2Y + card4H);
      ringGrad.addColorStop(0, '#c084fc');
      ringGrad.addColorStop(1, '#e879f9');
      ctx.strokeStyle = ringGrad;
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.lineCap = 'butt';

      ctx.font = '800 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`${pct}%`, ringCenterX, ringCenterY + 5);
    };

    // 1. Completion Rate
    renderCircleCard(40, isRu ? 'ДОСЛУШАНО ДО КОНЦА' : 'COMPLETED', data.completionRate);

    // 2. Discovery Rate
    renderCircleCard(40 + card4W + card4Gap, isRu ? 'ОТКРЫТИЕ НОВОГО' : 'DISCOVERY', data.discoveryRate);

    // 3. Repeat Rate
    renderCircleCard(40 + (card4W + card4Gap) * 2, isRu ? 'НА ПОВТОРЕ' : 'ON REPEAT', data.repeatRate);

    // 4. Peak Hour Card (Histogram)
    const c4X = 40 + (card4W + card4Gap) * 3;
    roundRect(ctx, c4X, row2Y, card4W, card4H, 16);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.fillText(isRu ? 'ПИКОВОЕ ВРЕМЯ' : 'PEAK HOUR', c4X + card4W / 2, row2Y + 28);

    ctx.font = '800 24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(data.peakHourFormatted, c4X + card4W / 2, row2Y + 64);

    // 24h mini bars
    const histStartX = c4X + 16;
    const histW = card4W - 32;
    const barStep = histW / 24;
    data.hoursDistribution.forEach((h, idx) => {
      const bh = Math.round((h.heightPct / 100) * 32);
      ctx.fillStyle = h.isPeak ? '#f43f5e' : 'rgba(168, 85, 247, 0.4)';
      roundRect(ctx, histStartX + idx * barStep, row2Y + 118 - bh, Math.max(3, barStep - 2), bh, 1.5);
      ctx.fill();
    });

    // 7. Row 3: Top Artists (Left) & Ritual + Top Tracks (Right)
    const row3Y = 688;
    const splitGap = 20;
    const colW = (W - 80 - splitGap) / 2;
    const colH = 550;

    // Left Column: Top Artists
    const leftX = 40;
    roundRect(ctx, leftX, row3Y, colW, colH, 20);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.font = 'bold 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fillText(isRu ? 'ЛЮБИМЫЕ ИСПОЛНИТЕЛИ' : 'TOP ARTISTS', leftX + 24, row3Y + 36);

    const artistRowH = 86;
    const artistStartY = row3Y + 54;
    data.topArtists.slice(0, 5).forEach((artist, idx) => {
      const ay = artistStartY + idx * artistRowH;

      // Rank
      ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.fillText(`#${artist.rank}`, leftX + 24, ay + 38);

      // Avatar circle
      const avatarX = leftX + 58;
      const avatarY = ay + 12;
      const avatarR = 24;

      ctx.save();
      ctx.beginPath();
      ctx.arc(avatarX + avatarR, avatarY + avatarR, avatarR, 0, Math.PI * 2);
      ctx.clip();

      const sampleTrackId = artist.sampleTrack ? String(artist.sampleTrack.id) : null;
      const artCover = sampleTrackId ? coverMap.get(sampleTrackId) : null;
      if (artCover) {
        ctx.drawImage(artCover, avatarX, avatarY, avatarR * 2, avatarR * 2);
      } else {
        ctx.fillStyle = '#2d2242';
        ctx.fillRect(avatarX, avatarY, avatarR * 2, avatarR * 2);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 15px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(artist.name.slice(0, 2).toUpperCase(), avatarX + avatarR, avatarY + avatarR + 5);
      }
      ctx.restore();

      // Artist Name & sub
      ctx.textAlign = 'left';
      ctx.font = '700 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = '#ffffff';
      const maxTextW = colW - 140;
      const displayName = truncateText(ctx, artist.name, maxTextW);
      ctx.fillText(displayName, leftX + 118, ay + 32);

      ctx.font = '500 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.fillText(`${isRu ? 'Исполнитель' : 'Artist'} • ${artist.formattedTime}`, leftX + 118, ay + 52);
    });

    // Right Column: Split into Ritual (Top) & Top Tracks (Bottom)
    const rightX = leftX + colW + splitGap;

    // Ritual Card
    const ritualCardH = 170;
    roundRect(ctx, rightX, row3Y, colW, ritualCardH, 20);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.fillText(isRu ? 'ТРЕК-РИТУАЛ' : 'DAILY RITUAL', rightX + 24, row3Y + 34);

    if (data.ritual) {
      // Cover thumbnail
      const rThumbX = rightX + 24;
      const rThumbY = row3Y + 48;
      const rThumbSize = 72;

      ctx.save();
      roundRect(ctx, rThumbX, rThumbY, rThumbSize, rThumbSize, 12);
      ctx.clip();
      const rCover = coverMap.get(data.ritual.trackId);
      if (rCover) {
        ctx.drawImage(rCover, rThumbX, rThumbY, rThumbSize, rThumbSize);
      } else {
        ctx.fillStyle = '#2d2242';
        ctx.fillRect(rThumbX, rThumbY, rThumbSize, rThumbSize);
        ctx.fillStyle = '#ffffff';
        ctx.font = '28px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('🎵', rThumbX + rThumbSize / 2, rThumbY + rThumbSize / 2 + 10);
      }
      ctx.restore();

      // Info
      ctx.textAlign = 'left';
      ctx.font = '700 17px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(truncateText(ctx, data.ritual.title, colW - 120), rightX + 110, row3Y + 74);

      ctx.font = '500 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.fillText(truncateText(ctx, data.ritual.artist, colW - 120), rightX + 110, row3Y + 96);

      // Badge
      ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = '#c084fc';
      ctx.fillText(data.ritual.formattedSub, rightX + 110, row3Y + 118);
    } else {
      ctx.font = '500 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.fillText(isRu ? 'Появится при регулярных возвращениях к песням' : 'Will appear when you return to a track often', rightX + 24, row3Y + 70);
    }

    // Top Tracks Box
    const topTracksY = row3Y + ritualCardH + 18;
    const topTracksH = colH - ritualCardH - 18;
    roundRect(ctx, rightX, topTracksY, colW, topTracksH, 20);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.fillText(isRu ? 'ГЛАВНЫЕ ТРЕКИ' : 'TOP TRACKS', rightX + 24, topTracksY + 34);

    const trackRowH = 84;
    const trackStartY = topTracksY + 48;
    data.topTracks.slice(0, 3).forEach((track, idx) => {
      const ty = trackStartY + idx * trackRowH;

      // Rank
      ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.fillText(`#${track.rank}`, rightX + 24, ty + 36);

      // Cover
      const tThumbX = rightX + 56;
      const tThumbY = ty + 8;
      const tThumbSize = 52;

      ctx.save();
      roundRect(ctx, tThumbX, tThumbY, tThumbSize, tThumbSize, 10);
      ctx.clip();
      const tCover = coverMap.get(track.trackId);
      if (tCover) {
        ctx.drawImage(tCover, tThumbX, tThumbY, tThumbSize, tThumbSize);
      } else {
        ctx.fillStyle = '#2d2242';
        ctx.fillRect(tThumbX, tThumbY, tThumbSize, tThumbSize);
        ctx.fillStyle = '#ffffff';
        ctx.font = '20px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('🎵', tThumbX + tThumbSize / 2, tThumbY + tThumbSize / 2 + 7);
      }
      ctx.restore();

      // Title & Artist
      ctx.textAlign = 'left';
      ctx.font = '700 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(truncateText(ctx, track.title, colW - 220), rightX + 120, ty + 30);

      ctx.font = '500 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.fillText(truncateText(ctx, track.artist, colW - 220), rightX + 120, ty + 50);

      // Badge (plays)
      ctx.font = '600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = '#c084fc';
      ctx.textAlign = 'right';
      ctx.fillText(track.formattedPlays, rightX + colW - 24, ty + 38);
    });

    // 8. Poster Footer
    const footPillW = 220;
    const footPillH = 34;
    const footPillX = (W - footPillW) / 2;
    const footPillY = H - 54;

    roundRect(ctx, footPillX, footPillY, footPillW, footPillH, 17);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();

    if (logoImg) {
      ctx.drawImage(logoImg, footPillX + 16, footPillY + 7, 20, 20);
    }
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Pain AUDIO COMPANION', footPillX + 44, footPillY + 22);

    return canvas;
  }

  function truncateText(ctx, text, maxWidth) {
    if (!text) return '';
    if (ctx.measureText(text).width <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) {
      t = t.slice(0, -1);
    }
    return t + '…';
  }

  /**
   * Triggers download of the canvas poster as PNG.
   */
  function downloadProfileCardPng(canvas, filename) {
    if (!canvas || typeof canvas.toBlob !== 'function') return false;
    const fname = filename || `pain-profile-${new Date().toISOString().slice(0, 10)}.png`;
    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 4000);
    }, 'image/png');
    return true;
  }

  /**
   * Copies the canvas image directly to clipboard.
   */
  async function copyProfileCardImage(canvas) {
    if (!canvas || typeof canvas.toBlob !== 'function') {
      throw new Error('Canvas not available');
    }
    return new Promise((resolve, reject) => {
      canvas.toBlob(async blob => {
        if (!blob) return reject(new Error('Failed to create PNG blob'));
        try {
          if (navigator.clipboard && typeof navigator.clipboard.write === 'function' && typeof ClipboardItem !== 'undefined') {
            await navigator.clipboard.write([
              new ClipboardItem({ 'image/png': blob })
            ]);
            resolve(true);
          } else {
            reject(new Error('Clipboard write not supported'));
          }
        } catch (err) {
          reject(err);
        }
      }, 'image/png');
    });
  }

  /**
   * Shares link and summary text via Web Share API or falls back to clipboard copy.
   */
  async function shareProfile(data) {
    const text = data.shareText || 'Pain Audio Companion';
    const url = data.shareUrl || window.location.href;

    if (navigator.share) {
      try {
        await navigator.share({
          title: data.isRu ? 'Мой музыкальный профиль • Pain' : 'My Music Profile • Pain',
          text,
          url
        });
        return { shared: true, method: 'native' };
      } catch (err) {
        if (err.name === 'AbortError') return { shared: false, cancelled: true };
      }
    }

    // Fallback: Copy to clipboard
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(`${text}\n\n${url}`);
      return { shared: true, method: 'clipboard' };
    }

    return { shared: false, method: 'none' };
  }

  return {
    collectProfileData,
    renderProfileCardHtml,
    renderProfileCardCanvas,
    downloadProfileCardPng,
    copyProfileCardImage,
    shareProfile,
    formatListeningTime,
    formatDateKey
  };
});
