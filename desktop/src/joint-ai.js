/**
 * Pain Audio — Joint AI Engine (CLAP Sound + ListenBrainz/KEXP Graph)
 * Ported from musicmylove/src/lib/joint runtime.
 * Pure in-browser neural inference: 56,875 tracks, 32D fused vectors, 24 neighbors, neural MLP.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.JointAI = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DIM = 32;
  const K = 24;

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

  let loadedJointData = null;
  let loadingPromise = null;

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
      const keysToTry = [
        name(song),
        mastering(name(song)),
        name({ artist: song.artist, title: cleanTitle(song.title) }),
        mastering(name({ artist: song.artist, title: cleanTitle(song.title) }))
      ];

      const rawArtists = (song.artist || '').split(/[,&/]|(?:\s+(?:feat\.?|ft\.?|vs\.?|with)\s+)/i).map(a => a.trim()).filter(Boolean);
      if (rawArtists.length > 1) {
        for (const a of rawArtists) {
          keysToTry.push(name({ artist: a, title: song.title }));
          keysToTry.push(mastering(name({ artist: a, title: song.title })));
          keysToTry.push(name({ artist: a, title: cleanTitle(song.title) }));
          keysToTry.push(mastering(name({ artist: a, title: cleanTitle(song.title) })));
        }
      }

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

    if (!seeds.size) {
      for (const song of songs) {
        if (ambiguous.has(song)) continue;
        const rawArtists = [song.artist, ...(song.artist || '').split(/[,&/]|(?:\s+(?:feat\.?|ft\.?|vs\.?|with)\s+)/i).map(a => a.trim()).filter(Boolean)];
        for (const a of rawArtists) {
          const artistTrackIdxs = m.artistMap.get(normalize(a));
          if (artistTrackIdxs && artistTrackIdxs.length > 0) {
            const chosenIdx = artistTrackIdxs[0];
            seeds.add(chosenIdx);
            known.add(chosenIdx);
            matches.push({ input: song, index: chosenIdx });
            break;
          }
        }
      }
    }

    return {
      seeds: [...seeds].sort((a, b) => a - b),
      known: [...known].sort((a, b) => a - b),
      unresolved: unresolved.filter(u => !matches.some(mMatch => mMatch.input === u)),
      matches
    };
  }

  function selectSeeds(input, artists) {
    const keyFn = (i) => Math.imul(i + 1, 2654435761) >>> 0;
    const groups = new Map();
    const uniqueInputs = [...new Set(input)].sort((a, b) => keyFn(a) - keyFn(b));

    for (const i of uniqueInputs) {
      const art = artists[i];
      let group = groups.get(art);
      if (!group) { group = []; groups.set(art, group); }
      group.push(i);
    }

    const queues = [...groups.values()].sort((a, b) => keyFn(a[0]) - keyFn(b[0]));
    const out = [];
    const maxLen = Math.max(0, ...queues.map(q => q.length));

    for (let p = 0; p < maxLen; p++) {
      for (const q of queues) {
        if (p < q.length) out.push(q[p]);
        if (out.length === 64) return out;
      }
    }
    return out;
  }

  function candidateIds(d, input) {
    const blocked = new Set(input.map(i => d.catalog.families[i]));
    const ids = new Set();
    const selected = selectSeeds(input, d.catalog.artists);

    // 1. Direct 1st-hop graph neighbors
    for (const s of selected) {
      for (let k = 0; k < K; k++) {
        const i = d.neighbors[s * K + k];
        if (i >= 0 && !blocked.has(d.catalog.families[i])) {
          ids.add(i);
        }
      }
    }

    let distinctArtists = new Set([...ids].map(i => d.catalog.artists[i])).size;

    // 2. 2nd-hop graph expansion if candidate pool lacks artist variety (< 60)
    if (distinctArtists < 60 || ids.size < 150) {
      const hop1 = [...ids];
      for (const h of hop1) {
        for (let k = 0; k < K; k++) {
          const i = d.neighbors[h * K + k];
          if (i >= 0 && !blocked.has(d.catalog.families[i])) {
            ids.add(i);
          }
          if (ids.size >= 800) break;
        }
        if (ids.size >= 800) break;
      }
      distinctArtists = new Set([...ids].map(i => d.catalog.artists[i])).size;
    }

    // 3. Vector acoustic similarity KNN (CLAP 512D) across 56k catalog
    // Ensures small seed sets (e.g. 1-3 indie tracks) ALWAYS find hundreds of acoustic matches!
    if (distinctArtists < 75 || ids.size < 300) {
      const n = d.catalog.tracks.length;
      const scores = [];
      for (let i = 0; i < n; i++) {
        if (blocked.has(d.catalog.families[i]) || ids.has(i)) continue;
        let maxDot = -Infinity;
        for (const s of selected) {
          let dot = 0;
          for (let j = 0; j < DIM; j++) {
            dot += d.vectors[i * DIM + j] * d.vectors[s * DIM + j];
          }
          if (dot > maxDot) maxDot = dot;
        }
        scores.push({ i, dot: maxDot });
      }
      scores.sort((a, b) => b.dot - a.dot);
      const needed = Math.max(250, 450 - ids.size);
      for (let k = 0; k < Math.min(needed, scores.length); k++) {
        ids.add(scores[k].i);
      }
    }

    return [...ids].sort((a, b) => a - b);
  }

  function neuralScore(d, seeds, i) {
    let maximum = -Infinity;
    let total = 0;
    let coverage = 0;
    let familiar = 0;

    for (const s of seeds) {
      let dot = 0;
      for (let j = 0; j < DIM; j++) {
        dot += d.vectors[i * DIM + j] * d.vectors[s * DIM + j];
      }
      maximum = Math.max(maximum, dot);
      total += dot;
      coverage += d.info[s * 2 + 1];
      if (d.catalog.artists[s] === d.catalog.artists[i]) {
        familiar = 1;
      }
    }

    const x = [
      maximum,
      total / seeds.length,
      d.info[i * 2],
      familiar,
      d.info[i * 2 + 1],
      coverage / seeds.length
    ];

    let value = d.weights.b2[0];
    for (let h = 0; h < 16; h++) {
      let v = d.weights.b1[h];
      for (let j = 0; j < 6; j++) {
        v += x[j] * d.weights.w1[h][j];
      }
      value += Math.max(0, v) * d.weights.w2[0][h];
    }
    return value;
  }

  // --- SLATE GENERATION WITH GUARANTEED 50 TRACKS & FILTERS ---
  function recommend(d, input, known = [], options = {}) {
    const n = d.catalog.tracks.length;
    if (!input.length || input.length > 2000) {
      throw new Error('Нужен список из 1-2000 треков');
    }

    const maxPerArtist = options.maxPerArtist ? Math.max(1, Math.min(5, options.maxPerArtist)) : 2;
    const targetCount = options.targetCount || 50;
    const popFilter = options.popularityFilter || 'all'; // 'all' | 'underground' | 'mid' | 'hits'
    const audioOnly = !!options.requireAudio;

    const seeds = selectSeeds(input, d.catalog.artists);
    const blocked = new Set([...input, ...known].map(i => d.catalog.families[i]));

    let candidateList = candidateIds(d, input).filter(i => !blocked.has(d.catalog.families[i]));

    // Filter candidate list by audio / popularity, preserving fallback pool
    let filteredCandidates = candidateList;
    if (audioOnly) {
      const withAudio = filteredCandidates.filter(i => d.info[i * 2 + 1] > 0);
      if (withAudio.length >= targetCount) filteredCandidates = withAudio;
    }

    if (popFilter === 'underground') {
      const ug = filteredCandidates.filter(i => (d.info[i * 2] || 0) <= 0.45);
      if (ug.length >= targetCount) filteredCandidates = ug;
    } else if (popFilter === 'mid') {
      const mid = filteredCandidates.filter(i => (d.info[i * 2] || 0) <= 0.75);
      if (mid.length >= targetCount) filteredCandidates = mid;
    } else if (popFilter === 'hits') {
      const hits = filteredCandidates.filter(i => (d.info[i * 2] || 0) >= 0.45);
      if (hits.length >= targetCount) filteredCandidates = hits;
    }

    // Score candidates with MLP + boost for selected popularity profile
    let rows = filteredCandidates.map(index => {
      let score = neuralScore(d, seeds, index);
      const pop = d.info[index * 2] || 0;
      if (popFilter === 'underground') {
        score += (1.0 - pop) * 0.75; // reward obscure gems
      } else if (popFilter === 'hits') {
        score += pop * 0.5; // reward recognizable hits
      }
      return { index, score };
    });

    rows.sort((a, b) => b.score - a.score || (d.catalog.tracks[a.index].id < d.catalog.tracks[b.index].id ? -1 : 1));

    const used = new Set();
    const counts = new Map();
    const out = [];
    let previous = -1;
    let candidatePool = [...rows];

    // Pass 1: Strict diversity (<= maxPerArtist, non-consecutive artist)
    while (candidatePool.length && out.length < targetCount) {
      const pos = candidatePool.findIndex(r =>
        !used.has(d.catalog.families[r.index]) &&
        (counts.get(d.catalog.artists[r.index]) || 0) < maxPerArtist &&
        d.catalog.artists[r.index] !== previous
      );
      if (pos < 0) break;
      const row = candidatePool.splice(pos, 1)[0];
      const artist = d.catalog.artists[row.index];
      out.push(row);
      used.add(d.catalog.families[row.index]);
      counts.set(artist, (counts.get(artist) || 0) + 1);
      previous = artist;
    }

    // Pass 2: Relax consecutive artist alternation if under targetCount
    if (out.length < targetCount) {
      while (candidatePool.length && out.length < targetCount) {
        const pos = candidatePool.findIndex(r =>
          !used.has(d.catalog.families[r.index]) &&
          (counts.get(d.catalog.artists[r.index]) || 0) < maxPerArtist
        );
        if (pos < 0) break;
        const row = candidatePool.splice(pos, 1)[0];
        const artist = d.catalog.artists[row.index];
        out.push(row);
        used.add(d.catalog.families[row.index]);
        counts.set(artist, (counts.get(artist) || 0) + 1);
      }
    }

    // Pass 3: Increment artist limit if still under targetCount
    if (out.length < targetCount) {
      while (candidatePool.length && out.length < targetCount) {
        const pos = candidatePool.findIndex(r =>
          !used.has(d.catalog.families[r.index]) &&
          (counts.get(d.catalog.artists[r.index]) || 0) < maxPerArtist + 2
        );
        if (pos < 0) break;
        const row = candidatePool.splice(pos, 1)[0];
        const artist = d.catalog.artists[row.index];
        out.push(row);
        used.add(d.catalog.families[row.index]);
        counts.set(artist, (counts.get(artist) || 0) + 1);
      }
    }

    // Pass 4: Fallback from remaining rows ensuring EXACTLY targetCount
    if (out.length < targetCount) {
      for (const r of rows) {
        if (!used.has(d.catalog.families[r.index])) {
          out.push(r);
          used.add(d.catalog.families[r.index]);
          if (out.length === targetCount) break;
        }
      }
    }

    return out;
  }

  // --- MODEL LOADING ---
  async function loadJointModel(base = '/joint-model') {
    if (loadedJointData) return loadedJointData;
    if (loadingPromise) return loadingPromise;

    loadingPromise = (async () => {
      let m;
      const isNode = typeof window === 'undefined' && !base.startsWith('http://') && !base.startsWith('https://');

      if (isNode) {
        const fs = require('fs/promises');
        const path = require('path');
        const resolvedBase = path.isAbsolute(base) ? base : path.join(__dirname, '..', base.replace(/^\//, ''));
        m = JSON.parse(await fs.readFile(path.join(resolvedBase, 'manifest.json'), 'utf8'));
      } else {
        const resp = await fetch(`${base}/manifest.json`);
        if (!resp.ok) throw new Error('Не найден манифест Joint Model (/joint-model/manifest.json)');
        m = await resp.json();
      }

      async function fetchBuffer(file) {
        if (isNode) {
          const fs = require('fs/promises');
          const path = require('path');
          const resolvedBase = path.isAbsolute(base) ? base : path.join(__dirname, '..', base.replace(/^\//, ''));
          const buf = await fs.readFile(path.join(resolvedBase, file));
          return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        }
        const r = await fetch(`${base}/${file}`);
        if (!r.ok) throw new Error(`Ошибка загрузки ${file}`);
        return await r.arrayBuffer();
      }

      const [vBuf, nBuf, iBuf, catBuf, rankBuf] = await Promise.all([
        fetchBuffer('vectors.f32'),
        fetchBuffer('neighbors.i32'),
        fetchBuffer('info.f32'),
        fetchBuffer('catalog.json'),
        fetchBuffer('ranker.json')
      ]);

      const textDecoder = new TextDecoder('utf-8');
      const catalog = JSON.parse(textDecoder.decode(catBuf));
      const weights = JSON.parse(textDecoder.decode(rankBuf));

      loadedJointData = {
        manifest: m,
        catalog,
        weights,
        vectors: new Float32Array(vBuf),
        neighbors: new Int32Array(nBuf),
        info: new Float32Array(iBuf)
      };

      return loadedJointData;
    })();

    return loadingPromise;
  }

  // --- END-TO-END PLAYLIST SYNTHESIS ---
  async function generateJointPlaylist(songs, localTracks = [], base = '/joint-model', options = {}) {
    const data = await loadJointModel(base);
    if (!songs || !songs.length) throw new Error('Список сидов пуст');

    const profile = resolveSongs(data.catalog, songs);
    if (!profile.seeds.length) {
      throw new Error(`Не удалось сопоставить треки с базой из 56 875 композиций. Попробуйте другие песни.`);
    }

    const recs = recommend(data, profile.seeds, profile.known, options);

    // Build index of local tracks for matching
    const localMap = new Map();
    for (const lt of localTracks) {
      const k = normalize(`${lt.artist || ''} - ${lt.title || ''}`);
      localMap.set(k, lt);
      const kAlt = normalize(`${lt.title || ''} - ${lt.artist || ''}`);
      localMap.set(kAlt, lt);
    }

    // Normalized match score bounded nicely between 74% and 99%
    const scores = recs.map(r => r.score);
    const maxScore = Math.max(...scores);
    const minScore = Math.min(...scores);
    const span = Math.max(0.001, maxScore - minScore);

    let tracks = recs.map(({ index, score }, rank) => {
      const t = data.catalog.tracks[index];
      const normKey = normalize(`${t.artist} - ${t.title}`);
      const matchedLocal = localMap.get(normKey) || null;
      const matchPercent = Math.max(72, Math.min(99, Math.round(99 - ((maxScore - score) / span) * 25)));

      return {
        rank: rank + 1,
        id: t.id,
        artist: t.artist,
        title: t.title,
        score: Math.round(score * 100) / 100,
        matchPercent,
        hasAudioFeatures: data.info[index * 2 + 1] > 0,
        popularity: Math.round((data.info[index * 2] || 0) * 100),
        matchedLocalTrack: matchedLocal,
        isLocal: !!matchedLocal
      };
    });

    if (options.excludedTracks) {
      const excluded = options.excludedTracks instanceof Set ? options.excludedTracks : new Set(Array.from(options.excludedTracks).map(String));
      tracks = tracks.filter(t => !excluded.has(String(t.id)) && !(t.matchedLocalTrack && excluded.has(String(t.matchedLocalTrack.id))));
      tracks.forEach((t, i) => { t.rank = i + 1; });
    }

    if (options.localOnly) {
      tracks = tracks.filter(t => t.isLocal);
      tracks.forEach((t, i) => { t.rank = i + 1; });
    }

    return {
      total: tracks.length,
      seedsMatched: profile.matches.length,
      seedsTotal: songs.length,
      tracks,
      localAvailableCount: tracks.filter(t => t.isLocal).length
    };
  }

  return {
    loadJointModel,
    generateJointPlaylist,
    resolveSongs,
    recommend,
    parseFileContent,
    isLoaded: () => !!loadedJointData
  };
});

