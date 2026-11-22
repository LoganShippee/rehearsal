#!/usr/bin/env bash
# Export a timestamped snapshot of the remote Cloudflare D1 database (rehearsal-hw)
# BEFORE running any schema migration. Backups are saved outside the git repository
# so student names and teacher emails never enter version control.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_DIR="${REHEARSAL_D1_BACKUP_DIR:-$HOME/Rehearsal-Backups/d1}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/rehearsal-hw-${STAMP}.sql"

mkdir -p "$BACKUP_DIR"

echo "Exporting remote D1 database 'rehearsal-hw' to $OUT..."
(cd "$DIR" && npx --yes wrangler d1 export rehearsal-hw --remote --output="$OUT")

if [ ! -s "$OUT" ]; then
  echo "Backup failed: $OUT was not created or is empty." >&2
  exit 1
fi

SIZE=$(wc -c < "$OUT" | tr -d ' ')
echo "Backup saved: $OUT ($SIZE bytes)"
echo "Tip: Cloudflare D1 also keeps 30-day Time Travel restore points:"
echo "  (cd \"$DIR\" && npx wrangler d1 time-travel info rehearsal-hw)"
