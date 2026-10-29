/* Python stays outside Electron's event loop. Query process never loads Torch. */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');

module.exports = function createPulseFlow({ dataDir, getTracks, resolveAudio, prepareAudio, audioStatus, runtimeInstaller, spawnImpl = spawn }) {
  const root = path.join(dataDir, 'pulseflow');
  const runtime = require('./music-runtime')(dataDir), python = runtime.python;
  // Electron packages unpack Python sources: Python cannot import from an asar.
  const bridge = path.join(runtime.sources, 'pulseflow', 'bridge.py');
  const pending = new Map();
  let indexAutomatic = false, backgroundAllowed = true;
  let query, indexer, sequence = 0, lastError = null, starting = false, closed = false, indexGeneration = 0, indexAbort;
  const env = { ...runtime.env(), OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1', MKL_NUM_THREADS: '1',
    TOKENIZERS_PARALLELISM: 'false', HF_HOME: path.join(root, 'models'), PYTHONUNBUFFERED: '1' };
  function stopQuery(error = new Error('PulseFlow stopped')) {
    const child = query; query = null;
    for (const job of pending.values()) { clearTimeout(job.timer); job.reject(error); }
    pending.clear(); child?.kill();
  }
  function spawnPython(command, extra = []) {
    const child = spawnImpl(python, [bridge, command, '--data', root, ...extra], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    require('./background-priority')(child);
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
    if(!runtime.installed())throw Object.assign(new Error('Local analysis is not installed'),{code:'RUNTIME_NOT_INSTALLED'});
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
    const installed = runtime.installed(), running = Boolean(indexer) || starting;
    if (['loading', 'indexing'].includes(saved.state) && !running) saved.state = 'interrupted';
    const tracks = getTracks(), unavailable = tracks.filter(t => !resolveAudio(String(t.id)))
      .map(t => ({ id: String(t.id), title: t.title, artist: t.artist, ...audioStatus?.(String(t.id)) }));
    let indexedIds = saved.indexedIds;
    if (!indexedIds && saved.state === 'ready' && !saved.failed) {
      try { indexedIds = JSON.parse(await fs.promises.readFile(path.join(root, 'input.json'), 'utf8')).filter(t => t.path).map(t => t.id); } catch (_) {}
    }
    const ids = new Set(indexedIds || []), indexed = indexedIds ? tracks.filter(t => ids.has(String(t.id))).length : Math.min(saved.indexed || 0, tracks.length);
    let failures = []; try { failures = JSON.parse(await fs.promises.readFile(path.join(root, 'errors.json'), 'utf8')); } catch (_) {}
    return { ...saved, indexedIds: undefined, indexed, total: tracks.length, unavailable, failures, installed, running, runtime:runtimeInstaller?.status(),
      available: fs.existsSync(path.join(root, 'catalog.npz')),
      state: installed ? (starting && !indexer ? 'preparing' : !running&&tracks.length&&unavailable.length===tracks.length?'no-audio':!running && saved.state === 'ready' && indexed < tracks.length ? 'partial' : saved.state || 'empty') : 'not-installed', lastError:installed?lastError:null };
  }
  async function start({ automatic = false } = {}) {
    if (automatic && !backgroundAllowed) return status();
    if (indexer || starting) return status();
    if (closed) throw new Error('PulseFlow stopped');
    if (!runtime.installed()) throw new Error('Install local analysis in Settings');
    starting = true; indexAutomatic = automatic; indexAbort = new AbortController();
    const generation = indexGeneration;
    try {
    await runtime.ensureSources();
    await fs.promises.mkdir(root, { recursive: true });
    const manifest = getTracks().map(t => ({ id: String(t.id), title: t.title, path: resolveAudio(String(t.id)) }));
    // Manual repair waits for complete downloads before passing paths to Python.
    if (!automatic && prepareAudio) for (const item of manifest.filter(t => !t.path)) {
      if (closed || generation !== indexGeneration) throw new Error('PulseFlow indexing cancelled');
      try { item.path = await prepareAudio(item.id,{signal:indexAbort.signal}); }
      catch (error) { if(!['AUDIO_NOT_ON_PHONE','AUDIO_PHONE_UNREADABLE'].includes(error.code))break; }
    }
    if (closed || generation !== indexGeneration) throw new Error('PulseFlow indexing cancelled');
    const file = path.join(root, 'input.json');
    await fs.promises.writeFile(file, JSON.stringify(manifest));
    if (closed || generation !== indexGeneration) throw new Error('PulseFlow indexing cancelled');
    const child = indexer = spawnPython('index', ['--manifest', file]);
    child.stdin.end(); lastError = null;
    child.on('error', error => { lastError = error.message; });
    child.on('close', code => { if (indexer === child) { indexer = null; if (code) lastError ||= 'PulseFlow indexing failed; see Settings and data/pulseflow/index.log'; } });
    return { ...(await status()), running: true, state: 'indexing', current: '', total: manifest.length };
    } finally { starting = false; }
  }
  async function recommend(request) {
    await runtime.ensureSources();
    return new Promise((resolve, reject) => {
      if (pending.size >= 4) { reject(new Error('PulseFlow is busy')); return; }
      const id = ++sequence, child = ensureQuery();
      // Includes cold Python imports, never model inference/downloads.
      const timer = setTimeout(() => stopQuery(new Error('PulseFlow query timed out')), 18000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ ...request, id }) + '\n');
    });
  }
  function close() { closed = true; indexGeneration++; indexAbort?.abort(); stopQuery(); indexer?.kill(); indexer = null; }
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
      if (pathname === '/api/pulseflow/cancel') { indexGeneration++; indexAbort?.abort(); indexer?.kill(); indexer = null; res.end(JSON.stringify(await status())); return; }
      if (pathname !== '/api/pulseflow/recommend') { res.writeHead(404); res.end('{}'); return; }
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 2 * 1024 * 1024) throw new Error('Queue is too large'); }
      res.end(JSON.stringify(await recommend(JSON.parse(body))));
    } catch (error) { if (!/cancelled/.test(error.message)) lastError = error.message; res.writeHead(503); res.end(JSON.stringify({ error: error.message })); }
  }
  function setBackgroundAllowed(value) {
    backgroundAllowed = value;
    if (!value && indexAutomatic && (indexer || starting)) {
      indexGeneration++; indexAbort?.abort(); indexer?.kill(); indexer = null;
    }
  }
  return { route, close, status, start, recommend, setBackgroundAllowed,reloadRuntime(){lastError=null;stopQuery(new Error('Runtime changed'));} };
};
