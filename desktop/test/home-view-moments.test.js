const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const homeViewSource = fs.readFileSync(require.resolve('../src/home-view'), 'utf8');

function setupTestEnvironment() {
  const root = {
    innerHTML: '',
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: (event, handler) => { root.listeners[event] = handler; },
    contains: () => true,
    listeners: {}
  };
  const doc = {
    getElementById: (id) => id === 'homeContent' ? root : { classList: { contains: () => true } },
    activeElement: null
  };
  const windowObj = {
    FavoriteMoments: {
      formatTime: (sec) => `${Math.floor(sec/60)}:${String(Math.floor(sec%60)).padStart(2,'0')}`
    },
    PainDJVibes: { list: () => ({ items: [], activeId: null }) }
  };
  const HomeModelMock = {
    build: (tracks, stats, now) => ({
      library: new Map(tracks.map(t => [String(t.id), t])),
      details: {
        plays: [],
        behavior: { streak: 1, longestStreak: 1, counts: {} },
        discoveries: 0,
        heardLibrary: 1,
        librarySize: tracks.length,
        knownTime: 1000,
        outsideFavorites: 0,
        calendar: [],
        hours: Array(24).fill(0)
      },
      recent: tracks,
      fresh: [],
      past: [],
      favorites: [],
      todayMs: 0,
      week: [],
      weekMs: 0
    }),
    mix: () => []
  };

  const context = {
    document: doc,
    window: windowObj,
    HomeModel: HomeModelMock,
    FavoriteMoments: windowObj.FavoriteMoments,
    requestAnimationFrame: (fn) => fn(),
    setTimeout: (fn) => fn(),
    Date,
    Math,
    String,
    Number,
    JSON,
    Array,
    Map,
    Set,
    escape: (s) => s
  };

  vm.runInNewContext(homeViewSource, context);
  return { HomeView: context.window.HomeView, root };
}

test('HomeView: renders Favorite Moments section with timecodes and duration pills', () => {
  const { HomeView, root } = setupTestEnvironment();
  const tracks = [
    { id: 'm1', title: 'Song One', artist: 'Artist One', duration: 200000 },
    { id: 'm2', title: 'Song Two', artist: 'Artist Two', duration: 180000 }
  ];
  const favoriteMoments = {
    'm1': 45.2,
    'm2': 110.0
  };

  HomeView.render({
    tracks,
    stats: {},
    playlists: [],
    queue: null,
    lang: 'ru',
    showMoments: true,
    favoriteMoments,
    momentsReel: { active: false, snippetSec: 25 }
  }, {
    cover: () => 'cover.jpg',
    fallbackCover: () => 'fallback.svg',
    navigate: () => {},
    resume: () => {},
    playTrack: () => {},
    playMix: () => {}
  });

  assert.match(root.innerHTML, /Лучшие моменты/);
  assert.match(root.innerHTML, /home-moments-grid/);
  assert.match(root.innerHTML, /Song One/);
  assert.match(root.innerHTML, /0:45/);
  assert.match(root.innerHTML, /1:50/);
  assert.match(root.innerHTML, /data-home-action="reel-duration"/);
});

test('HomeView: hides Favorite Moments section when showMoments is false', () => {
  const { HomeView, root } = setupTestEnvironment();
  const tracks = [{ id: 'm1', title: 'Song One', duration: 200000 }];
  const favoriteMoments = { 'm1': 45.2 };

  HomeView.render({
    tracks,
    stats: {},
    playlists: [],
    queue: null,
    lang: 'ru',
    showMoments: false,
    favoriteMoments
  }, {
    cover: () => '',
    fallbackCover: () => '',
    navigate: () => {},
    resume: () => {},
    playTrack: () => {}
  });

  assert.doesNotMatch(root.innerHTML, /Лучшие моменты/);
  assert.doesNotMatch(root.innerHTML, /home-moments-grid/);
});
