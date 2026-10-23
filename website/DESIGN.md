# PAIN — product, up close

Reference inspection: 23 October 2026. Installed and read `anthropics/skills/skills/frontend-design`. Firecrawl unavailable (no credits); inspected official pages with Chromium and web retrieval instead.

## Evidence and limits

- https://www.apple.com/airpods-pro/ — desktop capture at 1440×1000: large isolated physical product on pale neutral ground; compact product navigation, progressively disclosed details, one large subject per scene. Observed SF Pro, dark text, grey secondary text. Reference files in `/tmp/pain-ref-apple*.png`; some WebGL layers rendered as silhouettes, so these are not evidence for exact lighting or animation internals.
- https://www.spotify.com/us/premium/ — desktop capture at 1440×1000, rejected optional cookies: oversized heavy Spotify Mix title, moving brand silhouette, visible pause control, strong scene changes, product benefits paired with large images. Computed H1 128px/900; H2 examples 64px/800. Reference files `/tmp/pain-ref-spotify-clear*.png`.
- These are observed public front-end patterns, not access to proprietary source, design files, or private design systems. No borrowed brand assets or proprietary fonts.

## Proposed PAIN system

Color: porcelain #f5f5f1, shell #e6e7e2, graphite #20231f, secondary #656b61, sage #bcc7af, deep green #253129. Sage connects the site's product scenes with the tactile paper-and-vinyl app. No neon gradients.

Type: local Geist variable, 450–600 for text and display, comfortable Cyrillic. Main display 112px desktop/54px phone, section display 68px/38px, body 17px/15px. Labels in sentence case; numbering only for genuine instructions.

Layout: actual interface is the main subject, followed by different visual chapters rather than repeated text grids.

```
brand / product / details / guide                    download
big two-line statement                    purpose + download
[             interactive real player tour             ]
Smart DJ: title + acoustic illustration + usable explanations
Statistics: sage scene + real example + selectable detail
Lyrics / sound: two different product views
Everyday uses / FAQ / downloads / oversized PAIN signature
```

Motion: one restrained opening and a reversible transform on the main product frame as it enters view. Screen changes crossfade only after decoding. Controls answer user input. Stop nonessential motion offscreen, in a hidden tab, for reduced motion, or when paused. No autoplay audio, scroll hijacking, heavy WebGL, or framework.

## Critique before build

The previous design overused small uppercase indices, hairlines and repeated three-column descriptions. Remove those decorative labels, raise readable body size, keep the user's leaf silhouette, and make product surfaces carry the hierarchy. Do not just apply Apple's pill buttons or Spotify's green to the old layout. Existing explanatory content remains available but appears next to the feature it describes.

Screenshots are isolated local frontend previews with explicitly labelled demonstration data. The user's listening files/history are never read or mutated for this work.
