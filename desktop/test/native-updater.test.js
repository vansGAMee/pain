const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { isNewer } = require('../src/updater');
const comfort = require('../src/comfort-utils');

const source = fs.readFileSync(require.resolve('../src/native-updater'), 'utf8');
const updateInfo = { version: '1.8.0', releaseNotes: '# Better playback\n- [Tray](https://example.com) support' };

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function launch({ packaged = true, platform = 'win32', appImage = false,
  check = async () => ({ updateInfo }), download = async () => [],
  legacyState = { currentVersion: '1.7.4', latestVersion: '1.8.0', status: 'ready', available: true, canInstall: true }
} = {}) {
  const counts = { checks: 0, downloads: 0, fallbackChecks: 0, nativeLoads: 0 }, restarts = [];
  const native = new EventEmitter();
  native.autoDownload = true; native.autoInstallOnAppQuit = true;
  native.checkForUpdates = () => { counts.checks++; return check(); };
  native.downloadUpdate = () => { counts.downloads++; return download(); };
  native.quitAndInstall = (...args) => { restarts.push(args); };
  class LegacyUpdater {
    async check() { counts.fallbackChecks++; return { ...legacyState }; }
    prepareInstall() { assert.fail('Native updater must never install a legacy payload'); }
  }
  const context = {
    module: { exports: {} }, process: { platform, env: appImage ? { APPIMAGE: '/isolated/Pain.AppImage' } : {} },
    require(name) {
      if (name === 'electron') return { app: { isPackaged: packaged } };
      if (name === 'electron-updater') { counts.nativeLoads++; return { autoUpdater: native }; }
      if (name === './updater') return { Updater: LegacyUpdater, isNewer };
      if (name === './comfort-utils') return comfort;
      throw new Error(`Unexpected updater dependency: ${name}`);
    }
  };
  vm.runInNewContext(source, context);
  return { api: context.module.exports({ currentVersion: '1.7.4' }), native, counts, restarts };
}

test('development and unsupported native packages never offer legacy installation', async () => {
  for (const options of [{ packaged: false }, { packaged: false, platform: 'linux', appImage: true }, { platform: 'linux' }, { platform: 'darwin' }]) {
    const { api, counts } = launch(options);
    assert.equal(api.publicState().canInstall, false);
    const state = await api.check(true);
    assert.equal(state.available, true);
    assert.equal(state.canInstall, false);
    await assert.rejects(api.prepareInstall(), /Native installer is not available/);
    assert.equal(counts.fallbackChecks, 1);
    assert.equal(counts.nativeLoads, 0);
    assert.equal(counts.downloads, 0);
  }
});

test('Windows and AppImage automatically prepare an update without restarting playback', async () => {
  for (const options of [{}, { platform: 'linux', appImage: true }]) {
    const { api, native, counts, restarts } = launch(options);
    assert.equal(native.autoDownload, false);
    assert.equal(native.autoInstallOnAppQuit, true);
    assert.equal(native.autoRunAppAfterInstall, false);
    assert.equal(native.allowPrerelease, false);
    assert.equal(native.allowDowngrade, false);
    await assert.rejects(api.prepareInstall(), /Native installer is not available/);
    const state = await api.check(true);
    assert.equal(state.canInstall, true);
    assert.equal(counts.downloads, 1,'a check starts the background download without an installation request');
    const prepared = await api.prepareInstall();
    assert.equal(prepared.state.status, 'downloaded');
    assert.equal(counts.downloads, 1);
    assert.deepEqual(restarts, []);
    prepared.restart(); prepared.restart();
    assert.deepEqual(restarts, [[true, true]]);
    assert.equal(counts.fallbackChecks, 0);
  }
});

test('concurrent checks share work, cache results, and expose readable native release notes', async () => {
  const pending = deferred();
  const { api, counts } = launch({ check: () => pending.promise });
  const first = api.check(true), second = api.check(true);
  assert.equal(counts.checks, 1);
  pending.resolve({ updateInfo: { ...updateInfo, releaseNotes: [{ version: '1.8.0', note: '# Better playback' }, { version: '1.7.5', note: '- [Tray](https://example.com) support' }] } });
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b);
  assert.equal(a.currentVersion, '1.7.4');
  assert.equal(a.latestVersion, '1.8.0');
  assert.equal(a.notes, 'Better playback\nTray support');
  assert.equal(a.status, 'downloading');
  assert.equal(a.available, true);
  assert.equal(a.error, null);
  assert.match(a.page, /^https:\/\/github\.com\//);
  await api.check();
  assert.equal(counts.checks, 1);
  a.canInstall = false;
  assert.equal(api.publicState().canInstall, true);
});

