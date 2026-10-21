/**
 * Pain Audio Companion — Presence Engine: Generative Grammar & Surface Realization Module
 * Grounded, localized observations with explicit subjects.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PresenceGrammar = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * Safe Russian pluralization: (count, 'раз', 'раза', 'раз')
   */
  function pluralizeRu(count, one, few, many) {
    const abs = Math.abs(Number(count)) % 100;
    const rem = abs % 10;
    if (abs > 10 && abs < 20) return many;
    if (rem > 1 && rem < 5) return few;
    if (rem === 1) return one;
    return many;
  }

  function safeArtist(artistName) {
    if (!artistName || /unknown|неизвестн/i.test(artistName)) return 'музыки';
    return String(artistName).trim();
  }

  function safeTitle(title) {
    if (!title) return 'этой песни';
    return String(title).trim();
  }

  const BLACKLIST_PATTERNS = [
    /отличный выбор/i,
    /рады видеть/i,
    /наслаждайтесь/i,
    /музыкальный вайб/i,
    /настоящий фанат/i,
    /музыкальное путешествие/i,
    /вау/i,
    /добро пожаловать/i,
    /приветствуем/i,
    /🔥/,
    /🎵/,
    /✨.*✨/,
    /!{2,}/,
    /же ведь/i,
    /ведь же/i,
    /снова.*снова.*снова/i,
    /опять.*опять/i,
    /сегодня.*сегодня/i
  ];

  function passesNaturalnessCheck(text) {
    if (!text || typeof text !== 'string') return false;
    const trimmed = text.trim();
    if (trimmed.length < 3 || trimmed.length > 95) return false;

    for (let i = 0; i < BLACKLIST_PATTERNS.length; i++) {
      if (BLACKLIST_PATTERNS[i].test(trimmed)) return false;
    }

    if ((trimmed.match(/!/g) || []).length > 1) return false;

    const words = trimmed.toLowerCase().replace(/[.,—:!?]/g, '').split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length - 1; i++) {
      if (words[i] === words[i + 1] && words[i].length > 2) return false;
    }

    return true;
  }

  // Every variant names its subject and states only facts present in the plan.
  // Names remain uninflected, in both languages.
  const shortName = value => {
    const chars = Array.from(String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim());
    return chars.length > 44 ? chars.slice(0, 43).join('') + '…' : chars.join('');
  };
  function greeting(hour, lang) {
    const ru = lang !== 'en';
    if (hour >= 5 && hour < 12) return ru ? 'Доброе утро' : 'Good morning';
    if (hour >= 12 && hour < 18) return ru ? 'Добрый день' : 'Good afternoon';
    if (hour >= 18 && hour < 23) return ru ? 'Добрый вечер' : 'Good evening';
    return ru ? 'Доброй ночи' : 'Good evening';
  }
  function factualPhrases(plan, lang) {
    const f = plan.facts || {}, ru = lang !== 'en';
    const title = shortName(f.title), artist = shortName(f.artist);
    const count = f.count, session = f.period === 'session';
    const period = ru ? (session ? 'В этой сессии' : 'Сегодня') : (session ? 'This session' : 'Today');
    const times = pluralizeRu(count, 'раз', 'раза', 'раз');
    switch (plan.intent) {
      case 'single_track_loop':
        return ru ? [`${period}: «${title}» — ${count} ${times}`, `«${title}»: ${count} ${times} ${session ? 'за сессию' : 'за сегодня'}`]
          : [`${period}: “${title}” — ${count} plays`, `“${title}”: played ${count} times ${session ? 'this session' : 'today'}`];
      case 'compound_consecutive_days_track': {
        const days = f.dayCount, word = pluralizeRu(days, 'день', 'дня', 'дней');
        return ru ? [`«${title}» — ${days} ${word} подряд`, `${days} ${word} подряд слушаешь «${title}»`]
          : [`“${title}” — ${days} days in a row`, `Listening to “${title}” for ${days} consecutive days`];
      }
      case 'artist_monopoly':
      case 'compound_night_and_artist':
        return ru ? [`${period} чаще всего: ${artist}`, `${artist} — больше всего прослушиваний ${session ? 'за сессию' : 'сегодня'}`, `${period} в лидерах ${artist}`]
          : [`${period}'s most played: ${artist}`, `${artist} leads your ${session ? 'session' : 'day'}`, `Most plays ${session ? 'this session' : 'today'}: ${artist}`];
      case 'compound_streak_and_pace': {
        const days = f.streakDays, word = pluralizeRu(days, 'день', 'дня', 'дней');
        return ru ? [`С музыкой ${days} ${word} подряд`, `${days} ${word} подряд находишь время для музыки`]
          : [`Music for ${days} days in a row`, `${days} consecutive days of listening`];
      }
      case 'compound_gap_and_return':
      case 'artist_return':
        return ru ? [`После перерыва снова звучит ${artist}`, `Возвращение после паузы: ${artist}`]
          : [`Back to ${artist} after a break`, `${artist} is back in your listening`];
      case 'heavy_session':
        return ru ? ['Сегодня больше прослушиваний, чем обычно', `Уже ${f.todayCount} прослушиваний за сегодня`]
          : ['More listening than on your usual days', `${f.todayCount} plays so far today`];
      case 'late_night':
      case 'early_morning':
      case 'neutral_presence':
        return [greeting(f.hour ?? (f.timeBucket === 'morning' ? 9 : 18), lang), ru ? 'Что послушаем?' : 'What shall we listen to?'];
      case 'welcome_back':
        return ru ? ['С возвращением', 'Хорошо снова встретиться'] : ['Welcome back', 'Good to see you again'];
      case 'skip_streak':
        return ru ? ['Можно выбрать трек из любимых', 'Что послушаем дальше?'] : ['Try a track from your favourites', 'What shall we play next?'];
      case 'deep_focus':
        return ru ? ['В этой сессии почти без пропусков', 'Большинство треков в этой сессии — без пропусков']
          : ['Very few skips this session', 'Most tracks this session were not skipped'];
      case 'session_revisit':
        return ru ? ['С возвращением к музыке', 'Продолжим слушать?'] : ['Back for more music', 'Ready to keep listening?'];
      case 'new_user':
        return [greeting(f.hour, lang), plan.subject?.size ? (f.totalPlays ? (ru ? 'Что послушаем?' : 'What shall we listen to?') : (ru ? 'Что послушаем первым?' : 'What shall we play first?'))
          : (ru ? 'Добавь музыку, чтобы начать' : 'Add some music to get started')];
      default: return [greeting(f.hour ?? 18, lang)];
    }
  }
  const GRAMMAR_TREES = Object.fromEntries([
    'single_track_loop', 'compound_consecutive_days_track', 'artist_monopoly', 'compound_night_and_artist',
    'compound_streak_and_pace', 'compound_gap_and_return', 'artist_return', 'heavy_session', 'late_night',
    'early_morning', 'neutral_presence', 'welcome_back', 'skip_streak', 'deep_focus', 'session_revisit', 'new_user'
  ].map(intent => [intent, (plan, rng, lang) => factualPhrases(plan, lang).map(text => ({text, form: 'DIRECT', density: 'short'}))]));

  /**
   * Expand a SemanticPlan into multiple surface candidate variations
   */
  function expandPlan(plan, rng, count = 10, lang = 'ru') {
    const generator = GRAMMAR_TREES[plan.intent] || GRAMMAR_TREES.neutral_presence;
    const baseVariations = generator(plan, rng, lang);
    const candidates = [];

    // Combine base variations with stylistic punctuation and optional openers
    for (let i = 0; i < baseVariations.length; i++) {
      const base = baseVariations[i];
      const rawText = base.text;

      if (rawText && passesNaturalnessCheck(rawText)) {
        candidates.push({
          text: rawText.trim(),
          plan,
          form: base.form,
          density: base.density,
          structuralFingerprint: `${plan.intent}:${base.form}:${base.density}`
        });


      }
    }

    return candidates;
  }

  return {
    pluralizeRu,
    safeArtist,
    safeTitle,
    passesNaturalnessCheck,
    GRAMMAR_TREES,
    expandPlan,
    greeting
  };
});
