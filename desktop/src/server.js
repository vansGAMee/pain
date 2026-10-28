const http = require('http');
const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');
const dgram = require('dgram');
const crypto = require('crypto');
const { exec, spawn } = require('child_process');
const { probeDuration } = require('./audio-decode');
const analyzeFile = require('./audio-analysis-task');
const activeAudioAnalyses = new Set();
const MAX_CONCURRENT_AUDIO_ANALYSES = 2;

const findOnlineCover = require('./online-covers');
const lyricsRoute = require('./lyrics-store');
const parseRange = require('./range');
const PhoneSync = require('./phone-sync');
const AudioProfile = require('./audio-profile');
const AudioAnalyzer = require('./audio-analyzer');
const { Updater } = require('./updater');
const { version: APP_VERSION } = require('../package.json');
const PORT = 3000;
const MOBILE_HTTP_PORT = 8865;
const UDP_PORT = 8866;

const BASE_DATA_DIR = process.env.PAIN_DATA_DIR || (process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..'));
const DATA_DIR = path.join(BASE_DATA_DIR, 'data');
const DOWNLOADS_DIR = path.join(BASE_DATA_DIR, 'downloads');
const CACHE_DIR = path.join(BASE_DATA_DIR, 'cache');
const COVERS_DIR = path.join(BASE_DATA_DIR, 'covers');
const PLAYLISTS_FILE = path.join(DATA_DIR, 'playlists.json');
const updaterOptions = {
  currentVersion: APP_VERSION,
  appRoot: path.join(__dirname, '..'),
  dataDir: DATA_DIR
};
const updater = globalThis.painShell?.updater || (process.versions.electron
  ? require('./native-updater')(updaterOptions)
  : new Updater(updaterOptions));
const dataGuard = require('./data-guard');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
try { dataGuard.verifyAndRepair(DATA_DIR); } catch (err) { console.error('[DataGuard] Error verifying data:', err); }
setInterval(() => { try { dataGuard.createSnapshot(DATA_DIR, 'periodic'); } catch (_) {} }, 30 * 60 * 1000).unref();

if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
if (!fs.existsSync(COVERS_DIR)) fs.mkdirSync(COVERS_DIR, { recursive: true });

const phoneSync = new PhoneSync(DATA_DIR);
const ensureAudio = require('./audio-download')({ cacheDir: CACHE_DIR,
  resolveAudio: id => getResolvedAudioFilePath(id, true), phoneBase: getMobilePhoneBaseUrl,
  getTrack:id=>getLibraryTracks().find(t=>String(t.id)===id),availabilityFile:path.join(DATA_DIR,'audio-availability.json') });
const pulseflow = require('./pulseflow-service')({dataDir: DATA_DIR, getTracks: getLibraryTracks,
  resolveAudio: id => getResolvedAudioFilePath(id, true), prepareAudio: ensureAudio, audioStatus:ensureAudio.getStatus});
const desktopPreferences = globalThis.painShell?.preferences || require('./desktop-preferences')(DATA_DIR);
const localMedia = require('./local-media')(DATA_DIR, id => getResolvedAudioFilePath(id, true), getLibraryTracks);
const onlineLyrics = require('./lyrics-online')(DATA_DIR, {localMedia, getTrack:id=>getLibraryTracks().find(t=>String(t.id)===id)});
const catalog = require('./music-catalog')(DATA_DIR);
const storeCatalog=require('./store-search');storeCatalog.configure(DATA_DIR);
const loadGenreStats=()=>fs.promises.readFile(path.join(DATA_DIR,'stats.json'),'utf8').then(JSON.parse);
const wikiGenres=require('./wiki-track-genres')(DATA_DIR);
const deezerGenres=require('./deezer-genres')(DATA_DIR);
const genres=require('./genre-service')(DATA_DIR,{localMedia,catalog,store:storeCatalog,wiki:wikiGenres,deezer:deezerGenres,getTracks:getLibraryTracks,loadStats:loadGenreStats});
findOnlineCover.configure({ localMedia, catalog, dataDir: DATA_DIR });
const trackInfo = require('./track-info-service')(DATA_DIR, { localMedia, catalog, genres, getTracks:getLibraryTracks });
const genreProfiles=new Map();
const saveStatsSnapshot = body => phoneSync.saveStats(JSON.parse(body));

const LAST_IP_FILE = path.join(DATA_DIR, 'last_phone_ip.txt');

let discoveredDevices = [];
let hasAutoSynced = false;
let autoSyncBusy = false;
let lastFullSync=0,lastSyncDevice='';
let udpSocket = null;
let resourceSaverActive = true;
let performanceMode = 'balanced', lastArpScan = 0, lastBroadcast = 0;
try { performanceMode = require('./performance-mode').normalize(JSON.parse(fs.readFileSync(path.join(DATA_DIR,'performance-mode.json'),'utf8')).mode); } catch (_) {}
resourceSaverActive = performanceMode !== 'full';
findOnlineCover.setMode(performanceMode);
pulseflow.setBackgroundAllowed(performanceMode !== 'maximum');
genres.setMode(performanceMode);
setTimeout(()=>genres.seed().catch(()=>{}),15000).unref();
let lastDjStatePostHash = '', lastDjStateResponseJson = null;

// ==========================================
// 1. MEGA-SMART DISCOVERY & AUTO-SYNC ENGINE
// ==========================================

function registerDevice(device) {
  if (!device || !device.ip) return;
  const existing = discoveredDevices.find(d => d.ip === device.ip);
  if (existing) {
    Object.assign(existing, device);
  } else {
    discoveredDevices.push(device);
    console.log(`[Discovery] Found Android device: ${device.name} at http://${device.ip}:${device.port} (${device.tracks} tracks)`);
  }
  try {
    fs.writeFileSync(LAST_IP_FILE, `${device.ip}:${device.port}`, 'utf8');
  } catch (e) {}

  // Auto-sync library immediately in background
  triggerBackgroundAutoSync(device);
}

function probeDevice(ip, port = MOBILE_HTTP_PORT, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const req = http.get(`http://${ip}:${port}/api/status`, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.status === 'ok') {
            const dev = {
              name: json.appName ? `${json.appName} (${json.device || 'Android'})` : 'Android Device',
              ip: ip,
              port: port,
              tracks: json.tracks || 0,
              lastSeen: Date.now()
            };
            registerDevice(dev);
            resolve(dev);
            return;
          }
        } catch (e) {}
        resolve(null);
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });

    req.on('error', () => {
      resolve(null);
    });
  });
}

const PENDING_UPLOADS_FILE = path.join(DATA_DIR, 'pending-uploads.json');

function readPendingUploads() {
  try {
    if (fs.existsSync(PENDING_UPLOADS_FILE)) {
      const data = JSON.parse(fs.readFileSync(PENDING_UPLOADS_FILE, 'utf8'));
      return Array.isArray(data) ? data : [];
    }
  } catch (_) {}
  return [];
}

function writePendingUploads(list) {
  try {
    const tmp = PENDING_UPLOADS_FILE + '.' + crypto.randomUUID() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(list || []), 'utf8');
    safeAtomicRename(tmp, PENDING_UPLOADS_FILE);
  } catch (_) {
    try { fs.writeFileSync(PENDING_UPLOADS_FILE, JSON.stringify(list || []), 'utf8'); } catch (_) {}
  }
}

