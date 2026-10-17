#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$HOME/.local/bin"
APP_DIR="$HOME/.local/share/applications"
ICON_DIR_512="$HOME/.local/share/icons/hicolor/512x512/apps"
ICON_DIR_256="$HOME/.local/share/icons/hicolor/256x256/apps"
PIXMAPS_DIR="$HOME/.local/share/pixmaps"

mkdir -p "$BIN_DIR" "$APP_DIR" "$ICON_DIR_512" "$ICON_DIR_256" "$PIXMAPS_DIR"

# 1. Install Icons
cp "$SCRIPT_DIR/assets/app-icon.png" "$ICON_DIR_512/pain.png"
cp "$SCRIPT_DIR/assets/app-icon.png" "$ICON_DIR_256/pain.png"
cp "$SCRIPT_DIR/assets/app-icon.png" "$PIXMAPS_DIR/pain.png"

# 2. Install Executable Launcher
cat << 'LAUNCHER' > "$BIN_DIR/pain"
#!/usr/bin/env bash
PORT=3000

# Locate desktop server.js
if [ -f "$HOME/mono-local/desktop/src/server.js" ]; then
    SERVER_JS="$HOME/mono-local/desktop/src/server.js"
elif [ -f "$HOME/.local/share/pain/src/server.js" ]; then
    SERVER_JS="$HOME/.local/share/pain/src/server.js"
elif [ -f "/usr/share/pain/src/server.js" ]; then
    SERVER_JS="/usr/share/pain/src/server.js"
else
    SERVER_JS="$(dirname "$(dirname "$(readlink -f "$0")")")/desktop/src/server.js"
fi

# Start server if not running
if ! curl -s -m 1 "http://127.0.0.1:$PORT" > /dev/null 2>&1; then
    if [ -f "$SERVER_JS" ]; then
        node "$SERVER_JS" > /dev/null 2>&1 &
        for i in $(seq 1 20); do
            if curl -s -m 1 "http://127.0.0.1:$PORT" > /dev/null 2>&1; then
                break
            fi
            sleep 0.2
        done
    fi
fi

URL="http://localhost:$PORT"

# Open in standalone app window if chromium / chrome is available, else default browser
if command -v chromium > /dev/null 2>&1; then
    exec chromium --app="$URL" --class="Pain" --name="pain" "$@"
elif command -v google-chrome > /dev/null 2>&1; then
    exec google-chrome --app="$URL" --class="Pain" --name="pain" "$@"
elif command -v brave > /dev/null 2>&1; then
    exec brave --app="$URL" --class="Pain" --name="pain" "$@"
elif command -v xdg-open > /dev/null 2>&1; then
    exec xdg-open "$URL"
else
    echo "Pain running at $URL"
fi
LAUNCHER

chmod +x "$BIN_DIR/pain"

# 3. Install .desktop file
cat << DESKTOP > "$APP_DIR/pain.desktop"
[Desktop Entry]
Name=Pain
GenericName=Music Player & Companion
Comment=Minimalist Audio Player & Phone Companion
Exec=$BIN_DIR/pain
Icon=pain
Terminal=false
Type=Application
Categories=AudioVideo;Audio;Player;
Keywords=music;audio;player;pain;companion;
StartupWMClass=Pain
DESKTOP

# 4. Update desktop database & icon cache
if command -v update-desktop-database > /dev/null 2>&1; then
    update-desktop-database "$APP_DIR" > /dev/null 2>&1 || true
fi

if command -v gtk-update-icon-cache > /dev/null 2>&1; then
    gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" > /dev/null 2>&1 || true
fi

echo "Pain has been successfully installed to Arch Linux application menu!"
