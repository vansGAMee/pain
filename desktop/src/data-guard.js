const fs = require('fs');
const path = require('path');

const PROTECTED_FILES = [
  'library.json',
  'stats.json',
  'favorite-moments.json',
  'excluded-tracks.json',
  'dj-state.json',
  'playlists.json',
  'desktop-preferences.json',
  'sync-pending.json',
  'pending-uploads.json'
];

const MAX_SNAPSHOTS = 10;

function safeWrite(filePath, data) {
  const content = typeof data === 'string' ? data : JSON.stringify(data);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, filePath);
  return true;
}

function isValidJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return false;
    const stat = fs.statSync(filePath);
    if (stat.size === 0) return false;
    const content = fs.readFileSync(filePath, 'utf8');
    JSON.parse(content);
    return true;
  } catch (_) {
    return false;
  }
}

function isNonEmptyFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return false;
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size > 0;
  } catch (_) {
    return false;
  }
}

function getBackupsDir(dataDir) {
  return path.join(dataDir, 'backups');
}

let snapshotSeq = 0;
const MIN_AUTO_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000; // At most once every 5 minutes for background events

function listSnapshots(dataDir) {
  const backupsDir = getBackupsDir(dataDir);
  if (!fs.existsSync(backupsDir)) return [];

  return fs.readdirSync(backupsDir)
    .filter(name => name.startsWith('snapshot-'))
    .map(name => {
      const fullPath = path.join(backupsDir, name);
      const raw = name.replace('snapshot-', '');
      const parts = raw.split('_');
      const timestamp = parseInt(parts[0], 10) || 0;
      const seq = parseInt(parts[1], 10) || 0;
      return { name, fullPath, timestamp, seq };
    })
    .sort((a, b) => (b.timestamp - a.timestamp) || (b.seq - a.seq)); // Newest first
}

function createSnapshot(dataDir, reason = 'auto', force = false) {
  if (!fs.existsSync(dataDir)) return null;

  const now = Date.now();
  const isBackground = ['startup', 'auto', 'periodic', 'phone-sync', 'moments-change', 'excluded-change'].includes(reason);
  const lastSnapshotTime = listSnapshots(dataDir)[0]?.timestamp || 0;
  if (!force && isBackground && (now - lastSnapshotTime < MIN_AUTO_SNAPSHOT_INTERVAL_MS)) {
    return null;
  }

  const backupsDir = getBackupsDir(dataDir);
  if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

  snapshotSeq = (snapshotSeq + 1) % 100000;
  const snapshotName = `snapshot-${now}_${snapshotSeq}`;
  const targetDir = path.join(backupsDir, snapshotName);

  let copiedCount = 0;
  for (const filename of PROTECTED_FILES) {
    const srcPath = path.join(dataDir, filename);
    if (isNonEmptyFile(srcPath)) {
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
      fs.copyFileSync(srcPath, path.join(targetDir, filename));
      copiedCount++;
    }
  }

  if (copiedCount === 0) {
    if (fs.existsSync(targetDir)) {
      try { fs.rmdirSync(targetDir); } catch (_) {}
    }
    return null;
  }

  // Meta record
  try {
    fs.writeFileSync(path.join(targetDir, 'meta.json'), JSON.stringify({
      timestamp: now,
      seq: snapshotSeq,
      reason,
      files: copiedCount
    }), 'utf8');
  } catch (_) {}

  // Rotate snapshots: keep up to MAX_SNAPSHOTS
  const allSnapshots = listSnapshots(dataDir);
  if (allSnapshots.length > MAX_SNAPSHOTS) {
    const toRemove = allSnapshots.slice(MAX_SNAPSHOTS);
    for (const snap of toRemove) {
      try {
        fs.rmSync(snap.fullPath, { recursive: true, force: true });
      } catch (_) {}
    }
  }

  return { name: snapshotName, copiedCount, timestamp: now, seq: snapshotSeq };
}

function verifyAndRepair(dataDir) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const snapshots = listSnapshots(dataDir);
  const repaired = [];
  const healthy = [];

  for (const filename of PROTECTED_FILES) {
    const targetFile = path.join(dataDir, filename);
    if (isValidJsonFile(targetFile)) {
      healthy.push(filename);
      continue;
    }

    // File is missing, 0 bytes, or corrupted JSON
    let recovered = false;
    for (const snap of snapshots) {
      const backupFile = path.join(snap.fullPath, filename);
      if (isValidJsonFile(backupFile)) {
        try {
          fs.copyFileSync(backupFile, targetFile);
          repaired.push({ filename, sourceSnapshot: snap.name });
          console.warn(`[DataGuard] Auto-repaired corrupted/missing ${filename} from ${snap.name}`);
          recovered = true;
          break;
        } catch (_) {}
      }
    }

    if (!recovered) {
      // If favorite-moments or excluded-tracks has no backup, ensure valid empty state
      if (filename === 'favorite-moments.json') {
        safeWrite(targetFile, {});
      } else if (filename === 'excluded-tracks.json') {
        safeWrite(targetFile, []);
      }
    }
  }

  // After repair, take a clean snapshot if we have healthy files
  if (healthy.length > 0) {
    createSnapshot(dataDir, 'startup');
  }

  return { healthy, repaired, snapshotsAvailable: snapshots.length };
}

function exportBundle(dataDir) {
  const bundle = {
    pain_backup_version: 1,
    exported_at: Date.now(),
    files: {}
  };

  for (const filename of PROTECTED_FILES) {
    const filePath = path.join(dataDir, filename);
    if (isValidJsonFile(filePath)) {
      try {
        bundle.files[filename] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (_) {}
    }
  }

  return bundle;
}

function importBundle(dataDir, bundle) {
  if (!bundle || typeof bundle !== 'object' || !bundle.files || typeof bundle.files !== 'object') {
    throw new Error('Invalid backup bundle structure');
  }

  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  // Safety snapshot before import
  createSnapshot(dataDir, 'pre-import');

  const importedFiles = [];
  for (const [filename, content] of Object.entries(bundle.files)) {
    if (PROTECTED_FILES.includes(filename)) {
      const targetFile = path.join(dataDir, filename);
      safeWrite(targetFile, content);
      importedFiles.push(filename);
    }
  }

  // Safety snapshot after import
  createSnapshot(dataDir, 'post-import');

  return { success: true, importedFiles };
}

function getBackupStatus(dataDir) {
  const snapshots = listSnapshots(dataDir);
  return {
    snapshotCount: snapshots.length,
    latestSnapshot: snapshots[0] ? snapshots[0].timestamp : null,
    protectedFiles: PROTECTED_FILES.length
  };
}

module.exports = {
  PROTECTED_FILES,
  safeWrite,
  isValidJsonFile,
  createSnapshot,
  verifyAndRepair,
  exportBundle,
  importBundle,
  getBackupStatus,
  listSnapshots
};
