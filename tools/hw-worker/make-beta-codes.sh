#!/usr/bin/env bash
# Make beta codes for teachers.  Usage: ./make-beta-codes.sh COUNT "Label" YYYY-MM-DD [MAX_USES]
# Prints the codes, then asks before adding them to the live database.
# Needs migration 0002 applied first (see CLAUDE.md: run backup-d1.sh before any migration).
set -euo pipefail
cd "$(dirname "$0")"
N="${1:?how many codes}"; LABEL="${2:?label, e.g. Spring beta}"; END="${3:?end date YYYY-MM-DD}"; USES="${4:-1}"
ENDMS=$(( $(date -j -f %Y-%m-%d "$END" +%s 2>/dev/null || date -d "$END" +%s) * 1000 ))
NOW=$(( $(date +%s) * 1000 ))
SQL=""
for _ in $(seq "$N"); do
  CODE=$(python3 -c "import secrets as s; a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; print('BETA-'+''.join(s.choice(a) for _ in range(4))+'-'+''.join(s.choice(a) for _ in range(4)))")
  echo "$CODE"
  SQL+="INSERT INTO beta_codes (code,label,max_uses,uses,plan_ends_at,student_soft_cap,created_at) VALUES ('$CODE','${LABEL//\'/}',$USES,0,$ENDMS,300,$NOW);"
done
read -r -p "Add these $N code(s) to the live database? [y/N] " ok
[[ "$ok" == y* ]] || { echo "Not added."; exit 0; }
npx wrangler d1 execute rehearsal-hw --remote --command "$SQL"
