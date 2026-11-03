const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Home = require('../src/home-model');
const Messages = require('../src/home-messages');
const Copy = require('../src/home-message-copy');

const DAY = 86400000;
const NOW = new Date(2026, 10, 3, 15, 0).getTime();

function memoryStorage() {
  const entries = new Map();
  let reads = 0, writes = 0;
  return {
    entries,
    getItem(key) { reads++; return entries.get(key) ?? null; },
    setItem(key, value) { writes++; entries.set(key, String(value)); },
    removeItem(key) { entries.delete(key); },
    get reads() { return reads; },
    get writes() { return writes; }
  };
}

function fixture() {
  const tracks = Array.from({ length: 60 }, (_, i) => ({
    id: 'song-' + i, title: 'Песня ' + i, artist: 'Исполнитель ' + i % 12,
    duration: 180000, favorite: i % 4 === 0
  }));
  const plays = [];
  function play(i, days, offset = 0) {
    plays.push({ id: 'play-' + plays.length, track: tracks[i].id,
      started: NOW - days * DAY - 3600000 - offset * 200000,
      heard: 180000, duration: 180000, finished: 1 });
  }
  for (let i = 0; i < 20; i++) play(i, 60 + i);
  for (let i = 0; i < 25; i++) play(i, i % 6, i);
  for (let day = 0; day < 14; day++) play(0, day, 30);
  for (let i = 20; i < 30; i++) { play(i, 3, i); play(i, 1, i); }
  play(32, 10);
  play(36, 18);
  play(1, 40);
  return { tracks, stats: { plays }, model: Home.build(tracks, { plays }, NOW) };
}

function assertMessage(text) {
  assert.equal(typeof text, 'string');
  assert.ok(text.length > 12, 'message has meaningful visible content');
  assert.ok(text.length <= 100, `message exceeds the hero budget (${text.length}): ${text}`);
  assert.doesNotMatch(text, /undefined|NaN|Infinity|\{[a-zA-Z]+\}/);
  const withoutTitles = text.replace(/«[^»]*»|“[^”]*”/g, '');
  assert.doesNotMatch(withoutTitles, /[.!?]\s+\S/, 'the hero contains one sentence, not a paragraph');
  assert.doesNotMatch(text, /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u200b\u200c\u200d\ufeff]/,
    'uniqueness must not come from invisible characters');
}

function availableMessages(model, lang = 'ru') {
  return new Set(Messages.candidates(model, NOW).flatMap(card =>
    Copy.families[card.family][lang].map((_, variant) => Messages.format(card, lang, variant))
  ).filter(Boolean));
}

test('a fixed listening context uses every short sentence before repeating any', () => {
  const { model } = fixture(), storage = memoryStorage();
  // Keep a fixed eligible pool; larger summaries deliberately rotate track samples.
  for (const key of ['recent', 'fresh', 'past', 'favorites']) model[key] = model[key].slice(0, 6);
  for (const lang of ['ru', 'en']) {
    const engine = Messages.create({ storage, random: () => 0.314159 });
    const pool = availableMessages(model, lang), seen = new Set();
    assert.ok(pool.size >= 100, 'a rich context has a substantial selection of single sentences');
    let previous = '';
    for (let i = 0; i < pool.size; i++) {
      const text = engine.next(model, { now: NOW, lang });
      assertMessage(text);
      assert.ok(pool.has(text), 'every message is a supported observation from this context');
      assert.ok(!seen.has(text), `exact repeat before exhausting the pool at visit ${i}: ${text}`);
      seen.add(text);
      previous = text;
    }
    assert.deepEqual(seen, pool);
    for (let i = 0; i < 30; i++) {
      const text = engine.next(model, { now: NOW, lang });
      assertMessage(text);
      assert.ok(pool.has(text), 'exhaustion does not add meaningless uniqueness markers');
      assert.notEqual(text, previous, 'an exhausted pool still avoids adjacent repeats');
      previous = text;
    }
  }
  assert.ok(storage.entries.size <= 514, 'persistent novelty storage has a fixed upper bound');
  const storedCharacters = [...storage.entries.values()].reduce((sum, value) => sum + value.length, 0);
  assert.ok(storedCharacters < 300000, `history remains bounded: ${storedCharacters} characters`);
  assert.ok([...storage.entries.keys()].every(key => key.startsWith('pain_home_messages_v1')),
    'no playback, library or unrelated preference keys are touched');
});

