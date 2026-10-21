/**
 * Pain Audio Companion — Presence Engine: Generative Grammar & Surface Realization Module
 * Recursive statement trees with Subject Rotation, Discourse Forms, and Safe Russian.
 * Strictly respects Rules #9, #10, #11, #12, #13, #19, #32, #34, #35, #36, #37, #45, #47.
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

  const RU_ORDINALS = {
    1: 'первый',
    2: 'второй',
    3: 'третий',
    4: 'четвёртый',
    5: 'пятый',
    6: 'шестой',
    7: 'седьмой',
    8: 'восьмой',
    9: 'девятый',
    10: 'десятый'
  };

  const RU_CARDINALS = {
    1: 'один',
    2: 'два',
    3: 'три',
    4: 'четыре',
    5: 'пять',
    6: 'шесть',
    7: 'семь',
    8: 'восемь',
    9: 'девять',
    10: 'десять'
  };

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

  // --- RECURSIVE GRAMMAR COMPONENTS ---

  const OPENERS = [
    '',
    '',
    '',
    '',
    'кажется, ',
    'похоже, ',
    'ну да, ',
    'судя по всему, ',
    'в общем, ',
    'кстати, '
  ];

  const TIME_ADVERBS = {
    night: ['ночью', 'в этот поздний час', 'в ночной тишине', 'в такое время'],
    early_morning: ['с утра', 'ранним утром', 'в утренней тишине', 'на рассвете'],
    morning: ['утром', 'с утра', 'в начале дня'],
    afternoon: ['днем', 'среди дня', 'сегодня днем'],
    evening: ['вечером', 'в этот вечер', 'весь вечер', 'под вечер']
  };

  /**
   * Grammar expansions by Intent, with Subject Strategies (Rule #19) and Syntactic Forms (Rule #10)
   */
  const GRAMMAR_TREES = {
    // 1. COMPOUND: Late Night + Artist Monopoly
    compound_night_and_artist: (plan, rng) => {
      const art = safeArtist(plan.facts.artist);
      const variations = [];

      // Strategy: COMPOUND (Two coordinated clauses)
      const nightCl = rng.pick(['снова поздно', 'поздно сегодня', 'глубокая ночь', 'тихий ночной час', 'в такой час']);
      const artCl = rng.pick([`и снова ${art}`, `и опять ${art}`, `и всё вокруг ${art}`, `и в фокусе ${art}`, `и в наушниках ${art}`]);
      variations.push({ text: `${nightCl}. ${artCl}`, form: 'COMPOUND', density: 'short' });
      variations.push({ text: `${nightCl} — ${artCl}`, form: 'COMPOUND', density: 'short' });

      // Strategy: ELLIPTICAL (Minimalist 2-4 words)
      variations.push({ text: rng.pick([`ночь. ${art}.`, `ночь и ${art}`, `поздно — и снова ${art}`, `опять ${art}. ночь.`]), form: 'ELLIPTICAL', density: 'minimal' });

      // Strategy: INDIRECT (Observant / conversational)
      variations.push({ text: rng.pick([
        `ночью ${art} звучит совсем иначе`,
        `ночной выбор сегодня — ${art}`,
        `в такой час всё опять свелось к трекам ${art}`,
        `кажется, эта ночь принадлежит музыке ${art}`,
        `ночная музыка: почти один ${art}`
      ]), form: 'INDIRECT', density: 'short' });

      // Strategy: TEMPORAL (Time-anchored)
      variations.push({ text: rng.pick([
        `ночная сессия: ${art}`,
        `всю ночь почти один ${art}`,
        `поздний вечер — ${art}`,
        `до глубокой ночи — ${art}`
      ]), form: 'TEMPORAL', density: 'short' });

      // Strategy: USER (Focus on listener action)
      variations.push({ text: rng.pick([
        `ты и ночью не отпускаешь ${art}`,
        `снова возвращаешься к ${art} за полночь`,
        `позднее время, знакомый звук: ${art}`
      ]), form: 'DIRECT', density: 'short' });

      return variations;
    },

    // 2. COMPOUND: Consecutive Days Track
    compound_consecutive_days_track: (plan, rng) => {
      const title = safeTitle(plan.facts.title);
      const art = safeArtist(plan.facts.artist);
      const dayOrd = RU_ORDINALS[plan.facts.dayCount] || `${plan.facts.dayCount}-й`;
      const daysWord = pluralizeRu(plan.facts.dayCount, 'день', 'дня', 'дней');
      const variations = [];

      // Strategy: DIRECT (Fact with predicate)
      variations.push({ text: `${dayOrd} день к ней возвращаешься`, form: 'DIRECT', density: 'short' });
      variations.push({ text: `${dayOrd} день подряд эта песня с тобой`, form: 'DIRECT', density: 'short' });
      variations.push({ text: `уже ${dayOrd} день в твоем фокусе`, form: 'DIRECT', density: 'short' });

      // Strategy: ELLIPTICAL
      variations.push({ text: `${plan.facts.dayCount} ${daysWord} подряд к ней`, form: 'ELLIPTICAL', density: 'minimal' });
      variations.push({ text: 'снова эта песня', form: 'ELLIPTICAL', density: 'minimal' });
      variations.push({ text: 'всё ещё она', form: 'ELLIPTICAL', density: 'minimal' });
      variations.push({ text: `${dayOrd} день подряд`, form: 'ELLIPTICAL', density: 'minimal' });

      // Strategy: INDIRECT
      variations.push({ text: `кажется, ${title} надолго засела в голове`, form: 'INDIRECT', density: 'short' });
      variations.push({ text: 'похоже, эта песня сегодня не отпускает', form: 'INDIRECT', density: 'short' });
      variations.push({ text: 'несколько дней вокруг одной песни', form: 'INDIRECT', density: 'short' });

      // Strategy: CONTRAST / PATTERN
      variations.push({ text: `очередной день начинается с ${title}`, form: 'TEMPORAL', density: 'short' });
      variations.push({ text: `${title} — снова на устойчивом повторе`, form: 'DIRECT', density: 'short' });

      return variations;
    },

    // 3. COMPOUND: Streak + Pace
    compound_streak_and_pace: (plan, rng) => {
      const streak = plan.facts.streakDays;
      const dayOrd = RU_ORDINALS[streak] || `${streak}-й`;
      const daysWord = pluralizeRu(streak, 'день', 'дня', 'дней');
      const variations = [];

      variations.push({ text: `${dayOrd} день подряд, и темп не сбавляешь`, form: 'COMPOUND', density: 'short' });
      variations.push({ text: `${dayOrd} день подряд с музыкой`, form: 'DIRECT', density: 'short' });
      variations.push({ text: `${streak} ${daysWord} без пауз, уверенный темп`, form: 'DIRECT', density: 'short' });
      variations.push({ text: `${streak} ${daysWord} подряд`, form: 'ELLIPTICAL', density: 'minimal' });
      variations.push({ text: `${dayOrd} день серии`, form: 'ELLIPTICAL', density: 'minimal' });
      variations.push({ text: `ритм не сбавляешь уже несколько дней`, form: 'INDIRECT', density: 'short' });
      variations.push({ text: `музыка каждый день, устойчивый темп`, form: 'DIRECT', density: 'short' });

      return variations;
    },

    // 4. COMPOUND: Gap + Return
    compound_gap_and_return: (plan, rng) => {
      const isGeneric = !plan.facts.artist || /unknown|неизвестн/i.test(plan.facts.artist);
      const variations = [];

      if (isGeneric) {
        variations.push({ text: 'после паузы — снова с музыкой', form: 'DIRECT', density: 'short' });
        variations.push({ text: 'перерыв окончен, музыка на месте', form: 'DIRECT', density: 'short' });
        variations.push({ text: 'возвращение после нескольких дней тишины', form: 'DIRECT', density: 'short' });
        variations.push({ text: 'после паузы', form: 'ELLIPTICAL', density: 'minimal' });
        variations.push({ text: 'снова здесь', form: 'ELLIPTICAL', density: 'minimal' });
      } else {
        const art = safeArtist(plan.facts.artist);
        variations.push({ text: `возвращение после паузы, и сразу ${art}`, form: 'COMPOUND', density: 'short' });
        variations.push({ text: `после паузы — сразу к трекам ${art}`, form: 'DIRECT', density: 'short' });
        variations.push({ text: `несколько дней тишины, и снова ${art}`, form: 'COMPOUND', density: 'short' });
        variations.push({ text: `вернулся и первым делом включил ${art}`, form: 'DIRECT', density: 'short' });
        variations.push({ text: `после паузы — ${art}`, form: 'ELLIPTICAL', density: 'minimal' });
        variations.push({ text: `снова здесь. и снова ${art}`, form: 'COMPOUND', density: 'minimal' });
        variations.push({ text: `знакомый выбор после перерыва`, form: 'INDIRECT', density: 'short' });
      }

      return variations;
    },

    // 5. SINGLE TRACK LOOP
    single_track_loop: (plan, rng) => {
      const count = plan.facts.count;
      const title = safeTitle(plan.facts.title);
      const ord = RU_ORDINALS[count] || `${count}-й`;
      const timesWord = pluralizeRu(count, 'раз', 'раза', 'раз');
      const variations = [];

      // ELLIPTICAL
      variations.push({ text: `${ord} раз`, form: 'ELLIPTICAL', density: 'minimal' });
      variations.push({ text: 'снова она', form: 'ELLIPTICAL', density: 'minimal' });
      variations.push({ text: 'всё ещё на репите', form: 'ELLIPTICAL', density: 'minimal' });
      variations.push({ text: 'и опять эта песня', form: 'ELLIPTICAL', density: 'minimal' });
      variations.push({ text: `${count} ${timesWord} подряд`, form: 'ELLIPTICAL', density: 'minimal' });

      // DIRECT
      variations.push({ text: `уже ${count} ${timesWord} за сегодня`, form: 'DIRECT', density: 'short' });
      variations.push({ text: `эта песня сегодня на устойчивом повторе`, form: 'DIRECT', density: 'short' });
      variations.push({ text: `ты явно не готов её переключить`, form: 'DIRECT', density: 'short' });
      variations.push({ text: `${title} играет ${ord} раз за сегодня`, form: 'DIRECT', density: 'short' });

      // INDIRECT
      variations.push({ text: 'кажется, эта песня сегодня не отпускает', form: 'INDIRECT', density: 'short' });
      variations.push({ text: 'похоже, один трек захватил всё внимание', form: 'INDIRECT', density: 'short' });
      variations.push({ text: 'когда песня попала ровно в настроение', form: 'INDIRECT', density: 'short' });

      // TEMPORAL / PATTERN
      variations.push({ text: `${ord} раз за день`, form: 'TEMPORAL', density: 'minimal' });
      variations.push({ text: 'весь сеанс вокруг одной песни', form: 'TEMPORAL', density: 'short' });
      variations.push({ text: 'сегодня всё сводится к ней', form: 'INDIRECT', density: 'short' });

      return variations;
    },

    // 6. ARTIST MONOPOLY
    artist_monopoly: (plan, rng) => {
      const art = safeArtist(plan.facts.artist);
      const count = plan.facts.count;
      const timesWord = pluralizeRu(count, 'трек', 'трека', 'треков');
      const variations = [];

      // DIRECT
      variations.push({ text: `сегодня явно побеждает ${art}`, form: 'DIRECT', density: 'short' });
      variations.push({ text: `сегодня много ${art}`, form: 'DIRECT', density: 'minimal' });
      variations.push({ text: `в фокусе сегодня — ${art}`, form: 'DIRECT', density: 'short' });
      variations.push({ text: `сегодня в эфире почти один ${art}`, form: 'DIRECT', density: 'short' });

      // ELLIPTICAL
      variations.push({ text: `опять ${art}`, form: 'ELLIPTICAL', density: 'minimal' });
      variations.push({ text: `снова ${art}`, form: 'ELLIPTICAL', density: 'minimal' });
      variations.push({ text: `сегодня — ${art}`, form: 'ELLIPTICAL', density: 'minimal' });
      variations.push({ text: `только ${art}`, form: 'ELLIPTICAL', density: 'minimal' });

      // INDIRECT
      variations.push({ text: `кажется, сегодня всё свелось к ${art}`, form: 'INDIRECT', density: 'short' });
      variations.push({ text: `настроение сегодня задает ${art}`, form: 'INDIRECT', density: 'short' });
      variations.push({ text: `день, когда нужен только ${art}`, form: 'INDIRECT', density: 'short' });
      variations.push({ text: `звучит преимущественно ${art}`, form: 'INDIRECT', density: 'short' });

      // TEMPORAL
      const timeWord = plan.facts.timeContext === 'night' ? 'всю ночь' : (plan.facts.timeContext === 'morning' ? 'все утро' : 'весь день');
      variations.push({ text: `${timeWord} почти один ${art}`, form: 'TEMPORAL', density: 'short' });
      variations.push({ text: `${timeWord} звучит ${art}`, form: 'TEMPORAL', density: 'short' });
      variations.push({ text: `день проходит под знаком ${art}`, form: 'TEMPORAL', density: 'short' });

      return variations;
    },

    // 7. ARTIST RETURN
    artist_return: (plan, rng) => {
      const art = safeArtist(plan.facts.artist);
      const gap = plan.facts.gapDays;
      const daysWord = pluralizeRu(gap, 'день', 'дня', 'дней');
      const variations = [];

      variations.push({ text: `давно не звучал ${art}`, form: 'COMPARATIVE', density: 'short' });
      variations.push({ text: `давно не возвращался к ${art}`, form: 'COMPARATIVE', density: 'short' });
      variations.push({ text: `после долгой паузы снова ${art}`, form: 'COMPARATIVE', density: 'short' });
      variations.push({ text: `возвращение к ${art}`, form: 'DIRECT', density: 'minimal' });
      variations.push({ text: `снова вспомнил про ${art}`, form: 'DIRECT', density: 'short' });
      variations.push({ text: `старый знакомый снова в эфире`, form: 'INDIRECT', density: 'short' });
      variations.push({ text: `снова ${art}`, form: 'ELLIPTICAL', density: 'minimal' });
      variations.push({ text: `возвращение к классике`, form: 'ELLIPTICAL', density: 'minimal' });

      return variations;
    },

    // 8. HEAVY SESSION
    heavy_session: (plan, rng) => {
      const variations = [];
      variations.push({ text: 'сегодня необычно много музыки', form: 'DIRECT', density: 'short' });
      variations.push({ text: 'день выдался музыкальным', form: 'DIRECT', density: 'short' });
      variations.push({ text: 'сегодня музыка почти не смолкает', form: 'DIRECT', density: 'short' });
      variations.push({ text: 'сегодня заметно больше обычного', form: 'COMPARATIVE', density: 'short' });
      variations.push({ text: 'день не из тихих', form: 'COMPARATIVE', density: 'minimal' });
      variations.push({ text: 'больше треков, чем в обычные дни', form: 'COMPARATIVE', density: 'short' });
      variations.push({ text: 'плотный день', form: 'ELLIPTICAL', density: 'minimal' });
      variations.push({ text: 'много музыки сегодня', form: 'ELLIPTICAL', density: 'minimal' });
      variations.push({ text: 'без пауз', form: 'ELLIPTICAL', density: 'minimal' });
      return variations;
    },

    // 9. LATE NIGHT
    late_night: (plan, rng) => {
      const variations = [];
      variations.push({ text: 'снова поздно', form: 'ELLIPTICAL', density: 'minimal' });
      variations.push({ text: 'поздно сегодня', form: 'ELLIPTICAL', density: 'minimal' });
      variations.push({ text: 'глубокая ночь', form: 'ELLIPTICAL', density: 'minimal' });
      variations.push({ text: 'ночь', form: 'ELLIPTICAL', density: 'minimal' });
      variations.push({ text: 'в такое время всё звучит иначе', form: 'INDIRECT', density: 'short' });
      variations.push({ text: 'ночная музыка ощущается глубже', form: 'INDIRECT', density: 'short' });
      variations.push({ text: 'тихий ночной час', form: 'INDIRECT', density: 'minimal' });
      variations.push({ text: 'ночной сеанс', form: 'TEMPORAL', density: 'minimal' });
      variations.push({ text: 'позднее прослушивание', form: 'TEMPORAL', density: 'minimal' });
      variations.push({ text: 'ночная волна', form: 'TEMPORAL', density: 'minimal' });
      return variations;
    },

    // 10. EARLY MORNING
    early_morning: (plan, rng) => {
      const variations = [];
      variations.push({ text: 'с самого утра с музыкой', form: 'DIRECT', density: 'short' });
      variations.push({ text: 'день начинается со звука', form: 'DIRECT', density: 'short' });
      variations.push({ text: 'ранний музыкальный старт', form: 'DIRECT', density: 'short' });
      variations.push({ text: 'раннее утро', form: 'ELLIPTICAL', density: 'minimal' });
      variations.push({ text: 'утренний ритм', form: 'ELLIPTICAL', density: 'minimal' });
      variations.push({ text: 'утро', form: 'ELLIPTICAL', density: 'minimal' });
      return variations;
    },

    // 11. WELCOME BACK
    welcome_back: (plan, rng) => {
      const gap = plan.facts.gapDays;
      const daysWord = pluralizeRu(gap, 'день', 'дня', 'дней');
      const variations = [];
      variations.push({ text: 'снова здесь после паузы', form: 'DIRECT', density: 'short' });
      variations.push({ text: 'вернулся после нескольких дней тишины', form: 'DIRECT', density: 'short' });
      variations.push({ text: 'тишина позади, музыка на месте', form: 'DIRECT', density: 'short' });
      variations.push({ text: 'снова здесь', form: 'ELLIPTICAL', density: 'minimal' });
      variations.push({ text: 'вернулся', form: 'ELLIPTICAL', density: 'minimal' });
      variations.push({ text: 'после паузы', form: 'ELLIPTICAL', density: 'minimal' });
      return variations;
    },

    // 12. SKIP STREAK
    skip_streak: (plan, rng) => {
      const variations = [];
      variations.push({ text: 'ищешь то самое настроение', form: 'INDIRECT', density: 'short' });
      variations.push({ text: 'сегодня сложно выбрать нужный трек', form: 'INDIRECT', density: 'short' });
      variations.push({ text: 'в поиске правильного звучания', form: 'INDIRECT', density: 'short' });
      variations.push({ text: 'поиск настроения', form: 'ELLIPTICAL', density: 'minimal' });
      variations.push({ text: 'в поиске', form: 'ELLIPTICAL', density: 'minimal' });
      return variations;
    },

    // 13. DEEP FOCUS
    deep_focus: (plan, rng) => {
      const variations = [];
      variations.push({ text: 'ровный поток, без переключений', form: 'INDIRECT', density: 'short' });
      variations.push({ text: 'музыка просто идёт фоном', form: 'INDIRECT', density: 'short' });
      variations.push({ text: 'глубокое погружение', form: 'INDIRECT', density: 'minimal' });
      variations.push({ text: 'ровный поток', form: 'ELLIPTICAL', density: 'minimal' });
      variations.push({ text: 'в фокусе', form: 'ELLIPTICAL', density: 'minimal' });
      variations.push({ text: 'тихий поток', form: 'ELLIPTICAL', density: 'minimal' });
      return variations;
    },

    // 14. SESSION REVISIT
    session_revisit: (plan, rng) => {
      const variations = [];
      variations.push({ text: 'снова здесь', form: 'ELLIPTICAL', density: 'minimal' });
      variations.push({ text: 'продолжаем', form: 'ELLIPTICAL', density: 'minimal' });
      variations.push({ text: 'второй заход', form: 'ELLIPTICAL', density: 'minimal' });
      variations.push({ text: 'продолжение сегодняшней сессии', form: 'DIRECT', density: 'short' });
      variations.push({ text: 'снова в эфире', form: 'DIRECT', density: 'minimal' });
      variations.push({ text: 'музыка продолжается', form: 'DIRECT', density: 'short' });
      return variations;
    },

    // 15. NEUTRAL PRESENCE
    neutral_presence: (plan, rng) => {
      const bucket = plan.facts.timeBucket || 'evening';
      const variations = [];

      if (bucket === 'night') {
        variations.push({ text: 'ночь', form: 'ELLIPTICAL', density: 'minimal' });
        variations.push({ text: 'тихая ночь', form: 'ELLIPTICAL', density: 'minimal' });
        variations.push({ text: 'глубокая ночь', form: 'ELLIPTICAL', density: 'minimal' });
        variations.push({ text: 'ночной звук', form: 'INDIRECT', density: 'minimal' });
        variations.push({ text: 'тишина и музыка', form: 'INDIRECT', density: 'short' });
      } else if (bucket === 'early_morning' || bucket === 'morning') {
        variations.push({ text: 'утро', form: 'ELLIPTICAL', density: 'minimal' });
        variations.push({ text: 'тихое утро', form: 'ELLIPTICAL', density: 'minimal' });
        variations.push({ text: 'утренний поток', form: 'INDIRECT', density: 'minimal' });
        variations.push({ text: 'день начинается', form: 'DIRECT', density: 'minimal' });
      } else if (bucket === 'afternoon') {
        variations.push({ text: 'день', form: 'ELLIPTICAL', density: 'minimal' });
        variations.push({ text: 'тихий день', form: 'ELLIPTICAL', density: 'minimal' });
        variations.push({ text: 'музыка фоном', form: 'ELLIPTICAL', density: 'minimal' });
        variations.push({ text: 'ровный день', form: 'INDIRECT', density: 'minimal' });
        variations.push({ text: 'музыка на месте', form: 'DIRECT', density: 'short' });
      } else {
        variations.push({ text: 'вечер', form: 'ELLIPTICAL', density: 'minimal' });
        variations.push({ text: 'тихий вечер', form: 'ELLIPTICAL', density: 'minimal' });
        variations.push({ text: 'спокойный вечер', form: 'ELLIPTICAL', density: 'minimal' });
        variations.push({ text: 'вечерняя музыка', form: 'INDIRECT', density: 'minimal' });
        variations.push({ text: 'время для музыки', form: 'DIRECT', density: 'short' });
      }

      return variations;
    },

    // 16. NEW USER
    new_user: (plan, rng) => {
      const variations = [];
      variations.push({ text: 'пока только знакомимся', form: 'DIRECT', density: 'short' });
      variations.push({ text: 'первые треки в твоей истории', form: 'DIRECT', density: 'short' });
      variations.push({ text: 'начинаем собирать историю звука', form: 'DIRECT', density: 'short' });
      variations.push({ text: 'первые треки', form: 'ELLIPTICAL', density: 'minimal' });
      variations.push({ text: 'начало истории', form: 'ELLIPTICAL', density: 'minimal' });
      variations.push({ text: 'знакомство', form: 'ELLIPTICAL', density: 'minimal' });
      return variations;
    }
  };

  /**
   * Expand a SemanticPlan into multiple surface candidate variations
   */
  function expandPlan(plan, rng, count = 10) {
    const generator = GRAMMAR_TREES[plan.intent] || GRAMMAR_TREES.neutral_presence;
    const baseVariations = generator(plan, rng);
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

        // Add subtle punctuation / modifier variations for high entropy
        if (base.density !== 'minimal' && !rawText.endsWith('.')) {
          const dotted = rawText + '.';
          if (passesNaturalnessCheck(dotted)) {
            candidates.push({
              text: dotted,
              plan,
              form: base.form,
              density: base.density,
              structuralFingerprint: `${plan.intent}:${base.form}:punct`
            });
          }
        }
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
    expandPlan
  };
});
