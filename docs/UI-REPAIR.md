# UI repair 0.1.1

The proposed native screen redesign was rejected and removed. MainActivity again uses the original Figma geometry, typography, platter, relief surfaces and bottom dock. The working file before repair is backed up in /tmp/mono-before-ui-java.

Changes retained within the original design:
- Russian captions and duration units; removed SCRUB and MVP labels; consistent planned-function wording. Future crossfade and ReplayGain controls removed.
- One library import action and a concise empty state. Repaired search magnifier and consistent original Home roof geometry across screens.
- Ellipsis for constrained text, marquee on the player title, multi-line library rows. Bottom scroll space and a maximum content width for wide windows.
- Original decorative layers baked into assets/surfaces for immediate rendering; no competing whole-app raster preload. Explicit background dimensions fix empty background layers inside ScrollView. Non-default relief depth still uses the original renderer.
- Artwork decoding uses two workers, coalesces identical requests, samples large embedded covers, checks recycled view ownership and clears stale artwork. Scans invalidate negative artwork cache. Artwork appears within existing player/home/dock components.

Validation: assembleDebug, 6 unit tests and lint passed (no lint errors; existing warnings remain). 5 Android repository/playback tests passed on API 34. Original layout, Russian settings and cold launch inspected on the emulator. 120 Hz performance has not been measured on physical hardware.

To reproduce decorative assets: install app and androidTest APKs; run instrumentation with `-e bakeDesign true -e class dev.mono.local.BakeDesignTest`, then copy app files/surfaces into app/src/main/assets/surfaces. The export test skips during normal test runs.

Research consulted before repair:
- https://www.nngroup.com/articles/aesthetic-minimalist-design/
- https://developer.android.com/guide/topics/ui/accessibility/apps
- https://medium.com/@xurxe/accessible-neumorphism-soft-ui-992286900bfa

The user's correction takes precedence over the earlier proposal: preserve the original visual composition when fixing further issues.
