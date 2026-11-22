#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SITE="$ROOT/site"
OUT="$SITE/dist"

rm -rf "$OUT"
mkdir -p "$OUT"

# Copy marketing site static files (exclude build scripts, docs, and existing dist/)
for item in "$SITE"/*; do
  base="$(basename "$item")"
  case "$base" in
    dist|build-pages.sh|DEPLOY.md) continue ;;
    *) cp -R "$item" "$OUT/$base" ;;
  esac
done

VERSION="$(tr -d '[:space:]' < "$ROOT/release/VERSION")"
echo "Built Cloudflare Pages bundle in site/dist (Rehearsal v$VERSION)"
