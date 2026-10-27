const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const source = fs.readFileSync(require.resolve('../src/main'), 'utf8');

async function launch({ platform = 'linux', lock = true, ready = true, listening = true, trayEnabled = true, trayFailure } = {}) {
  const calls = [], windows = [], trays = [], trayErrors = [], opened = [];
  const app = new EventEmitter(), server = new EventEmitter();
  const env = { PAIN_USER_DATA_DIR: '/isolated/pain-profile' };
  const paths = { appData: '/isolated/app-data' };
  let resolveReady, isReady = false, setTray;
  const readyPromise = new Promise(resolve => { resolveReady = resolve; });
  app.setName = () => {};
  app.setPath = (key, value) => { paths[key] = value; };
  app.getPath = key => paths[key];
  app.setAppUserModelId = () => {};
  app.setDesktopName = () => {};
  app.requestSingleInstanceLock = () => { calls.push('lock'); return lock; };
  app.whenReady = () => { calls.push('ready'); return readyPromise; };
  app.isReady = () => isReady;
  app.quit = () => { calls.push('quit'); app.emit('before-quit'); };
  app.isPackaged = false;
  server.listening = listening;
  server.address = () => ({ port: 3013 });
  server.desktopPreferences = {
    attachShell(callback) {
      setTray = callback;
      try { callback(trayEnabled); } catch (error) { trayErrors.push(error); }
    }
  };

  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      calls.push('window'); windows.push(this);
      this.options = options; this.visible = options.show !== false;
      this.destroyed = false; this.minimized = false; this.focusCount = 0;
      this.webContents = { setWindowOpenHandler: handler => { this.openHandler = handler; } };
    }
    isDestroyed() { return this.destroyed; }
    isMinimized() { return this.minimized; }
    show() { this.visible = true; }
    hide() { this.visible = false; }
    restore() { this.minimized = false; }
    focus() { this.focusCount++; }
    loadURL(url) { this.url = url; }
    static getAllWindows() { return windows.filter(window => !window.destroyed); }
  }
  class Tray extends EventEmitter {
    constructor() {
      super();
      if (trayFailure === 'constructor') throw new Error('Tray unavailable');
      this.destroyed = false; trays.push(this);
    }
    setToolTip() {}
    setContextMenu(menu) {
      if (trayFailure === 'menu') throw new Error('Tray menu unavailable');
      this.menu = menu;
    }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
  }
  vm.runInNewContext(source, {
    __dirname: path.dirname(require.resolve('../src/main')),
    process: { platform, env, execPath: '/isolated/Pain', versions: { electron: 'test' } },
    require(name) {
      if (name === 'electron') return {
        app, BrowserWindow, Tray, Menu: { buildFromTemplate: template => template },
        shell: { openExternal: async url => { opened.push(url); } }
      };
      if (name === 'path') return path;
      if (name === 'fs') return { existsSync: () => false };
      if (name === './server-runtime') {
        assert.equal(env.OPEN_BROWSER, 'false');
        calls.push('server'); return () => server;
      }
      throw new Error(`Unexpected native shell dependency: ${name}`);
    }
  });
  async function becomeReady() {
    isReady = true; resolveReady(); await readyPromise; await Promise.resolve();
  }
  if (ready) await becomeReady();
  return { app, server, calls, windows, trays, trayErrors, opened, becomeReady, setTray: enabled => setTray(enabled) };
}

function request(window, eventName) {
  const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  window.emit(eventName, event);
  return event.defaultPrevented;
}

