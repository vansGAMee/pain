# Студия / Studio

Optional desktop theme. Select in Settings → Appearance. Existing Paper/Dark themes and the typeface remain intact; selection uses the existing `pain_theme` preference.

Direction: a quiet listening desk, with a dark equipment rail and a light work surface. Graphite sidebar and transport, fog-grey canvas, muted sage controls. No glowing cards or decorative labels. Same Geist font; stronger spacing and a side-by-side vinyl composition on wide displays.

Palette: canvas #eef0eb, surface #f8f9f5, ink #252c26, muted #667063, equipment #25312b, sage #c0cfb0.

Layout: navigation | collection/player; transport underneath. Wide player: disc | title. Windows up to 650px stack the player; content and navigation remain scrollable in short windows. Fullscreen keeps its existing controls. Motion follows the existing reduced-motion preference.

Implementation: `src/studio-theme.css`, all product rules scoped to `data-theme="studio"`. Theme previews alone are shared, inside settings. No recommendation, history, audio, Android or library mutations.
