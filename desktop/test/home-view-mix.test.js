const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const homeViewSource = fs.readFileSync(require.resolve('../src/home-view'), 'utf8');

function setupTestEnvironment() {
  const root = {
    innerHTML: '',
    querySelectorAll: (selector) => {
      const results = [];
      if (selector === '.home-mix .home-track') {
        const matches = root.innerHTML.match(/class="home-track([^"]*)"[^>]*data-home-action="mix"[^>]*data-id="([^"]*)"/g) || [];
        for (const m of matches) {
          const isCurrent = m.includes('is-current');
          const idMatch = m.match(/data-id="([^"]*)"/);
          const endObj = { innerHTML: '' };
          results.push({
            classList: { contains: (cls) => cls === 'is-current' && isCurrent },
            dataset: { id: idMatch ? idMatch[1] : '' },
            querySelector: (sel) => sel === '.home-track-end' ? endObj : null
          });
        }
      } else if (selector === '[data-home-action="vibe"]') {
        return [];
      }
      return results;
    },
    querySelector: (selector) => {
      if (selector === '[data-home-action="mix-play"]') {
        return { textContent: '' };
      }
      return null;
    },
    addEventListener: (event, handler) => { root.listeners[event] = handler; },
    contains: () => true,
    listeners: {}
  };
  const doc = {
    getElementById: (id) => id === 'homeContent' ? root : { classList: { contains: () => true } },
    activeElement: null
  };
  const windowObj = {
    PainDJVibes: { list: () => ({ items: [], activeId: null }) }
  };
  let mixCallCount = 0;
  const HomeModelMock = {
    build: (tracks, stats, now) => ({
      library: new Map(tracks.map(t => [String(t.id), t])),
      details: {
        plays: [],
        behavior: { streak: 1, longestStreak: 1, counts: {} },
        discoveries: 0,
        heardLibrary: tracks.length,
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
    mix: (tracks, queue, limit, variation) => {
      mixCallCount++;
      // Rotate tracks according to variation, keeping real track IDs
      const offset = variation % tracks.length;
      const rotated = [...tracks.slice(offset), ...tracks.slice(0, offset)];
      return rotated.slice(0, limit).map(t => ({ track: t, decision: null }));
    }
  };

  const context = {
    document: doc,
    window: windowObj,
    HomeModel: HomeModelMock,
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
  return {
    HomeView: context.window.HomeView,
    root,
    getMixCalls: () => mixCallCount
  };
}

test('Smart DJ mix stays stable when playback starts and does not regenerate or blink', () => {
  const { HomeView, root, getMixCalls } = setupTestEnvironment();
  const tracks = Array.from({ length: 10 }, (_, i) => ({
    id: `track-${i}`,
    title: `Song ${i}`,
    artist: `Artist ${i}`,
    duration: 180000
  }));

  const queueMock = { excludedTracks: new Set(), recommendationRevision: 1, isExcluded: () => false };
  const handlers = {
    cover: () => 'cover.jpg',
    fallbackCover: () => 'fallback.svg',
    navigate: () => {},
    resume: () => {},
    playTrack: () => {},
    playMix: () => {}
  };

  HomeView.render({
    tracks,
    stats: {},
    playlists: [],
    queue: queueMock,
    lang: 'ru',
    current: null,
    isPlaying: false
  }, handlers);

  assert.equal(getMixCalls(), 1, 'mix should be generated once on initial load');
  assert.match(root.innerHTML, /Song 0/);
  assert.match(root.innerHTML, /Song 5/);

  HomeView.render({
    tracks,
    stats: {},
    playlists: [],
    queue: queueMock,
    lang: 'ru',
    current: tracks[0],
    isPlaying: true
  }, handlers);

  assert.equal(getMixCalls(), 1, 'playback change must NOT trigger mix regeneration');
  assert.match(root.innerHTML, /Song 0/, 'same tracks must remain on screen');
  assert.match(root.innerHTML, /is-current/, 'playing track gets is-current highlight');
  assert.match(root.innerHTML, /Пауза/, 'play button displays Pause when mix is playing');
  assert.doesNotMatch(root.innerHTML, /Собираем подборку…/, 'UI must not blink or wipe tracks');
});

test('Clicking a mix track triggers playMix and subsequent click on playing track toggles resume', () => {
  const { HomeView, root } = setupTestEnvironment();
  const tracks = Array.from({ length: 6 }, (_, i) => ({
    id: `t${i}`,
    title: `Song ${i}`,
    artist: `Artist ${i}`,
    duration: 180000
  }));

  let playedTrack = null;
  let playedList = null;
  let resumeCalled = false;

  const handlers = {
    cover: () => '',
    fallbackCover: () => '',
    navigate: () => {},
    resume: () => { resumeCalled = true; },
    playTrack: () => {},
    playMix: (t, list) => { playedTrack = t; playedList = list; }
  };

  const queueMock = { excludedTracks: new Set(), isExcluded: () => false };

  HomeView.render({
    tracks,
    stats: {},
    playlists: [],
    queue: queueMock,
    lang: 'ru',
    current: null,
    isPlaying: false
  }, handlers);

  // Click on track t2
  root.listeners.click({
    target: {
      closest: (sel) => sel === '[data-home-action]' ? {
        dataset: { homeAction: 'mix', id: 't2' },
        disabled: false
      } : null
    }
  });

  assert.ok(playedTrack, 'playMix must be invoked');
  assert.equal(playedTrack.id, 't2');
  assert.equal(playedList.length, 6);
  assert.equal(resumeCalled, false);

  // Now simulate that t2 is currently playing
  HomeView.render({
    tracks,
    stats: {},
    playlists: [],
    queue: queueMock,
    lang: 'ru',
    current: { id: 't2' },
    isPlaying: true
  }, handlers);

  // Clicking on t2 while it is playing must toggle pause (resume)
  root.listeners.click({
    target: {
      closest: (sel) => sel === '[data-home-action]' ? {
        dataset: { homeAction: 'mix', id: 't2' },
        disabled: false
      } : null
    }
  });

  assert.equal(resumeCalled, true, 'clicking currently playing track must toggle resume/pause');
});

test('Explicit refresh regenerates mix but keeps existing tracks rendered until ready', () => {
  const { HomeView, root, getMixCalls } = setupTestEnvironment();
  const tracks = Array.from({ length: 6 }, (_, i) => ({
    id: `t${i}`,
    title: `Song ${i}`,
    duration: 180000
  }));

  const queueMock = { excludedTracks: new Set(), isExcluded: () => false };
  const handlers = {
    cover: () => '',
    fallbackCover: () => '',
    navigate: () => {},
    resume: () => {},
    playTrack: () => {},
    playMix: () => {}
  };

  HomeView.render({
    tracks,
    stats: {},
    playlists: [],
    queue: queueMock,
    lang: 'ru',
    current: null,
    isPlaying: false
  }, handlers);

  assert.equal(getMixCalls(), 1);
  assert.match(root.innerHTML, /Song 0/);

  root.listeners.click({
    target: {
      closest: (sel) => sel === '[data-home-action]' ? {
        dataset: { homeAction: 'refresh' },
        disabled: false
      } : null
    }
  });

  assert.equal(getMixCalls(), 2, 'refresh must trigger mix recalculation with variation');
  // With variation=1, tracks rotated so Song 1 is first
  assert.match(root.innerHTML, /Song 1/);
});