for (const platform of ['linux', 'win32']) {
  test(`${platform}: duplicate launch exits before Electron readiness, server or window creation`, async () => {
    const shell = await launch({ platform, lock: false });
    assert.deepEqual(shell.calls, ['lock', 'quit']);
    assert.equal(shell.windows.length, 0);
  });

  test(`${platform}: primary launch waits for readiness, creates one window and uses the listening port`, async () => {
    const shell = await launch({ platform, ready: false, listening: false });
    shell.app.emit('second-instance');
    assert.deepEqual(shell.calls, ['lock', 'ready']);
    await shell.becomeReady();
    assert.deepEqual(shell.calls, ['lock', 'ready', 'server', 'window']);
    const window = shell.windows[0];
    assert.equal(window.visible, false);
    assert.equal(window.url, undefined);
    shell.server.listening = true; shell.server.emit('listening');
    assert.equal(window.url, 'http://localhost:3013');
    window.emit('ready-to-show');
    assert.equal(window.visible, true);
  });

  test(`${platform}: close uses the tray and all activation paths restore the same window`, async () => {
    const shell = await launch({ platform });
    const window = shell.windows[0], tray = shell.trays[0];
    const activations = [
      () => shell.app.emit('second-instance'), () => shell.app.emit('activate'),
      () => shell.server.emit('activate-window'), () => tray.emit('click'),
      () => tray.emit('double-click'), () => tray.menu.find(item => /Open/.test(item.label)).click()
    ];
    for (const [index, activate] of activations.entries()) {
      window.show();
      assert.equal(request(window, 'minimize'), true, 'minimizing uses the enabled tray');
      assert.equal(window.visible, false);
      activate();
      assert.equal(window.visible, true);
      assert.equal(request(window, 'close'), true);
      assert.equal(window.visible, false);
      window.minimized = true;
      const focused = window.focusCount;
      activate();
      assert.equal(window.visible, true);
      assert.equal(window.minimized, false);
      assert.equal(window.focusCount, focused + 1);
    }
    assert.equal(shell.windows.length, 1);
    assert.equal(shell.calls.filter(call => call === 'server').length, 1);
    assert.equal(shell.calls.includes('quit'), false);
  });

  test(`${platform}: disabling a tray restores a hidden window and normal close/minimize`, async () => {
    const shell = await launch({ platform });
    const window = shell.windows[0], tray = shell.trays[0];
    assert.equal(request(window, 'close'), true);
    assert.equal(window.visible, false);
    shell.setTray(false);
    assert.equal(window.visible, true);
    assert.equal(tray.destroyed, true);
    assert.equal(request(window, 'minimize'), false);
    assert.equal(request(window, 'close'), false);
    shell.app.emit('window-all-closed');
    assert.equal(shell.calls.at(-1), 'quit');
  });

  test(`${platform}: a missing, failed or destroyed tray cannot hide an orphaned window`, async () => {
    for (const options of [{ trayEnabled: false }, { trayFailure: 'constructor' }, { trayFailure: 'menu' }, { destroyTray: true }]) {
      const shell = await launch({ platform, ...options });
      const window = shell.windows[0];
      if (options.destroyTray) shell.trays[0].destroy();
      window.emit('ready-to-show');
      assert.equal(request(window, 'minimize'), false);
      assert.equal(request(window, 'close'), false);
      assert.equal(window.visible, true);
      if (options.trayFailure) assert.equal(shell.trayErrors.length, 1);
      if (options.trayFailure === 'menu') assert.equal(shell.trays[0].destroyed, true);
    }
  });

  test(`${platform}: tray Quit and application quit permit closing and destroy the tray`, async () => {
    for (const fromTray of [true, false]) {
      const shell = await launch({ platform });
      if (fromTray) shell.trays[0].menu.find(item => /Quit/.test(item.label)).click();
      else shell.app.quit();
      assert.equal(shell.calls.at(-1), 'quit');
      assert.equal(request(shell.windows[0], 'close'), false);
      assert.equal(request(shell.windows[0], 'minimize'), false);
      shell.app.emit('will-quit');
      assert.equal(shell.trays[0].destroyed, true);
    }
  });
}

test('native renderer is isolated and popup links cannot create extra windows or launch local protocols', async () => {
  const shell = await launch();
  const window = shell.windows[0];
  assert.equal(window.options.webPreferences.nodeIntegration, false);
  assert.equal(window.options.webPreferences.contextIsolation, true);
  for (const url of ['https://example.com/music', 'http://example.com', 'file:///tmp/script', 'powershell:command', 'javascript:alert(1)']) {
    assert.equal(window.openHandler({ url }).action, 'deny');
  }
  assert.deepEqual(shell.opened, ['https://example.com/music', 'http://example.com']);
  assert.equal(shell.windows.length, 1);
});