test('concurrent downloads share preparation and checking cannot replace a pending install', async () => {
  const pending = deferred();
  const { api, counts, restarts } = launch({ download: () => pending.promise });
  await api.check(true);
  const first = api.prepareInstall(), second = api.prepareInstall();
  assert.equal(counts.downloads, 1);
  assert.equal((await api.check(true)).status, 'downloading');
  assert.equal(counts.checks, 1);
  pending.resolve([]);
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b);
  assert.equal(await api.prepareInstall(), a);
  assert.equal((await api.check(true)).status, 'downloaded');
  assert.equal(counts.downloads, 1);
  assert.equal(counts.checks, 1);
  a.restart(); b.restart();
  assert.deepEqual(restarts, [[true, true]]);
});

test('same, older or missing native releases cannot be installed', async () => {
  for (const info of [{ version: '1.7.4' }, { version: '1.6.0' }, undefined]) {
    const { api, counts } = launch({ check: async () => ({ updateInfo: info }) });
    const state = await api.check(true);
    assert.equal(state.available, false);
    assert.equal(state.canInstall, false);
    await assert.rejects(api.prepareInstall(), /Native installer is not available/);
    assert.equal(counts.downloads, 0);
  }
});

test('a failed check clears installation eligibility and can be retried', async () => {
  let fail = true;
  const { api, counts, native } = launch({ check: async () => {
    if (fail) throw new Error('Metadata unavailable');
    return { updateInfo };
  } });
  const failed = await api.check(true);
  assert.equal(failed.status, 'error');
  assert.equal(failed.canInstall, false);
  assert.equal(failed.error, 'Metadata unavailable');
  fail = false;
  assert.equal((await api.check(true)).canInstall, true);
  assert.equal(api.publicState().error, null);
  assert.equal(counts.checks, 2);
  native.emit('error', new Error('Update service unavailable'));
  assert.equal(api.publicState().status, 'error');
  assert.equal(api.publicState().error, 'Update service unavailable');
});

for (const synchronous of [false, true]) {
  test(`${synchronous ? 'synchronous' : 'asynchronous'} download failures can be retried without stale errors`, async () => {
    let fail = true;
    const { api, counts } = launch({ download: () => {
      if (!fail) return Promise.resolve([]);
      if (synchronous) throw new Error('Download unavailable');
      return Promise.reject(new Error('Download unavailable'));
    } });
    await api.check(true);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(api.publicState().status, 'error');
    assert.equal(counts.downloads, 1);
    fail = false;
    await api.check(true);
    const prepared = await api.prepareInstall();
    assert.equal(counts.downloads, 2);
    assert.equal(prepared.state.status, 'downloaded');
    assert.equal(prepared.state.error, null);
  });
}

test('the real native quit handler installs silently only on successful exit and does not reopen the app',()=>{
  const {BaseUpdater}=require('electron-updater/out/BaseUpdater');
  const app=new EventEmitter(),installed=[];
  const updater=Object.create(BaseUpdater.prototype);
  Object.assign(updater,{app:{onQuit:handler=>app.on('quit',handler)},autoInstallOnAppQuit:true,
    _logger:{info(){},warn(){}},downloadedUpdateHelper:{file:'/isolated/verified-installer',downloadedFileInfo:{}},
    doInstall:options=>{installed.push(options);return true;}});
  updater.addQuitHandler();updater.addQuitHandler();assert.equal(app.listenerCount('quit'),1);
  assert.deepEqual(installed,[],'ready updates must never interrupt a running app');
  app.emit('quit',1);assert.deepEqual(installed,[],'a crash is not a successful exit');
  app.emit('quit',0);app.emit('quit',0);
  assert.equal(installed.length,1);assert.equal(installed[0].isSilent,true);assert.equal(installed[0].isForceRunAfter,false);
});
