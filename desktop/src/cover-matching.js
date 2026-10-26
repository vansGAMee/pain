'use strict';
const norm = value => String(value || '').normalize('NFKC').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]/gu, '');
const unknown = value => !value || /^(unknown(?: artist| album)?|неизвестный исполнитель|неизвестный альбом|download|telegram|recordings|<unknown>)$/i.test(value.trim());
const decoration = /^(?:(?:official\s+)?(?:audio|music video|video|lyric(?:s| video)?)|(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?|slowed(?:\s*(?:and|&|\+)\s*reverb)?|sped up|speed up|bass boosted)$/i;
function title(value) {
  return String(value || '').replace(/\.(mp3|flac|m4a|wav|ogg)$/i, '')
    .replace(/[([]([^()[\]]+)[)\]]/g, (whole, inner) => decoration.test(inner.trim()) ? '' : whole)
    .replace(/\s+[-–—]\s+(.+)$/, (whole, suffix) => decoration.test(suffix.trim()) ? '' : whole).trim();
}
const primary = value => String(value || '').split(/\s+(?:feat\.?|ft\.?|featuring)\s+|\s*[;,]\s*/i)[0].trim();
function metadata(track) {
  let artist = String(track.artist || '').trim(), name = String(track.title || '').trim();
  if (unknown(artist)) {
    const parts = name.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    if (!parts) return null;
    artist = parts[1]; name = parts[2];
  }
  return { artist, title: name, album: unknown(track.album) ? '' : String(track.album).trim() };
}
function matches(item, track, album = false) {
  const artist = norm(item.artistName) === norm(track.artist) || norm(primary(item.artistName)) === norm(primary(track.artist));
  return artist && (album ? norm(item.collectionName) === norm(track.album) : norm(title(item.trackName)) === norm(title(track.title)));
}
function queries(track) {
  const list = [{ term: `${track.artist} ${track.title}`, entity: 'song' }, { term: `${primary(track.artist)} ${title(track.title)}`, entity: 'song' }];
  if (track.album) list.push({ term: `${primary(track.artist)} ${track.album}`, entity: 'album' });
  return list.filter((query, i) => list.findIndex(other => other.term === query.term && other.entity === query.entity) === i);
}
module.exports = { norm, metadata, matches, queries };
