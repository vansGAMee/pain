const http = require('http');
const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');
const dgram = require('dgram');
const { exec } = require('child_process');

const lyricsRoute = require('./lyrics-store');
const parseRange = require('./range');
const mergeStats = require('./stats-store');
const PORT = 3000;
const MOBILE_HTTP_PORT = 8865;
const UDP_PORT = 8866;

const BASE_DATA_DIR = process.env.PAIN_DATA_DIR || (process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..'));
const DATA_DIR = path.join(BASE_DATA_DIR, 'data');
const DOWNLOADS_DIR = path.join(BASE_DATA_DIR, 'downloads');
const CACHE_DIR = path.join(BASE_DATA_DIR, 'cache');
const COVERS_DIR = path.join(BASE_DATA_DIR, 'covers');
const PLAYLISTS_FILE = path.join(DATA_DIR, 'playlists.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
if (!fs.existsSync(COVERS_DIR)) fs.mkdirSync(COVERS_DIR, { recursive: true });

function saveStatsSnapshot(body) {
  const incoming=JSON.parse(body);
  if(!incoming||typeof incoming!=='object'||!Array.isArray(incoming.plays))throw new Error('Invalid statistics');
  const file=path.join(DATA_DIR,'stats.json');let local={plays:[],slices:[]};
  try{local=JSON.parse(fs.readFileSync(file,'utf8'));}catch(_){}
  const merged=mergeStats(local,incoming);
  fs.writeFileSync(file+'.tmp',JSON.stringify(merged),'utf8');fs.renameSync(file+'.tmp',file);
  return merged;
}

const LAST_IP_FILE = path.join(DATA_DIR, 'last_phone_ip.txt');

let discoveredDevices = [];
let hasAutoSynced = false;
let udpSocket = null;

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

// Background auto-sync function
async function triggerBackgroundAutoSync(device) {
  const libFile = path.join(DATA_DIR, 'library.json');
  const needsSync = !hasAutoSynced || !fs.existsSync(libFile) || (fs.existsSync(libFile) && fs.statSync(libFile).size < 100);
  if (!needsSync) return;
  hasAutoSynced = true;

  console.log(`[Auto-Sync] Initiating instant zero-touch library sync from http://${device.ip}:${device.port}...`);
  // Fetch library
  http.get(`http://${device.ip}:${device.port}/api/library`, (res) => {
    let body = '';
    res.on('data', c => body += c);
    res.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        if (parsed.tracks && parsed.tracks.length > 0) {
          fs.writeFileSync(libFile, body, 'utf8');
          console.log(`[Auto-Sync] Successfully saved ${parsed.tracks.length} tracks to library.json!`);
        }
      } catch (e) {}
    });
  }).on('error', () => {});

  // Fetch stats
  http.get(`http://${device.ip}:${device.port}/api/stats`, (res) => {
    let body = '';
    res.on('data', c => body += c);
    res.on('end', () => {
      try {
        saveStatsSnapshot(body);
      } catch (e) {}
    });
  }).on('error', () => {});
}

// Fast ARP Table Scanner (executes in <10ms, discovers all active LAN devices)
function scanArpTable() {
  try {
    const cmd = process.platform === 'win32' ? 'arp -a' : 'arp -a 2>/dev/null || ip neighbor 2>/dev/null';
    exec(cmd, { timeout: 2000 }, (err, stdout) => {
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
async function scanSubnetsSmart() {
  if (isScanningSubnet) return;
  isScanningSubnet = true;

  try {
    const interfaces = os.networkInterfaces();
    const subnets = [];
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if ((iface.family === 'IPv4' || iface.family === 4) && !iface.internal && iface.address) {
          if (iface.address.startsWith('169.254.')) continue;
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
      for (let start = 1; start <= 254; start += 25) {
        const end = Math.min(start + 24, 254);
        const batch = [];
        for (let i = start; i <= end; i++) {
          const ip = `${prefix}.${i}`;
          batch.push(probeDevice(ip, MOBILE_HTTP_PORT, 1200));
        }
        await Promise.all(batch);
      }
    }
  } catch (e) {
  } finally {
    isScanningSubnet = false;
  }
}

// UDP Multi-Target Broadcast
function broadcastDiscovery() {
  if (!udpSocket) return;
  const message = Buffer.from('PAIN_DISCOVERY');

  udpSocket.send(message, 0, message.length, UDP_PORT, '255.255.255.255', () => {});

  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
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
    setInterval(broadcastDiscovery, 3000);
  });
} catch (e) {
  try {
    udpSocket = dgram.createSocket('udp4');
    udpSocket.bind(0, () => {
      udpSocket.setBroadcast(true);
      broadcastDiscovery();
      setInterval(broadcastDiscovery, 3000);
    });
  } catch (err) {}
}

// Trigger initial scans
checkLastKnownIp();
scanArpTable();
setTimeout(scanArpTable, 1500);
setTimeout(scanSubnetsSmart, 500);
setInterval(scanArpTable, 5000);
setInterval(scanSubnetsSmart, 15000);
}


const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
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
    }
    return libraryTracksCache;
  } catch (e) {
    return libraryTracksCache;
  }
}

