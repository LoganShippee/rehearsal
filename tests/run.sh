#!/bin/zsh
# Runs the grader tests (JavaScriptCore, built into macOS). Usage: tests/run.sh
cd "$(dirname "$0")/.."
J=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
for t in grader-test grader-test2 tap-test; do
  echo "== $t"; "$J" tests/$t.js -- web/music.js web/grade.js "$t" || exit 1
done
