const http = require('http');
const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');
const dgram = require('dgram');
const { exec } = require('child_process');

const PORT = 3000;
const MOBILE_HTTP_PORT = 8865;
const UDP_PORT = 8866;

const BASE_DATA_DIR = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
const DATA_DIR = path.join(BASE_DATA_DIR, 'data');
const DOWNLOADS_DIR = path.join(BASE_DATA_DIR, 'downloads');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

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
        fs.writeFileSync(path.join(DATA_DIR, 'stats.json'), body, 'utf8');
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

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

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
        fs.writeFileSync(path.join(DATA_DIR, 'stats.json'), body, 'utf8');
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
    const rawName = req.headers['x-filename'] ? decodeURIComponent(req.headers['x-filename']) : `track-${Date.now()}.mp3`;
    // Clean filename for Windows (illegal chars: \ / : * ? " < > |)
    const safeFilename = rawName.replace(/[/\\?%*:|"<>]/g, '_').trim();
    const dest = path.join(DOWNLOADS_DIR, safeFilename);
    const fileStream = fs.createWriteStream(dest);
    req.pipe(fileStream);
    fileStream.on('finish', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', filename: safeFilename }));
    });
    fileStream.on('error', (err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
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

