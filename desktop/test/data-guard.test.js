const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const dataGuard = require('../src/data-guard');

function createTempDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pain-dataguard-test-'));
  return dir;
}

test('DataGuard: safeWrite and isValidJsonFile', () => {
  const dir = createTempDataDir();
  try {
    const file = path.join(dir, 'test-file.json');
    const data = { hello: 'world', count: 42 };

    // File doesn't exist yet
    assert.equal(dataGuard.isValidJsonFile(file), false);

    // safeWrite creates and writes valid json
    dataGuard.safeWrite(file, data);
    assert.equal(dataGuard.isValidJsonFile(file), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), data);

    // Corrupt with 0 bytes
    fs.writeFileSync(file, '');
    assert.equal(dataGuard.isValidJsonFile(file), false);

    // Corrupt with broken json
    fs.writeFileSync(file, '{"invalid_json: 123');
    assert.equal(dataGuard.isValidJsonFile(file), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('DataGuard: createSnapshot and rotation limit', () => {
  const dir = createTempDataDir();
  try {
    // Populate some protected files
    dataGuard.safeWrite(path.join(dir, 'favorite-moments.json'), { 'media:1': 45.2 });
    dataGuard.safeWrite(path.join(dir, 'excluded-tracks.json'), ['media:99']);
    dataGuard.safeWrite(path.join(dir, 'stats.json'), { plays: [{ track: 'media:1', started: 12345 }] });

    // Create 12 snapshots in loop (simulating rotation)
    for (let i = 0; i < 12; i++) {
      // Offset timestamps slightly
      const res = dataGuard.createSnapshot(dir, `test-${i}`);
      assert.ok(res);
      assert.equal(res.copiedCount, 3);
    }

    const snapshots = dataGuard.listSnapshots(dir);
    // Should be clamped to MAX_SNAPSHOTS (10)
    assert.equal(snapshots.length, 10);
    assert.ok(snapshots[0].timestamp >= snapshots[1].timestamp, 'must be sorted newest first');

    const status = dataGuard.getBackupStatus(dir);
    assert.equal(status.snapshotCount, 10);
    assert.equal(status.latestSnapshot, snapshots[0].timestamp);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('DataGuard: verifyAndRepair self-heals corrupted and 0-byte files', () => {
  const dir = createTempDataDir();
  try {
    const favFile = path.join(dir, 'favorite-moments.json');
    const exclFile = path.join(dir, 'excluded-tracks.json');
    const statsFile = path.join(dir, 'stats.json');

    const goodFav = { 'media:29169': 159.1, 'media:28832': 191.1 };
    const goodExcl = ['media:20', 'media:22'];
    const goodStats = { plays: [{ track: 'media:29169', started: 1000 }] };

    dataGuard.safeWrite(favFile, goodFav);
    dataGuard.safeWrite(exclFile, goodExcl);
    dataGuard.safeWrite(statsFile, goodStats);

    // Create a healthy snapshot
    const snap = dataGuard.createSnapshot(dir, 'initial-healthy');
    assert.ok(snap);

    // Simulate power loss corruption:
    // 1. favorite-moments.json truncated to 0 bytes
    fs.writeFileSync(favFile, '');
    // 2. stats.json deleted completely
    fs.unlinkSync(statsFile);
    // 3. excluded-tracks.json corrupted with garbage
    fs.writeFileSync(exclFile, 'CORRUPTED_NOT_JSON!!!');

    assert.equal(dataGuard.isValidJsonFile(favFile), false);
    assert.equal(dataGuard.isValidJsonFile(statsFile), false);
    assert.equal(dataGuard.isValidJsonFile(exclFile), false);

    // Run verifyAndRepair
    const repairResult = dataGuard.verifyAndRepair(dir);
    assert.equal(repairResult.repaired.length, 3);

    // Verify all files were fully restored from snapshot
    assert.equal(dataGuard.isValidJsonFile(favFile), true);
    assert.equal(dataGuard.isValidJsonFile(statsFile), true);
    assert.equal(dataGuard.isValidJsonFile(exclFile), true);

    assert.deepEqual(JSON.parse(fs.readFileSync(favFile, 'utf8')), goodFav);
    assert.deepEqual(JSON.parse(fs.readFileSync(exclFile, 'utf8')), goodExcl);
    assert.deepEqual(JSON.parse(fs.readFileSync(statsFile, 'utf8')), goodStats);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('DataGuard: exportBundle and importBundle roundtrip', () => {
  const dir = createTempDataDir();
  const restoreDir = createTempDataDir();
  try {
    const fav = { 'media:123': 88.5 };
    const excl = ['media:55', 'media:66'];
    const pref = { tray: true, autostart: true };

    dataGuard.safeWrite(path.join(dir, 'favorite-moments.json'), fav);
    dataGuard.safeWrite(path.join(dir, 'excluded-tracks.json'), excl);
    dataGuard.safeWrite(path.join(dir, 'desktop-preferences.json'), pref);

    // Export bundle
    const bundle = dataGuard.exportBundle(dir);
    assert.equal(bundle.pain_backup_version, 1);
    assert.ok(bundle.exported_at > 0);
    assert.deepEqual(bundle.files['favorite-moments.json'], fav);
    assert.deepEqual(bundle.files['excluded-tracks.json'], excl);
    assert.deepEqual(bundle.files['desktop-preferences.json'], pref);

    // Pre-populate restoreDir with older data to verify pre-import snapshot
    dataGuard.safeWrite(path.join(restoreDir, 'favorite-moments.json'), { 'media:0': 10 });

    // Import into directory
    const importRes = dataGuard.importBundle(restoreDir, bundle);
    assert.equal(importRes.success, true);
    assert.ok(importRes.importedFiles.includes('favorite-moments.json'));
    assert.ok(importRes.importedFiles.includes('excluded-tracks.json'));
    assert.ok(importRes.importedFiles.includes('desktop-preferences.json'));

    // Check restored files on disk
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(restoreDir, 'favorite-moments.json'), 'utf8')), fav);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(restoreDir, 'excluded-tracks.json'), 'utf8')), excl);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(restoreDir, 'desktop-preferences.json'), 'utf8')), pref);

    // Pre and post import snapshots should have been created
    const snapshots = dataGuard.listSnapshots(restoreDir);
    assert.ok(snapshots.length >= 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(restoreDir, { recursive: true, force: true });
  }
});
