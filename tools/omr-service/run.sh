#!/usr/bin/env bash
# Starts the standalone Rehearsal OMR wrapper service on 127.0.0.1:8788.
# Audiveris 5.x is invoked only as an external CLI subprocess (AGPL v3 isolation).
set -euo pipefail

cd "$(dirname "$0")"

if [[ -n "${AUDIVERIS_BIN:-}" ]]; then
  echo "Using AUDIVERIS_BIN=${AUDIVERIS_BIN}"
elif command -v audiveris >/dev/null 2>&1; then
  echo "Found Audiveris on PATH: $(command -v audiveris)"
elif [[ -x "/Applications/Audiveris.app/Contents/MacOS/Audiveris" ]]; then
  echo "Found Audiveris app bundle: /Applications/Audiveris.app/Contents/MacOS/Audiveris"
else
  echo "Warning: Audiveris 5.x was not detected on PATH or in /Applications/Audiveris.app."
  echo "Install Audiveris 5.x or set AUDIVERIS_BIN=/path/to/audiveris before scanning."
fi

if [[ -n "${TESSDATA_PREFIX:-}" ]]; then
  echo "Using TESSDATA_PREFIX=${TESSDATA_PREFIX}"
elif [[ -d "$HOME/Library/Application Support/AudiverisLtd/audiveris/tessdata" ]]; then
  echo "Found Audiveris tessdata: $HOME/Library/Application Support/AudiverisLtd/audiveris/tessdata"
elif [[ -d "/opt/homebrew/share/tessdata" ]]; then
  echo "Found Homebrew tessdata: /opt/homebrew/share/tessdata"
else
  echo "Note: Tesseract tessdata not detected (install eng.traineddata or set TESSDATA_PREFIX for lyric/text OCR)."
fi

exec /usr/bin/python3 server.py
