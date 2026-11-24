#!/usr/bin/env bash
# Rehearsal metrics: downloads (GitHub releases) and active teachers / students (Online Homework database).
# Read-only: it only reads numbers, and prints no names, emails or codes.
#   tools/metrics.sh
# Needs the GitHub CLI (gh, signed in) and wrangler (signed in to Cloudflare, from tools/hw-worker).
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:$PATH"
source release/config   # sets REPO="owner/name"

echo "== Downloads (GitHub releases: $REPO) =="
RELEASES=$(gh api "repos/$REPO/releases?per_page=100" --paginate)
RELEASES="$RELEASES" python3 - <<'PY'
import os, json
rel = json.loads(os.environ["RELEASES"])
mac_total = win_total = 0
rows = []
for r in rel:
    mac = win = 0
    for a in r.get("assets", []):
        n, c = a["name"].lower(), a["download_count"]
        if n.endswith(".exe") or "windows" in n:
            win += c
        elif n.endswith(".zip") and "web" not in n:
            mac += c
    mac_total += mac
    win_total += win
    rows.append((r["tag_name"], mac, win))
print("  version     Mac  Windows")
for v, m, w in rows[:8]:
    print(f"  {v:<8} {m:>5} {w:>8}")
print(f"  all releases: Mac {mac_total}, Windows {win_total}")
print("  (counts include update downloads, so they run higher than first-time installs)")
PY

echo
echo "== Online Homework (live database) =="
NOW=$(( $(date +%s) * 1000 )); D7=$(( NOW - 7*86400000 )); D30=$(( NOW - 30*86400000 ))
SQL="SELECT
 (SELECT COUNT(*) FROM teachers) AS teachers_total,
 (SELECT COUNT(DISTINCT teacher_id) FROM teacher_sessions WHERE last_seen_at >= $D7) AS teachers_7d,
 (SELECT COUNT(DISTINCT teacher_id) FROM teacher_sessions WHERE last_seen_at >= $D30) AS teachers_30d,
 (SELECT COUNT(*) FROM teachers WHERE beta_code IS NOT NULL) AS teachers_beta,
 (SELECT COUNT(*) FROM students WHERE is_test = 0 AND archived_at IS NULL) AS students_total,
 (SELECT COUNT(DISTINCT ss.student_id) FROM student_sessions ss JOIN students st ON st.id = ss.student_id WHERE st.is_test = 0 AND ss.last_seen_at >= $D7) AS students_7d,
 (SELECT COUNT(DISTINCT ss.student_id) FROM student_sessions ss JOIN students st ON st.id = ss.student_id WHERE st.is_test = 0 AND ss.last_seen_at >= $D30) AS students_30d,
 (SELECT COUNT(*) FROM submissions s JOIN students st ON st.id = s.student_id WHERE st.is_test = 0 AND s.submitted_at >= $D30) AS submissions_30d"
DB=$(cd tools/hw-worker && npx wrangler d1 execute rehearsal-hw --remote --json --command "$SQL" 2>/dev/null)
DB="$DB" python3 - <<'PY'
import os, json
r = json.loads(os.environ["DB"])[0]["results"][0]
print(f"  Teachers:  {r['teachers_total']} total, {r['teachers_7d']} active in 7 days, {r['teachers_30d']} in 30 days, {r['teachers_beta']} on beta codes")
print(f"  Students:  {r['students_total']} on rosters, {r['students_7d']} active in 7 days, {r['students_30d']} in 30 days")
print(f"  Homework turned in (last 30 days): {r['submissions_30d']}")
PY
echo
echo "Not measured: use of the web version (app.rehearsalmusic.com), because Rehearsal doesn't track visitors."
