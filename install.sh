#!/bin/sh
# Spotify Reimagined (CD Shelf) installer for Linux and macOS.
#   curl -fsSL https://raw.githubusercontent.com/WhiteRafalicu/spotify-reimagined/main/install.sh | sh
# Needs Spicetify (https://spicetify.app). CDS_ZIP=<path or url> installs a specific build.
set -e
REPO="WhiteRafalicu/spotify-reimagined"
ZIP="${CDS_ZIP:-https://github.com/$REPO/releases/latest/download/cd-shelf.zip}"

if ! command -v spicetify >/dev/null 2>&1; then
  echo "Spicetify isn't installed. Install it first: https://spicetify.app/docs/getting-started" >&2
  exit 1
fi
command -v unzip >/dev/null 2>&1 || { echo "unzip is required." >&2; exit 1; }

CONFIG_DIR="$(dirname "$(spicetify -c)")"
APP_DIR="$CONFIG_DIR/CustomApps/cd-shelf"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Downloading CD Shelf..."
case "$ZIP" in
  http*) curl -fsSL "$ZIP" -o "$TMP/cd-shelf.zip" ;;
  *) cp "$ZIP" "$TMP/cd-shelf.zip" ;;
esac
mkdir -p "$APP_DIR"
unzip -oq "$TMP/cd-shelf.zip" -d "$APP_DIR"

echo "Registering it with Spicetify..."
case "$(spicetify config custom_apps 2>/dev/null)" in
  *cd-shelf*) ;;
  *) spicetify config custom_apps cd-shelf >/dev/null ;;
esac
spicetify apply

echo "Done. Open Spotify: CD Shelf is your new home page."
