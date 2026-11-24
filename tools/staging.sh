#!/usr/bin/env bash
# Staging: a private test copy of Rehearsal Online Homework (server + website) for trying features before they go live.
# It has its OWN database and storage with fake data only, and can never touch real teachers or students.
#
#   tools/staging.sh all      deploy the staging server and the staging website (the usual one)
#   tools/staging.sh api      only the server (applies new migrations first, like a real release will)
#   tools/staging.sh web      only the website
#   tools/staging.sh seed     add a fake teacher, class and students to play with
#   tools/staging.sh reset    wipe all staging data (asks first; staging only)
#   tools/staging.sh status   is it up?
#
# Staging server:  https://rehearsal-hw-staging.logan-shippee.workers.dev
# Staging website: https://rehearsal-staging.pages.dev   (teacher sign-in shows the 6-digit code on screen)
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:$PATH"

API="https://rehearsal-hw-staging.logan-shippee.workers.dev"
SITE="https://rehearsal-staging.pages.dev"
PROJECT="rehearsal-staging"
CFG="wrangler.staging.toml"
DB="rehearsal-hw-staging"
BUILD="/tmp/rehearsal-staging-site"

# every wrangler call here is pinned to the staging config, so it can't reach the real database
W() { (cd tools/hw-worker && npx wrangler "$@" -c "$CFG"); }

deploy_api() {
  echo "== Staging server =="
  W d1 migrations apply "$DB" --remote 2>&1 | grep -E "✅|🕒|rror|No migrations" || true
  W deploy 2>&1 | grep -E "Deployed|https://|rror" || true
}

deploy_web() {
  echo "== Staging website =="
  rm -rf "$BUILD"; mkdir -p "$BUILD"; cp -R web/. "$BUILD/"
  SHA=$(git rev-parse --short HEAD 2>/dev/null || echo dev)
  # all edits are made to the COPY in $BUILD, never to web/
  python3 - "$BUILD" "$API" "$SITE" "$SHA" <<'PY'
import sys, re, json, os
build, api, site, sha = sys.argv[1:5]
def edit(name, fn):
    p = os.path.join(build, name)
    s = open(p, encoding='utf-8').read()
    open(p, 'w', encoding='utf-8').write(fn(s))
prod_api, prod_site = 'https://api.rehearsalmusic.com', 'https://app.rehearsalmusic.com'
for f in ('hw-api.js', 'hw-teacher-api.js'):
    edit(f, lambda s: s.replace(prod_api, api))
for f in ('hw-teacher-api.js', 'hw-teacher.js', 'hw-student.js'):
    edit(f, lambda s: s.replace(prod_site, site))
tag = '<script src="staging-banner.js"></script>'
for f in ('index.html', 'hw.html'):
    edit(f, lambda s: s if tag in s else s.replace('</body>', tag + '\n</body>', 1))
open(os.path.join(build, 'staging-banner.js'), 'w').write(
  "(function(){var b=document.createElement('div');b.textContent='STAGING \\u2014 test copy, fake data only';"
  "b.style.cssText='position:fixed;left:50%;bottom:8px;transform:translateX(-50%);z-index:2147483647;background:#b45309;color:#fff;"
  "font:600 12px system-ui,sans-serif;padding:5px 12px;border-radius:99px;box-shadow:0 2px 8px rgba(0,0,0,.35);pointer-events:none';"
  "document.body.appendChild(b);document.title='[STAGING] '+document.title;})();\n")
# no offline cache on staging: always show what was just deployed
open(os.path.join(build, 'sw.js'), 'w').write(
  "self.addEventListener('install',()=>self.skipWaiting());\n"
  "self.addEventListener('activate',e=>e.waitUntil(self.registration.unregister()));\n")
open(os.path.join(build, 'version.json'), 'w').write(json.dumps({"version": "staging-" + sha}))
PY
  (cd tools/hw-worker && npx wrangler pages project create "$PROJECT" --production-branch main >/dev/null 2>&1) || true
  (cd tools/hw-worker && npx wrangler pages deploy "$BUILD" --project-name "$PROJECT" --branch main --commit-dirty=true 2>&1 | grep -E "https://|rror|Success" || true)
}

seed() {
  echo "== Adding fake test data to staging =="
  API="$API" python3 - <<'PY'
import json, os, urllib.request
api = os.environ["API"]
def call(method, path, token=None, body=None):
    req = urllib.request.Request(api + path, method=method, data=(json.dumps(body).encode() if body is not None else None))
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", "rehearsal-staging-seed/1.0")   # Cloudflare turns away Python's default one
    if token: req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=30) as r: return json.load(r)
    except urllib.error.HTTPError as e:
        return json.load(e)
email = "staging.teacher@example.test"
start = call("POST", "/api/auth/teacher/email/start", body={"email": email})
ver = call("POST", "/api/auth/teacher/email/verify", body={"email": email, "code": start.get("devCode"), "name": "Staging Teacher"})
tok = ver.get("token")
if not tok:
    raise SystemExit("could not sign in the fake teacher: " + json.dumps(ver)[:200])
cls = call("POST", "/api/classes", tok, {"name": "Staging Choir"})
c = cls.get("class", {})
studs = call("POST", f"/api/classes/{c.get('id')}/students", tok, {"students": [
    {"name": "Test Alto", "part": "Alto", "email": "alto@example.test"},
    {"name": "Test Bass", "part": "Bass"},
    {"name": "Test Soprano", "part": "Soprano", "email": "soprano@example.test"}]})
print("Fake teacher email:", email, "(sign in on the staging website; the 6-digit code appears on screen)")
print("Class:", c.get("name"), "| class code:", c.get("joinCode"))
for s in (studs.get("students") or studs.get("created") or []):
    print("  student:", s.get("displayName"), "| code:", s.get("code") or s.get("studentCode") or "(see roster)")
PY
}

reset_data() {
  # staging only: the database name is fixed above and every command is pinned to wrangler.staging.toml
  [[ "$DB" == "rehearsal-hw-staging" ]] || { echo "refusing: not the staging database" >&2; exit 1; }
  read -r -p "Delete ALL data in the STAGING database ($DB)? Type reset to confirm: " ok
  [[ "$ok" == "reset" ]] || { echo "Cancelled."; exit 0; }
  SQL=""
  for t in submissions attempt_starts student_sessions students assignments classes teacher_sessions auth_codes oauth_handoffs rate_limits beta_redemptions beta_codes teachers; do
    SQL+="DELETE FROM $t;"
  done
  W d1 execute "$DB" --remote --command "$SQL" 2>&1 | grep -E "Executed|rror" || true
  echo "Staging data cleared."
}

status() {
  echo "Staging server:  $(curl -s -o /dev/null -w '%{http_code}' "$API/api/health")  $API"
  echo "Staging website: $(curl -s -o /dev/null -w '%{http_code}' "$SITE/")  $SITE"
}

case "${1:-}" in
  all)    deploy_api; deploy_web; status ;;
  api)    deploy_api ;;
  web)    deploy_web ;;
  seed)   seed ;;
  reset)  reset_data ;;
  status) status ;;
  *) sed -n 2,13p "$0"; exit 1 ;;
esac
