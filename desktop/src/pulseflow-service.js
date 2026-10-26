/* Python stays outside Electron's event loop. Query process never loads Torch. */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');

module.exports = function createPulseFlow({ dataDir, getTracks, resolveAudio }) {
  const root = path.join(dataDir, 'pulseflow');
  const runtimeRoot = __dirname.includes('app.asar') ? path.dirname(dataDir) : path.join(__dirname, '..');
  const python = process.env.PAIN_PULSEFLOW_PYTHON || path.join(runtimeRoot, '.pulseflow-venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  // Electron packages unpack Python sources: Python cannot import from an asar.
  const bridge = path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'pulseflow', 'bridge.py');
  const pending = new Map();
  let query, indexer, sequence = 0, lastError = null, starting = false, closed = false, indexGeneration = 0;
  const env = { ...process.env, OMP_NUM_THREADS: '2', OPENBLAS_NUM_THREADS: '2', MKL_NUM_THREADS: '2',
    TOKENIZERS_PARALLELISM: 'false', HF_HOME: path.join(root, 'models'), PYTHONUNBUFFERED: '1' };
  function stopQuery(error = new Error('PulseFlow stopped')) {
    const child = query; query = null;
    for (const job of pending.values()) { clearTimeout(job.timer); job.reject(error); }
    pending.clear(); child?.kill();
  }
  function spawnPython(command, extra = []) {
    const child = spawn(python, [bridge, command, '--data', root, ...extra], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let log;
    fs.mkdirSync(root, { recursive: true });
    log = fs.createWriteStream(path.join(root, command + '.log'), { flags: 'a' });
    log.on('error', () => {});
    child.stderr.pipe(log, { end: false });
    if (command === 'index') child.stdout.pipe(log, { end: false });
    child.once('close', () => log.end());
    return child;
  }
  function ensureQuery() {
    if (query) return query;
    const child = query = spawnPython('serve');
    readline.createInterface({ input: child.stdout }).on('line', line => {
      let message; try { message = JSON.parse(line); } catch (_) { return; }
      const job = pending.get(message.id); if (!job) return;
      pending.delete(message.id); clearTimeout(job.timer);
      if (message.error) { lastError = message.error; job.reject(new Error(message.error)); }
      else { lastError = null; job.resolve(message.result); }
    });
    child.on('error', error => { if (query === child) stopQuery(error); });
    child.on('exit', () => { if (query === child) stopQuery(new Error('PulseFlow process exited')); });
    child.stdin.on('error', error => { if (query === child) stopQuery(error); });
    return child;
  }
  async function status() {
    let saved = {}; try { saved = JSON.parse(await fs.promises.readFile(path.join(root, 'status.json'), 'utf8')); } catch (_) {}
    const installed = fs.existsSync(python), running = Boolean(indexer) || starting;
    if (['loading', 'indexing'].includes(saved.state) && !running) saved.state = 'interrupted';
    return { ...saved, installed, running, available: fs.existsSync(path.join(root, 'catalog.npz')),
      state: installed ? saved.state || 'empty' : 'not-installed', lastError };
  }
  async function start() {
    if (indexer || starting) return status();
    if (closed) throw new Error('PulseFlow stopped');
    if (!fs.existsSync(python)) throw new Error('Install the PulseFlow runtime: npm run pulseflow:setup');
    starting = true;
    const generation = indexGeneration;
    try {
    await fs.promises.mkdir(root, { recursive: true });
    const manifest = getTracks().map(t => ({ id: String(t.id), title: t.title, path: resolveAudio(String(t.id)) })).filter(t => t.path);
    const file = path.join(root, 'input.json');
    await fs.promises.writeFile(file, JSON.stringify(manifest));
    if (closed || generation !== indexGeneration) throw new Error('PulseFlow indexing cancelled');
    const child = indexer = spawnPython('index', ['--manifest', file]);
    child.stdin.end(); lastError = null;
    child.on('error', error => { lastError = error.message; });
    child.on('close', code => { if (indexer === child) indexer = null; if (code) lastError ||= 'PulseFlow indexing failed; see Settings and data/pulseflow/index.log'; });
    return { ...(await status()), running: true, state: 'loading', total: manifest.length };
    } finally { starting = false; }
  }
  function recommend(request) {
    return new Promise((resolve, reject) => {
      if (pending.size >= 4) { reject(new Error('PulseFlow is busy')); return; }
      const id = ++sequence, child = ensureQuery();
      // Includes cold Python imports, never model inference/downloads.
      const timer = setTimeout(() => stopQuery(new Error('PulseFlow query timed out')), 18000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ ...request, id }) + '\n');
    });
  }
  function close() { closed = true; indexGeneration++; stopQuery(); indexer?.kill(); indexer = null; }
  process.once('exit', close);
  async function route(req, res, pathname) {
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    let local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
    try { if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) local = false; } catch (_) { local = false; }
    if (!local) { res.writeHead(403); res.end('{}'); return; }
    try {
      if (pathname === '/api/pulseflow/status' && req.method === 'GET') { res.end(JSON.stringify(await status())); return; }
      if (req.method !== 'POST' || req.headers['x-pain-update'] !== 'pulseflow') { res.writeHead(403); res.end('{}'); return; }
      if (pathname === '/api/pulseflow/index') { res.end(JSON.stringify(await start())); return; }
      if (pathname === '/api/pulseflow/cancel') { indexGeneration++; indexer?.kill(); indexer = null; res.end(JSON.stringify(await status())); return; }
      if (pathname !== '/api/pulseflow/recommend') { res.writeHead(404); res.end('{}'); return; }
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 2 * 1024 * 1024) throw new Error('Queue is too large'); }
      res.end(JSON.stringify(await recommend(JSON.parse(body))));
    } catch (error) { lastError = error.message; res.writeHead(503); res.end(JSON.stringify({ error: error.message })); }
  }
  return { route, close, status, start, recommend };
};
