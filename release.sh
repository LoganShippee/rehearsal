#!/bin/zsh
# Publishes a new version of Rehearsal on GitHub. Everyone's copy picks it up by itself.
#
#   ./release.sh "What changed"            1.0.3 → 1.0.4
#   ./release.sh --minor "What changed"    1.0.3 → 1.1.0
#   ./release.sh --major "What changed"    1.0.3 → 2.0.0
#
# What it does: runs the grader tests, raises the version, commits everything, builds, zips the app and
# the web/ folder, writes latest.json (signed with your release key) and uploads them as a GitHub
# release. If anything in native/, build.sh or the Mac icon changed since the last release, the "native" number goes
# up too, and users get "Install and reopen" instead of a quiet web update.
set -e
cd "$(dirname "$0")"
die() { print -u2 "release: $1"; exit 1; }
export PATH="$HOME/.local/bin:$PATH"            # where the GitHub CLI was installed

KEY="$HOME/.rehearsal/release-key"
REPO=""; source release/config
[[ -n "$REPO" ]] || die "set REPO=\"owner/name\" in release/config first"
command -v gh >/dev/null || die "the GitHub CLI (gh) isn't installed"
gh auth status >/dev/null 2>&1 || die "sign in to GitHub first: gh auth login"
if [[ ! -f "$KEY" ]]; then                         # restore it from the Keychain backup if the file is gone
  K=$(security find-generic-password -s "Rehearsal release key" -w 2>/dev/null || true)
  [[ -n "$K" ]] || die "no release key at $KEY or in the Keychain (restore it from your backup; without it, updates can't be signed)"
  mkdir -p "${KEY:h}" && (umask 077; print -r -- "$K" > "$KEY") && echo "Restored the release key from the Keychain."
fi
git rev-parse --git-dir >/dev/null 2>&1 || die "not a git repository"

bump=patch
case "$1" in --minor) bump=minor; shift;; --major) bump=major; shift;; esac
NOTES="$1"

tests/run.sh >/dev/null || die "the grader tests failed (run tests/run.sh to see why)"

OLD=$(cat release/VERSION); NATIVE=$(cat release/NATIVE); NATIVE_WIN=$(cat release/NATIVE_WIN 2>/dev/null || echo 1)
if git rev-parse -q --verify "refs/tags/v$OLD" >/dev/null; then
  IFS=. read -r MA MI PA <<< "$OLD"
  case $bump in major) NEW="$((MA + 1)).0.0";; minor) NEW="$MA.$((MI + 1)).0";; *) NEW="$MA.$MI.$((PA + 1))";; esac
  # the app shell changed since the last release → users need the whole app, not just web files
  # (the Mac icon lives inside the app too)
  git diff --quiet "v$OLD" -- native build.sh icon/AppIcon.icns || NATIVE=$((NATIVE + 1))
  git diff --quiet "v$OLD" -- windows web/favicon.ico || NATIVE_WIN=$((NATIVE_WIN + 1))
  [[ -n "$NOTES" ]] || NOTES=$(git log --format='- %s' "v$OLD"..HEAD | grep -v '^- Release v' || true)
else
  NEW="$OLD"                                     # the very first release
fi
[[ -n "$NOTES" ]] || NOTES="Rehearsal $NEW"
echo "Releasing Rehearsal $NEW (native $NATIVE, win $NATIVE_WIN) to $REPO"

echo "$NEW" > release/VERSION; echo "$NATIVE" > release/NATIVE; echo "$NATIVE_WIN" > release/NATIVE_WIN
git add -A
git commit -q -m "Release v$NEW" -m "$NOTES" || true
git tag "v$NEW"
git push -q origin HEAD --tags

./build.sh
OUT=build/release; rm -rf "$OUT"; mkdir -p "$OUT"
ditto -c -k --keepParent "build/Rehearsal.app" "$OUT/Rehearsal.zip"
ditto -c -k --keepParent "build/Rehearsal.app/Contents/Resources/web" "$OUT/web.zip"

HEAD_SHA=$(git rev-parse HEAD)
RUN_ID=""
echo "Waiting for Windows build (commit ${HEAD_SHA:0:7})…"
for _ in {1..30}; do
  RUN_ID=$(gh run list --repo "$REPO" --workflow build-windows.yml --commit "$HEAD_SHA" --limit 1 --json databaseId --jq '.[0].databaseId // empty' 2>/dev/null || true)
  [[ -n "$RUN_ID" ]] && break
  sleep 2