test('exact-message history survives creation of a new engine', () => {
  const { model } = fixture(), storage = memoryStorage(), seen = new Set();
  for (let launch = 0; launch < 20; launch++) {
    const engine = Messages.create({ storage, random: () => 0.25 });
    for (let i = 0; i < 10; i++) {
      const text = engine.next(model, { now: NOW, lang: 'ru' });
      assert.ok(!seen.has(text), `repeat after reload ${launch}: ${text}`);
      seen.add(text);
    }
  }
});

test('a new or empty library receives varied text without invented listening history', () => {
  const empty = Home.build([], {}, NOW);
  const emptyCards = Messages.candidates(empty, NOW);
  assert.ok(emptyCards.length > 0);
  assert.ok(emptyCards.every(card => card.family === 'empty'));
  const engine = Messages.create({ storage: memoryStorage(), random: () => 0.41 });
  const pool = availableMessages(empty), seen = new Set();
  let previous = '';
  for (let i = 0; i < 100; i++) {
    const text = engine.next(empty, { now: NOW, lang: 'ru' });
    assertMessage(text);
    assert.ok(pool.has(text));
    if (i < pool.size) assert.ok(!seen.has(text), `empty-library text repeated before using its full pool at ${i}`);
    assert.notEqual(text, previous, 'an exhausted cold-start pool must not stick on one sentence');
    assert.doesNotMatch(text, /Вы слушали|Вы возвращались|Ваша серия|вы услышали/);
    seen.add(text);
    previous = text;
  }
  assert.deepEqual(seen, pool);
  const tracks = [{ id: 'one', title: 'Первый трек', duration: 180000 }];
  const preview = Home.build(tracks, { plays: [{ id: 'preview', track: 'one', started: NOW - 10000, heard: 500 }] }, NOW);
  const historyFamilies = new Set(['ritual', 'comeback', 'recent', 'fresh', 'past', 'repeat', 'retained', 'streak', 'allHeard']);
  assert.ok(Messages.candidates(preview, NOW).every(card => !historyFamilies.has(card.family)),
    'an accidental preview is not treated as a discovery or listening habit');
});

