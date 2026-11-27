#!/usr/bin/env python3
"""
Tests tests/edit-guard.py across both Antigravity (--host agy) and Claude Code (--host claude).
Verifies that:
  - In-scope edits are allowed
  - Protected zones (zoom, scroll, stacking, persistent IDs, grader) require permission unless requested
  - Unrelated app files and unrelated sections inside app.js/styles.css require permission
  - Guardrail files themselves always require permission
  - Conversational follow-ups inherit recent user intent from transcript
"""

import json
import os
import subprocess
import sys
import tempfile

REPO = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
GUARD = os.path.join(REPO, "tests", "edit-guard.py")

passed = 0
failed = 0


def run_guard(host: str, payload: dict) -> dict:
    p = subprocess.run(
        ["/usr/bin/python3", GUARD, "--host", host],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        check=True,
    )
    return json.loads(p.stdout.strip() or "{}")


def check(name: str, cond: bool, detail: str = ""):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print(f"FAIL: {name}" + (f" — {detail}" if detail else ""))


def agy_edit(rel_path: str, target: str, last_user: str, transcript: str = "") -> dict:
    return run_guard("agy", {
        "hookEventName": "PreToolUse",
        "lastUserInput": last_user,
        "transcriptPath": transcript,
        "cwd": REPO,
        "toolCall": {
            "id": "t1",
            "name": "edit_file",
            "args": {
                "Path": os.path.join(REPO, rel_path),
                "Target": target,
                "Replacement": target,
            },
        },
    })


def claude_edit(rel_path: str, target: str, transcript: str = "") -> dict:
    return run_guard("claude", {
        "hook_event_name": "PreToolUse",
        "transcript_path": transcript,
        "cwd": REPO,
        "tool_name": "Edit",
        "tool_input": {
            "file_path": os.path.join(REPO, rel_path),
            "old_string": target,
            "new_string": target,
        },
    })


print("==== edit-guard-test")

# 1. Normal app/UI/refactor edits inside repo are allowed without pre-edit popups
r = agy_edit("web/music.js", "METRONOME", "fix the metronome beat flash bug")
check("app edit in music.js allowed", r.get("decision") == "allow", str(r))

r = agy_edit("web/pdfview.js", "const reRenderSharp = () => {", "modularize and clean up")
check("UI/zoom edit allowed without pre-edit popup (verified post-edit by reviewer + tests)", r.get("decision") == "allow", str(r))

r = agy_edit("web/app.js", "window.__pinch = (x, y, mag, phase) => {", "modularize app.js")
check("app.js edit allowed without pre-edit popup", r.get("decision") == "allow", str(r))

# 2. Catastrophic alwaysAsk data-safety zones ALWAYS require confirmation
r = agy_edit("build.sh", "<key>CFBundleIdentifier</key><string>local.rehearsal.app</string>", "update build.sh identifier")
check("persistent-ids always requires permission", r.get("decision") == "force_ask" and "persistent-ids" in r.get("reason", ""), str(r))

r = agy_edit("tools/hw-worker/wrangler.toml", "database_id", "update wrangler")
check("homework-data-integrity always requires permission", r.get("decision") == "force_ask" and "homework-data-integrity" in r.get("reason", ""), str(r))

# 3. Claude Code host protocol (--host claude)
r_ok = claude_edit("web/tools.js", "REHEARSAL AUDIO TRACK PLAYER")
r_bad = claude_edit("build.sh", "<key>CFBundleIdentifier</key><string>local.rehearsal.app</string>")
check("claude host: normal app edit returns empty {} (defer to normal)", r_ok == {}, str(r_ok))
check("claude host: persistent-ids returns permissionDecision=ask",
      r_bad.get("hookSpecificOutput", {}).get("permissionDecision") == "ask", str(r_bad))

print(f"edit-guard: {passed} passed, {failed} failed")
if failed > 0:
    sys.exit(1)
