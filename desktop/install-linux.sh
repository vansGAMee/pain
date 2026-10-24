#!/usr/bin/env bash
set -euo pipefail
PAIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAIN_BIN="$HOME/.local/bin"
PAIN_APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
PAIN_ICONS="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/512x512/apps"
mkdir -p "$PAIN_BIN" "$PAIN_APPS" "$PAIN_ICONS"

# Resolve the real native runtime at install time; never silently fall back to a browser.
if [[ -x "$PAIN_ROOT/pain" ]]; then
    PAIN_COMMAND=("$PAIN_ROOT/pain")
elif [[ -x "$PAIN_ROOT/node_modules/electron/dist/electron" ]]; then
    PAIN_COMMAND=("$PAIN_ROOT/node_modules/electron/dist/electron" "$PAIN_ROOT")
elif [[ -n "${PAIN_ELECTRON_PATH:-}" && -x "$PAIN_ELECTRON_PATH" ]]; then
    PAIN_COMMAND=("$PAIN_ELECTRON_PATH" "$PAIN_ROOT")
else
    echo 'Native Electron runtime not found. Run npm install in the desktop folder, then run this installer again.' >&2
    exit 1
fi
[[ ! -f "$PAIN_BIN/pain" ]] || cp -p "$PAIN_BIN/pain" "$PAIN_BIN/pain.before-native"
{
    printf '#!/usr/bin/env bash\nexec '
    printf '%q ' "${PAIN_COMMAND[@]}"
    printf '"$@"\n'
} > "$PAIN_BIN/pain"
chmod +x "$PAIN_BIN/pain"
cp "$PAIN_ROOT/assets/app-icon.png" "$PAIN_ICONS/pain.png"
PAIN_DESKTOP_EXEC="${PAIN_BIN//\\/\\\\}/pain"
PAIN_DESKTOP_EXEC="${PAIN_DESKTOP_EXEC//\"/\\\"}"
cat > "$PAIN_APPS/pain.desktop" <<EOF
[Desktop Entry]
Name=PAIN
GenericName=Music Player
Exec="$PAIN_DESKTOP_EXEC"
Icon=pain
Terminal=false
Type=Application
Categories=AudioVideo;Audio;Player;
StartupWMClass=pain
EOF
if command -v update-desktop-database >/dev/null; then update-desktop-database "$PAIN_APPS" >/dev/null 2>&1 || true; fi
echo 'PAIN native launcher installed. Start with: pain'