function getResolvedAudioFilePath(trackId) {
  const safeId = trackId.replace(/[/\\?%*:|"<>]/g, '_');
  const cachedFile = path.join(CACHE_DIR, `${safeId}.mp3`);

  try {
    if (fs.existsSync(cachedFile)) {
      const sz = fs.statSync(cachedFile).size;
      if (sz >= 4096) {
        return cachedFile;
      }
      try { fs.unlinkSync(cachedFile); } catch (_) {}
    }
  } catch (_) {}

  try {
    const tracks = getLibraryTracks();
    const track = tracks.find(t => String(t.id) === String(trackId));
    if (track) {
      const ext = track.path ? track.path.split('.').pop() : 'mp3';
      const rawName = `${track.artist} - ${track.title}.${ext}`;
      const safeFilename = rawName.replace(/[/\\?%*:|"<>]/g, '_').trim();
      const dlPath = path.join(DOWNLOADS_DIR, safeFilename);
      if (fs.existsSync(dlPath) && fs.statSync(dlPath).size >= 4096) {
        try {
          if (!fs.existsSync(cachedFile)) {
            try {
              fs.linkSync(dlPath, cachedFile);
            } catch (_) {
              fs.copyFileSync(dlPath, cachedFile);
            }
          }
        } catch (_) {}
        return dlPath;
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Filename, Range');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (lyricsRoute(req,res,url,DATA_DIR)) return;

  // API endpoints
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
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        fs.writeFileSync(path.join(DATA_DIR, 'library.json'), body, 'utf8');
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
          fs.renameSync(tmpDest, dest);
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
          if(phoneRes.complete&&size>=4096&&(!expected||expected===size))fs.renameSync(temp,cachedFile);else discard();
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
              fs.renameSync(tmpFile, cachedFile);
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

    let trackTitle = 'Pain', trackArtist = 'Audio';
    try {
      const libFile = path.join(DATA_DIR, 'library.json');
      if (fs.existsSync(libFile)) {
        const lib = JSON.parse(fs.readFileSync(libFile, 'utf8'));
        const track = (lib.tracks || []).find(t => t.id === trackId);
        if (track) {
          trackTitle = track.title || 'Pain';
          trackArtist = track.artist || 'Audio';
        }
      }
    } catch (e) {}

    const svg = generateProceduralCoverSvg(trackTitle, trackArtist);
    res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
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

  // 2-Way Sync: Favorite / Like Toggle
  if (pathname === '/api/sync-like' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        const { trackId, favorite } = parsed;
        const favVal = (favorite === true || favorite === 1) ? 1 : 0;

        const libFile = path.join(DATA_DIR, 'library.json');
        if (fs.existsSync(libFile)) {
          try {
            const lib = JSON.parse(fs.readFileSync(libFile, 'utf8'));
            const track = (lib.tracks || []).find(t => t.id === trackId);
            if (track) {
              track.favorite = favVal;
              fs.writeFileSync(libFile, JSON.stringify(lib, null, 2), 'utf8');
            }
          } catch (e) {}
        }

        // Relay to mobile phone
        const rawPhone = parsed.phoneUrl || getMobilePhoneBaseUrl();
        const phoneUrl = rawPhone.replace(/\/+$/, '');

        // Save last known phone IP for persistent reconnection
        try {
          const u = new URL(phoneUrl);
          fs.writeFileSync(LAST_IP_FILE, `${u.hostname}:${u.port || MOBILE_HTTP_PORT}`, 'utf8');
        } catch (e) {}

        const favPayload = JSON.stringify({ trackId, favorite: favVal });
        const favUrl = new URL(`${phoneUrl}/api/favorite`);
        const postReq = http.request(favUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(favPayload) }
        }, (phoneRes) => {
          if (phoneRes.statusCode === 200) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', syncedToPhone: true }));
          } else {
            // Fallback for older Android server versions
            const libPayload = JSON.stringify({ tracks: [{ id: trackId, favorite: favVal }] });
            const libUrl = new URL(`${phoneUrl}/api/library`);
            const fallbackReq = http.request(libUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(libPayload) }
            }, (fallbackRes) => {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ status: 'ok', syncedToPhone: fallbackRes.statusCode === 200 }));
            });
            fallbackReq.on('error', () => {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ status: 'ok', syncedToPhone: false }));
            });
            fallbackReq.write(libPayload);
            fallbackReq.end();
          }
        });
        postReq.on('error', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', syncedToPhone: false }));
        });
        postReq.write(favPayload);
        postReq.end();
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // 2-Way Sync: Play Statistics
  if (pathname === '/api/sync-stats' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        const statsFile = path.join(DATA_DIR, 'stats.json');
        let stats = { plays: [], slices: [] };
        if (fs.existsSync(statsFile)) {
          try { stats = JSON.parse(fs.readFileSync(statsFile, 'utf8')); } catch (e) {}
        }

        const trackId = parsed.track || (parsed.play && parsed.play.track);
        const heard = parsed.heard || (parsed.play && parsed.play.heard) || 0;
        const duration = parsed.duration || (parsed.play && parsed.play.duration) || heard;
        const started = parsed.started || (parsed.play && parsed.play.started) || (Date.now() - heard);
        const finished = (parsed.finished === true || parsed.finished === 1 || (parsed.play && parsed.play.finished == 1)) ? 1 : 0;

        const playId = parsed.id || (parsed.play && parsed.play.id) || ('pc_' + Date.now() + '_' + Math.floor(Math.random() * 10000));
        const playObj = parsed.play || {
          id: playId,
          track: trackId,
          session: 'pc_companion',
          started: started,
          heard: heard,
          media_heard: heard,
          duration: duration,
          finished: finished,
          skipped: 0
        };

        const alreadyExists = stats.plays.some(p => p.id === playObj.id || (p.track === playObj.track && Math.abs(p.started - playObj.started) < 2000));
        if (!alreadyExists) {
          stats.plays.push(playObj);
          fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2), 'utf8');
        }

        // Relay to mobile phone
        const rawPhone = parsed.phoneUrl || getMobilePhoneBaseUrl();
        const phoneUrl = rawPhone.replace(/\/+$/, '');

        // Save last known phone IP
        try {
          const u = new URL(phoneUrl);
          fs.writeFileSync(LAST_IP_FILE, `${u.hostname}:${u.port || MOBILE_HTTP_PORT}`, 'utf8');
        } catch (e) {}

        const recPayload = JSON.stringify({
          track: trackId,
          heard: heard,
          started: started,
          duration: duration,
          finished: finished === 1
        });
        const recUrl = new URL(`${phoneUrl}/api/record-play`);
        const postReq = http.request(recUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(recPayload) }
        }, (phoneRes) => {
          if (phoneRes.statusCode === 200) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', syncedToPhone: true }));
          } else {
            // Fallback to /api/stats
            const legacyStatsPayload = JSON.stringify({ plays: [playObj] });
            const legacyUrl = new URL(`${phoneUrl}/api/stats`);
            const fallbackReq = http.request(legacyUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(legacyStatsPayload) }
            }, (fallbackRes) => {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ status: 'ok', syncedToPhone: fallbackRes.statusCode === 200 }));
            });
            fallbackReq.on('error', () => {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ status: 'ok', syncedToPhone: false }));
            });
            fallbackReq.setTimeout(5000,()=>fallbackReq.destroy(new Error("Phone timed out")));
            fallbackReq.write(legacyStatsPayload);
            fallbackReq.end();
          }
        });
        postReq.on('error', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', syncedToPhone: false }));
        });
        postReq.setTimeout(5000,()=>postReq.destroy(new Error("Phone timed out")));
        postReq.write(recPayload);
        postReq.end();
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Serve static files
  let safePath = pathname === '/' ? '/index.html' : pathname;
  let filePath = path.join(__dirname, safePath);

  // Check if it's in assets
  if (safePath.startsWith('/assets/')) {
    filePath = path.join(__dirname, '..', safePath);
  }

  // Check if it's in joint-model (AI weights)
  if (safePath.startsWith('/joint-model/')) {
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

function startServer(p) {
  server.listen(p, '0.0.0.0', () => {
    console.log(`========================================================`);
    console.log(` Pain — Minimalist Audio Player & Sync Companion`);
    console.log(` Web UI: http://localhost:${p}`);
    console.log(` Running on Windows 10/11 & Linux`);
    console.log(` Keep this console window open while using Pain.`);
    console.log(`========================================================`);
    if (process.env.OPEN_BROWSER !== 'false') {
      if (process.platform === 'win32') {
        // Launch in Microsoft Edge App Mode (preinstalled on 100% of Windows 10 & 11)
        // Edge in app mode removes the URL bar, tabs, and browser chrome, rendering as a native app window.
        exec(`start msedge --app=http://localhost:${p} --window-size=1200,820`, (err) => {
          if (err) {
            exec(`start chrome --app=http://localhost:${p} --window-size=1200,820`, (err2) => {
              if (err2) {
                exec(`start "" "http://localhost:${p}"`);
              }
            });
          }
        });
      } else if (process.platform === 'darwin') {
        exec(`open "http://localhost:${p}"`);
      } else {
        exec(`(google-chrome --app=http://localhost:${p} --window-size=1200,820 || chromium --app=http://localhost:${p} --window-size=1200,820 || xdg-open http://localhost:${p}) >/dev/null 2>&1 &`);
      }
    }
  });
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`Port ${currentPort} in use, trying ${currentPort + 1}...`);
    currentPort++;
    startServer(currentPort);
  } else {
    console.error('Server error:', err);
  }
});

startServer(currentPort);


module.exports = server;