test('rendered Russian copy uses the governed number case and preserves track titles', () => {
  const forms = [
    [1, '1 день', '1 дня', '1 трек', '1 трека', '1 прослушивание', '1 прослушивания'],
    [2, '2 дня', '2 дней', '2 трека', '2 треков', '2 прослушивания', '2 прослушиваний'],
    [5, '5 дней', '5 дней', '5 треков', '5 треков', '5 прослушиваний', '5 прослушиваний'],
    [11, '11 дней', '11 дней', '11 треков', '11 треков', '11 прослушиваний', '11 прослушиваний'],
    [21, '21 день', '21 дня', '21 трек', '21 трека', '21 прослушивание', '21 прослушивания'],
    [22, '22 дня', '22 дней', '22 трека', '22 треков', '22 прослушивания', '22 прослушиваний'],
    [101, '101 день', '101 дня', '101 трек', '101 трека', '101 прослушивание', '101 прослушивания']
  ];
  for (const [n, day, dayGen, track, trackGen, listen, listenGen] of forms) {
    const tracks = Array.from({ length: n }, (_, i) => ({ id: String(i), title: 'Весна' }));
    const model = Home.build(tracks, {}, NOW);
    model.details.behavior.streak = n;
    model.details.calendar[0].ms = 60000;
    const cards = Messages.candidates(model, NOW);
    const dayCard = cards.find(card => card.family === (n === 1 ? 'activeDays' : 'streak'));
    const trackCard = cards.find(card => card.family === 'unexplored');
    assert.equal(dayCard.values.daySpan, day);
    assert.equal(dayCard.values.daySpanGen, dayGen);
    assert.equal(trackCard.values.trackCount, track);
    assert.equal(trackCard.values.trackCountGen, trackGen);
    assert.equal(trackCard.values.listenCount, listen);
    assert.equal(trackCard.values.listenCountGen, listenGen);
    const values = { ...trackCard.values, ...dayCard.values, title: 'Весна', otherTitle: 'Зима',
      percent: 75, minutes: 123, previousMinutes: 100, hour: '21:00–22:00' };
    const rendered = family => Copy.families[family].ru.map((_, variant) =>
      Messages.format({ family, values }, 'ru', variant)).filter(Boolean);
    const returns = rendered('comeback');
    const age = rendered('past');
    const repeats = rendered('repeat');
    assert.ok(returns.some(text => text.includes('после ' + dayGen)),
      `a rendered return must use the genitive after «после»: ${dayGen}`);
    assert.ok(age.some(text => text.includes(day + ' назад')),
      `a rendered interval must preserve the counting form before «назад»: ${day}`);
    assert.ok(repeats.some(text => text.includes(listen)),
      `the listen count has a rendered grammatical form: ${listen}`);
    for (const text of Object.keys(Copy.families).flatMap(rendered)) {
      assertMessage(text);
      assert.doesNotMatch(text, /(?:^|\s)(?:к|с|у|для)\s+«/i,
        'declension belongs to «треку/трека», never to the unmodified title');
      if (text.includes('после ' + n + ' ')) assert.ok(text.includes('после ' + dayGen));
      assert.doesNotMatch(text, /«Весны»|«Весне»|«Весну»/, 'metadata must stay unchanged inside quotes');
      if (n % 10 === 1 && n % 100 !== 11) {
        assert.doesNotMatch(text, new RegExp('(?:^|[^0-9])' + n + '\\s+(?:разных дат|разные даты|датах|днях|разных днях|дней|отметок)(?:[ .,:;!?]|$)'),
          'numbers ending in one cannot use plural calendar nouns/adjectives');
      }
      if (n === 5 || n === 11) assert.doesNotMatch(text, new RegExp('(?:^|[^0-9])' + n + '\\s+разные даты'),
        'five and eleven require the genitive plural, not «разные даты»');
    }
  }
});

test('the complete copy catalog renders as one short sentence even with long metadata', () => {
  const values = {
    title: 'Очень длинное название. Ещё одна часть?', otherTitle: '🎸'.repeat(64),
    days: 101, daySpan: '101 день', daySpanGen: '101 дня',
    count: 101, trackCount: '101 трек', trackCountGen: '101 трека',
    listenCount: '101 прослушивание', listenCountGen: '101 прослушивания',
    minutes: 1561, previousMinutes: 999, percent: 99, hour: '23:00–00:00'
  };
  for (const [family, entry] of Object.entries(Copy.families)) {
    for (const lang of ['ru', 'en']) {
      for (let variant = 0; variant < entry[lang].length; variant++) {
        const text = Messages.format({ family, values }, lang, variant);
        assert.ok(text, `${family}/${lang}/${variant} remains usable within the short-line budget`);
        assertMessage(text);
        assert.doesNotMatch(text, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/,
          'title shortening must preserve whole Unicode characters');
        if (lang === 'ru') assert.doesNotMatch(text, /(?:^|\s)(?:к|с|у|для)\s+«/i);
      }
    }
  }
});

test('removed tracks cannot supply a named ritual or comeback', () => {
  const { model } = fixture();
  model.details.ritual = { track: 'removed-song', days: 28 };
  model.details.comeback = { track: 'removed-song', days: 90, at: NOW - DAY };
  model.details.behavior.counts['removed-song'] = 100000;
  const cards = Messages.candidates(model, NOW);
  assert.ok(cards.every(card => !['ritual', 'comeback'].includes(card.family)));
  assert.ok(cards.every(card => !String(card.values?.title || '').includes('undefined')));
});

