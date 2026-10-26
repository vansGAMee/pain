# PulseFlow in PAIN desktop, 2026-10-26

The desktop player now invokes the original Python PulseFlow engine. The
vendored source is unchanged, pinned to
[`d1fedcd4e1a676c0838ab2f7eb9ba6934676bcff`](https://github.com/Philippe-Guerrier/pulseflow-ai-offline-music-recommender/tree/d1fedcd4e1a676c0838ab2f7eb9ba6934676bcff).
`desktop/src/vendor/pulseflow/UPSTREAM.json` records SHA-256 for every copied
file; the test suite verifies them. The former JS imitation was removed.

The active upstream CLI/web path is `generate_playlist._select_tracks`, not
`sequencer.py`. PAIN calls that function with real CLAP audio embeddings and
FAISS `IndexFlatIP`, using upstream L2 normalization. Pure `smooth` and
`contrast` retain upstream candidate retrieval, ordering and scores. The player
passes its eligible queue as the catalog: scope, exclusions and tracks already
played are navigation constraints, not score penalties. It retains a generated
20-track sequence between Next presses, including the contrast alternation.

The local runtime uses Python 3.11, Torch 2.5.1, FAISS 1.10.0, and LAION CLAP
commit `1fd4c37df5ffbfcfbad5415c170bc66cf94c9994`. The default non-fusion
`630k-audioset-best.pt` checkpoint has SHA-256
`8053c9775516af2f4902e1e8281e356cc1bf7a85e8b761908170767b77c3f037`.
Dependencies are locked in `desktop/src/pulseflow/requirements.lock`.

## Modes and actual validation

Settings offers **History + PulseFlow**, **PulseFlow: smooth**, and
**PulseFlow: contrast**. The first is the default: completed-listen count is
the primary ordering; original smooth PulseFlow orders equal-count candidates.
This is lexicographic ordering, with no mixing weights, thresholds or invented
engagement penalties. Likes/skips are not silently converted into CLAP scores.
If the process/index is unavailable, playback uses the existing cheap completed-
frequency fallback and labels the reason accordingly. The Home preview reports
an error instead of running a heavy substitute on the renderer thread.

On the saved library:

- 769/769 audio files have real 512-dimensional CLAP embeddings; zero failed files.
- 1,538 comparisons (all seeds, both pure policies): identical IDs, order and
  scores against the unmodified upstream function using the same embeddings.
- Median Python query 4.27 ms, p95 5.29 ms, maximum 8.25 ms in this run.
- 400 Node tests passed. Real Electron playback exercised all three modes,
  Next, automatic end-of-track, a failed worker, and concurrent audio analysis
  at 4× CPU slowdown: no native unresponsive events, crashes or JavaScript
  errors. Maximum measured renderer long task: 144 ms; main event-loop delay:
  20.56 ms. This is a bounded test, not proof of never freezing.
- The bounded-audio path produced an exactly equal embedding to the original
  path on real 40.56-second PCM with the same random state. Peak test RSS was
  2,783 MiB, including model loading.

Chronological 80/20 history split: 3,682 deduplicated known-track events,
2,945 training events, 737 held out, 24 usable completed-next-track targets.
Current favorites were not used. Candidates were available by the cutoff;
future outcomes were not included in counts. Hit@10 / Hit@20:

| Method | Hit@10 | Hit@20 |
| --- | ---: | ---: |
| Pure smooth | 0/24 | 0/24 |
| Pure contrast | 1/24 | 1/24 |
| Completed-frequency baseline | 3/24 | 3/24 |
| History + PulseFlow | 3/24 | 3/24 |

Pure PulseFlow does **not** outperform the personal-frequency baseline here.
This is why it is available explicitly rather than being misrepresented as a
better default predictor. Eight real 30-transition queues per mode had no track
repeats within a cycle and no scope/exclusion violations. History + PulseFlow
and baseline both covered 31 distinct tracks / 27 artists across those starts,
with zero adjacent same-artist pairs. Pure smooth covered 205 tracks / 164
artists; contrast 203 / 170. Those modes offer broader acoustic exploration.

These are small retrospective checks. The historical suffix has been examined
before and informed the default-mode choice; it is not a fresh blind test.
Historical audio file versions and exclusion changes are unavailable. Audio
embeddings were measured now; the historical recordings are assumed unchanged.
Next-track hits do not establish subjective listening satisfaction.
Full aggregate evidence: [pulseflow-validation-2026-10-26.json](pulseflow-validation-2026-10-26.json).

## Resource and data behavior

CLAP indexing and FAISS queries run in separate Python child processes. Only
the indexer loads Torch/GPU weights. Renderer workers exchange queue metadata
and compact completed counts; live acoustic profiles and full listening history
are no longer cloned or used to invalidate a PulseFlow answer.

Indexing is incremental by file path, size and nanosecond mtime, with atomic
per-file caches and catalog publication. Existing catalogs remain available
while refreshing. Changed/missing files cannot supply stale embeddings. An
interrupted run resumes from saved vectors. Indexing runs after startup and
periodically for newly synced files; Settings can start/stop it explicitly.
Library, favorites, playlists and history are not modified by indexing.

The real library includes a five-hour, 291 MB recording. The original full-file
loader caused an OOM kill on that file. The wrapper now streams oversized or
unsupported audio to disk, uses LAION's original `get_audio_features` random
10-second crop, then calls the original embedding function. Cropping before
pointwise quantization avoids allocating entire-recording copies. FFmpeg
decodes unsupported formats and supplies 48 kHz mono for this bounded path;
codec/resampler differences from libsndfile/librosa are possible. The normal
path still calls upstream `read_mono` directly. No metadata-derived fake vectors
or audio-property guesses are used.

The Python environment and derived files are local and ignored by Git. Setup
downloads public model/runtime files once; music/history are not uploaded.
Inference works offline afterward. This integration is for desktop; the
Android native engine has not been replaced by a fake Python-equivalent port.

## Reproduce

With `uv` and FFmpeg installed, run `cd desktop && npm run pulseflow:setup`,
then Settings → PulseFlow → Update library index. The current Linux checkout
already has the runtime, model and complete index installed.

```sh
cd desktop
npm test
OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2 .pulseflow-venv/bin/python \
  test/pulseflow-real.py --data data --output /tmp/pulseflow-check.json
node test/pulseflow-queues.cjs
PAIN_TEST_PULSEFLOW=true PLAYWRIGHT_MODULE=/path/to/playwright \
  node test/native-playback-browser.cjs
```

The native harness copies data into an isolated profile and disables phone sync
and automatic indexing. Python query/index logs are in `data/pulseflow/`.
`PAIN_PULSEFLOW_PYTHON` can point to an existing compatible interpreter; packaged
desktop builds otherwise look for `.pulseflow-venv` alongside their data folder.
