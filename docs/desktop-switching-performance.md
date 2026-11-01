# Desktop playback preparation

The playback path now starts the next decoder before waiting for transition analysis. It uses the existing streaming `/api/cached-track` response directly instead of first completing a separate `/api/preload-track` download. Selection still goes through the same queue `peekNextAsync` / `nextAsync` methods, with the existing stale-selection checks. No model, ranking, selection-mode preference, markup or stylesheet changed.

Preparation resumes after pause or buffering recovery. An obsolete decoder is unloaded when switching without a crossfade, cancelling its transfer and releasing its buffer. Crossfades retain the audible outgoing decoder until the existing fade completes. Obsolete BPM requests are aborted. Playback resolves imported files without creating a synchronous cache copy; the original file stays in place.

## Validation

All fixtures are isolated from user data. The old persistence test that required a particular number of exclusions in `desktop/data` now tests a temporary store and restart instead.

- `npm test` in `desktop`: 562 passing tests, including queue/model, cache streaming, phone ID recovery, library removal, sync and listening history.
- `prefetch-performance-browser.cjs`: synthetic library of 800 tracks and 20,000 listens; 1.4-second source latency, 3-second transition-analysis latency. With the original 1.9.1 `app.js`, Next took 1,443 ms and the next decoder was unprepared. With the change it took 4.6 ms with a ready decoder, without the duplicate full-download request. This is a controlled prepared-next test, not a guarantee for arbitrary selections or cold files. Arbitrary selections under sixfold CPU throttling showed no consistent improvement.
- `prefetch-stream-browser.cjs`: actual app server and a slow HTTP phone fixture; playback begins before the full response arrives, Next reuses the same request, incomplete files never become cache entries, obsolete transfers are cancelled, preparation restarts after pause. A local import plays without a cache copy. Library JSON and original audio are unchanged.
- `smart-transitions-browser.cjs`: actual Web Audio output, automatic succession, prepared decoder reuse, rapid switches, pause/resume, suspended AudioContext recovery and seeking.
- `buffering-transitions-browser.cjs`: audible outgoing song survives rapid selections while replacements buffer; failed playback can be retried.
- `phone-playback-browser.cjs`: changed phone IDs, missing files, loading cancellation and resume, unchanged library.
- `listening-integrity-browser.cjs`: checkpoints, play counts and pause/resume remain correct.

Browser scripts accept `PLAYWRIGHT_MODULE` (default `playwright`). To reproduce the timing baseline, export the old `desktop/src/app.js` to a temporary file and pass its absolute path in `PAIN_BASELINE_APP` when running `prefetch-performance-browser.cjs`.

The lower-player text “Smart DJ” is an existing generic fallback when no matching explanation is saved for the current track. It is distinct from the saved “Весь мой вкус” selection policy, which remains controlled by `pulseflow-settings.js` and was not changed here.

Follow-up: repeated manual Next clicks while a selection or decoder is pending now coalesce into one operation instead of accumulating skipped songs. A fresh click after playback starts still advances normally, and manual track selection supersedes an old request. The existing selection worker starts during the outgoing fade so it does not wait for that decoder to become free. Automatic succession remains independent of the manual-click guard. `rapid-next-browser.cjs` verifies selection delays, buffering, 24-click bursts, subsequent navigation, manual override and preservation of the saved taste policy.

The separately requested “Songs that meet” chart fix excludes same-track repeats from its links while retaining those listens in totals. Long labels use ellipses and full-title hover text; measured SVG text width keeps both columns inside the chart. Covered by the chart model tests and a browser layout check.
