const { app, BrowserWindow, Tray, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');

app.setName('PAIN');
app.setPath('userData', process.env.PAIN_USER_DATA_DIR || path.join(app.getPath('appData'), 'Pain'));
if (process.platform === 'win32') app.setAppUserModelId('dev.pain.desktop');
if (process.platform === 'linux') {
  app.setDesktopName('pain.desktop');
  app.commandLine?.appendSwitch('enable-features', 'WaylandWindowDecorations');
  app.commandLine?.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  if (process.env.XDG_SESSION_TYPE === 'wayland' || process.env.WAYLAND_DISPLAY) {
    app.commandLine?.appendSwitch('ozone-platform-hint', 'auto');
  }
}

let mainWindow = null, tray = null, server = null, quitting = false;
const icon = path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'app-icon.ico' : 'app-icon.png');
function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show(); mainWindow.focus();
}
function setTray(enabled) {
  if (enabled && !tray) {
    const next = new Tray(icon);
    try {
      next.setToolTip('PAIN');
      next.setContextMenu(Menu.buildFromTemplate([
        { label: 'PAIN — Открыть / Open', click: showWindow },
        { type: 'separator' },
        { label: 'Выход / Quit', click: () => app.quit() }
      ]));
      next.on('click', showWindow); next.on('double-click', showWindow);
      tray = next;
    } catch (error) { next.destroy(); throw error; }
  } else if (!enabled && tray) {
    showWindow(); tray.destroy(); tray = null;
  }
}
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100, height: 780, minWidth: 900, minHeight: 650,
    show: false, backgroundColor: '#EFEDE6', title: 'PAIN', icon,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true }
  });
  const hideToTray = event => {
    if (!quitting && tray && !tray.isDestroyed()) { event.preventDefault(); mainWindow.hide(); }
  };
  mainWindow.on('close', hideToTray);
  mainWindow.on('minimize', hideToTray);
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.once('ready-to-show', showWindow);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  mainWindow.webContents.on?.('render-process-gone', (event, details) => {
    console.error('[Main] Renderer process gone:', details);
    if (details.reason !== 'clean-exit' && !quitting && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.reload();
    }
  });
  const load = () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(`http://localhost:${server.address().port}`);
  };
  if (server.listening) load(); else server.once('listening', load);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (app.isReady()) showWindow(); });
  app.on('activate', () => { if (mainWindow) showWindow(); else if (server) createWindow(); });
  app.on('before-quit', event => {
    if(!quitting&&server?.shutdown){
      quitting=true;event.preventDefault();
      // Save the current play while HTTP is still available, including a quit
      // from the tray. A stalled renderer must not prevent a normal exit.
      const saved=mainWindow&&!mainWindow.isDestroyed()
        ? mainWindow.webContents.executeJavaScript('window.PainPlayer?.flushListening()').catch(()=>{}) : Promise.resolve();
      let timer;
      Promise.race([saved,new Promise(resolve=>{timer=setTimeout(resolve,3000);})])
        .finally(()=>{clearTimeout(timer);return server.shutdown();}).finally(()=>app.quit());
    }
    else quitting = true;
  });
  app.on('will-quit', () => { server?.pulseflow?.close(); tray?.destroy(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.whenReady().then(() => {
    process.env.OPEN_BROWSER = 'false';
    if (!process.env.PAIN_DATA_DIR && app.isPackaged) {
      const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
      const exeDir = path.dirname(process.execPath);
      const appDataDir = app.getPath('userData');

      let baseDir = appDataDir;
      if (portableDir) {
        baseDir = portableDir;
      } else if (fs.existsSync(path.join(exeDir, 'data'))) {
        baseDir = exeDir;
      }

      // Auto-migration between portable and installed if current target data dir is empty
      const targetDataDir = path.join(baseDir, 'data');
      if (!fs.existsSync(path.join(targetDataDir, 'library.json'))) {
        const candidates = [appDataDir, portableDir, exeDir].filter(Boolean);
        for (const cand of candidates) {
          const candData = path.join(cand, 'data');
          if (cand !== baseDir && fs.existsSync(path.join(candData, 'library.json'))) {
            try {
              fs.mkdirSync(targetDataDir, { recursive: true });
              for (const f of fs.readdirSync(candData)) {
                const srcPath = path.join(candData, f);
                const dstPath = path.join(targetDataDir, f);
                if (!fs.existsSync(dstPath) && fs.statSync(srcPath).isFile()) {
                  fs.copyFileSync(srcPath, dstPath);
                }
              }
              break;
            } catch (_) {}
          }
        }
      }
      process.env.PAIN_DATA_DIR = baseDir;
    }
    server = require('./server-runtime')();
    server.on('backend-error',error=>{console.error('[Main] Backend unavailable:',error);});
    createWindow();
    server.on('activate-window', showWindow);
    server.desktopPreferences.attachShell(setTray);
  });
}
