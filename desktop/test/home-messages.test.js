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
  assert.ok(text.length <= 82, `message exceeds the hero budget (${text.length}): ${text}`);
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
  model.catalog = model.catalog.filter(track => !model.last.has(track.id)).slice(0, 2);
  for (const lang of ['ru', 'en']) {
    const engine = Messages.create({ storage, random: () => 0.314159 });
    const pool = availableMessages(model, lang), seen = new Set();
    assert.ok(pool.size >= 50, 'a rich context has plenty of distinct facts and actionable suggestions');
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
  assert.equal(storage.entries.size, 1, 'a single bounded record holds the recent choices');
  const storedCharacters = [...storage.entries.values()].reduce((sum, value) => sum + value.length, 0);
  assert.ok(storedCharacters < 13000, `history remains bounded: ${storedCharacters} characters`);
  assert.ok([...storage.entries.keys()].every(key => key.startsWith('pain_home_messages_v1')),
    'no playback, library or unrelated preference keys are touched');
});

test('exact-message history survives creation of a new engine', () => {
  const { model } = fixture(), storage = memoryStorage(), seen = new Set();
  for (let launch = 0; launch < 18; launch++) {
    const engine = Messages.create({ storage, random: () => 0.25 });
    for (let i = 0; i < 10; i++) {
      const text = engine.next(model, { now: NOW, lang: 'ru' });
      assert.ok(!seen.has(text), `repeat after reload ${launch}: ${text}`);
      seen.add(text);
    }
  }
});

test('early visits rotate topics and track names, including both tracks in paired suggestions', () => {
  const { model } = fixture(), storage = memoryStorage(), shown = [];
  const engine = Messages.create({storage, random: () => .314159});
  for (let i = 0; i < 16; i++) {
    assertMessage(engine.next(model, {now: NOW}));
    const state = JSON.parse(storage.entries.get('pain_home_messages_v1:state'));
    shown.push(state.recent.at(-1));
  }
  assert.ok(new Set(shown.slice(0, 10).map(row => row.group)).size >= 6);
  for (let i = 1; i < shown.length; i++) {
    assert.notEqual(shown[i].group, shown[i-1].group);
    assert.notEqual(shown[i].lead, shown[i-1].lead);
    const anchors = [shown[i].anchor, shown[i].related].filter(Boolean);
    assert.ok(anchors.every(anchor => ![shown[i-1].anchor, shown[i-1].related].includes(anchor)));
  }
  assert.ok(Messages.candidates(model, NOW).some(card => card.family === 'foundAgain'));
  assert.ok(Messages.candidates(model, NOW).some(card => card.family === 'trackTime'));
});

test('a new fact comes before more wording for an old fact, even after reload', () => {
  const {model} = fixture(), storage = memoryStorage(), seen = new Set();
  for(const key of ['recent','fresh','past','favorites'])model[key]=model[key].slice(0,6);
  model.catalog=model.catalog.filter(track=>!model.last.has(track.id)).slice(0,2);
  const facts = new Set(Messages.candidates(model,NOW).filter(card=>!card.event).map(card=>[
    Copy.families[card.family].fact||card.family,[card.anchor,card.related].sort().join('|')
  ].join('|')));
  for(let i=0;i<facts.size;i++){
    Messages.create({storage,random:()=>.2}).next(model,{now:NOW});
    const row=JSON.parse(storage.entries.get('pain_home_messages_v1:state')).recent.at(-1);
    assert.ok(!seen.has(row.fact),`another wording for ${row.family} preceded a new fact on visit ${i+1}`);
    seen.add(row.fact);
  }
});

