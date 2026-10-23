# PAIN / Форма

Optional desktop edition, selected in Settings → Appearance. The reference is a
physical listening instrument: matte mineral surface, inset readouts, raised
controls and a single quiet ink-purple accent. Relief describes what can be
pressed; it is not applied to every content block. No decorative counters,
glowing badges, invented moods or simulated graphs.

## Tokens and composition

- Spacing: 4 / 8 / 12 / 16 / 24 / 32 / 40 / 48 / 64 px, via `--space-*`.
  Borders, optical letter spacing, icon geometry and animation travel are not spacing.
- Palette: shell #dedcd4; surface #e8e6de; ink #20201f; secondary #5d5a62;
  active #493261; quiet chart #a4a097. Purple means active, selected or measured emphasis.
- Typography: existing user-selected font; Geist by default. Fluid display
  headings, tabular numerical readouts, normal sentence case. No remote fonts.
- Desktop: labelled navigation rail | search and workspace; persistent transport.
  Home: greeting + playable record; listening readouts; charts; DJ + saved vibes;
  recent listening, discoveries, favourites and personal playlists.
- Content sections share a surface and use whitespace/dividers. Only controls and
  the playing record have pronounced elevation. Components own padding; grids own gaps.
- Below the point where columns no longer fit, stack them. Small windows use a
  native disclosure navigation drawer. All actions remain reachable and labelled.
- Every interactive control has hover, press, keyboard focus and disabled states.
  Loading and empty states say what is missing; no fabricated example listening.
- Motion answers an action: 160 ms press feedback, 240 ms view arrival, 400 ms chart
  reveal. Honour both reduced-motion settings. No new continuous animation loop.

## Data and safety

Use ListeningInsights for deduplication and accounting. “New” means first qualified
listen in the available history, not a claimed release date. Moods are explicitly
saved DJ vibes, not inferred human emotions. Generate the mix with an isolated
QueueEngine; viewing Home must never advance or reset live playback. Escape all
metadata, tolerate removed tracks and empty histories. Never modify the library
or statistics in presentation code.

## Primary references

The spacing/token and grouping approach follows [Carbon spacing](https://www.carbondesignsystem.com/building-blocks/foundations/spacing/overview)
and [Atlassian spacing](https://atlassian.design/foundations/spacing/). The 4 px base
and selected scale above are PAIN's own constraints; the visual direction comes
from the supplied references, not a claim of certification by those systems.