async function pushTrackToPhone(phoneBase, filePath, metadata) {
  return new Promise((resolve, reject) => {
    try {
      const destUrl = new URL('/api/upload-track', phoneBase);
      if (metadata.filename) destUrl.searchParams.set('filename', metadata.filename);
      if (metadata.title) destUrl.searchParams.set('title', metadata.title);
      if (metadata.artist) destUrl.searchParams.set('artist', metadata.artist);
      if (metadata.album) destUrl.searchParams.set('album', metadata.album);
      if (metadata.trackId) destUrl.searchParams.set('trackId', metadata.trackId);

      const stat = fs.statSync(filePath);
      const req = http.request(destUrl, {
        method: 'POST',
        headers: {
          'Content-Type': metadata.mime || 'audio/mpeg',
          'Content-Length': stat.size,
          'X-Filename': encodeURIComponent(metadata.filename || path.basename(filePath)),
          'X-Title': encodeURIComponent(metadata.title || ''),
          'X-Artist': encodeURIComponent(metadata.artist || ''),
          'X-Album': encodeURIComponent(metadata.album || '')
        },
        timeout: 60000
      }, res => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            if (res.statusCode === 200) {
              resolve(JSON.parse(body));
            } else {
              reject(new Error(`Phone HTTP ${res.statusCode}: ${body}`));
            }
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy(new Error('Phone upload timed out'));
      });
      const fileStream = fs.createReadStream(filePath);
      fileStream.on('error', error => req.destroy(error));
      req.on('close', () => fileStream.destroy());
      fileStream.pipe(req);
    } catch (err) {
      reject(err);
    }
  });
}

let isUploadingPending = false;
async function processPendingTrackUploads(base) {
  if (isUploadingPending) return;
  isUploadingPending = true;
  try {
    const pending = readPendingUploads();
    if (!pending || pending.length === 0) return;
    const sent = new Set();
    for (const item of pending) {
      try {
        if (fs.existsSync(item.filePath)) {
          await pushTrackToPhone(base, item.filePath, item);
          sent.add(JSON.stringify(item));
          console.log(`[UploadQueue] Successfully pushed pending track ${item.filename} to phone at ${base}`);
        }
      } catch (err) {
        // Keep failed and missing files queued for recovery/retry.
      }
    }
    // New uploads may have arrived while the network request was in flight.
    writePendingUploads(readPendingUploads().filter(item => !sent.has(JSON.stringify(item))));
  } catch (_) {
  } finally {
    isUploadingPending = false;
  }
}

// Background auto-sync function with debounce
let autoSyncTimeout = null;
function triggerBackgroundAutoSync(device) {
  if (autoSyncBusy) return;
  if (autoSyncTimeout) clearTimeout(autoSyncTimeout);
  autoSyncTimeout = setTimeout(async () => {
    autoSyncTimeout = null;
    if (autoSyncBusy) return;
    autoSyncBusy = true;
    try {
      const base = `http://${device.ip}:${device.port}`;
      if (!hasAutoSynced || base !== lastSyncDevice || Date.now() - lastFullSync >= 300000) {
        await phoneSync.synchronize(base);
        hasAutoSynced = true;
        lastFullSync = Date.now();
        lastSyncDevice = base;
      } else {
        await phoneSync.flush(base);
      }
      await processPendingTrackUploads(base);
    } catch (_) { /* Keep pending changes; the next discovery retries. */ }
    finally { autoSyncBusy = false; }
  }, 1000);
}

// Fast ARP Table Scanner (executes in <10ms, discovers active LAN devices)
function scanArpTable() {
  if (typeof performanceMode !== 'undefined' && performanceMode === 'maximum') return;
  if (typeof resourceSaverActive !== 'undefined' && resourceSaverActive && typeof lastArpScan !== 'undefined' && Date.now() - lastArpScan < 60000) return;
  if (typeof lastArpScan !== 'undefined') lastArpScan = Date.now();
  try {
    const cmd = process.platform === 'win32' ? 'arp -a' : 'ip -4 neigh show 2>/dev/null || arp -an 2>/dev/null';
    exec(cmd, { timeout: 2000, windowsHide: true }, (err, stdout) => {
      if (err || !stdout) return;
      const ipMatches = stdout.match(/\b(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)\b/g);
      if (ipMatches) {
        const uniqueIps = Array.from(new Set(ipMatches));
        for (const ip of uniqueIps) {
          if (!ip.endsWith('.255') && !ip.endsWith('.1')) {
            probeDevice(ip, MOBILE_HTTP_PORT, 1200);
          }
        }
      }
    });
  } catch (e) {}
}

// Check last known IP first
function checkLastKnownIp() {
  try {
    if (fs.existsSync(LAST_IP_FILE)) {
      const content = fs.readFileSync(LAST_IP_FILE, 'utf8').trim();
      if (content) {
        const [ip, portStr] = content.split(':');
        const port = parseInt(portStr, 10) || MOBILE_HTTP_PORT;
        probeDevice(ip, port, 1000);
      }
    }
  } catch (e) {}
}

// Smart Batched Subnet Scanner
let isScanningSubnet = false;
let lastSubnetScan = 0;
async function scanSubnetsSmart() {
  if (isScanningSubnet || resourceSaverActive) return;
  // If we already have discovered devices active recently, or scanned recently, no need to flood subnets
  const now = Date.now();
  if (now - lastSubnetScan < 120000) return;
  const recentDevice = discoveredDevices.find(d => now - (d.lastSeen || 0) < 60000);
  if (recentDevice) return;
  isScanningSubnet = true;
  lastSubnetScan = now;

  try {
    const interfaces = os.networkInterfaces();
    const subnets = [];
    for (const name of Object.keys(interfaces)) {
      if (/^(amn|tun|tap|wg|docker|veth|br-|virbr|dummy|lo)/i.test(name)) continue;
      for (const iface of interfaces[name]) {
        if ((iface.family === 'IPv4' || iface.family === 4) && !iface.internal && iface.address) {
          if (iface.address.startsWith('169.254.') || iface.address.startsWith('127.')) continue;
          const parts = iface.address.split('.');
          if (parts.length === 4) {
            parts.pop();
            const subnet = parts.join('.');
            if (!subnets.includes(subnet)) subnets.push(subnet);
          }
        }
      }
    }

    for (const prefix of subnets) {
      // Chunk in small batches (4 at a time to never saturate libuv) with event loop yields
      for (let start = 1; start <= 254; start += 4) {
        if (resourceSaverActive) break;
        if (discoveredDevices.some(d => Date.now() - (d.lastSeen || 0) < 60000)) break;
        const end = Math.min(start + 3, 254);
        const batch = [];
        for (let i = start; i <= end; i++) {
          const ip = `${prefix}.${i}`;
          batch.push(probeDevice(ip, MOBILE_HTTP_PORT, 600));
        }
        await Promise.all(batch);
        await new Promise(r => setImmediate(r));
      }
    }
  } catch (e) {
  } finally {
    isScanningSubnet = false;
  }
}

// UDP Multi-Target Broadcast
function broadcastDiscovery() {
  if (!udpSocket || performanceMode === 'maximum' || Date.now()-lastBroadcast < (resourceSaverActive ? 15000 : 5000)) return;
  lastBroadcast = Date.now();
  const message = Buffer.from('PAIN_DISCOVERY');

  udpSocket.send(message, 0, message.length, UDP_PORT, '255.255.255.255', () => {});

  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      if (/^(amn|tun|tap|wg|docker|veth|br-|virbr|dummy|lo)/i.test(name)) continue;
      for (const iface of interfaces[name]) {
        if ((iface.family === 'IPv4' || iface.family === 4) && !iface.internal && iface.address) {
          const parts = iface.address.split('.');
          if (parts.length === 4) {
            parts[3] = '255';
            const bcast = parts.join('.');
            udpSocket.send(message, 0, message.length, UDP_PORT, bcast, () => {});
          }
        }
      }
    }
  } catch (e) {}
}