test('corrupt or denied storage leaves the message engine usable', () => {
  const { model } = fixture();
  const stores = [
    { getItem: () => '{not valid json', setItem: () => {} },
    { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); } },
    { getItem: () => null, setItem() { throw new Error('QuotaExceededError'); } }
  ];
  for (const storage of stores) {
    const engine = Messages.create({ storage, random: () => 0.5 });
    const seen = new Set();
    for (let i = 0; i < 50; i++) {
      const text = engine.next(model, { now: NOW, lang: 'ru' });
      assertMessage(text);
      assert.ok(!seen.has(text), 'in-memory novelty remains available without persistence');
      seen.add(text);
    }
  }
});

test('message generation consumes existing summaries without traversing the raw play history', () => {
  const { model } = fixture();
  model.details.plays = new Proxy([], {
    get(target, key) {
      if (key === 'length') return 10000000;
      throw new Error('raw play history was accessed: ' + String(key));
    }
  });
  const engine = Messages.create({ storage: memoryStorage(), random: () => 0.123 });
  for (let i = 0; i < 20; i++) assertMessage(engine.next(model, { now: NOW, lang: 'ru' }));
});

test('long hostile metadata is bounded and both languages resolve all sentence fields', () => {
  const { tracks, stats } = fixture();
  for (const track of tracks) {
    track.title = '<img src=x onerror=alert(1)>\u0000\u200b\u202e' + 'Оченьдлинноеназвание'.repeat(100);
    track.artist = 'Artist ' + 'X'.repeat(10000);
  }
  const model = Home.build(tracks, stats, NOW);
  const engine = Messages.create({ storage: memoryStorage(), random: () => 0.2 });
  for (const lang of ['ru', 'en']) {
    for (let i = 0; i < 100; i++) {
      const text = engine.next(model, { now: NOW, lang });
      assertMessage(text);
      assert.doesNotMatch(text, /\u202e/);
      if (lang === 'en') assert.doesNotMatch(text, /\d+\s+(?:день|дня|дней|трек|трека|треков)(?:[.,;!? ]|$)/);
    }
  }
});


test('active-day statements use the same one-minute threshold as the Home summary', () => {
  const { model } = fixture();
  model.details.calendar = Array.from({ length: 28 }, (_, i) => ({
    at: NOW - (27 - i) * DAY, ms: [1, 59999, 60000, 180000][i] || 0
  }));
  const active = Messages.candidates(model, NOW).find(card => card.family === 'activeDays');
  assert.ok(active);
  assert.equal(active.values.days, 2, 'accidental fragments do not create an active listening day');
  for (const day of model.details.calendar) day.ms = 500;
  assert.ok(!Messages.candidates(model, NOW).some(card => card.family === 'activeDays'));
});

test('recent and range copy does not call an old listening history recent', () => {
  const tracks = Array.from({ length: 3 }, (_, i) => ({
    id: String(i), title: 'Песня ' + i, artist: 'Артист ' + i, duration: 180000
  }));
  const play = (i, days) => ({ id: 'play-' + i + '-' + days, track: String(i),
    started: NOW - days * DAY, heard: 180000, duration: 180000 });
  const old = Home.build(tracks, { plays: tracks.map((_, i) => play(i, 60 + i)) }, NOW);
  assert.equal(old.recent.length, 3, 'the existing model keeps the latest tracks regardless of their age');
  assert.ok(Messages.candidates(old, NOW).every(card => !['recent', 'range'].includes(card.family)));
  const oneRecent = Home.build(tracks, { plays: [play(0, 1), play(1, 60), play(2, 62)] }, NOW);
  assert.ok(!Messages.candidates(oneRecent, NOW).some(card => card.family === 'range'),
    'a recent/old pair is not described as two recent choices');
  const twoRecent = Home.build(tracks, { plays: [play(0, 1), play(1, 60), play(2, 2)] }, NOW);
  const cards = Messages.candidates(twoRecent, NOW);
  assert.ok(cards.some(card => card.family === 'range'));
  assert.deepEqual(cards.filter(card => card.family === 'recent').map(card => card.anchor).sort(), ['0', '2']);
});

