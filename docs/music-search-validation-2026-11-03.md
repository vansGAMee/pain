# Local music search and playback restoration — 2026-11-03

The recommendation model and its ranking are unchanged. Search owns a separate
worker and indexes metadata, published track genres and already saved lyrics.
It does not scan audio, download every song's lyrics, or send queries to a search
service while typing. All library/history evaluation reads are read only.

## Search behaviour and methods

- Typographical mistakes: bounded optimal-string-alignment distance, including
  adjacent swaps. Tolerance uses [Lucene's AUTO lengths](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/common-options):
  0 edits for 0–2 characters, 1 for 3–5, 2 for 6 or more.
- Retrieval uses [MiniSearch 7.2.0](https://github.com/lucaong/minisearch/tree/v7.2.0)
  with its published BM25+ defaults. No custom statistical weights were fitted.
  Literal metadata, phrase matches, corrections and phonetic fallbacks have
  explicit ordering. Every requested word must match; one occurrence cannot
  satisfy arbitrarily many different query words.
- Russian/English keyboard layout, mixed layouts, transliteration variants,
  diacritics, Unicode lookalikes, joined/split words, filename noise, initials,
  contractions and word reordering are supported. Unicode word segmentation
  also supports scripts that do not separate all words with spaces.
- [Double Metaphone](https://github.com/words/double-metaphone) supplies labelled
  pronunciation fallbacks, including some English phrases typed in Russian.
  Strong literal matches suppress phonetic noise. Pronunciation cannot establish
  a song's genre or catalogue identity.
- Genre matches use file genres and the existing genre service's saved track
  data. Russian genre-name aliases translate labels, never infer missing genres.
- Saved/manual/previously downloaded lyrics are indexed without modifying them.
  A search result can show the actual matched lyric line. Text edits and newly
  fetched lyrics update the index; deletion removes old words. The visible count
  is the number of available texts, not a claim that all songs have lyrics.
- Useful syntax: `genre:shoegaze`, `жанр:рок`, `artist:Muse`, `title:dementia`,
  `lyrics:"quiet room waits"`, `muse -live`. Fields can be mixed. Natural frames
  such as `песня со словами …` or `song that goes …` select lyrics search.
- A free-form description such as a sad song with a whispering man is **not**
  an implemented audio-semantic search. The hint does not claim to understand it.

## Reproducible evaluation

Run `node desktop/test/music-search-evaluation.cjs` against an existing local
library, or set `PAIN_EVAL_DATA_DIR`. The report goes to the system temporary
directory unless `PAIN_SEARCH_REPORT` is supplied. No player data is written.
Tracks are selected by SHA-256 order before querying, not selected by outcome.
Queries include seven mechanical changes to 100 sampled titles. Recordings with
the same title and artist count as equivalent. These are retrieval stress tests,
not a measure of subjective taste or unconstrained natural-language understanding.

Observed snapshot: 725 tracks, 165 locally available texts, 686 queries.

| Query family | Queries | Target found | Within first five |
| --- | ---: | ---: | ---: |
| Normalized title | 100 | 100 | 100 |
| Reordered words | 100 | 100 | 100 |
| Wrong keyboard layout | 100 | 100 | 100 |
| Transliteration | 100 | 100 | 100 |
| Removed spaces | 100 | 100 | 100 |
| Adjacent letter swap | 93 | 93 | 93 |
| Deleted letter | 93 | 93 | 90 |

Short ambiguous deletions (`lash`, `ara`, `hte`) can prefer other literal or
prefix matches. This limitation is retained in the report rather than tuning
search to these songs. Measured local engine median was about 9 ms, p95 about
186 ms; indexing metadata took about 141 ms, outside the UI thread. Hardware and
available texts affect these timings.

## Browser and restoration checks

`desktop/test/music-search-browser.cjs` serves a read-only real metadata snapshot
and disposable synthetic lyrics/audio. Chromium uses 4× CPU throttling. Checks:
typos, joined/split words, actual genres, lyric phrases, pronunciation, natural
lyrics frames, rapid typing without stale results, adding a found song to a real
playlist, and uninterrupted audio while searching. A full search/indexing pass
had a maximum UI frame gap of about 100 ms; the rapid-typing pass about 17 ms.
No page errors were observed. A screenshot was inspected to confirm the small
hint fits below the original search input without changing the layout.

Startup previously let a focus/library refresh fill the queue with the first
song before the saved song was restored in the player bar. Restoration now sets
the queue and bar to the same saved song, even if the queue was populated first.
A real selection made during startup wins over a delayed checkpoint read.

The browser test deliberately delays checkpoint loading, refreshes the library
to reproduce the old first-song queue, then verifies correct restoration and a
later refresh. It also checks position retention, paused startup, unavailable
browser storage, different localhost origins, closing while playing and reopening.

The small disk checkpoint is local-only and atomically serialized. Older writes
cannot replace newer ones. Quit waits for the checkpoint alongside listening
history. A temporary listening-room track does not overwrite local playback.
Unit tests verify persisted state, concurrent/stale writes and invalid input.

`desktop/test/list-scroll-browser.cjs` also passes: favourites, playlists,
metadata refresh, playback changes, settings, picker, table/grid, sidebar,
home and a second theme preserve scrolling under 4× CPU throttling.

Browser validation ran on Linux Chromium. Windows runtime was not available;
the changed implementation uses platform-independent browser and Node APIs.

The focused Node suite passes 37 tests. An isolated server built from the staged
tree (without unrelated workspace changes) also served the genre snapshot,
cached-lyrics endpoint, persisted playback checkpoint and both worker libraries.

## Lyrics source work carried forward

Independent NetEase and Lyrics.ovh fallbacks supplement LRCLIB and KuGou.
Independent hosts overlap after the preferred source misses or fails. Switching
songs cancels old lookups. Plain words are never given invented timing; timing
requires the verified recording/version and duration within LRCLIB's documented
two-second tolerance. Provider failures are distinct from a genuine empty result.
Timeouts, rate limits and access restrictions cool down only the affected host.

Actual Globalping HTTP GET measurements, including response bodies, were made
from Rostelecom, Vimpelcom and MTS probes in Russia (not ICMP ping):

- [LRCLIB: valid song lyrics, HTTP 200 in the sampled networks](https://api.globalping.io/v1/measurements/2Lb3RUHxjzJJgeY3O00021Qpe).
- [NetEase lyrics endpoint](https://api.globalping.io/v1/measurements/2dK9hAtB81p1sEmHS00021Qpf)
  and [anonymous search endpoint](https://api.globalping.io/v1/measurements/2C5fo5C2YZNpfAFmn00021Qpf).
- [Lyrics.ovh measurement](https://api.globalping.io/v1/measurements/2mKznX3d1NSB6A5Sd00021Qpf):
  probe failures are not evidence of country-wide blocking.

Availability differs by source/network and can change; these measurements do
not establish universal coverage in Russia. A separate fixed 16-track online
sample found text for 13, timing for 11, and an instrumental designation for one.
It does not justify promising lyrics or ratings for 90% of arbitrary libraries.
Ratings and recommendation algorithms were not replaced by this change.