// Test/offline environments can explicitly disable LAN discovery.
function startDiscovery(){
if(process.env.PAIN_DISCOVERY !== 'false') {
// Setup UDP
try {
  udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  udpSocket.on('error', () => {});

  udpSocket.on('message', (msg, rinfo) => {
    const text = msg.toString('utf8').trim();
    if (text.startsWith('PAIN_DEVICE')) {
      const parts = text.split('|');
      const device = {
        name: parts[1] || 'Android Device',
        ip: rinfo.address,
        port: parseInt(parts[2], 10) || MOBILE_HTTP_PORT,
        tracks: parseInt(parts[3], 10) || 0,
        lastSeen: Date.now()
      };
      registerDevice(device);
    }
  });

  udpSocket.bind(UDP_PORT, () => {
    udpSocket.setBroadcast(true);
    broadcastDiscovery();
    setInterval(broadcastDiscovery, 5000);
  });
} catch (e) {
  try {
    udpSocket = dgram.createSocket('udp4');
    udpSocket.bind(0, () => {
      udpSocket.setBroadcast(true);
      broadcastDiscovery();
      setInterval(broadcastDiscovery, 5000);
    });
  } catch (err) {}
}

// Trigger initial scans
checkLastKnownIp();
scanArpTable();
setTimeout(scanArpTable, 1500);
setTimeout(scanSubnetsSmart, 2000);
setInterval(scanArpTable, 20000);
}
}


const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac'
};

function getMobilePhoneBaseUrl() {
  if (discoveredDevices.length > 0) {
    const dev = discoveredDevices[0];
    return `http://${dev.ip}:${dev.port}`;
  }
  try {
    if (fs.existsSync(LAST_IP_FILE)) {
      const c = fs.readFileSync(LAST_IP_FILE, 'utf8').trim();
      if (c) return `http://${c}`;
    }
  } catch (e) {}
  return 'http://192.168.1.2:8865';
}

let trackMimeCache = new Map();
let libraryFileMtime = 0;
let libraryTracksCache = [];

function getLibraryTracks() {
  try {
    const libFile = path.join(DATA_DIR, 'library.json');
    if (!fs.existsSync(libFile)) return [];
    const stat = fs.statSync(libFile);
    if (stat.mtimeMs !== libraryFileMtime) {
      libraryFileMtime = stat.mtimeMs;
      const parsed = JSON.parse(fs.readFileSync(libFile, 'utf8'));
      libraryTracksCache = Array.isArray(parsed.tracks) ? parsed.tracks : [];
      setImmediate(()=>genres.seed().catch(()=>{}));
    }
    return libraryTracksCache;
  } catch (e) {
    return libraryTracksCache;
  }
}

