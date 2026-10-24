/**
 * Pain Audio — Joint AI Engine (CLAP Sound + ListenBrainz/KEXP Graph)
 * Ported from musicmylove/src/lib/joint runtime.
 * Catalog retrieval and a supplied trained ranker. Scores are ordering values,
 * not calibrated probabilities that a listener will like a track.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.JointAI = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const modelDimensions = d => d.manifest.dimensions;

  const normalize = (s) => (s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/ς/g, 'σ')
    .replace(/[’‘]/g, "'")
    .replace(/[‐‑–—]/g, '-')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/\s+-\s+/g, ' - ');

  const name = (s) => normalize(`${s.artist || ''} - ${s.title || ''}`);
  const mastering = (s) => s.replace(/\s*[\[(](?:(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?)[\])]\s*$/, '').replace(/\s+-\s+(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?\s*$/, '');
  const cleanTitle = (t) => (t || '').replace(/\s*[\[(](?:feat\.?|ft\.?|prod\.?|ost|super slowed|slowed|bonus track|official|audio|video|clip|lyrics?|extended|short|hq|hd|remix).*?[\])]/gi, '').replace(/["'«»]/g, '').trim();
  const familyName = (s) => normalize(s.artist || '') + '\u001f' + normalize(s.title || '').replace(/\s*[\[(][^\])]*(?:remaster|live|version|remix|acoustic|edit)[^\])]*[\])]\s*$/, '').replace(/\s+-\s+(?:\d{4}\s+)?(?:remaster|live|version|remix|acoustic|edit).*$/, '').trim();

  // --- UNIVERSAL FILE & TRACK PARSERS ---
  function parseCsvLine(line, delimiter) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  }

  function detectDelimiter(firstLine) {
    const comma = (firstLine.match(/,/g) || []).length;
    const semi = (firstLine.match(/;/g) || []).length;
    const tab = (firstLine.match(/\t/g) || []).length;
    if (semi > comma && semi > tab) return ';';
    if (tab > comma && tab > semi) return '\t';
    return ',';
  }

  function extractArtistAndTitle(str) {
    if (!str || typeof str !== 'string') return null;
    const clean = str.replace(/^\s*(?:\[\d+\]|\d+[\.\)\-:]|\d+\s+[-–—])\s*/u, '')
                     .replace(/^\s*[•\*\-]\s+/u, '')
                     .trim();
    const match = /^(.+?)\s*(?:[-–—:]|\s+by\s+)\s*(.+)$/i.exec(clean);
    if (match) {
      const artist = match[1].trim().replace(/^["']|["']$/g, '');
      const title = match[2].trim().replace(/^["']|["']$/g, '');
      if (artist && title) return { artist, title };
    }
    return null;
  }

  function parseFileContent(text) {
    if (!text || typeof text !== 'string') return [];
    const content = text.replace(/^\uFEFF/, '').trim();
    if (!content) return [];

    // 1. JSON
    if (content.startsWith('[') || content.startsWith('{')) {
      try {
        const parsed = JSON.parse(content);
        const list = Array.isArray(parsed) ? parsed : (parsed.tracks || parsed.items || parsed.songs || []);
        if (Array.isArray(list)) {
          const songs = [];
          for (const rawItem of list) {
            if (!rawItem || typeof rawItem !== 'object') continue;
            const item = (rawItem.track && typeof rawItem.track === 'object') ? rawItem.track : rawItem;
            let artist = item.artist || item.author || item.performer || item.byArtist || item['Исполнитель'] || item['Артист'] || item['Автор'];
            if (!artist && Array.isArray(item.artists) && item.artists[0]) {
              artist = typeof item.artists[0] === 'string' ? item.artists[0] : item.artists[0].name;
            }
            let title = item.title || item.track || item.trackName || item.name || item.song || item['Название'] || item['Трек'] || item['Песня'] || item.master_metadata_track_name;
            if (artist && title) {
              songs.push({ artist: String(artist).trim(), title: String(title).trim() });
            }
          }
          if (songs.length > 0) return songs;
        }
      } catch (e) {}
    }

    // 2. Multi-line formats: M3U, CSV, TSV, TXT
    const rawLines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (rawLines.length === 0) return [];

    // M3U
    const isM3u = rawLines.some(l => l.startsWith('#EXTM3U') || l.startsWith('#EXTINF:'));
    if (isM3u) {
      const songs = [];
      for (const line of rawLines) {
        if (line.startsWith('#EXTINF:')) {
          const commaIdx = line.indexOf(',');
          const trackStr = (commaIdx !== -1 ? line.slice(commaIdx + 1) : line.replace('#EXTINF:', '')).trim();
          const ext = extractArtistAndTitle(trackStr);
          if (ext) songs.push(ext);
        } else if (!line.startsWith('#')) {
          const cleanName = line.replace(/\.[a-z0-9]{2,4}$/i, '').trim();
          const ext = extractArtistAndTitle(cleanName);
          if (ext) songs.push(ext);
        }
      }
      if (songs.length > 0) return songs;
    }

    const lines = rawLines.filter(l => !l.startsWith('#'));
    if (lines.length === 0) return [];

    // CSV header check
    const firstLine = lines[0];
    const delimiter = detectDelimiter(firstLine);
    const headerCols = parseCsvLine(firstLine, delimiter).map(c => c.toLowerCase().replace(/["']/g, '').trim());

    const isHeader = headerCols.some(col =>
      col.includes('artist') || col.includes('track') || col.includes('title') || col.includes('song') ||
      col.includes('исполнитель') || col.includes('артист') || col.includes('автор') ||
      col.includes('название') || col.includes('трек') || col.includes('песня')
    );

    let artistIdx = -1;
    let titleIdx = -1;
    if (isHeader) {
      artistIdx = headerCols.findIndex(col =>
        col.includes('artist') || col.includes('author') || col.includes('performer') ||
        col.includes('исполнитель') || col.includes('артист') || col.includes('автор')
      );
      titleIdx = headerCols.findIndex((col, i) =>
        i !== artistIdx && (
          col === 'track name' || col === 'track' || col === 'title' || col === 'song' || col === 'name' ||
          col === 'название' || col === 'трек' || col === 'песня' ||
          col.includes('track') || col.includes('title') || col.includes('название')
        )
      );
    }

    const songs = [];
    const startLine = (isHeader && artistIdx !== -1 && titleIdx !== -1) ? 1 : 0;

    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      if (isHeader && artistIdx !== -1 && titleIdx !== -1) {
        const cols = parseCsvLine(line, delimiter);
        const artist = cols[artistIdx]?.replace(/^["']|["']$/g, '').trim();
        const title = cols[titleIdx]?.replace(/^["']|["']$/g, '').trim();
        if (artist && title) songs.push({ artist, title });
      } else {
        const ext = extractArtistAndTitle(line);
        if (ext) {
          songs.push(ext);
        } else {
          const cols = parseCsvLine(line, delimiter);
          if (cols.length >= 2) {
            const artist = cols[0].replace(/^["']|["']$/g, '').trim();
            const title = cols[1].replace(/^["']|["']$/g, '').trim();
            if (artist && title) songs.push({ artist, title });
          }
        }
      }
    }

    return songs;
  }

  const loadedModels = new Map();
  const pendingModels = new Map();

  const catalogIndicesCache = new WeakMap();

  function buildIndices(catalog) {
    let cached = catalogIndicesCache.get(catalog);
    if (cached) return cached;

    const exact = new Map();
    const master = new Map();
    const family = new Map();
    const artistMap = new Map();

    const add = (m, k, i) => {
      let s = m.get(k);
      if (!s) { s = new Set(); m.set(k, s); }
      s.add(i);
    };

    catalog.tracks.forEach((t, i) => {
      const aNorm = normalize(t.artist);
      let list = artistMap.get(aNorm);
      if (!list) { list = []; artistMap.set(aNorm, list); }
      list.push(i);

      const aliases = Array.isArray(t.aliases) ? t.aliases : [];
      for (const [artist, title] of [[t.artist, t.title], ...aliases]) {
        const song = { artist, title };
        add(exact, name(song), i);
        add(master, mastering(name(song)), i);
        add(family, familyName(song), i);
      }
    });

    cached = { exact, master, family, artistMap };
    catalogIndicesCache.set(catalog, cached);
    return cached;
  }

  function resolveSongs(catalog, songs) {
    const m = buildIndices(catalog);
    const seeds = new Set();
    const known = new Set();
    const unresolved = [];
    const matches = [];
    const ambiguous = new Set();

    for (const song of songs) {
      // An unknown title by a known artist is still an unknown recording.
      // Only exact identities, explicit aliases and remaster labels may resolve.
      const keysToTry = [name(song), mastering(name(song))];

      let ids = new Set();
      for (const k of keysToTry) {
        const match = m.exact.get(k) || m.master.get(k);
        if (match && match.size > 0) {
          ids = match;
          break;
        }
      }

      for (const i of ids) known.add(i);
      const famMatches = m.family.get(familyName(song));
      if (famMatches) {
        for (const i of famMatches) known.add(i);
      }

      let selected = ids.size === 1 ? [...ids][0] : undefined;
      if (ids.size > 1) {
        const fallback = [...ids].filter(i => catalog.tracks[i].id && catalog.tracks[i].id.startsWith('fallback:') && keysToTry.includes(name(catalog.tracks[i])));
        if (fallback.length === 1) selected = fallback[0];
        else ambiguous.add(song);
      }

      if (selected === undefined) {
        unresolved.push(song);
      } else {
        seeds.add(selected);
        matches.push({ input: song, index: selected });
      }
    }

    return {
      seeds: [...seeds].sort((a, b) => a - b),
      known: [...known].sort((a, b) => a - b),
      unresolved: unresolved.filter(u => !matches.some(mMatch => mMatch.input === u)),
      matches
    };
  }

  // Bound inference work for imported libraries. Round-robin artists ensures
  // an artist with many duplicates cannot occupy the entire seed budget.
  const MAX_MODEL_SEEDS = 64;
  function selectSeeds(input, artists) {
    const groups = new Map();
    for (const i of [...new Set(input)].sort((a, b) => a - b)) {
      const artist = artists[i];
      if (!groups.has(artist)) groups.set(artist, []);
      groups.get(artist).push(i);
    }
    const out = [];
    for (let round = 0; out.length < Math.min(MAX_MODEL_SEEDS, input.length); round++) {
      let added = false;
      for (const group of groups.values()) {
        if (round < group.length) { out.push(group[round]); added = true; }
        if (out.length === MAX_MODEL_SEEDS) break;
      }
      if (!added) break;
    }
    return out;
  }

  function neuralScore(d, seeds, i) {
    let maximum = -Infinity, total = 0, coverage = 0, familiar = 0, reference = null;
    const dim = modelDimensions(d);
    for (const s of seeds) {
      let dot = 0;
      for (let j = 0; j < dim; j++) dot += d.vectors[i * dim + j] * d.vectors[s * dim + j];
      if (dot > maximum) { maximum = dot; reference = s; }
      total += dot;
      coverage += d.info[s * 2 + 1];
      if (d.catalog.artists[s] === d.catalog.artists[i]) familiar = 1;
    }
    // Input ordering is the trained model's schema, not hand-tuned boosts.
    const x = [maximum, total / seeds.length, d.info[i * 2], familiar, d.info[i * 2 + 1], coverage / seeds.length];
    let score = d.weights.b2[0];
    for (let h = 0; h < d.weights.b1.length; h++) {
      let value = d.weights.b1[h];
      for (let j = 0; j < x.length; j++) value += x[j] * d.weights.w1[h][j];
      score += Math.max(0, value) * d.weights.w2[0][h];
    }
    return { score, reference, vectorSimilarity: Math.max(-1, Math.min(1, maximum)) };
  }

  const popularityBandsCache = new WeakMap();
  function popularityBands(d) {
    if (!popularityBandsCache.has(d)) {
      const sorted = Array.from({ length: d.catalog.tracks.length }, (_, i) => d.info[i * 2]).sort((a, b) => a - b);
      // The lower, middle and upper thirds of this catalog, not global hit rates.
      popularityBandsCache.set(d, [sorted[Math.floor((sorted.length - 1) / 3)], sorted[Math.floor(2 * (sorted.length - 1) / 3)]]);
    }
    return popularityBandsCache.get(d);
  }

  function recommend(d, input, known = [], options = {}) {
    const n = d.catalog.tracks.length;
    if (!Array.isArray(input) || !input.length || input.length > 2000 || input.some(i => !Number.isInteger(i) || i < 0 || i >= n)) {
      throw new Error('Нужен список из 1–2000 распознанных треков');
    }
    const maxPerArtist = options.maxPerArtist ?? 2;
    const targetCount = options.targetCount ?? 50;
    if (!Number.isInteger(maxPerArtist) || maxPerArtist < 1 || !Number.isInteger(targetCount) || targetCount < 0 || targetCount > 2000) throw new Error('Некорректный размер плейлиста или лимит исполнителя');
    const popFilter = options.popularityFilter || 'all';
    if (!['all', 'underground', 'mid', 'hits'].includes(popFilter)) throw new Error('Неизвестный фильтр популярности');
    const seeds = selectSeeds(input, d.catalog.artists);
    const blocked = new Set([...input, ...known].filter(i => Number.isInteger(i) && i >= 0 && i < n).map(i => d.catalog.families[i]));
    const excluded = new Set(Array.from(options.excludedTracks || [], String));
    // Block alternate versions of explicitly excluded recordings too.
    for (let i = 0; i < n; i++) if (excluded.has(String(d.catalog.tracks[i].id))) blocked.add(d.catalog.families[i]);
    const [lower, upper] = popularityBands(d);
    const rows = [];
    // Score the eligible catalog. Filtering after taking top 50 starved local
    // playlists and silently refilled restrictive filters with unrelated tracks.
    for (let i = 0; i < n; i++) {
      if (blocked.has(d.catalog.families[i]) || options.allowedIndices && !options.allowedIndices.has(i)) continue;
      if (options.requireAudio && !(d.info[i * 2 + 1] > 0)) continue;
      const popularity = d.info[i * 2];
      if (popFilter === 'underground' && popularity > lower || popFilter === 'mid' && (popularity <= lower || popularity > upper) || popFilter === 'hits' && popularity <= upper) continue;
      const evidence = neuralScore(d, seeds, i);
      if (Number.isFinite(evidence.score)) rows.push({ index: i, ...evidence });
    }
    rows.sort((a, b) => b.score - a.score || String(d.catalog.tracks[a.index].id).localeCompare(String(d.catalog.tracks[b.index].id)));
    const used = new Set(), counts = new Map(), out = [];
    let previous;
    while (rows.length && out.length < targetCount) {
      const eligible = r => !used.has(d.catalog.families[r.index]) && (counts.get(d.catalog.artists[r.index]) || 0) < maxPerArtist;
      let position = rows.findIndex(r => eligible(r) && d.catalog.artists[r.index] !== previous);
      if (position < 0) position = rows.findIndex(eligible);
      if (position < 0) break;
      const row = rows.splice(position, 1)[0], artist = d.catalog.artists[row.index];
      out.push(row); used.add(d.catalog.families[row.index]);
      counts.set(artist, (counts.get(artist) || 0) + 1); previous = artist;
    }
    return out;
  }

  // --- MODEL LOADING ---
  function validateModel(d) {
    const { manifest: m, catalog: c, weights: w } = d;
    const n = m.tracks, dim = m.dimensions, k = m.neighbors;
    if (m.schema !== 'joint-browser-v1' || !Number.isInteger(n) || n <= 0 || !Number.isInteger(dim) || dim <= 0 || !Number.isInteger(k) || k <= 0 ||
        c.tracks?.length !== n || c.artists?.length !== n || c.families?.length !== n || d.vectors.length !== n * dim || d.info.length !== n * 2 || d.neighbors.length !== n * k) throw new Error('Несовместимый или неполный каталог рекомендаций');
    if (!c.tracks.every(t => t && t.id != null && typeof t.artist === 'string' && typeof t.title === 'string') || c.artists.some(x => x == null) || c.families.some(x => x == null)) throw new Error('Повреждены идентификаторы каталога');
    if (!d.vectors.every(Number.isFinite) || !d.info.every(Number.isFinite) || d.neighbors.some(i => i < -1 || i >= n)) throw new Error('Повреждены признаки каталога');
    const h = w.b1?.length;
    if (!h || w.w1?.length !== h || w.w2?.length !== 1 || w.w2[0]?.length !== h || w.b2?.length !== 1 ||
        !w.w1.every(row => row.length === 6 && row.every(Number.isFinite)) || ![...w.b1, ...w.b2, ...w.w2[0]].every(Number.isFinite)) throw new Error('Несовместимые веса рекомендателя');
    return d;
  }

  async function loadJointModel(base = '/joint-model') {
    if (loadedModels.has(base)) return loadedModels.get(base);
    if (pendingModels.has(base)) return pendingModels.get(base);
    const promise = (async () => {
      const isNode = typeof window === 'undefined' && !/^https?:/.test(base);
      const read = async file => {
        if (isNode) {
          const fs = require('node:fs/promises'), path = require('node:path');
          const resolved = base === '/joint-model' ? path.join(__dirname, '../joint-model') : path.isAbsolute(base) ? base : path.join(__dirname, '..', base);
          const b = await fs.readFile(path.join(resolved, file));
          return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
        }
        const response = await fetch(`${base}/${file}`);
        if (!response.ok) throw new Error(`Каталог недоступен: ${file} (${response.status})`);
        return response.arrayBuffer();
      };
      const decode = buffer => JSON.parse(new TextDecoder().decode(buffer));
      const m = decode(await read('manifest.json'));
      const files = ['vectors.f32', 'neighbors.i32', 'info.f32', 'catalog.json', 'ranker.json'];
      const buffers = await Promise.all(files.map(async file => {
        const buffer = await read(file);
        if (m.sizes?.[file] != null && m.sizes[file] !== buffer.byteLength) throw new Error(`Неполный файл каталога: ${file}`);
        if (m.sha256?.[file]) {
          const crypto = isNode ? require('node:crypto').webcrypto : globalThis.crypto;
          if (!crypto?.subtle) throw new Error('Недоступна проверка целостности каталога');
          const digest = await crypto.subtle.digest('SHA-256', buffer);
          const hex = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
          if (hex !== m.sha256[file]) throw new Error(`Повреждён файл каталога: ${file}`);
        }
        return buffer;
      }));
      const [v, n, i, c, w] = buffers;
      const data = validateModel({ manifest: m, catalog: decode(c), weights: decode(w), vectors: new Float32Array(v), neighbors: new Int32Array(n), info: new Float32Array(i) });
      loadedModels.set(base, data);
      return data;
    })();
    pendingModels.set(base, promise);
    try { return await promise; }
    finally { pendingModels.delete(base); } // failed loads may be retried
  }

  function localPlaylist(songs, localTracks, options = {}) {
    const Taste = typeof module === 'object' && module.exports ? require('./taste-model') : globalThis.TasteModel;
    const Sound = typeof module === 'object' && module.exports ? require('./audio-profile') : globalThis.AudioProfile;
    if (!Taste || !Sound) throw new Error('Локальный рекомендатель не загружен');
    if (options.popularityFilter && options.popularityFilter !== 'all') throw new Error('Фильтр популярности каталога недоступен для локального подбора. Выберите «Все треки».');
    const catalog = { tracks: localTracks, artists: localTracks.map(t => Taste.artistIdentity(t) || String(t.id)), families: localTracks.map(t => familyName(t)) };
    const profile = resolveSongs(catalog, songs);
    if (!profile.seeds.length) throw new Error('Опорные треки не найдены в библиотеке. Укажите точного исполнителя и название.');
    const excluded = new Set(Array.from(options.excludedTracks || [], String));
    const identity = t => Taste.artistIdentity(t) ? familyName(t) : `id:${t.id}`;
    const activeSeeds = profile.seeds.filter(i => !excluded.has(String(localTracks[i].id)));
    if (!activeSeeds.length) throw new Error('Опорные треки исключены из рекомендаций');
    const blocked = new Set(profile.known.map(i => identity(localTracks[i])));
    const model = new Taste(localTracks, options.plays || [], options.now ?? Date.now(), options.audioProfiles || {}, { excludedTracks: excluded });
    const candidates = localTracks.filter(t => !excluded.has(String(t.id)) && !blocked.has(identity(t)) && (!options.requireAudio || Sound.texture(model.sound(t))));
    // Separate seed neighbourhoods preserve multiple tastes in an imported list.
    const lists = selectSeeds(activeSeeds, catalog.artists).map(i => {
      const seed = localTracks[i];
      return candidates.map(track => ({ track, seed, ...model.score(seed, track, options.bpmCache || {}, { explicitReference: true }) })).sort((a, b) => b.score - a.score || String(a.track.id).localeCompare(String(b.track.id)));
    });
    const maxPerArtist = options.maxPerArtist ?? 2, target = options.targetCount ?? 50;
    if (!Number.isInteger(maxPerArtist) || maxPerArtist < 1 || !Number.isInteger(target) || target < 0 || target > 2000) throw new Error('Некорректный размер плейлиста или лимит исполнителя');
    const used = new Set(), counts = new Map(), tracks = [];
    while (tracks.length < target) {
      let added = false;
      for (const list of lists) {
        let row;
        while (list.length) {
          const candidate = list.shift(), t = candidate.track, artist = Taste.artistIdentity(t) || String(t.id);
          if (used.has(identity(t)) || (counts.get(artist) || 0) >= maxPerArtist) continue;
          row = candidate; counts.set(artist, (counts.get(artist) || 0) + 1); break;
        }
        if (!row) continue;
        const t = row.track;
        used.add(identity(t)); added = true;
        tracks.push({ rank: tracks.length + 1, id: t.id, artist: t.artist, title: t.title, score: row.score, matchPercent: null,
          hasAudioFeatures: !!Sound.texture(model.sound(t)), referenceTitle: row.explanation?.referenceTitle || null, reasons: row.reasons,
          matchedLocalTrack: t, isLocal: true, source: 'local' });
        if (tracks.length === target) break;
      }
      if (!added) break;
    }
    return { total: tracks.length, tracks, seedsMatched: profile.matches.length, seedsTotal: songs.length, localAvailableCount: tracks.length, source: 'local', catalogSize: localTracks.length };
  }

  async function generateJointPlaylist(songs, localTracks = [], base = '/joint-model', options = {}) {
    if (!Array.isArray(songs) || !songs.length || songs.length > 2000) throw new Error('Нужен список из 1–2000 опорных треков');
    if (options.localOnly) return localPlaylist(songs, localTracks, options);
    let data;
    try { data = await loadJointModel(base); }
    catch (error) {
      // The installed app remains useful without the optional catalog, while
      // explicitly reporting which source was actually used.
      const result = localPlaylist(songs, localTracks, options);
      return { ...result, notice: 'catalog-unavailable' };
    }
    const profile = resolveSongs(data.catalog, songs);
    if (!profile.seeds.length) return { ...localPlaylist(songs, localTracks, options), notice: 'seeds-outside-catalog' };
    const localCatalog = { tracks: localTracks };
    const localMatches = new Map();
    const excluded = new Set(Array.from(options.excludedTracks || [], String));
    const blocked = [...profile.known];
    // Match identities and aliases before selection; reversed artist/title and
    // ambiguous duplicate names must not play an unrelated local recording.
    for (let i = 0; i < data.catalog.tracks.length; i++) {
      const resolved = resolveSongs(localCatalog, [data.catalog.tracks[i]]);
      if (resolved.seeds.length === 1) localMatches.set(i, localTracks[resolved.seeds[0]]);
      if (resolved.known.some(j => excluded.has(String(localTracks[j].id)))) blocked.push(i);
    }
    const recs = recommend(data, profile.seeds, blocked, { ...options, excludedTracks: excluded });
    const tracks = recs.map(({ index, score, reference }, rank) => {
      const t = data.catalog.tracks[index], matchedLocal = localMatches.get(index) || null;
      return { rank: rank + 1, id: t.id, artist: t.artist, title: t.title, score, matchPercent: null,
        hasAudioFeatures: data.info[index * 2 + 1] > 0, referenceTitle: data.catalog.tracks[reference]?.title || null,
        matchedLocalTrack: matchedLocal, isLocal: !!matchedLocal, source: 'catalog' };
    });
    return { total: tracks.length, seedsMatched: profile.matches.length, seedsTotal: songs.length, tracks,
      localAvailableCount: tracks.filter(t => t.isLocal).length, source: 'catalog', catalogSize: data.catalog.tracks.length,
      modelStatus: data.manifest.status };
  }

  return { loadJointModel, generateJointPlaylist, resolveSongs, recommend, parseFileContent, validateModel,
    isLoaded: () => loadedModels.size > 0 };
});
