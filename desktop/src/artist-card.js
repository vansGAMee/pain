// Artist Card component: interactive modal for exploring artist biography,
// avatar, related artists, and library discography.
(function() {
  'use strict';

  const escapeHtml = str => String(str || '').replace(/[&<>'"]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[c] || c));

  const norm = s => String(s || '').normalize('NFKC').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]/gu, '');
  const splitArtists = s => [...new Set(String(s || '').split(/\s+(?:feat\.?|ft\.?|featuring)\s+|\s*[;,]\s*|\s+&\s+/i).map(x => x.trim()).filter(Boolean))];
  const primaryArtist = s => splitArtists(s)[0] || String(s || '').trim();

  function formatTime(seconds) {
    if (!seconds || isNaN(seconds) || !isFinite(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  let backdrop = null;
  let card = null;
  let abortController = null;
  let currentArtist = null;

  function isRu() {
    try {
      return typeof localStorage !== 'undefined' ? localStorage.getItem('pain_lang') !== 'en' : true;
    } catch (_) {
      return true;
    }
  }

  function isOnlineEnabled() {
    try {
      return typeof localStorage !== 'undefined' ? localStorage.getItem('pain_online_artist_info') !== 'false' : true;
    } catch (_) {
      return true;
    }
  }

  function ensureModal() {
    if (backdrop) return;

    backdrop = document.createElement('div');
    backdrop.id = 'artistCardBackdrop';
    backdrop.className = 'modal-backdrop';
    backdrop.style.display = 'none';
    backdrop.setAttribute('aria-hidden', 'true');

    card = document.createElement('div');
    card.id = 'artistModalCard';
    card.className = 'artist-modal-card modal-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');

    const onlineSwitch = document.getElementById('onlineArtistInfoSwitch');
    if (onlineSwitch && !onlineSwitch.dataset.bound) {
      onlineSwitch.dataset.bound = 'true';
      onlineSwitch.checked = isOnlineEnabled();
      onlineSwitch.addEventListener('change', () => {
        try {
          localStorage.setItem('pain_online_artist_info', String(onlineSwitch.checked));
        } catch (_) {}
      });
    }

    backdrop.appendChild(card);
    document.body.appendChild(backdrop);

    backdrop.addEventListener('click', e => {
      if (e.target === backdrop) close();
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && backdrop && backdrop.style.display !== 'none') {
        close();
      }
    });
  }

  function close() {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    if (backdrop) {
      backdrop.style.display = 'none';
      backdrop.setAttribute('aria-hidden', 'true');
    }
    currentArtist = null;
  }

  function getArtistTracks(artistName, tracksList) {
    const allTracks = tracksList || (typeof window !== 'undefined' ? (window.PainPlayer?.getTracks?.() || window.state?.tracks || []) : []);
    const targetNorm = norm(artistName);
    const primaryNorm = norm(primaryArtist(artistName));

    return allTracks.filter(t => {
      if (!t.artist) return false;
      const tNorm = norm(t.artist);
      if (tNorm === targetNorm || tNorm === primaryNorm) return true;
      const parts = splitArtists(t.artist);
      return parts.some(p => {
        const pNorm = norm(p);
        return pNorm === targetNorm || pNorm === primaryNorm;
      });
    });
  }

  function renderSkeleton(artistName, artistTracks) {
    const ru = isRu();
    const initial = (primaryArtist(artistName).charAt(0) || '?').toUpperCase();
    const tracksCountText = ru
      ? `${artistTracks.length} ${pluralizeRu(artistTracks.length, 'трек', 'трека', 'треков')} в фонотеке`
      : `${artistTracks.length} track${artistTracks.length === 1 ? '' : 's'} in library`;

    const online = isOnlineEnabled();

    card.innerHTML = `
      <div class="artist-modal-hero">
        <div class="artist-avatar-wrap">
          <div class="artist-avatar-fallback" id="artistAvatarFallback">${escapeHtml(initial)}</div>
          <img class="artist-avatar-img" id="artistAvatarImg" src="" alt="" style="display: none;">
        </div>
        <div class="artist-hero-info">
          <div class="artist-hero-name">${escapeHtml(artistName)}</div>
          <div class="artist-hero-meta">
            <span>${escapeHtml(tracksCountText)}</span>
          </div>
          <div class="artist-genres-row" id="artistGenresRow"></div>
        </div>
        <button type="button" class="artist-modal-close" id="artistModalCloseBtn" title="${ru ? 'Закрыть' : 'Close'}" aria-label="${ru ? 'Закрыть' : 'Close'}">✕</button>
      </div>
      <div class="artist-modal-body">
        <section id="artistBioSection" ${!online ? 'style="display:none;"' : ''}>
          <div class="artist-section-title">${ru ? 'История и стиль' : 'About & History'}</div>
          <div class="artist-bio-text" id="artistBioText" style="color: var(--ink-muted);">${online ? (ru ? 'Загрузка сведений…' : 'Loading details…') : ''}</div>
          <div id="artistStoriesWrap"></div>
          <div id="artistWikiLinkWrap"></div>
        </section>

        <section id="artistSimilarSection" style="display: none;">
          <div class="artist-section-title">${ru ? 'На что похоже' : 'Similar & Influences'}</div>
          <div class="artist-similar-wrap" id="artistSimilarWrap"></div>
        </section>

        <section id="artistTracksSection">
          <div class="artist-section-title">
            <span>${ru ? 'Треки в вашей фонотеке' : 'Tracks in your library'}</span>
            <span class="artist-section-count">${artistTracks.length}</span>
          </div>
          <div class="artist-tracks-list" id="artistTracksList">
            ${renderTracksListHtml(artistTracks)}
          </div>
        </section>
      </div>
    `;

    document.getElementById('artistModalCloseBtn')?.addEventListener('click', close);
    bindTracksListEvents(artistTracks, artistName);
  }

  function renderTracksListHtml(tracks) {
    if (!tracks.length) {
      const ru = isRu();
      return `<div style="padding: 16px; color: var(--ink-muted); font-size: 13px; text-align: center;">${ru ? 'В фонотеке пока нет треков этого артиста' : 'No tracks by this artist in library'}</div>`;
    }

    return tracks.map((track, idx) => {
      const coverUrl = `/api/cover/${encodeURIComponent(track.id)}?online=${localStorage.getItem('pain_online_covers') === 'true' ? 1 : 0}`;
      const durationSec = Math.max(0, Number(track.duration) || 0) / 1000;
      const plays = (typeof window.getTrackPlayCount === 'function') ? window.getTrackPlayCount(track.id) : (track.plays || 0);

      return `
        <div class="artist-track-item" data-track-id="${escapeHtml(track.id)}" data-index="${idx}">
          <img class="artist-track-cover" src="${coverUrl}" alt="" loading="lazy">
          <div class="artist-track-info">
            <div class="artist-track-title">${escapeHtml(track.title || track.name || 'Untitled')}</div>
            <div class="artist-track-album">${escapeHtml(track.album || '—')}</div>
          </div>
          <div class="artist-track-meta">
            ${plays ? `<span title="${isRu() ? 'Прослушиваний' : 'Plays'}">${plays} ▶</span>` : ''}
            <span>${formatTime(durationSec)}</span>
          </div>
          <button type="button" class="artist-track-play-btn" title="${isRu() ? 'Слушать' : 'Play'}">▶</button>
        </div>
      `;
    }).join('');
  }

  function bindTracksListEvents(tracks, artistName) {
    const list = document.getElementById('artistTracksList');
    if (!list) return;

    list.addEventListener('click', e => {
      const item = e.target.closest('.artist-track-item');
      if (!item) return;
      const trackId = item.dataset.trackId;
      const track = tracks.find(t => String(t.id) === String(trackId));
      if (!track) return;

      if (typeof window.PainPlayer?.playTrackInContext === 'function') {
        window.PainPlayer.playTrackInContext(track, tracks, { type: 'artist', id: artistName, title: artistName });
      }
    });

    list.addEventListener('error', e => {
      const img = e.target;
      if (img && img.classList.contains('artist-track-cover')) {
        img.onerror = null;
        img.src = '/assets/app-icon.png';
      }
    }, true);
  }

  function updateWithOnlineData(data, artistTracks, artistName) {
    const ru = isRu();

    // 1. Avatar
    const img = document.getElementById('artistAvatarImg');
    const fallback = document.getElementById('artistAvatarFallback');
    if (data.avatar && img && fallback) {
      img.onload = () => {
        img.style.display = 'block';
        fallback.style.display = 'none';
      };
      img.onerror = () => {
        img.style.display = 'none';
        fallback.style.display = 'flex';
      };
      img.src = data.avatar;
    }

    // 2. Genres
    const genresRow = document.getElementById('artistGenresRow');
    if (genresRow && data.genres && data.genres.length) {
      genresRow.innerHTML = data.genres.map(g => `<span class="artist-genre-pill">${escapeHtml(g)}</span>`).join('');
    }

    // 3. Bio & Stories
    const bioText = document.getElementById('artistBioText');
    const storiesWrap = document.getElementById('artistStoriesWrap');
    const wikiWrap = document.getElementById('artistWikiLinkWrap');

    if (bioText) {
      if (data.bio) {
        bioText.style.color = 'var(--ink)';
        bioText.textContent = data.bio;
      } else {
        bioText.textContent = ru ? 'Биографическая справка не найдена в открытых источниках.' : 'No biography found in open sources.';
        bioText.style.color = 'var(--ink-muted)';
      }
    }

    if (storiesWrap && data.stories && data.stories.length) {
      storiesWrap.innerHTML = data.stories.map(s => `
        <details class="track-info-story" style="margin-top: 10px;" open>
          <summary style="font-weight: 600; font-size: 13px; color: var(--ink); cursor: pointer; padding: 4px 0;">${escapeHtml(s.heading)}</summary>
          <div class="artist-bio-text" style="margin-top: 6px;">${escapeHtml(s.text)}</div>
        </details>
      `).join('');
    }

    if (wikiWrap && data.url) {
      wikiWrap.innerHTML = `<a href="${escapeHtml(data.url)}" target="_blank" rel="noopener noreferrer" class="artist-bio-more">${ru ? 'Читать статью в Википедии →' : 'Read full article on Wikipedia →'}</a>`;
    }

    // 4. Similar artists
    const similarSec = document.getElementById('artistSimilarSection');
    const similarWrap = document.getElementById('artistSimilarWrap');
    if (similarSec && similarWrap && data.similar && data.similar.length) {
      similarSec.style.display = 'block';
      similarWrap.innerHTML = data.similar.map(item => `
        <div class="artist-similar-chip" data-artist="${escapeHtml(item.name)}" title="${escapeHtml(item.name)}">
          ${item.picture ? `<img class="artist-similar-chip-img" src="${escapeHtml(item.picture)}" alt="">` : ''}
          <span>${escapeHtml(item.name)}</span>
        </div>
      `).join('');

      similarWrap.addEventListener('click', e => {
        const chip = e.target.closest('.artist-similar-chip');
        if (!chip) return;
        const name = chip.dataset.artist;
        if (name) open(name);
      });
    }
  }

  function pluralizeRu(count, one, few, many) {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod100 >= 11 && mod100 <= 19) return many;
    if (mod10 === 1) return one;
    if (mod10 >= 2 && mod10 <= 4) return few;
    return many;
  }

  function open(artistName) {
    const clean = String(artistName || '').trim();
    if (!clean || clean.toLowerCase() === 'unknown artist' || clean === 'Pain Audio') return;

    ensureModal();
    currentArtist = clean;

    const artistTracks = getArtistTracks(clean);
    renderSkeleton(clean, artistTracks);

    backdrop.style.display = 'flex';
    backdrop.setAttribute('aria-hidden', 'false');

    if (!isOnlineEnabled()) return;

    if (abortController) abortController.abort();
    abortController = new AbortController();

    const lang = isRu() ? 'ru' : 'en';
    fetch(`/api/artist-info?artist=${encodeURIComponent(clean)}&lang=${lang}&online=1`, {
      signal: abortController.signal
    })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!data || currentArtist !== clean) return;
        updateWithOnlineData(data, artistTracks, clean);
      })
      .catch(err => {
        if (err.name === 'AbortError') return;
        const bioText = document.getElementById('artistBioText');
        if (bioText && currentArtist === clean) {
          bioText.textContent = isRu() ? 'Не удалось загрузить сведения об исполнителе.' : 'Could not load artist details.';
          bioText.style.color = 'var(--ink-muted)';
        }
      });
  }

  if (typeof document !== 'undefined') {
    const bindSwitch = () => {
      const onlineSwitch = document.getElementById('onlineArtistInfoSwitch');
      if (onlineSwitch && !onlineSwitch.dataset.bound) {
        onlineSwitch.dataset.bound = 'true';
        onlineSwitch.checked = isOnlineEnabled();
        onlineSwitch.addEventListener('change', () => {
          try {
            localStorage.setItem('pain_online_artist_info', String(onlineSwitch.checked));
          } catch (_) {}
        });
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bindSwitch);
    } else {
      bindSwitch();
    }
  }

  const api = {
    open,
    close,
    getArtistTracks,
    norm,
    primaryArtist,
    splitArtists,
    formatTime,
    isRu
  };

  if (typeof window !== 'undefined') {
    window.ArtistCard = api;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();