function getResolvedAudioFilePath(trackId, readOnly = false, allowAlias = true) {
  const safeId = trackId.replace(/[/\\?%*:|"<>]/g, '_');
  const cachedFile = path.join(CACHE_DIR, `${safeId}.mp3`);

  try {
    if (fs.existsSync(cachedFile)) {
      const sz = fs.statSync(cachedFile).size;
      if (sz >= 4096) {
        return cachedFile;
      }
      if (!readOnly) { try { fs.unlinkSync(cachedFile); } catch (_) {} }
    }
  } catch (_) {}

  try {
    const tracks = getLibraryTracks();
    const track = tracks.find(t => String(t.id) === String(trackId));
    if (track) {
      if (track.path) {
        const directDlPath = path.join(DOWNLOADS_DIR, track.path);
        if (fs.existsSync(directDlPath) && fs.statSync(directDlPath).size >= 4096) {
          try {
            if (!readOnly && !fs.existsSync(cachedFile)) {
              try { fs.linkSync(directDlPath, cachedFile); } catch (_) { fs.copyFileSync(directDlPath, cachedFile); }
            }
          } catch (_) {}
          return directDlPath;
        }
      }
      const ext = track.path ? track.path.split('.').pop() : 'mp3';
      const rawName = `${track.artist} - ${track.title}.${ext}`;
      const safeFilename = rawName.replace(/[/\\?%*:|"<>]/g, '_').trim();
      const dlPath = path.join(DOWNLOADS_DIR, safeFilename);
      if (fs.existsSync(dlPath) && fs.statSync(dlPath).size >= 4096) {
        try {
          if (!readOnly && !fs.existsSync(cachedFile)) {
            try {
              fs.linkSync(dlPath, cachedFile);
            } catch (_) {
              fs.copyFileSync(dlPath, cachedFile);
            }
          }
        } catch (_) {}
        return dlPath;
      }
      // MediaStore IDs can change after rescanning or duplicate imports. Reuse
      // an existing exact recording without changing IDs, likes or history.
      if (allowAlias) {
        const other = require('./audio-download').replacement(track, tracks);
        if (other) {
          const file = getResolvedAudioFilePath(String(other.id), true, false);
          if (file && fs.statSync(file).size === Number(track.bytes)) return file;
        }
      }
    }
  } catch (_) {}

  return null;
}


function getTrackMimeType(trackId) {
  if (trackMimeCache.has(trackId)) {
    return trackMimeCache.get(trackId);
  }
  try {
    const tracks = getLibraryTracks();
    for (const t of tracks) {
      if (t.id && t.mime) {
        trackMimeCache.set(t.id, t.mime);
      }
    }
    if (trackMimeCache.has(trackId)) {
      return trackMimeCache.get(trackId);
    }
  } catch (e) {}
  return 'audio/mpeg';
}

function safeAtomicRename(src, dst) {
  try {
    if (fs.existsSync(dst)) {
      try { fs.unlinkSync(dst); } catch (_) {}
    }
    fs.renameSync(src, dst);
  } catch (err) {
    try {
      fs.copyFileSync(src, dst);
      try { fs.unlinkSync(src); } catch (_) {}
    } catch (_) {}
  }
}

function streamFileWithRange(filePath, req, res, mime = 'audio/mpeg') {
  try {
    const stat = fs.statSync(filePath);
    const total = stat.size;
    const range = req.headers.range;

    if (range) {
      const parsedRange=parseRange(range,total);
      if(!parsedRange){res.writeHead(416,{'Content-Range':`bytes */${total}`,'Accept-Ranges':'bytes'});res.end();return;}
      const {start,end}=parsedRange;

      const chunksize = (end - start) + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': mime,
        'Access-Control-Allow-Origin': '*'
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      const stream = fs.createReadStream(filePath, { start, end });
      stream.on('error', () => {
        try { res.end(); } catch (e) {}
      });
      res.on('close', () => {
        try { stream.destroy(); } catch (_) {}
      });
      stream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': total,
        'Accept-Ranges': 'bytes',
        'Content-Type': mime,
        'Access-Control-Allow-Origin': '*'
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      const stream = fs.createReadStream(filePath);
      stream.on('error', () => {
        try { res.end(); } catch (e) {}
      });
      res.on('close', () => {
        try { stream.destroy(); } catch (_) {}
      });
      stream.pipe(res);
    }
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('File stream error: ' + err.message);
  }
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Filename, X-Pain-Update, Range');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (pathname.startsWith('/api/pulseflow/')) { pulseflow.route(req, res, pathname); return; }
  if(pathname==='/api/genres'||pathname.startsWith('/api/genres/track/')||pathname==='/api/taste-profile'){
    const send=data=>{if(!res.destroyed){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));}};
    (async()=>{
      await genres.ready;
      if(pathname==='/api/genres'){
        if(req.method==='POST')return send(await genres.setEnabled(url.searchParams.get('enabled')==='1'));
        return send(genres.status());
      }
      if(req.method!=='GET'){res.writeHead(405);res.end();return;}
      if(pathname.startsWith('/api/genres/track/')){
        const id=decodeURIComponent(pathname.slice('/api/genres/track/'.length)),track=getLibraryTracks().find(t=>String(t.id)===id);
        if(!track){res.writeHead(404);res.end();return;}
        await genres.enqueue(track,true);return send({id,...(genres.entry(track)||{names:require('./genre-profile-model').normalize(track.genre),scope:'file'})});
      }
      const range=url.searchParams.get('range')==='28'?'28':'all';
      const stamps=await Promise.all(['stats.json','library.json'].map(name=>fs.promises.stat(path.join(DATA_DIR,name)).then(s=>s.mtimeMs).catch(()=>0)));
      const key=JSON.stringify([stamps,genres.status().revision,new Date().toDateString()]);
      let saved=genreProfiles.get(range);
      if(saved?.key!==key){
        const [stats,entries]=await Promise.all([loadGenreStats().catch(()=>({})),genres.snapshot()]);
        const tracks=getLibraryTracks(),details=require('./listening-insights').build(tracks,stats);
        saved={key,data:require('./genre-profile-model').build(tracks,details,entries,range)};genreProfiles.set(range,saved);
      }
      send({...saved.data,status:genres.status()});
    })().catch(()=>{if(!res.destroyed){res.writeHead(503);res.end('{}');}});return;
  }
  if (pathname.startsWith('/api/track-info/') && req.method === 'GET') {
    let id;try{id=decodeURIComponent(pathname.slice('/api/track-info/'.length));}catch(_){res.writeHead(400);res.end();return;}
    const track=getLibraryTracks().find(t=>String(t.id)===id);
    if(!track){res.writeHead(404);res.end();return;}
    const abort = new AbortController();
    res.on('close', () => abort.abort());
    const result=url.searchParams.get('local')==='1'?trackInfo.local(track,url.searchParams.get('lang')==='en'?'en':'ru'):trackInfo(track,url.searchParams.get('lang')==='en'?'en':'ru',{signal:abort.signal});
    result.then(data=>{
      if(!res.destroyed){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));}
    }).catch(()=>{if(!res.destroyed){res.writeHead(503);res.end('{}');}});return;
  }

  if (pathname === '/api/desktop-preferences') {
    let local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
    try { if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) local = false; } catch (_) { local = false; }
    if (!local || (req.method === 'POST' && req.headers['x-pain-update'] !== 'preferences')) { res.writeHead(403); res.end(); return; }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET') { res.end(JSON.stringify(desktopPreferences.state())); return; }
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 2048) req.destroy(); });
    req.on('end', async () => {
      try { res.end(JSON.stringify(await desktopPreferences.update(JSON.parse(body)))); }
      catch (error) { res.writeHead(400); res.end(JSON.stringify({ error: error.message })); }
    });
    return;
  }

  if (lyricsRoute(req,res,url,DATA_DIR,onlineLyrics)) return;

  if (pathname === '/api/resource-saver') {
    if (req.method === 'POST') {
      let body = ''; req.setEncoding('utf8');
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const json = JSON.parse(body);
          performanceMode = ['full','balanced','maximum'].includes(json.mode) ? json.mode : (json.resourceSaver ? 'balanced' : 'full');
          resourceSaverActive = performanceMode !== 'full';
          findOnlineCover.setMode(performanceMode);
          pulseflow.setBackgroundAllowed(performanceMode !== 'maximum');
          genres.setMode(performanceMode);
          fs.promises.writeFile(path.join(DATA_DIR,'performance-mode.json'), JSON.stringify({mode:performanceMode})).catch(()=>{});
        } catch (_) {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, resourceSaver: resourceSaverActive, mode: performanceMode }));
      });
      return;
    }
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ resourceSaver: resourceSaverActive, mode: performanceMode }));
      return;
    }
  }

  if (pathname === '/api/dj-state') {
    if (req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(phoneSync.read('dj-state.json', {})));
      return;
    }
    if (req.method === 'POST') {
      let body = '', size = 0; req.setEncoding('utf8');
      req.on('data', chunk => { size += Buffer.byteLength(chunk); if (size > 8 * 1024 * 1024) req.destroy(); else body += chunk; });
      req.on('end', () => {
        try {
          const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
          if (lastDjStatePostHash === bodyHash && lastDjStateResponseJson) {
            res.setHeader('Content-Type', 'application/json');
            res.end(lastDjStateResponseJson);
            return;
          }
          const state = phoneSync.saveDjState(JSON.parse(body));
          lastDjStatePostHash = bodyHash;
          lastDjStateResponseJson = JSON.stringify(state);
          res.setHeader('Content-Type', 'application/json');
          res.end(lastDjStateResponseJson);
        } catch (_) {
          res.writeHead(400);
          res.end('{}');
        }
      });
      return;
    }
  }

  if (pathname.startsWith('/api/analyze-track/')) {
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
    let trackId;
    try { trackId = decodeURIComponent(pathname.substring('/api/analyze-track/'.length)); }
    catch (_) { res.writeHead(400); res.end(); return; }
    const reply = (status, value) => { if (!res.destroyed) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); } };
    if (!trackId) { reply(400, { error: 'Missing trackId' }); return; }
    let body = '', bodyBytes = 0;
    req.setEncoding('utf8');
    req.on('data', chunk => { bodyBytes += Buffer.byteLength(chunk); if (bodyBytes <= 65536) body += chunk; });
    req.on('end', async () => {
      if (bodyBytes > 65536) { reply(413, { error: 'Analysis request is too large' }); return; }
      let requestedTrack;
      try { const parsed = body.trim() ? JSON.parse(body) : {}; requestedTrack = parsed.track || (parsed.id ? parsed : null); }
      catch (_) { reply(400, { error: 'Invalid JSON' }); return; }
      if (requestedTrack && String(requestedTrack.id) !== trackId) { reply(400, { error: 'Track ID mismatch' }); return; }
      // Metadata is authoritative only when it comes from the saved library.
      // The request may not label an arbitrary cached file as another song.
      const track = getLibraryTracks().find(t => String(t.id) === trackId);
      if (!track) { reply(404, { error: 'Track not found in the saved library' }); return; }

      const isForce = url.searchParams.get('force') === '1';
      const existing = phoneSync.read('dj-state.json', {}).profiles?.[trackId];

      let file = getResolvedAudioFilePath(trackId, true);
      if (!file) {
        if (existing && AudioAnalyzer.complete(existing, track)) {
          reply(200, { success: true, profile: existing, bpm: null, cached: true }); return;
        }
        try { file = await ensureAudio(trackId); }
        catch (error) { reply(error.code?.startsWith('AUDIO_')?404:502, { code: error.code?.startsWith('AUDIO_')?error.code:'PHONE_UNAVAILABLE', error: error.message }); return; }
      }
      if (res.destroyed) return;
      let stat;
      try { stat = fs.statSync(file); } catch (_) {
        if (existing && AudioAnalyzer.complete(existing, track)) {
          reply(200, { success: true, profile: existing, bpm: null, cached: true }); return;
        }
        reply(404, { error: 'Audio file unavailable; download it before analysis' }); return;
      }
      if (!isForce && existing && AudioAnalyzer.complete(existing, track)) {
        if (!existing.analysis?.source || (existing.analysis.source?.bytes === stat.size && existing.analysis.source?.modified === stat.mtimeMs)) {
          reply(200, { success: true, profile: existing, bpm: null, cached: true }); return;
        }
      }
      if (activeAudioAnalyses.has(trackId) || activeAudioAnalyses.size >= MAX_CONCURRENT_AUDIO_ANALYSES) {
        reply(429, { error: 'Audio analysis is busy; retry after the current track' }); return;
      }
      const abort = new AbortController(), cancel = () => abort.abort();
      res.on('close', cancel);
      activeAudioAnalyses.add(trackId);
      try {
        const result = await analyzeFile(file, track, { signal: abort.signal });
        if (abort.signal.aborted) return;
        if (!result || !AudioAnalyzer.complete(result.profile, track)) {
          reply(422, { error: 'Insufficient measurable audio for a complete profile' }); return;
        }
        const after = fs.statSync(file);
        if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) { reply(409, { error: 'Audio file changed during analysis' }); return; }
        result.profile.analysis.source = { bytes: stat.size, modified: stat.mtimeMs };
        phoneSync.saveDjState({ profiles: { [trackId]: result.profile } });
        reply(200, { success: true, profile: result.profile, bpm: result.bpm });
      } catch (error) {
        if (!abort.signal.aborted) reply(500, { error: error.message });
      } finally {
        res.removeListener('close', cancel);
        activeAudioAnalyses.delete(trackId);
      }
    });
    return;
  }

  if (pathname === '/api/favorite-moments') {
    const file = path.join(DATA_DIR, 'favorite-moments.json');
    if (req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json');
      res.end(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '{}');
      return;
    }
    if (req.method === 'POST') {
      let body = '', size = 0; req.setEncoding('utf8');
      req.on('data', chunk => { size += Buffer.byteLength(chunk); if (size > 2 * 1024 * 1024) req.destroy(); else body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            dataGuard.safeWrite(file, parsed);
            dataGuard.createSnapshot(DATA_DIR, 'moments-change');
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(parsed));
            return;
          }
          res.writeHead(400); res.end('{}');
        } catch (_) { res.writeHead(400); res.end('{}'); }
      });
      return;
    }
  }

  if (pathname === '/api/excluded-tracks') {
    const file = path.join(DATA_DIR, 'excluded-tracks.json');
    if (req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json');
      res.end(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '[]');
      return;
    }
    if (req.method === 'POST') {
      let body = '', size = 0; req.setEncoding('utf8');
      req.on('data', chunk => { size += Buffer.byteLength(chunk); if (size > 2 * 1024 * 1024) req.destroy(); else body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (Array.isArray(parsed)) {
            const unique = Array.from(new Set(parsed.map(String)));
            dataGuard.safeWrite(file, unique);
            dataGuard.createSnapshot(DATA_DIR, 'excluded-change');
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(unique));
            return;
          }
          res.writeHead(400); res.end('[]');
        } catch (_) { res.writeHead(400); res.end('[]'); }
      });
      return;
    }
  }

  // Backup & Disaster Recovery Endpoints
  if (pathname === '/api/backup/status' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(dataGuard.getBackupStatus(DATA_DIR)));
    return;
  }

  if (pathname === '/api/backup/export' && req.method === 'GET') {
    const bundle = dataGuard.exportBundle(DATA_DIR);
    const dateStr = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="pain-backup-${dateStr}.json"`);
    res.end(JSON.stringify(bundle, null, 2));
    return;
  }

  if (pathname === '/api/backup/import' && req.method === 'POST') {
    let body = '', size = 0; req.setEncoding('utf8');
    req.on('data', chunk => { size += Buffer.byteLength(chunk); if (size > 100 * 1024 * 1024) req.destroy(); else body += chunk; });
    req.on('end', () => {
      try {
        const bundle = JSON.parse(body);
        const result = dataGuard.importBundle(DATA_DIR, bundle);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message || 'Import failed' }));
      }
    });
    return;
  }

  if (pathname === '/profile') {
    res.writeHead(302, { 'Location': '/?view=insights#profile' });
    res.end();
    return;
  }

  // API endpoints
  if (pathname === '/api/update-status' && req.method === 'GET') {
    updater.check(url.searchParams.get('refresh') === '1').then(status => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(status));
    });
    return;
  }

  if (pathname === '/api/install-update' && req.method === 'POST') {
    let localOrigin = true;
    try {
      if (req.headers.origin) localOrigin = ['localhost', '127.0.0.1', '::1'].includes(new URL(req.headers.origin).hostname);
    } catch (_) { localOrigin = false; }
    if (!localOrigin || req.headers['x-pain-update'] !== 'install') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Local confirmation required' }));
      return;
    }
    updater.prepareInstall().then(({ state, restart }) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(state), () => setTimeout(restart, 300));
    }).catch(error => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message || 'Update failed' }));
    });
    return;
  }

  if (pathname === '/api/devices') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(discoveredDevices));
    return;
  }

  if (pathname === '/api/saved-library') {
    const libFile = path.join(DATA_DIR, 'library.json');
    if (fs.existsSync(libFile)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      fs.createReadStream(libFile).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ tracks: [] }));
    }
    return;
  }

  if (pathname === '/api/saved-stats') {
    const statsFile = path.join(DATA_DIR, 'stats.json');
    if (fs.existsSync(statsFile)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      fs.createReadStream(statsFile).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ plays: [], slices: [] }));
    }
    return;
  }

  if (pathname === '/api/save-library' && req.method === 'POST') {
    req.setEncoding('utf8');
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        phoneSync.saveLibrary(JSON.parse(body));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (pathname === '/api/save-stats' && req.method === 'POST') {
    req.setEncoding('utf8');
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        saveStatsSnapshot(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (pathname === '/api/upload-status' && req.method === 'GET') {
    const pending = readPendingUploads();
    const phone = discoveredDevices.length > 0 ? discoveredDevices[0] : null;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      phoneConnected: !!phone,
      phoneIp: phone ? `${phone.ip}:${phone.port}` : null,
      phoneName: phone ? phone.name : null,
      pendingCount: pending.length,
      pending
    }));
    return;
  }

  if (pathname === '/api/upload-to-phone' && req.method === 'POST') {
    let rawFilename, rawTitle, rawArtist, rawAlbum;
    try {
      const field = (name, fallback = '') => url.searchParams.get(name) || (req.headers['x-' + name] ? decodeURIComponent(req.headers['x-' + name]) : fallback);
      rawFilename = field('filename', `track-${Date.now()}.mp3`);
      rawTitle = field('title'); rawArtist = field('artist'); rawAlbum = field('album', 'PC Uploads');
    } catch (_) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid upload metadata' }));
      req.resume(); return;
    }

    const safeFilename = rawFilename.replace(/[/\\?%*:|"<>]/g, '_').trim();
    if (!safeFilename || safeFilename === '.' || safeFilename === '..') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid filename' }));
      req.resume(); return;
    }
    const dest = path.join(DOWNLOADS_DIR, safeFilename);
    const tmpDest = `${dest}.${crypto.randomUUID()}.tmp`;

    const fileStream = fs.createWriteStream(tmpDest);
    req.pipe(fileStream);

    fileStream.on('finish', async () => {
      try {
        const sz = fs.existsSync(tmpDest) ? fs.statSync(tmpDest).size : 0;
        if (sz < 4096) {
          try { fs.unlinkSync(tmpDest); } catch (_) {}
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'File too small or corrupted' }));
          return;
        }

        await fs.promises.rename(tmpDest, dest);

        const ext = path.extname(safeFilename).replace(/^\./, '').toLowerCase() || 'mp3';
        let mime = 'audio/mpeg';
        if (ext === 'flac') mime = 'audio/flac';
        else if (ext === 'wav') mime = 'audio/wav';
        else if (ext === 'm4a') mime = 'audio/mp4';
        else if (ext === 'ogg') mime = 'audio/ogg';

        let title = rawTitle;
        let artist = rawArtist;
        if (!title) {
          const baseNoExt = path.basename(safeFilename, path.extname(safeFilename));
          if (baseNoExt.includes(' - ')) {
            const parts = baseNoExt.split(' - ');
            artist = artist || parts[0].trim();
            title = parts.slice(1).join(' - ').trim();
          } else {
            title = baseNoExt;
          }
        }
        if (!artist) artist = 'Загружено с ПК';

        const trackId = 'pc_upload_' + crypto.createHash('sha256').update(safeFilename).digest('hex').substring(0, 16);

        // Also cache locally for immediate offline playback on desktop
        const cachedPath = path.join(CACHE_DIR, `${trackId}.mp3`);
        const cacheTmp = `${cachedPath}.${crypto.randomUUID()}.tmp`;
        try {
          try { await fs.promises.link(dest, cacheTmp); } catch (_) { await fs.promises.copyFile(dest, cacheTmp); }
          await fs.promises.rename(cacheTmp, cachedPath);
        } finally { await fs.promises.unlink(cacheTmp).catch(() => {}); }
        let duration = 0;
        try { duration = Math.round(await probeDuration(dest) * 1000); } catch (_) { /* Unknown until playback reads it. */ }

        const track = {
          id: trackId,
          uri: `file://${dest}`,
          path: safeFilename,
          title,
          artist,
          album: rawAlbum || 'PC Library',
          folder: 'downloads',
          mime,
          duration,
          bytes: sz,
          added: Math.floor(Date.now() / 1000),
          album_id: 0,
          number: 0,
          favorite: 0
        };

        // Add to desktop library
        try {
          const curLib = phoneSync.read('library.json', { tracks: [] });
          const curTracks = Array.isArray(curLib.tracks) ? curLib.tracks : [];
          const idx = curTracks.findIndex(t => String(t.id) === trackId);
          if (idx >= 0) {
            track.favorite = curTracks[idx].favorite;
            curTracks[idx] = { ...curTracks[idx], ...track };
          }
          else curTracks.push(track);
          phoneSync.saveLibrary({ ...curLib, tracks: curTracks });
        } catch (e) {
          console.error('[UploadToPhone] Error saving library:', e);
          throw e;
        }

        // Try pushing directly to phone if online
        let pushed = false;
        let phoneResult = null;
        const phoneBase = discoveredDevices.length > 0 ? `http://${discoveredDevices[0].ip}:${discoveredDevices[0].port}` : null;
        if (phoneBase) {
          try {
            phoneResult = await pushTrackToPhone(phoneBase, dest, {
              trackId,
              filename: safeFilename,
              title,
              artist,
              album: rawAlbum,
              mime
            });
            pushed = true;
          } catch (phoneErr) {
            console.log(`[UploadToPhone] Direct push failed (${phoneErr.message}), queueing for later`);
          }
        }

        if (!pushed) {
          const pending = readPendingUploads().filter(item => item.trackId !== trackId);
          pending.push({
            id: crypto.randomUUID(),
            filePath: dest,
            filename: safeFilename,
            title,
            artist,
            album: rawAlbum,
            mime,
            trackId,
            queuedAt: Date.now()
          });
          writePendingUploads(pending);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          phoneOnline: pushed,
          track,
          phoneResult,
          message: pushed
            ? 'Трек успешно отправлен на телефон и добавлен в медиатеку!'
            : 'Трек сохранён на ПК и будет автоматически передан на телефон при подключении к сети.'
        }));
      } catch (err) {
        try { if (fs.existsSync(tmpDest)) fs.unlinkSync(tmpDest); } catch (_) {}
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });

    fileStream.on('error', (err) => {
      try { if (fs.existsSync(tmpDest)) fs.unlinkSync(tmpDest); } catch (_) {}
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  if (pathname === '/api/save-audio' && req.method === 'POST') {
    const rawTrackId = req.headers['x-track-id'] ? decodeURIComponent(req.headers['x-track-id']) : null;
    const rawName = req.headers['x-filename'] ? decodeURIComponent(req.headers['x-filename']) : `track-${Date.now()}.mp3`;
    const safeFilename = rawName.replace(/[/\\?%*:|"<>]/g, '_').trim();
    
    let dest;
    if (rawTrackId) {
      const safeId = rawTrackId.replace(/[/\\?%*:|"<>]/g, '_');
      dest = path.join(CACHE_DIR, `${safeId}.mp3`);
    } else {
      const tracks = getLibraryTracks();
      const matched = tracks.find(t => {
        const ext = t.path ? t.path.split('.').pop() : 'mp3';
        const name = `${t.artist} - ${t.title}.${ext}`.replace(/[/\\?%*:|"<>]/g, '_').trim();
        return name === safeFilename;
      });
      if (matched) {
        const safeId = matched.id.replace(/[/\\?%*:|"<>]/g, '_');
        dest = path.join(CACHE_DIR, `${safeId}.mp3`);
      } else {
        dest = path.join(DOWNLOADS_DIR, safeFilename);
      }
    }
    const tmpDest = `${dest}.${require('crypto').randomUUID()}.tmp`;
    const fileStream = fs.createWriteStream(tmpDest);
    req.pipe(fileStream);
    fileStream.on('finish', () => {
      try {
        const sz = fs.existsSync(tmpDest) ? fs.statSync(tmpDest).size : 0;
        if (sz >= 4096) {
          safeAtomicRename(tmpDest, dest);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', filename: path.basename(dest), size: sz }));
          return;
        }
        try { fs.unlinkSync(tmpDest); } catch (_) {}
      } catch (e) {
        try { fs.unlinkSync(tmpDest); } catch (_) {}
      }
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File too small or corrupted' }));
    });
    fileStream.on('error', (err) => {
      try { fs.unlinkSync(tmpDest); } catch (_) {}
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  // Sleep-proof local cached track playback (streams from disk or fetches & caches from mobile)
  if (pathname.startsWith('/api/cached-track/')) {
    const trackId = decodeURIComponent(pathname.substring('/api/cached-track/'.length));
    const safeId = trackId.replace(/[/\\?%*:|"<>]/g, '_');
    const cachedFile = path.join(CACHE_DIR, `${safeId}.mp3`);
    const mime = getTrackMimeType(trackId);

    // If cached on disk in CACHE_DIR or DOWNLOADS_DIR (>64KB), stream with HTTP 206 Range support
    const localAudioPath = getResolvedAudioFilePath(trackId);
    if (localAudioPath) {
      streamFileWithRange(localAudioPath, req, res, mime);
      return;
    }

    const phoneUrl = (url.searchParams.get('phoneUrl') || getMobilePhoneBaseUrl()).replace(/\/+$/, '');
    let source;
    try{source=new URL(`${phoneUrl}/api/track/${encodeURIComponent(trackId)}`);if(source.protocol!=='http:')throw new Error('HTTP required');}
    catch(e){res.writeHead(400);res.end('Invalid phone URL');return;}
    const upstream=http.get(source,{headers:req.headers.range?{Range:req.headers.range}:{}},phoneRes=>{
      const headers={'Content-Type':phoneRes.headers['content-type']||mime,'Accept-Ranges':'bytes','Access-Control-Allow-Origin':'*'};
      for(const key of ['content-length','content-range'])if(phoneRes.headers[key])headers[key]=phoneRes.headers[key];
      res.writeHead(phoneRes.statusCode,headers);
      if(req.method==='HEAD'){res.end();phoneRes.resume();return;}
      phoneRes.pipe(res);
      // Cache only an entire representation, never a partial seek response.
      const cr=/^bytes 0-(\d+)\/(\d+)$/.exec(phoneRes.headers['content-range']||'');
      const whole=phoneRes.statusCode===200||(phoneRes.statusCode===206&&cr&&Number(cr[1])+1===Number(cr[2]));
      if(!whole){phoneRes.on('error',()=>res.destroy());return;}
      const temp=cachedFile+'.'+require('crypto').randomUUID()+'.tmp';
      const output=fs.createWriteStream(temp);
      const discard=()=>{try{fs.unlinkSync(temp);}catch(_){}};
      output.on('error',discard);
      phoneRes.on('aborted',()=>{output.destroy();discard();});
      phoneRes.on('error',()=>{output.destroy();discard();res.destroy();});
      output.on('finish',()=>{
        try{
          const size=fs.statSync(temp).size;
          const expected=Number(phoneRes.headers['content-length'])||0;
          if(phoneRes.complete&&size>=4096&&(!expected||expected===size))safeAtomicRename(temp,cachedFile);else discard();
        }catch(_){discard();}
      });
      phoneRes.pipe(output);
    });
    upstream.setTimeout(30000,()=>upstream.destroy(new Error('Phone timed out')));
    upstream.on('error',err=>{if(!res.headersSent){res.writeHead(502);res.end('Phone unavailable');}else res.destroy();});
    return;
  }

  // Pre-fetch track in background for sleep-resistant seamless queue
  if (pathname.startsWith('/api/preload-track/') && req.method === 'POST') {
    const trackId = decodeURIComponent(pathname.substring('/api/preload-track/'.length));
    const safeId = trackId.replace(/[/\\?%*:|"<>]/g, '_');
    const cachedFile = path.join(CACHE_DIR, `${safeId}.mp3`);
    const tmpFile = path.join(CACHE_DIR, `${safeId}.${require("crypto").randomUUID()}.tmp`);
    const localAudioPath = getResolvedAudioFilePath(trackId);
    if (localAudioPath) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'already_cached' }));
      return;
    }
    const phoneUrl = url.searchParams.get('phoneUrl') || getMobilePhoneBaseUrl();
    http.get(`${phoneUrl}/api/track/${encodeURIComponent(trackId)}`, (phoneRes) => {
      if (phoneRes.statusCode === 200) {
        const fileStream = fs.createWriteStream(tmpFile);
        fileStream.on('error',()=>{try{fs.unlinkSync(tmpFile);}catch(_){}if(!res.headersSent){res.writeHead(500);res.end();}});
        phoneRes.on('aborted',()=>{fileStream.destroy();try{fs.unlinkSync(tmpFile);}catch(_){}if(!res.headersSent){res.writeHead(502);res.end();}});
        phoneRes.on('error',()=>fileStream.destroy());
        phoneRes.pipe(fileStream);
        fileStream.on('finish', () => {
          try {
            if (phoneRes.complete && fs.existsSync(tmpFile) && fs.statSync(tmpFile).size >= 4096 && (!phoneRes.headers['content-length'] || fs.statSync(tmpFile).size === Number(phoneRes.headers['content-length']))) {
              safeAtomicRename(tmpFile, cachedFile);
            }
          } catch (e) {}
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'cached', trackId }));
        });
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Phone responded ${phoneRes.statusCode}` }));
      }
    }).on('error', (e) => {
      try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (err) {}
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    });
    return;
  }

  // List cached tracks on disk
  if (pathname === '/api/cached-tracks' && req.method === 'GET') {
    try {
      const cachedSet = new Set();
      if (fs.existsSync(CACHE_DIR)) {
        const files = fs.readdirSync(CACHE_DIR);
        for (const f of files) {
          if (f.endsWith('.mp3')) {
            try {
              if (fs.statSync(path.join(CACHE_DIR, f)).size >= 4096) {
                cachedSet.add(f.replace(/\.mp3$/, ''));
              }
            } catch (_) {}
          }
        }
      }
      if (fs.existsSync(DOWNLOADS_DIR)) {
        const dlFiles = new Set(fs.readdirSync(DOWNLOADS_DIR));
        const tracks = getLibraryTracks();
        for (const t of tracks) {
          const safeId = t.id.replace(/[/\\?%*:|"<>]/g, '_');
          if (cachedSet.has(safeId)) continue;
          const ext = t.path ? t.path.split('.').pop() : 'mp3';
          const rawName = `${t.artist} - ${t.title}.${ext}`;
          const safeFilename = rawName.replace(/[/\\?%*:|"<>]/g, '_').trim();
          if (dlFiles.has(safeFilename)) {
            try {
              if (fs.statSync(path.join(DOWNLOADS_DIR, safeFilename)).size >= 4096) {
                cachedSet.add(safeId);
              }
            } catch (_) {}
          }
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ cached: Array.from(cachedSet) }));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ cached: [] }));
    }
    return;
  }

  // Delete specific track or all tracks from local cache
  if (pathname === '/api/delete-cache' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const { trackId, clearAll } = parsed;

        if (clearAll) {
          let count = 0;
          for (const dir of [CACHE_DIR, DOWNLOADS_DIR]) {
            if (fs.existsSync(dir)) {
              for (const f of fs.readdirSync(dir)) {
                if (f !== '.gitkeep') {
                  try {
                    fs.unlinkSync(path.join(dir, f));
                    count++;
                  } catch (ignored) {}
                }
              }
            }
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', cleared: count }));
          return;
        }

        if (trackId) {
          const safeId = trackId.replace(/[/\\?%*:|"<>]/g, '_');
          let removed = false;
          for (const ext of ['.mp3', '.tmp']) {
            const f = path.join(CACHE_DIR, `${safeId}${ext}`);
            if (fs.existsSync(f)) {
              try { fs.unlinkSync(f); removed = true; } catch (_) {}
            }
          }
          try {
            const tracks = getLibraryTracks();
            const track = tracks.find(t => String(t.id) === String(trackId));
            if (track) {
              const ext = track.path ? track.path.split('.').pop() : 'mp3';
              const rawName = `${track.artist} - ${track.title}.${ext}`;
              const safeFilename = rawName.replace(/[/\\?%*:|"<>]/g, '_').trim();
              const dlPath = path.join(DOWNLOADS_DIR, safeFilename);
              if (fs.existsSync(dlPath)) {
                try { fs.unlinkSync(dlPath); removed = true; } catch (_) {}
              }
            }
          } catch (_) {}
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', removed, trackId }));
          return;
        }

        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing trackId or clearAll' }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

function generateProceduralCoverSvg(title = 'Pain', artist = 'Audio') {
  let hash = 0;
  const str = String(title || 'Pain') + String(artist || 'Audio');
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  const absHash = Math.abs(hash);
  const paperBgs = ['#EAE7DF', '#E2DFD5', '#DCD8CE', '#E7E4DC', '#DDD8CD', '#ECE9E1'];
  const labelBgs = ['#FAF9F6', '#1C1C1A', '#EFEDE6', '#E4E1D7'];
  const bg = paperBgs[absHash % paperBgs.length];
  const labelBg = labelBgs[(absHash >> 2) % labelBgs.length];
  const isDarkLabel = labelBg === '#1C1C1A';
  const textFill = isDarkLabel ? '#EFEDE6' : '#1C1C1A';

  let monogram = 'P';
  if (title) {
    const words = String(title).trim().split(/\s+/);
    if (words.length >= 2) {
      monogram = (words[0][0] + words[1][0]).toUpperCase();
    } else if (words[0].length >= 2) {
      monogram = words[0].substring(0, 2).toUpperCase();
    } else {
      monogram = words[0].toUpperCase();
    }
  }
  const cleanMonogram = monogram.replace(/[&<>'"]/g, '');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
    <rect width="200" height="200" fill="${bg}"/>
    <circle cx="100" cy="100" r="88" fill="none" stroke="#1C1C1A" stroke-width="0.75" opacity="0.08"/>
    <circle cx="100" cy="100" r="76" fill="none" stroke="#1C1C1A" stroke-width="0.75" opacity="0.07"/>
    <circle cx="100" cy="100" r="64" fill="none" stroke="#1C1C1A" stroke-width="0.75" opacity="0.08"/>
    <circle cx="100" cy="100" r="52" fill="none" stroke="#1C1C1A" stroke-width="0.75" opacity="0.09"/>
    <circle cx="100" cy="100" r="42" fill="none" stroke="#1C1C1A" stroke-width="0.75" opacity="0.07"/>
    <circle cx="100" cy="100" r="32" fill="${labelBg}" stroke="#1C1C1A" stroke-width="0.8" opacity="0.95"/>
    <circle cx="100" cy="100" r="5.5" fill="${bg}" stroke="#1C1C1A" stroke-width="1.2"/>
    <text x="100" y="86" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="700" letter-spacing="-0.5" fill="${textFill}">${cleanMonogram}</text>
    <text x="100" y="122" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="6.5" font-weight="600" letter-spacing="1" fill="${textFill}" opacity="0.75">PAIN AUDIO</text>
  </svg>`.trim();
}

  if (pathname === '/api/online-covers') {
    if (req.method === 'POST') findOnlineCover.setEnabled(url.searchParams.get('enabled') === '1');
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ completed: findOnlineCover.status() }));
    return;
  }

  // Cover Art Endpoints
  if (pathname.startsWith('/api/cover/')) {
    const trackId = decodeURIComponent(pathname.substring('/api/cover/'.length));
    const safeId = trackId.replace(/[/\\?%*:|"<>]/g, '_');
    const coverFile = path.join(COVERS_DIR, `${safeId}.jpg`);
    if (fs.existsSync(coverFile)) {
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' });
      fs.createReadStream(coverFile).pipe(res);
      return;
    }

    const track = getLibraryTracks().find(t => t.id === trackId);
    const trackTitle = track?.title || 'Pain';
    const trackArtist = track?.artist || 'Audio';
    // Never hold an image HTTP connection while waiting on the internet:
    // Chromium needs the same connection pool to start/seek audio streams.
    if (track) findOnlineCover(track, coverFile, () => true, { online: url.searchParams.get('online') === '1', priority: url.searchParams.get('priority') === '1' }).catch(() => {});
    const svg = generateProceduralCoverSvg(trackTitle, trackArtist);
    res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(svg);
    return;
  }

  if (pathname.startsWith('/api/save-cover/') && req.method === 'POST') {
    const trackId = decodeURIComponent(pathname.substring('/api/save-cover/'.length));
    const safeId = trackId.replace(/[/\\?%*:|"<>]/g, '_');
    const coverFile = path.join(COVERS_DIR, `${safeId}.jpg`);
    const writeStream = fs.createWriteStream(coverFile);
    req.pipe(writeStream);
    writeStream.on('finish', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    });
    writeStream.on('error', (err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  // Custom Playlists Endpoints
  if (pathname === '/api/playlists' && req.method === 'GET') {
    if (fs.existsSync(PLAYLISTS_FILE)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      fs.createReadStream(PLAYLISTS_FILE).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([]));
    }
    return;
  }

  if (pathname === '/api/playlists' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        fs.writeFileSync(PLAYLISTS_FILE, body, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Persist first; an offline phone must never lose a local like or listening record.
  if (['/api/sync-like', '/api/sync-stats', '/api/sync-phone'].includes(pathname) && req.method === 'POST') {
    req.setEncoding('utf8');
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      const send = (code, value) => { res.writeHead(code, {'Content-Type':'application/json'}); res.end(JSON.stringify(value)); };
      let persisted = false;
      try {
        const parsed = JSON.parse(body);
        if (pathname === '/api/sync-like') { phoneSync.favorite(parsed.trackId, parsed.favorite); persisted = true; }
        if (pathname === '/api/sync-stats') {
          const {phoneUrl, ...play} = parsed; phoneSync.play(parsed.play || play); persisted = true;
        }
        const base = new URL(parsed.phoneUrl || getMobilePhoneBaseUrl());
        if (base.protocol !== 'http:') throw new Error('Invalid phone URL');
        fs.writeFileSync(LAST_IP_FILE, `${base.hostname}:${base.port || MOBILE_HTTP_PORT}`, 'utf8');
        if (pathname === '/api/sync-phone') {
          const snapshots = await phoneSync.synchronize(base.href);
          send(200, {status:'ok', ...snapshots});
        } else {
          let syncedToPhone = false;
          try { await phoneSync.flush(base.href); syncedToPhone = true; } catch (_) {}
          send(200, {status:'ok', syncedToPhone});
        }
      } catch (e) { send(persisted ? 200 : 500, persisted ? {status:'ok', syncedToPhone:false} : {error:e.message}); }
    });
    return;
  }

  // Serve static files
  let safePath = pathname === '/' ? '/index.html' : pathname === '/favicon.ico' ? '/assets/app-icon.ico' : pathname;
  let filePath = path.join(__dirname, safePath);

  // Check if it's in assets
  if (safePath.startsWith('/assets/')) {
    filePath = path.join(__dirname, '..', safePath);
  }


  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

let currentPort = parseInt(process.env.PORT, 10) || PORT;
const firstPort=currentPort;
let lastWindowOpen=0;

function openWindow(){
  if(!server.listening||Date.now()-lastWindowOpen<5000)return;
  lastWindowOpen=Date.now();
  if(process.env.OPEN_BROWSER==='false'){server.emit('activate-window');return;}
  const p=server.address().port;
  if (process.platform === 'win32') {
    exec(`start "" msedge --app=http://localhost:${p} --window-size=1200,820`, { windowsHide: true }, (err) => {
      if (err) exec(`start "" chrome --app=http://localhost:${p} --window-size=1200,820`, { windowsHide: true }, (err2) => {
        if (err2) exec(`start "" "http://localhost:${p}"`, { windowsHide: true });
      });
    });
    require('./windows-identity').apply();
  } else if (process.platform === 'darwin') {
    exec(`open "http://localhost:${p}"`);
  } else {
    exec(`(google-chrome --app=http://localhost:${p} --window-size=1200,820 || chromium --app=http://localhost:${p} --window-size=1200,820 || xdg-open http://localhost:${p}) >/dev/null 2>&1 &`);
  }
}

// Register once, not once per failed port: Node retains listen callbacks after
// EADDRINUSE, which used to open N windows after N occupied ports.
server.once('listening', () => {
    const p=server.address().port;
    console.log(`========================================================`);
    console.log(` Pain — Minimalist Audio Player & Sync Companion`);
    console.log(` Web UI: http://localhost:${p}`);
    console.log(` Running on Windows 10/11 & Linux`);
    console.log(` Keep this console window open while using Pain.`);
    console.log(`========================================================`);
    openWindow();
    desktopPreferences.start();
    startDiscovery();
    if (process.env.PAIN_PULSEFLOW_AUTO_INDEX !== 'false') {
      setTimeout(() => { if (performanceMode !== 'maximum') pulseflow.start({automatic:true}).catch(() => {}); }, 15000).unref();
      // Incremental cached embeddings make newly synced files available as well.
      const pulseflowTimer = setInterval(() => { if (performanceMode !== 'maximum') pulseflow.start({automatic:true}).catch(() => {}); }, 10 * 60 * 1000);
      pulseflowTimer.unref(); server.once('close', () => clearInterval(pulseflowTimer));
    }
    setTimeout(() => updater.check().catch(() => {}), 3000).unref();
});

function startServer(p) {server.listen(p, '0.0.0.0');}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && currentPort-firstPort<20 && currentPort<65535) {
    console.warn(`Port ${currentPort} in use, trying ${currentPort + 1}...`);
    currentPort++;
    startServer(currentPort);
  } else {
    console.error('Server error:', err);
    process.exit(1);
  }
});

if(process.platform==='win32' && !process.versions?.electron){
  require('./instance-lock').claim({activate:openWindow}).then(lock=>{
    if(!lock){process.exit(0);return;}
    server.instanceLock=lock;
    startServer(currentPort);
  }).catch(error=>{console.error('Cannot acquire PAIN instance:',error);process.exit(1);});
}else startServer(currentPort);


module.exports = server;
server.pulseflow = pulseflow;
server.on('close', () => pulseflow.close());
server.desktopPreferences = desktopPreferences;
