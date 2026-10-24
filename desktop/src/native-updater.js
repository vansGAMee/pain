// Native packages use the installer/update metadata produced by electron-builder.
// Never replace an Electron runtime with the legacy Node-only EXE/archive.
module.exports = function createNativeUpdater(options) {
  const { app } = require('electron');
  const { Updater, isNewer } = require('./updater');
  const fallback = new Updater(options);
  const { releaseSummary } = require('./comfort-utils');
  let state = { currentVersion: options.currentVersion, status: 'idle', available: false, canInstall: false };
  let checking = null, installing = null;
  const supported = app.isPackaged && (process.platform === 'win32' || !!process.env.APPIMAGE);
  const updater = supported ? require('electron-updater').autoUpdater : null;
  if (updater) {
    updater.autoDownload = false; updater.autoInstallOnAppQuit = false;
    updater.on('error', error => { state = { ...state, status: 'error', error: error.message }; });
  }
  const api = {
    publicState: () => ({ ...state }),
    async check(force = false) {
      if (installing || ['downloading', 'downloaded'].includes(state.status)) return api.publicState();
      if (checking) return checking;
      if (!force && Date.now() - (state.checkedAt || 0) < 6 * 3600000) return api.publicState();
      checking = (async () => {
        try {
          if (!updater) { state = { ...await fallback.check(force), canInstall: false }; return api.publicState(); }
          const result = await updater.checkForUpdates();
          const info = result?.updateInfo;
          const available = !!info && isNewer(info.version, options.currentVersion);
          const notes = Array.isArray(info?.releaseNotes) ? info.releaseNotes.map(item => item.note).join('\n') : info?.releaseNotes;
          state = { ...state, status: 'ready', latestVersion: info?.version, available, canInstall: available,
            notes: releaseSummary(notes), page: 'https://github.com/vansGAMee/pain/releases/latest', checkedAt: Date.now(), error: null };
        } catch (error) { state = { ...state, status: 'error', available: false, canInstall: false, error: error.message }; }
        return api.publicState();
      })().finally(() => { checking = null; });
      return checking;
    },
    async prepareInstall() {
      if (installing) return installing;
      if (!updater || !state.canInstall) throw new Error('Native installer is not available');
      const promise = (async () => {
        try {
          state = { ...state, status: 'downloading', error: null };
          await updater.downloadUpdate();
          state = { ...state, status: 'downloaded', error: null };
          let started = false;
          return { state: api.publicState(), restart() { if (!started) { started = true; updater.quitAndInstall(false, true); } } };
        } catch (error) {
          state = { ...state, status: 'error', error: error.message };
          throw error;
        }
      })();
      installing = promise.catch(error => {
        installing = null;
        throw error;
      });
      return installing;
    }
  };
  return api;
};