test('outside-favourites percentages have enough evidence and the stated history denominator', () => {
  const { model } = fixture();
  model.details.knownTime = 3600000;
  model.details.totalMs = 3600000;
  for (const outside of [0, 3600000]) {
    model.details.outsideFavorites = outside;
    assert.ok(!Messages.candidates(model, NOW).some(card => card.family === 'outside'),
      'zero and complete shares do not become exaggerated broad-history claims');
  }
  model.details.outsideFavorites = 1800000;
  model.details.totalMs = 7200000;
  assert.ok(!Messages.candidates(model, NOW).some(card => card.family === 'outside'),
    'time belonging to removed songs cannot silently disappear from the denominator');
  model.details.totalMs = model.details.knownTime;
  const card = Messages.candidates(model, NOW).find(item => item.family === 'outside');
  assert.ok(card);
  assert.equal(card.values.percent, 50);
});

test('astral metadata cannot overflow the hero budget when two titles share a sentence', () => {
  const tracks = [
    { id: 'a', title: '🙂'.repeat(150), artist: 'A', duration: 180000 },
    { id: 'b', title: '🎸'.repeat(150), artist: 'B', duration: 180000 }
  ];
  const model = Home.build(tracks, { plays: tracks.map((track, i) => ({
    id: 'p' + i, track: track.id, started: NOW - (i + 1) * DAY,
    heard: 180000, duration: 180000
  })) }, NOW);
  assert.ok(Messages.candidates(model, NOW).some(card => card.family === 'range'));
  const engine = Messages.create({ storage: memoryStorage(), random: () => 0.3 });
  for (let i = 0; i < 300; i++) assertMessage(engine.next(model, { now: NOW, lang: i % 2 ? 'ru' : 'en' }));
});

function homeHarness() {
  const storage = memoryStorage(), listeners = {}, scheduled = [];
  const root = {
    innerHTML: '', listeners: {},
    querySelectorAll: () => [], querySelector: () => null,
    addEventListener(type, fn) { this.listeners[type] = fn; }, contains: () => true
  };
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [NOW])); }
    static now() { return NOW; }
  }
  const context = {
    document: { getElementById: id => id === 'homeContent' ? root : { classList: { contains: () => true } }, activeElement: null },
    HomeModel: Home, localStorage: storage, Date: FixedDate,
    requestAnimationFrame: fn => { scheduled.push(fn); },
    setTimeout: fn => { scheduled.push(fn); },
    window: {
      PainDJVibes: { list: () => ({ items: [], activeId: null }) },
      addEventListener: (type, fn) => { listeners[type] = fn; }
    }
  };
  context.window.localStorage = storage;
  vm.createContext(context);
  for (const name of ['home-message-copy', 'home-messages', 'home-view']) {
    vm.runInContext(fs.readFileSync(require.resolve('../src/' + name), 'utf8'), context, { filename: name + '.js' });
  }
  return { root, storage, listeners, scheduled, view: context.window.HomeView,
    text: () => /<p class="home-personal">([^]*?)<\/p>/.exec(root.innerHTML)?.[1] };
}

test('Home keeps its personal text through incidental rerenders and renews it after a visit', async () => {
  const { tracks, stats } = fixture();
  const h = homeHarness();
  const handlers = { cover: () => '', fallbackCover: () => '' };
  const data = { tracks, stats, playlists: [], lang: 'ru', current: tracks[0], isPlaying: false };
  h.view.render(data, handlers);
  const first = h.text();
  assert.ok(first);
  const writes = h.storage.writes;
  h.listeners['pain:view']?.({ detail: 'home' });
  h.view.render(data, handlers);
  h.view.render({ ...data, current: tracks[1], isPlaying: true }, handlers);
  h.view.setPlaying(false);
  assert.equal(h.text(), first);
  assert.equal(h.storage.writes, writes, 'ordinary render and playback updates do not persist new messages');
  while (h.scheduled.length) await h.scheduled.shift()();
  assert.equal(h.text(), first, 'async mix completion keeps the selected sentence');
  assert.equal(typeof h.listeners['pain:view'], 'function');
  h.listeners['pain:view']({ detail: 'library' });
  h.view.render(data, handlers);
  assert.notEqual(h.text(), first, 'a new visit gets a new message');
  const second = h.text();
  h.view.render({ ...data, lang: 'en' }, handlers);
  assert.notEqual(h.text(), second, 'language changes update the personal line immediately');
});