done
[[ -n "$RUN_ID" ]] || die "Windows build workflow run not found for commit $HEAD_SHA"
gh run watch "$RUN_ID" --repo "$REPO" --exit-status || die "Windows build failed (see GitHub Actions)"
rm -rf "$OUT/win"
gh run download "$RUN_ID" --repo "$REPO" -n "Rehearsal-Windows-$NEW" -D "$OUT/win"
mv "$OUT/win/Rehearsal-Windows.zip" "$OUT/Rehearsal-Windows.zip"
mv "$OUT/win/Rehearsal-Setup.exe" "$OUT/Rehearsal-Setup.exe"
rm -rf "$OUT/win"

URL="https://github.com/$REPO/releases/download/v$NEW"
APPSHA=$(shasum -a 256 "$OUT/Rehearsal.zip" | cut -d' ' -f1)
WINSHA=$(shasum -a 256 "$OUT/Rehearsal-Windows.zip" | cut -d' ' -f1)
WEBSHA=$(shasum -a 256 "$OUT/web.zip" | cut -d' ' -f1)
VERSION="$NEW" NATIVE="$NATIVE" NATIVE_WIN="$NATIVE_WIN" NOTES="$NOTES" URL="$URL" APPSHA="$APPSHA" WINSHA="$WINSHA" WEBSHA="$WEBSHA" /usr/bin/python3 -c '
import json, os, datetime
e = os.environ
print(json.dumps({"version": e["VERSION"], "native": int(e["NATIVE"]), "nativeWin": int(e["NATIVE_WIN"]), "notes": e["NOTES"],
  "date": datetime.date.today().isoformat(),
  "app": {"url": e["URL"] + "/Rehearsal.zip", "sha256": e["APPSHA"]},
  "appWin": {"url": e["URL"] + "/Rehearsal-Windows.zip", "sha256": e["WINSHA"]},
  "web": {"url": e["URL"] + "/web.zip", "sha256": e["WEBSHA"]}}, indent=1))' > "$OUT/latest.json"

[[ build/rehearsal-sign -nt tools/rehearsal-sign.swift ]] || swiftc -O tools/rehearsal-sign.swift -o build/rehearsal-sign 2>/dev/null
build/rehearsal-sign sign "$KEY" "$OUT/latest.json" > "$OUT/latest.json.sig"
build/rehearsal-sign verify "$(cat release/public-key.txt)" "$OUT/latest.json" "$OUT/latest.json.sig" || die "signature check failed"

# The web version (any browser): the same web folder, published on GitHub Pages (branch gh-pages).
PAGES=build/pages; rm -rf "$PAGES"; mkdir -p "$PAGES"
cp -R "build/Rehearsal.app/Contents/Resources/web/." "$PAGES/"
touch "$PAGES/.nojekyll"
( cd "$PAGES" && git init -q -b gh-pages && git add -A \
  && git -c user.name="$(git -C "$OLDPWD" config user.name)" -c user.email="$(git -C "$OLDPWD" config user.email)" commit -q -m "Rehearsal $NEW (web)" \
  && git push -q -f "https://github.com/$REPO.git" gh-pages )
gh api "repos/$REPO/pages" >/dev/null 2>&1 || gh api -X POST "repos/$REPO/pages" -f "source[branch]=gh-pages" -f "source[path]=/" >/dev/null 2>&1 || true   # 409 = already on
gh release create "v$NEW" "$OUT/Rehearsal.zip" "$OUT/Rehearsal-Windows.zip" "$OUT/Rehearsal-Setup.exe" "$OUT/web.zip" "$OUT/latest.json" "$OUT/latest.json.sig" \
  --repo "$REPO" --title "Rehearsal $NEW" --notes "$NOTES" --latest
echo "Published: https://github.com/$REPO/releases/tag/v$NEW"
echo "New users download: https://github.com/$REPO/releases/latest/download/Rehearsal.zip"
echo "Windows download: https://github.com/$REPO/releases/latest/download/Rehearsal-Setup.exe"
OWNER=${REPO%%/*}; echo "Web version (any browser): https://${OWNER:l}.github.io/${REPO#*/}/"
