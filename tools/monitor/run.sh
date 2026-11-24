#!/usr/bin/env bash
# Starts the read-only Rehearsal Monitor on 127.0.0.1:8790 and opens it in the browser.
set -euo pipefail

cd "$(dirname "$0")"

# Open the page shortly after the server starts. Runs in the background so the server stays in the foreground.
(
  sleep 1
  open "http://127.0.0.1:8790"
) &

exec python3 server.py
