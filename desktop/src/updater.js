const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');

const REPOSITORY = 'vansGAMee/pain';
const API_URL = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const ALLOWED_HOSTS = new Set(['api.github.com', 'github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com', 'github-releases.githubusercontent.com']);

function versionParts(value) {
  const match = String(value || '').trim().match(/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+][0-9a-z.-]+)?$/i);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

function isNewer(candidate, current) {
  const a = versionParts(candidate), b = versionParts(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

function assetName(version, platform) {
  if (platform === 'win32') return `Pain-v${version}.exe`;
  if (platform === 'linux') return `Pain-v${version}-Linux.tar.gz`;
  return null;
}

function request(url, { maxBytes = 1024 * 1024, redirects = 5, streamTo = null } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch (_) { reject(new Error('Invalid update URL')); return; }
    if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) {
      reject(new Error('Untrusted update host')); return;
    }
    const req = https.get(parsed, {
      headers: { 'User-Agent': 'Pain-AutoUpdater', 'Accept': 'application/vnd.github+json' },
      timeout: 15000
    }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        res.resume();
        if (!res.headers.location || redirects <= 0) { reject(new Error('Too many update redirects')); return; }
        const next = new URL(res.headers.location, parsed).toString();
        request(next, { maxBytes, redirects: redirects - 1, streamTo }).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`Update server returned ${res.statusCode}`)); return; }
      const declared = Number(res.headers['content-length']);
      if (Number.isFinite(declared) && declared > maxBytes) { res.resume(); reject(new Error('Update file is too large')); return; }
      let size = 0;
      if (streamTo) {
        const output = fs.createWriteStream(streamTo, { flags: 'wx' });
        const hash = crypto.createHash('sha256');
        const fail = error => { output.destroy(); fs.rm(streamTo, { force: true }, () => {}); reject(error); };
        output.on('error', fail);
        res.on('data', chunk => {
          size += chunk.length;
          if (size > maxBytes) { req.destroy(); res.destroy(); fail(new Error('Update file is too large')); return; }
          hash.update(chunk);
        });
        res.on('error', fail);
        output.on('finish', () => resolve({ path: streamTo, size, sha256: hash.digest('hex') }));
        res.pipe(output);
      } else {
        const chunks = [];
        res.on('data', chunk => {
          size += chunk.length;
          if (size > maxBytes) { req.destroy(); res.destroy(); reject(new Error('Update response is too large')); return; }
          chunks.push(chunk);
        });
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      }
    });
    req.on('timeout', () => req.destroy(new Error('Update check timed out')));
    req.on('error', reject);
  });
}

function parseChecksum(text, filename) {
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.match(/^([a-f\d]{64})\s+\*?(.+)$/i);
    if (match && match[2].trim() === filename) return match[1].toLowerCase();
  }
  return null;
}

