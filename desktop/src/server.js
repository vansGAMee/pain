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

let discoveredDevices = [];
let udpSocket = null;

// UDP Discovery Server & Broadcaster
try {
  udpSocket = dgram.createSocket('udp4');
  udpSocket.on('error', (err) => {
    console.error('UDP error:', err);
  });

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
      const existing = discoveredDevices.find(d => d.ip === device.ip);
      if (existing) {
        Object.assign(existing, device);
      } else {
        discoveredDevices.push(device);
      }
    }
  });

  udpSocket.bind(0, () => {
    udpSocket.setBroadcast(true);
    broadcastDiscovery();
    setInterval(broadcastDiscovery, 3000);
  });
} catch (e) {
  console.error('Failed to setup UDP:', e);
}

function broadcastDiscovery() {
  if (!udpSocket) return;
  const message = Buffer.from('PAIN_DISCOVERY');
  udpSocket.send(message, 0, message.length, UDP_PORT, '255.255.255.255', (err) => {
    if (err && err.code !== 'ENETUNREACH') console.error('Broadcast err:', err);
  });
}

// Fast Subnet Scanner (fallback if router blocks UDP broadcast)
function scanSubnetForDevices() {
  const interfaces = os.networkInterfaces();
  const subnets = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const parts = iface.address.split('.');
        parts.pop();
        subnets.push(parts.join('.'));
      }
    }
  }

  for (const prefix of subnets) {
    for (let i = 1; i <= 254; i++) {
      const ip = prefix + '.' + i;
      const sock = new net.Socket();
      sock.setTimeout(350);
      sock.on('connect', () => {
        sock.destroy();
        http.get(`http://${ip}:${MOBILE_HTTP_PORT}/api/status`, res => {
          let b = '';
          res.on('data', c => b += c);
          res.on('end', () => {
            try {
              const data = JSON.parse(b);
              if (data.status === 'ok') {
                const device = {
                  name: data.appName ? `${data.appName} (${data.device || 'Android'})` : 'Android Device',
                  ip: ip,
                  port: MOBILE_HTTP_PORT,
                  tracks: data.tracks || 0,
                  lastSeen: Date.now()
                };
                const existing = discoveredDevices.find(d => d.ip === device.ip);
                if (existing) {
                  Object.assign(existing, device);
                } else {
                  discoveredDevices.push(device);
                }
              }
            } catch (e) {}
          });
        }).on('error', () => {});
      });
      sock.on('timeout', () => sock.destroy());
      sock.on('error', () => sock.destroy());
      sock.connect(MOBILE_HTTP_PORT, ip);
    }
  }
}

scanSubnetForDevices();
setInterval(scanSubnetForDevices, 8000);

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
    console.log(`Pain Windows Companion running at http://localhost:${p}`);
    if (process.env.OPEN_BROWSER !== 'false') {
      if (process.platform === 'win32') {
        exec(`start http://localhost:${p}`);
      } else if (process.platform === 'darwin') {
        exec(`open http://localhost:${p}`);
      } else {
        exec(`(chromium --app=http://localhost:${p} || xdg-open http://localhost:${p}) >/dev/null 2>&1 &`);
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
