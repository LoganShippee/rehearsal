#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SITE="$ROOT/site"
OUT="$SITE/dist"

rm -rf "$OUT"
mkdir -p "$OUT/app"

# Copy marketing site static files (exclude build scripts and existing dist/)
for item in "$SITE"/*; do
  base="$(basename "$item")"
  case "$base" in
    dist|build-pages.sh|DEPLOY.md) continue ;;
    *) cp -R "$item" "$OUT/$base" ;;
  esac
done

# Copy web app into /app/ so everything runs on rehearsalmusic.com
cp -R "$ROOT/web/." "$OUT/app/"

# Write /app/version.json from release metadata
VERSION="$(tr -d '[:space:]' < "$ROOT/release/VERSION")"
NATIVE="$(tr -d '[:space:]' < "$ROOT/release/NATIVE")"
NATIVE_WIN="$(tr -d '[:space:]' < "$ROOT/release/NATIVE_WIN")"
printf '{"version":"%s","native":%s,"nativeWin":%s}\n' "$VERSION" "$NATIVE" "$NATIVE_WIN" > "$OUT/app/version.json"

echo "Built Cloudflare Pages bundle in site/dist (Rehearsal v$VERSION)"
