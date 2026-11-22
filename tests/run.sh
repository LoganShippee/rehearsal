#!/bin/zsh
# Runs all automated checks (zero external dependencies):
#   1. App-wide syntax, offline cache, zoom/scroll, stacking, and ID invariants
#   2. Pre-edit permission gate self-tests (Antigravity + Claude Code hooks)
#   3. Grader & tap-test suites
# Usage: tests/run.sh
cd "$(dirname "$0")/.."
J=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
echo "== invariants-test"; "$J" tests/invariants-test.js || exit 1
echo "== edit-guard-test"; /usr/bin/python3 tests/edit-guard-test.py || exit 1
for t in grader-test grader-test2 tap-test; do
  echo "== $t"; "$J" tests/$t.js -- web/music.js web/grade.js "$t" || exit 1
done
