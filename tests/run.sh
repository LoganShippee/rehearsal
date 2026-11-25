#!/bin/zsh
# Runs all automated checks (zero external dependencies):
#   1. App-wide syntax, offline cache, zoom/scroll, stacking, and ID invariants
#   2. Pre-edit permission gate self-tests (Antigravity + Claude Code hooks)
#   3. Grader & tap-test suites, Sight Reading generator (seeded)
#   4. Online Homework server: worker unit tests, D1 schema checks, 90-day audio delete
#      (tests/hw-api-test.mjs needs a running local server, so it stays manual)
# Usage: tests/run.sh
cd "$(dirname "$0")/.."
J=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
echo "== invariants-test"; "$J" tests/invariants-test.js || exit 1
echo "== edit-guard-test"; /usr/bin/python3 tests/edit-guard-test.py || exit 1
for t in grader-test grader-test2 tap-test; do
  echo "== $t"; "$J" tests/$t.js -- web/music.js web/grade.js "$t" || exit 1
done
echo "== grader-takes-test"; "$J" tests/grader-takes-test.js -- web/music.js web/grade.js grader-takes-test || exit 1
echo "== sight-test"; "$J" tests/sight-test.js -- web/sight.js sight-test || exit 1
echo "== hw-worker-unit"; "$J" -m tests/hw-worker-unit.mjs || exit 1
echo "== hw-schema-test"; /usr/bin/python3 tests/hw-schema-test.py || exit 1
echo "== hw-cleanup-test"; "$J" -m tests/hw-cleanup-test.mjs || exit 1
/usr/bin/python3 tests/hw-cleanup-test.py || exit 1
echo "== scan-test"; "$J" tests/scan-test.js || exit 1
echo "== omr-service-test"; /usr/bin/python3 tests/omr-service-test.py || exit 1
echo "== omr-bench-test"; /usr/bin/python3 tests/omr-bench-test.py || exit 1
