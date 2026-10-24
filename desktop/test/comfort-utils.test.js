const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { cleanTitle, releaseSummary } = require('../src/comfort-utils');
const create = require('../src/desktop-preferences');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pain native's "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
test('source cleanup preserves real titles and never empties a title', () => {
  for (const name of ['Song [music-site.ru]', 'Song (www.music.com)', 'Song — music-site.net', 'Song https://music.example.com/download']) assert.equal(cleanTitle(name), 'Song');
  for (const name of ['will.i.am', 'Song (Live)', 'Song — Remix', '[music.ru]', 'Song about music.com today', 'https://example.com']) assert.equal(cleanTitle(name), name);
});
test('release summary remains bounded readable text', () => {
  assert.equal(releaseSummary('## Fixes\n- **Seeking** works\n- [Details](https://example.com)\n```sh\ncode\n```'), 'Fixes\nSeeking works\nDetails');
  assert.equal(releaseSummary(undefined), '');
  assert.ok(releaseSummary('x'.repeat(5000)).length <= 700);
});
for (const syntax of ['lua', 'conf', 'xdg']) test(`native Linux login is reversible and idempotent: ${syntax}`, async t => {
  const root = fixture(t), hyprFile = path.join(root, 'hypr', 'hyprland.' + syntax);
  fs.mkdirSync(path.dirname(hyprFile));
  const original = syntax === 'lua' ? '-- Keep my desktop\nhl.on("hyprland.start", function() hl.exec_cmd("waybar") end)\n' : '# Keep my desktop\nexec-once = waybar\n';
  fs.writeFileSync(hyprFile, original);
  const options = { app: { isPackaged: true }, platform: 'linux', executable: path.join(root, 'pain'), env: { XDG_CONFIG_HOME: root, XDG_CURRENT_DESKTOP: syntax === 'xdg' ? 'GNOME' : 'Hyprland' } };
  const prefs = create(root, options);
  assert.equal(prefs.state().autostart, false);
  await prefs.update({ autostart: true });
  const entry = fs.readFileSync(path.join(root, 'autostart/pain.desktop'), 'utf8');
  assert.ok(entry.includes('"--autostart"'));
  assert.equal(create(root, options).state().autostart, true);
  const first = fs.readFileSync(hyprFile, 'utf8');
  await prefs.update({ autostart: true });
  assert.equal(fs.readFileSync(hyprFile, 'utf8'), first);
  if (syntax !== 'xdg') {
    assert.equal((first.match(/PAIN AUTOSTART BEGIN/g) || []).length, 1);
    assert.ok(first.includes(original.trim()));
    assert.equal(fs.readFileSync(hyprFile + '.before-pain-autostart', 'utf8'), original);
    if (syntax === 'lua') {
      const { execFileSync } = require('node:child_process');
      const result = execFileSync('lua', ['-e', 'hl={on=function(_,f) f() end,exec_cmd=function(s) print(s) end}; dofile(arg[1])', '--', hyprFile], { encoding: 'utf8' });
      assert.ok(result.includes('--autostart'));
    }
  }
  await prefs.update({ autostart: false });
  assert.equal(prefs.state().autostart, false);
  assert.equal(fs.existsSync(path.join(root, 'autostart/pain.desktop')), false);
  assert.equal(fs.readFileSync(hyprFile, 'utf8').trim(), original.trim());
});
test('Windows login uses native API and reads actual OS state, not a saved checkbox', async t => {
  const root = fixture(t), calls = [];
  let enabled = false, blocked = false;
  const app = { isPackaged: true,
    getLoginItemSettings: () => ({ openAtLogin: enabled, executableWillLaunchAtLogin: !blocked }),
    setLoginItemSettings(settings) { calls.push(settings); enabled = settings.openAtLogin; blocked = false; }
  };
  const prefs = create(root, { app, platform: 'win32', executable: 'C:\\Music Player\\pain.exe', env: {} });
  await prefs.update({ autostart: true });
  assert.equal(prefs.state().autostart, true);
  assert.equal(calls[0].path, 'C:\\Music Player\\pain.exe');
  assert.deepEqual(calls[0].args, ['--autostart']);
  blocked = true; assert.equal(prefs.state().autostart, false);
  await prefs.update({ autostart: true }); assert.equal(prefs.state().autostart, true);
  await prefs.update({ autostart: false }); assert.equal(prefs.state().autostart, false);
});
test('unavailable tray never reports success; enabling and disabling use native shell only', async t => {
  const root = fixture(t), prefs = create(root, { env: {}, platform: 'linux' });
  assert.equal(prefs.state().canTray, false);
  await assert.rejects(prefs.update({ tray: true }), /native/);
  prefs.attachShell(enabled => { if (enabled) throw new Error('No tray'); });
  await assert.rejects(prefs.update({ tray: true }), /No tray/);
  assert.equal(prefs.state().tray, false);
  const calls = [];
  prefs.attachShell(enabled => calls.push(enabled));
  await prefs.update({ tray: true }); await prefs.update({ tray: false });
  assert.deepEqual(calls, [false, true, false]);
});
