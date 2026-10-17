const http = require('http');
const fs = require('fs');
const path = require('path');
const dgram = require('dgram');
const { exec } = require('child_process');

const PORT = 3000;
const MOBILE_HTTP_PORT = 8865;
const UDP_PORT = 8866;

const DATA_DIR = path.join(__dirname, '..', 'data');
const DOWNLOADS_DIR = path.join(__dirname, '..', 'downloads');
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Pain Windows Companion running at http://localhost:${PORT}`);
  if (process.env.OPEN_BROWSER !== 'false') {
    if (process.platform === 'win32') {
      exec(`start http://localhost:${PORT}`);
    } else if (process.platform === 'darwin') {
      exec(`open http://localhost:${PORT}`);
    } else {
      exec(`(chromium --app=http://localhost:${PORT} || xdg-open http://localhost:${PORT}) >/dev/null 2>&1 &`);
    }
  }
});