function quoteSh(value) { return `'${String(value).replace(/'/g, `'"'"'`)}'`; }
function quotePs(value) { return `'${String(value).replace(/'/g, "''")}'`; }
function writable(directory) {
  try { fs.accessSync(directory, fs.constants.W_OK); return true; } catch (_) { return false; }
}

class Updater {
  constructor(options = {}) {
    this.currentVersion = options.currentVersion;
    this.platform = options.platform || process.platform;
    this.appRoot = options.appRoot;
    this.dataDir = options.dataDir;
    this.executable = options.executable || process.execPath;
    this.packaged = options.packaged ?? !!process.pkg;
    this.fetch = options.fetch || request;
    this.exit = options.exit || (() => process.exit(0));
    this.spawn = options.spawn || spawn;
    this.tmpDir = options.tmpDir || os.tmpdir();
    this.release = null;
    this.state = { currentVersion: this.currentVersion, status: 'idle', available: false, canInstall: false };
    this.installing = null;
  }

  publicState() { return { ...this.state }; }

  async check(force = false) {
    if (['downloading', 'downloaded'].includes(this.state.status)) return this.publicState();
    if (this.checking) return this.checking;
    if (!force && this.state.checkedAt && Date.now() - this.state.checkedAt < 6 * 3600000) return this.publicState();
    this.checking = this._check().finally(() => { this.checking = null; });
    return this.checking;
  }

  async _check() {
    this.state = { ...this.state, status: 'checking', error: null };
    try {
      const body = await this.fetch(API_URL, { maxBytes: 1024 * 1024 });
      const release = JSON.parse(body.toString('utf8'));
      const version = String(release.tag_name || '').replace(/^v/i, '');
      if (!versionParts(version) || release.draft || release.prerelease) throw new Error('No valid stable release');
      const filename = assetName(version, this.platform);
      const asset = Array.isArray(release.assets) && release.assets.find(item => item.name === filename);
      const sums = Array.isArray(release.assets) && release.assets.find(item => item.name === `SHA256SUMS-v${version}.txt`);
      const available = isNewer(version, this.currentVersion);
      const gitCheckout = fs.existsSync(path.join(this.appRoot, '..', '.git')) || fs.existsSync(path.join(this.appRoot, '.git'));
      const destination = this.platform === 'win32' ? path.dirname(this.executable) : this.appRoot;
      const supported = this.platform === 'win32' ? this.packaged : this.platform === 'linux' && !gitCheckout;
      const canInstall = available && !!asset && !!sums && supported && writable(destination);
      this.release = { version, asset, sums, page: release.html_url };
      this.state = {
        currentVersion: this.currentVersion, latestVersion: version, status: 'ready', available,
        canInstall, page: release.html_url, checkedAt: Date.now(), error: null
      };
    } catch (error) {
      this.release = null;
      this.state = { ...this.state, available: false, canInstall: false, status: 'error', checkedAt: Date.now(), error: error.message || 'Update check failed' };
    }
    return this.publicState();
  }

  async prepareInstall() {
    if (this.prepared) return this.prepared;
    if (this.installing) return this.installing;
    this.installing = this._prepareInstall().finally(() => { this.installing = null; });
    return this.installing;
  }

  async _prepareInstall() {
    await this.check(true);
    if (this.state.status === 'error') throw new Error(this.state.error);
    if (!this.state.available) throw new Error('No update is available');
    if (!this.state.canInstall || !this.release?.asset || !this.release?.sums) throw new Error('Automatic installation is unavailable for this build');
    this.state = { ...this.state, status: 'downloading', error: null };
    const directory = fs.mkdtempSync(path.join(this.tmpDir, 'pain-update-'));
    const release = this.release, filename = release.asset.name;
    const target = path.join(directory, filename);
    try {
      const sums = await this.fetch(release.sums.browser_download_url, { maxBytes: 128 * 1024 });
      const expected = parseChecksum(sums.toString('utf8'), filename);
      if (!expected) throw new Error('Release checksum is missing');
      const downloaded = await this.fetch(release.asset.browser_download_url, { maxBytes: 150 * 1024 * 1024, streamTo: target });
      if (downloaded.sha256 !== expected) throw new Error('Update checksum does not match');
      const restart = this.platform === 'win32' ? this.windowsRestart(target, directory) : this.linuxRestart(target, directory);
      this.state = { ...this.state, status: 'downloaded' };
      this.prepared = { state: this.publicState(), restart };
      return this.prepared;
    } catch (error) {
      fs.rmSync(directory, { recursive: true, force: true });
      this.state = { ...this.state, status: 'error', error: error.message || 'Update failed' };
      throw error;
    }
  }

  launchInstaller(command, args) {
    let started = false;
    return () => {
      if (started) return;
      started = true;
      const fail = error => {
        this.prepared = null;
        this.state = { ...this.state, status: 'error', error: error.message || 'Could not start installer' };
      };
      try {
        const child = this.spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
        child.once('error', fail);
        child.once('spawn', () => { child.unref(); setTimeout(this.exit, 250); });
      } catch (error) { fail(error); }
    };
  }

  windowsRestart(downloaded, directory) {
    const script = path.join(directory, 'install.ps1');
    const source = quotePs(downloaded), exe = quotePs(this.executable);
    fs.writeFileSync(script, `\ufeff$ErrorActionPreference='Stop'\nfor($i=0;$i -lt 120 -and (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue);$i++){Start-Sleep -Milliseconds 250}\nif(Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue){exit 1}\nMove-Item -LiteralPath ${source} -Destination ${exe} -Force\nStart-Process -FilePath ${exe}\nRemove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force\n`, 'utf8');
    return this.launchInstaller('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', script]);
  }

  linuxRestart(archive, directory) {
    const script = path.join(directory, 'install.sh');
    const unpacked = path.join(directory, 'unpacked');
    fs.writeFileSync(script, `#!/usr/bin/env sh\nset -eu\ni=0\nwhile kill -0 ${process.pid} 2>/dev/null; do i=$((i+1)); [ "$i" -ge 30 ] && exit 1; sleep 1; done\nmkdir -p ${quoteSh(unpacked)}\ntar -xzf ${quoteSh(archive)} -C ${quoteSh(unpacked)}\ncp -a ${quoteSh(path.join(unpacked, 'Pain', 'src'))} ${quoteSh(this.appRoot + path.sep)}\ncp -a ${quoteSh(path.join(unpacked, 'Pain', 'assets'))} ${quoteSh(this.appRoot + path.sep)}\ncp -f ${quoteSh(path.join(unpacked, 'Pain', 'package.json'))} ${quoteSh(path.join(this.appRoot, 'package.json'))}\nnohup ${quoteSh(this.executable)} ${quoteSh(path.join(this.appRoot, 'src', 'server.js'))} >/dev/null 2>&1 &\n`, { mode: 0o700 });
    return this.launchInstaller(script, []);
  }
}

module.exports = { Updater, isNewer, assetName, parseChecksum, request };
