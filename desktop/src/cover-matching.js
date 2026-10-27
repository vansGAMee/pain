'use strict';
const norm = value => String(value || '').normalize('NFKC').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]/gu, '');
const unknown = value => !value || /^(unknown(?: artist| album)?|неизвестный исполнитель|неизвестный альбом|download|telegram|recordings|<unknown>)$/i.test(String(value).trim());
const decoration = /^(?:(?:official\s+)?(?:audio|music video|video|lyric(?:s| video)?)|(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?|slowed(?:\s*(?:and|&|\+)\s*reverb(?:ed)?)?|sped up|speed up|bass boosted)$/i;
function title(value) {
  return require('./comfort-utils').cleanTitle(String(value || '').replace(/_/g, ' ')).replace(/\.(mp3|flac|m4a|wav|ogg)$/i, '')
    .replace(/[([]([^()[\]]+)[)\]]/g, (whole, inner) => decoration.test(inner.trim()) ? '' : whole)
    .replace(/\s+[-–—]\s+(.+)$/, (whole, suffix) => decoration.test(suffix.trim()) ? '' : whole).trim();
}
const artists = value => [...new Set(String(value || '').split(/\s+(?:feat\.?|ft\.?|featuring)\s+|\s*[;,]\s*|\s+&\s+/i).map(s=>s.trim()).filter(Boolean))];
const primary = value => artists(value)[0] || '';
function metadata(track) {
  let artist = String(track.artist || '').trim(), name = title(track.title || track.filename || track.name).replace(/_/g, ' ').trim();
  if (unknown(artist)) {
    const parts = name.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    if (!parts) return null;
    artist = parts[1]; name = parts[2];
  }
  return { artist, title: name, album: unknown(track.album) ? '' : String(track.album).trim() };
}
function matches(item, track, album = false) {
  const artist = norm(item.artistName) === norm(track.artist) || artists(item.artistName).some(a=>artists(track.artist).some(b=>norm(a)===norm(b)));
  return artist && (album ? norm(item.collectionName) === norm(track.album) : norm(title(item.trackName)) === norm(title(track.title)));
}
function queries(track) {
  const list = [{ term: `${track.artist} ${track.title}`, entity: 'song' }, { term: `${primary(track.artist)} ${title(track.title)}`, entity: 'song' }];
  for (const artist of artists(track.artist).slice(1,3)) list.push({term:`${artist} ${title(track.title)}`,entity:'song'});
  if (track.album) list.push({ term: `${primary(track.artist)} ${track.album}`, entity: 'album' });
  return list.filter((query, i) => list.findIndex(other => other.term === query.term && other.entity === query.entity) === i);
}
function fromFilename(track, artists = []) {
  if (!unknown(track.artist)) return track;
  const name = title(track.title || track.filename || track.name).replace(/\s*\(\d+\)$/, '').trim();
  const lower = name.toLowerCase().replace(/ё/g,'е');
  for (const artist of [...new Set(artists)].filter(a => !unknown(a)).sort((a,b) => b.length-a.length)) {
    const key = artist.toLowerCase().replace(/ё/g,'е');
    let song;
    if (lower.endsWith(' '+key)) song = name.slice(0,-artist.length).replace(/[\s–—-]+$/, '');
    else if (lower.startsWith(key+' ')) song = name.slice(artist.length).replace(/^[\s–—-]+/, '');
    if (song) return { ...track, title: song, artist };
  }
  return track;
}
module.exports = { norm, metadata, matches, queries, unknown, title, primary, fromFilename, artists };
