const fs = require('fs'), path = require('path'), os = require('os');
const quoteSh = value => "'" + value.replace(/'/g, "'\"'\"'") + "'";
const quoteDesktop = value => '"' + value.replace(/[\\"`$]/g, '\\\\$&').replace(/%/g, '%%') + '"';

module.exports = function createPreferences(dataDir, options = {}) {
  const platform = options.platform || process.platform, env = options.env || process.env;
  const nativeApp = options.app || (process.versions.electron ? require('electron').app : null);
  const executable = options.executable || env.PORTABLE_EXECUTABLE_FILE || env.APPIMAGE || process.execPath;
  const args = nativeApp?.isPackaged ? [] : [path.join(__dirname, '..')];
  const loginArgs = [...args, '--autostart'];
  const file = path.join(dataDir, 'desktop-preferences.json');
  const config = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  const startupFile = path.join(config, 'autostart', 'pain.desktop');
  const hyprDir = path.join(config, 'hypr');
  const hypr = /hyprland/i.test(env.XDG_CURRENT_DESKTOP || '') || !!env.HYPRLAND_INSTANCE_SIGNATURE;
  const hyprFile = path.join(hyprDir, fs.existsSync(path.join(hyprDir, 'hyprland.lua')) ? 'hyprland.lua' : 'hyprland.conf');
  const lua = hyprFile.endsWith('.lua');
  const marker = (lua ? '--' : '#') + ' PAIN AUTOSTART';
  const blockPattern = new RegExp('\\n?' + marker + ' BEGIN\\n[\\s\\S]*?' + marker + ' END\\n?', 'g');
  let saved = {}, shell = null, trayActive = false;
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
  const prefs = { tray: saved?.tray === true };
  const login = () => ({ path: executable, args: loginArgs, name: 'dev.pain.desktop' });
  function hasHook() { try { return fs.readFileSync(hyprFile, 'utf8').includes(marker + ' BEGIN'); } catch (_) { return false; } }
  function state() {
    let autostart = false;
    if (nativeApp && platform === 'win32') {
      const settings = nativeApp.getLoginItemSettings(login());
      autostart = settings.openAtLogin && settings.executableWillLaunchAtLogin !== false;
    } else if (nativeApp && platform === 'linux') autostart = fs.existsSync(startupFile) && (!hypr || hasHook());
    return { autostart, tray: trayActive, canAutostart: !!nativeApp && ['linux', 'win32'].includes(platform), canTray: !!shell };
  }
  function setHyprHook(enabled) {
    if (!hypr && !hasHook()) return;
    if (!fs.existsSync(hyprFile)) { if (enabled) throw new Error('Hyprland config not found'); return; }
    const original = fs.readFileSync(hyprFile, 'utf8');
    let content = original.replace(blockPattern, '\n');
    if (enabled) {
      const command = [executable, ...loginArgs].map(quoteSh).join(' ');
      const launch = lua ? `hl.on("hyprland.start", function() hl.exec_cmd(${JSON.stringify(command)}) end)` : `exec-once = ${command}`;
      content = content.trimEnd() + `\n\n${marker} BEGIN\n${launch}\n${marker} END\n`;
    }
    if (content !== original) {
      if (!fs.existsSync(hyprFile + '.before-pain-autostart')) fs.copyFileSync(hyprFile, hyprFile + '.before-pain-autostart');
      fs.writeFileSync(hyprFile, content);
    }
  }
  function autostart(enabled) {
    if (!state().canAutostart) throw new Error('Requires native PAIN app');
    if (platform === 'win32') {
      nativeApp.setLoginItemSettings({ ...login(), openAtLogin: enabled, enabled });
      if (state().autostart !== enabled) throw new Error('System login setting was not applied');
    } else {
      if (enabled) {
        fs.mkdirSync(path.dirname(startupFile), { recursive: true });
        setHyprHook(true);
        fs.writeFileSync(startupFile, `[Desktop Entry]\nType=Application\nName=PAIN\nExec=${[executable, ...loginArgs].map(quoteDesktop).join(' ')}\nIcon=pain\nTerminal=false\n`, { mode: 0o600 });
      } else { setHyprHook(false); fs.rmSync(startupFile, { force: true }); }
    }
  }
  return {
    state,
    attachShell(callback) {
      shell = callback;
      try { shell(prefs.tray); trayActive = prefs.tray; } catch (_) { trayActive = false; }
    },
    start() {},
    async update(body) {
      if (!body || typeof body !== 'object') throw new Error('Invalid preferences');
      if (typeof body.autostart === 'boolean') autostart(body.autostart);
      if (typeof body.tray === 'boolean') {
        if (!shell) throw new Error('Requires native PAIN app');
        shell(body.tray); trayActive = body.tray; prefs.tray = body.tray;
      }
      fs.writeFileSync(file + '.tmp', JSON.stringify({ ...prefs, autostart: state().autostart }));
      fs.renameSync(file + '.tmp', file);
      return state();
    }
  };
};
