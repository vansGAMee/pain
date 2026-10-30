'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), { createHash } = require('node:crypto');
const matching = require('./cover-matching');
const normalize = s => String(s || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const musicRegex = /music|singer|rapper|band|song|album|composer|musician|групп|музык|пев|рэп|альбом|песн|композитор|исполнител/i;

function cleanBio(text) {
  if (!text) return '';
  return String(text).split('\n')
    .map(p => p.trim())
    .filter(p => p.length > 40 && !/^(см\.|see also|примечания|ссылки)/i.test(p))
    .slice(0, 4)
    .join('\n\n');
}

function extractStories(fullText) {
  if (!fullText) return [];
  const parts = String(fullText).split(/^={2,}\s*(.*?)\s*={2,}\s*$/m), result = [];
  for (let i = 1; i < parts.length - 1; i += 2) {
    const heading = parts[i].trim();
    if (!/history|career|background|formation|early|style|истори|карьер|создан|начал|стиль|направление/i.test(heading)) continue;
    if (/discography|members|awards|tours|дискограф|состав|наград|тур/i.test(heading)) continue;
    const paras = parts[i + 1].split('\n').map(s => s.trim()).filter(s => s.length > 80);
    if (!paras.length) continue;
    let text = paras.slice(0, 2).join('\n\n');
    if (text.length > 800) text = text.slice(0, 800) + '…';
    result.push({ heading, text });
    if (result.length >= 2) break;
  }
  return result;
}

module.exports = function createArtistInfoService(dir, { fetcher = fetch, genres, getTracks = () => [] } = {}) {
  const pending = new Map();
  const request = require('./source-fetch')({ fetcher });

  async function fetchWikipedia(artistName, lang, signal) {
    const query = matching.primary(artistName) || artistName;
    const primaryLang = /\p{Script=Cyrillic}/u.test(query) ? 'ru' : lang;

    async function queryWiki(l) {
      const params = new URLSearchParams({
        action: 'query', format: 'json', formatversion: '2', generator: 'search',
        gsrsearch: `${query} musician OR band OR singer`, gsrlimit: '3',
        prop: 'extracts|pageimages|info', piprop: 'thumbnail', pithumbsize: '600',
        exintro: '1', explaintext: '1', exchars: '1200', inprop: 'url'
      });
      const res = await request(`https://${l}.wikipedia.org/w/api.php?${params}`, {
        headers: { 'User-Agent': 'PAIN/1.8.9 (https://github.com/vansGAMee/pain)' },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(6000)]) : AbortSignal.timeout(6000)
      });
      if (!res.ok) throw new Error('Wiki ' + res.status);
      const data = await res.json();
      const pages = data.query?.pages || [];
      const normQ = normalize(query);
      const page = pages.find(p => {
        const normTitle = normalize(p.title.replace(/\s*\([^)]*\)\s*$/, ''));
        return (normTitle === normQ || normTitle.includes(normQ) || normQ.includes(normTitle)) && p.extract && musicRegex.test(p.extract);
      }) || pages.find(p => p.extract && musicRegex.test(p.extract));

      if (!page) return null;
      let stories = [];
      if (page.pageid) {
        try {
          const fullParams = new URLSearchParams({
            action: 'query', format: 'json', formatversion: '2', pageids: String(page.pageid),
            prop: 'extracts', explaintext: '1'
          });
          const fullRes = await request(`https://${l}.wikipedia.org/w/api.php?${fullParams}`, {
            headers: { 'User-Agent': 'PAIN/1.8.9 (https://github.com/vansGAMee/pain)' },
            signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(6000)]) : AbortSignal.timeout(6000)
          });
          if (fullRes.ok) {
            const fullData = await fullRes.json();
            stories = extractStories(fullData.query?.pages?.[0]?.extract);
          }
        } catch (_) {}
      }
      return {
        title: page.title,
        bio: cleanBio(page.extract),
        url: page.fullurl,
        thumbnail: page.thumbnail?.source || null,
        stories,
        lang: l
      };
    }

    let result = null;
    try {
      result = await queryWiki(primaryLang);
    } catch (_) {}
    if (!result && primaryLang !== (primaryLang === 'ru' ? 'en' : 'ru')) {
      try {
        result = await queryWiki(primaryLang === 'ru' ? 'en' : 'ru');
      } catch (_) {}
    }
    return result;
  }

  async function fetchDeezer(artistName, signal) {
    const query = matching.primary(artistName) || artistName;
    try {
      const res = await request('https://api.deezer.com/search/artist?' + new URLSearchParams({ q: query, limit: '5' }), {
        headers: { 'User-Agent': 'PAIN/1.8.9 (local music player)' },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000)
      });
      if (!res.ok) return null;
      const data = await res.json();
      const artists = data.data || [];
      const normQ = normalize(query);
      const matched = artists.find(a => normalize(a.name) === normQ) || artists[0];
      if (!matched) return null;

      let related = [];
      try {
        const relRes = await request(`https://api.deezer.com/artist/${matched.id}/related?limit=6`, {
          headers: { 'User-Agent': 'PAIN/1.8.9 (local music player)' },
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(4000)]) : AbortSignal.timeout(4000)
        });
        if (relRes.ok) {
          const relData = await relRes.json();
          related = (relData.data || []).map(a => ({ name: a.name, picture: a.picture_medium || a.picture_small || null }));
        }
      } catch (_) {}

      return {
        name: matched.name,
        picture: matched.picture_big || matched.picture_medium || null,
        related
      };
    } catch (_) {
      return null;
    }
  }

  function getLibraryArtistContext(artistName) {
    const normTarget = normalize(artistName);
    const allTracks = getTracks();
    const artistTracks = allTracks.filter(t => {
      if (!t.artist) return false;
      const tNorm = normalize(t.artist);
      if (tNorm === normTarget) return true;
      const parts = matching.artists(t.artist);
      return parts.some(p => normalize(p) === normTarget);
    });

    const genreSet = new Set();
    for (const t of artistTracks) {
      if (genres) {
        const entry = genres.entry(t);
        for (const g of (entry?.names || [])) genreSet.add(g);
      }
      if (t.genre) {
        for (const g of String(t.genre).split(/[/,;]/)) {
          const clean = g.trim();
          if (clean && clean.length > 2) genreSet.add(clean);
        }
      }
    }

    const libraryGenres = [...genreSet].slice(0, 6);

    let similarInLibrary = [];
    if (libraryGenres.length > 0) {
      const otherArtists = new Map();
      for (const t of allTracks) {
        if (!t.artist || normalize(t.artist) === normTarget) continue;
        const main = matching.primary(t.artist) || t.artist;
        if (normalize(main) === normTarget) continue;
        let matchCount = 0;
        if (genres) {
          const entry = genres.entry(t);
          for (const g of (entry?.names || [])) if (genreSet.has(g)) matchCount++;
        }
        if (t.genre && String(t.genre).split(/[/,;]/).some(g => genreSet.has(g.trim()))) matchCount++;
        if (matchCount > 0) {
          otherArtists.set(main, (otherArtists.get(main) || 0) + matchCount);
        }
      }
      similarInLibrary = [...otherArtists.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name]) => name);
    }

    return {
      tracksCount: artistTracks.length,
      genres: libraryGenres,
      similarInLibrary
    };
  }

  async function lookup(artistName, lang = 'ru', { online = true, signal } = {}) {
    const clean = String(artistName || '').trim();
    if (matching.unknown(clean)) {
      return {
        artist: clean || 'Unknown Artist',
        offline: true,
        avatar: null,
        bio: null,
        stories: [],
        genres: [],
        similar: [],
        url: null
      };
    }

    const libContext = getLibraryArtistContext(clean);
    if (!online) {
      return {
        artist: clean,
        offline: true,
        avatar: null,
        bio: null,
        stories: [],
        genres: libContext.genres,
        similar: libContext.similarInLibrary.map(name => ({ name, picture: null })),
        url: null
      };
    }

    const key = createHash('sha256').update(JSON.stringify([clean, lang])).digest('hex');
    const cacheFile = path.join(dir, 'artist-info', key + '.json');

    if (pending.has(key)) return pending.get(key);

    const job = (async () => {
      let cached;
      try {
        cached = JSON.parse(await fs.readFile(cacheFile, 'utf8'));
        if (Date.now() - (cached.at || 0) < 14 * 86400000 && cached.value) {
          return { ...cached.value, ...libContext, cached: true };
        }
      } catch (_) {}

      try {
        const [wiki, deezer] = await Promise.allSettled([
          fetchWikipedia(clean, lang, signal),
          fetchDeezer(clean, signal)
        ]);

        const wikiData = wiki.status === 'fulfilled' ? wiki.value : null;
        const deezerData = deezer.status === 'fulfilled' ? deezer.value : null;

        const avatar = deezerData?.picture || wikiData?.thumbnail || null;
        const bio = wikiData?.bio || null;
        const stories = wikiData?.stories || [];
        const url = wikiData?.url || null;

        const similarMap = new Map();
        for (const item of (deezerData?.related || [])) {
          if (normalize(item.name) !== normalize(clean)) {
            similarMap.set(normalize(item.name), item);
          }
        }
        for (const name of libContext.similarInLibrary) {
          const n = normalize(name);
          if (!similarMap.has(n)) {
            similarMap.set(n, { name, picture: null });
          }
        }
        const similar = [...similarMap.values()].slice(0, 8);

        const value = {
          artist: clean,
          avatar,
          bio,
          stories,
          genres: libContext.genres,
          similar,
          url,
          offline: !wikiData && !deezerData
        };

        await fs.mkdir(path.dirname(cacheFile), { recursive: true });
        await fs.writeFile(cacheFile, JSON.stringify({ at: Date.now(), value })).catch(() => {});
        return { ...value, ...libContext };
      } catch (error) {
        if (cached?.value) return { ...cached.value, ...libContext, offline: true };
        return {
          artist: clean,
          offline: true,
          avatar: null,
          bio: null,
          stories: [],
          genres: libContext.genres,
          similar: libContext.similarInLibrary.map(name => ({ name, picture: null })),
          url: null
        };
      }
    })().finally(() => pending.delete(key));

    pending.set(key, job);
    return job;
  }

  return { lookup, getLibraryArtistContext };
};