test('recent choices migrate from the old format without loading the old text pages', () => {
  const storage = memoryStorage(), model = Home.build([], {}, NOW);
  const text = Copy.families.empty.ru[0];
  storage.setItem('pain_home_messages_v1:state', JSON.stringify({version:1,seed:42,
    recent:[{text,family:'empty',anchor:'',frame:'empty:0'}]}));
  storage.setItem('pain_home_messages_v1:bits:8', 'ff'.repeat(256));
  const engine = Messages.create({storage});
  for (let i = 1; i < Copy.families.empty.ru.length; i++) assert.notEqual(engine.next(model, {now:NOW}), text);
  assert.equal(storage.reads, 1);
  assert.equal(JSON.parse(storage.entries.get('pain_home_messages_v1:state')).version, 2);
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
      ratio: n+' из 120',denominator:120,percent: 75, minutes: 123, previousMinutes: 100, hour: '21:00–22:00' };
    const rendered = family => Copy.families[family].ru.map((_, variant) =>
      Messages.format({ family, values }, 'ru', variant)).filter(Boolean);
    const returns = rendered('comeback');
    const age = rendered('past');
    const repeats = rendered('repeat');
    assert.ok(returns.some(text => text.toLowerCase().includes('после ' + dayGen)),
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
    title: 'Очень длинное название. Ещё одна часть?', otherTitle: '🎸'.repeat(64), artist: '😀'.repeat(80),
    album: 'Длинный альбом с названием на несколько слов', localDay: 2,
    days: 101, daySpan: '101 день', daySpanGen: '101 дня',
    count: 101, trackCount: '101 трек', trackCountGen: '101 трека',
    listenCount: '101 прослушивание', listenCountGen: '101 прослушивания',
    ratio:'101 из 120',denominator:120,minutes: 1561, previousMinutes: 999, percent: 99, hour: '23:00–00:00', length: '1:42'
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

test('named listening suggestions require the right track evidence', () => {
  const tracks = [
    {id:'new', title:'Стекло', artist:'Линии', duration:180000},
    {id:'other', title:'Ноябрь', artist:' линии ', duration:180000},
    {id:'old', title:'Эхо', artist:'Разные исполнители', duration:95000, favorite:true},
    {id:'unknown', title:'Без автора', artist:'Разные исполнители', duration:180000},
    {id:'unplayed', title:'Короткий трек', artist:'Автор', duration:63000, favorite:true},
    {id:'heard', title:'Ветки', artist:'Линии', duration:180000}
  ];
  const play = (track, days, heard) => ({id:track, track, started:NOW-days*DAY, heard});
  const plays = [play('new',1,145000), play('old',42,95000), play('heard',10,90000), play('other',0,10000)];
  const model = Home.build(tracks,{plays},NOW);
  const cards = Messages.candidates(model,NOW);
  const anchors = family => cards.filter(card => card.family === family).map(card => card.anchor);
  assert.deepEqual(anchors('artistDiscovery'), ['other']);
  assert.ok(anchors('unheard').includes('unknown'));
  assert.deepEqual(anchors('shortBreak'), ['old']);
  assert.equal(cards.find(card => card.family === 'shortBreak').values.length, '1:35');
  const pair = cards.find(card => card.family === 'contrast');
  assert.deepEqual([pair.anchor,pair.related], ['new','old']);
  assert.match(Messages.format(pair), /Стекло.*Эхо/);
  const excluded = new Set(['other','old']);
  assert.ok(Messages.candidates(model,NOW,0,undefined,id=>excluded.has(id))
    .every(card => !excluded.has(card.anchor) && !excluded.has(card.related)));
});

test('album suggestions distinguish editions by artist and use a heard or unheard track as stated', () => {
  const tracks = [
    {id:'a',title:'Ветер',artist:'Линии',album:'Шум',duration:180000},
    {id:'b',title:'Вода',artist:'Линии',album:'Шум',duration:600000},
    {id:'c',title:'Воздух',artist:'линии',album:' ШУМ ',duration:180000},
    {id:'d',title:'Голос',artist:'Другой',album:'Шум',duration:180000}
  ];
  const plays = [
    {id:'today',track:'a',started:NOW-900000,heard:360000},
    {id:'yesterday',track:'b',started:NOW-DAY,heard:120000}
  ];
  const model = Home.build(tracks,{plays},NOW);
  const cards = Messages.candidates(model,NOW);
  assert.deepEqual(cards.filter(card=>card.family==='albumDiscovery').map(card=>card.anchor),['c']);
  assert.deepEqual(cards.filter(card=>card.family==='albumPair').map(card=>[card.anchor,card.related]),[['a','b']]);
  assert.equal(cards.find(card=>card.family==='todayHeadliner')?.anchor,'a');
  assert.equal(cards.find(card=>card.family==='slowListen')?.values.length,'10:00');
});

test('calendar messages use local hours and complete days of silence', () => {
  const tracks = [{id:'music',title:'Мелодия'}];
  const play = (id,day,hour,heard) => ({id,track:'music',started:new Date(2026,10,3-day,hour).getTime(),heard});
  const plays = [play('today',0,13,180000)];
  for(const day of [8,14,21]){
    plays.push(play('night-'+day,day,2,600000),play('morning-'+day,day,8,660000));
  }
  const cards = history => Messages.candidates(Home.build(tracks,{plays:history},NOW),NOW);
  const byFamily = Object.fromEntries(cards(plays).map(card=>[card.family,card]));
  assert.equal(byFamily.nightTime.values.minutes,30);
  assert.equal(byFamily.morningTime.values.minutes,33);
  assert.equal(byFamily.breakEnded.values.days,7);
  assert.ok(!byFamily.weekdayHabit);
  assert.ok(cards([...plays,play('last-week',7,13,180000)]).some(card=>card.family==='weekdayHabit'));
});

test('catalog discovery accesses at most 24 positions and moves past the first page on an empty history', () => {
  const {model} = fixture();
  let reads = 0;
  model.catalog = new Proxy(model.catalog,{get(target,key,receiver){
    if(/^\d+$/.test(String(key)))reads++;
    return Reflect.get(target,key,receiver);
  }});
  Messages.candidates(model,NOW,2048);
  assert.equal(reads,24);
  const cold = Home.build(model.catalog,{},NOW);
  const firstTracks = seed => Messages.candidates(cold,NOW,seed).filter(card => card.family === 'ready').map(card => card.anchor);
  const initial = new Set(firstTracks(0));
  assert.equal(initial.size,6);
  assert.ok(firstTracks(47).every(id => !initial.has(id)));
});

test('week and time-of-day observations require several comparable days', () => {
  const library = [{id:'one', title:'Вечер', duration:180000}];
  const older = Array.from({length:4},(_,i) => ({id:'earlier-'+i, track:'one',
    started:new Date(2026,10,2-i,15,5).getTime(), heard:240000}));
  const today = {id:'today',track:'one',started:NOW-1800000,heard:960000};
  const cards = (plays,at=NOW) => Messages.candidates(Home.build(library,{plays},at),at);
  const full = cards([...older,today]);
  assert.equal(full.find(card => card.family === 'weekPeak')?.values.minutes,16);
  assert.equal(full.find(card => card.family === 'hourRoutine')?.values.days,4);
  assert.ok(!full.some(card => card.family === 'today' || card.family === 'peakHour'));
  assert.ok(!cards([older[0],today]).some(card => card.family === 'weekPeak' || card.family === 'hourRoutine'));
  assert.ok(!cards([...older,today],NOW+3600000).some(card => card.family === 'hourRoutine'));
  assert.ok(!cards([...older,{...today,heard:360000}]).some(card => card.family === 'weekPeak'));
});

test('dated surprises show only once per event and at most once per local day', () => {
  const tracks = [{id:'first',title:'Ночь'},{id:'year',title:'Рассвет'}];
  const play = (id,track,started,heard=180000) => ({id,track,started,heard});
  const plays = [
    play('preview','removed',new Date(2024,10,2,13).getTime(),500),
    play('opening','first',new Date(2024,10,3,13).getTime()),
    play('anniversary','year',new Date(2025,10,3,23,58).getTime()),
    play('return','first',NOW-2*3600000),
    play('same-day','first',NOW-3600000)
  ];
  const build = (now, history=plays) => Home.build(tracks,{plays:history},now);
  const storage = memoryStorage();
  const next = (now,lang='ru') => Messages.create({storage,random:()=>0.2}).next(build(now),{now,lang});
  assert.match(next(NOW), /Перемотка на год.*Рассвет/);
  for (let i=0;i<12;i++) assert.doesNotMatch(next(NOW,'en'), /Rewind one year|came full circle/);
  assert.match(next(NOW+DAY), /вернулся первый трек.*Ночь/);
  assert.doesNotMatch(next(NOW+2*DAY,'en'), /came full circle/);
  assert.ok(!Messages.candidates(build(NOW+4*DAY),NOW+4*DAY).some(card=>card.event));
  const removedOpening = build(NOW,[...plays,play('removed','removed',new Date(2024,10,1,13).getTime())]);
  assert.ok(!Messages.candidates(removedOpening,NOW).some(card=>card.family==='openingReturn'));
  assert.ok(!Messages.candidates(build(NOW),NOW,0,undefined,id=>id==='year').some(card=>card.family==='anniversary'));
  const leapDay = new Date(2028,1,29,15).getTime();
  const afterFebruary = play('march','year',new Date(2027,2,1,0,0).getTime());
  assert.ok(!Messages.candidates(build(leapDay,[afterFebruary]),leapDay).some(card=>card.family==='anniversary'));
});

test('the weekly chorus and 24-hour milestone are earned by listening', () => {
  const tracks = [{id:'chorus',title:'Весна'}];
  const play = (id,started,heard=180000) => ({id,track:'chorus',started,heard});
  const plays = [play('today',NOW-3600000),play('yesterday',NOW-DAY-3600000),play('before',NOW-2*DAY)];
  const cards = (history,now=NOW) => Messages.candidates(Home.build(tracks,{plays:history},now),now);
  const chorus = cards(plays).find(card=>card.family==='newRitual');
  assert.match(Messages.format(chorus), /припев.*3 из 7 дней/i);
  chorus.values.title='Очень длинное название трека из фонотеки с невероятными приключениями';
  assert.ok(Messages.format(chorus).length<=64);
  assert.ok(!cards([plays[0],plays[1],play('same-day',NOW-7200000)]).some(card=>card.family==='newRitual'));
  const long = play('long',NOW-3*DAY,DAY-60000);
  const withMilestone = [long,plays[0]];
  assert.ok(cards(withMilestone).some(card=>card.family==='dayOfMusic'));
  assert.ok(!cards(withMilestone,NOW+DAY).some(card=>card.family==='dayOfMusic'));
  assert.ok(!cards([long]).some(card=>card.family==='dayOfMusic'));
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
