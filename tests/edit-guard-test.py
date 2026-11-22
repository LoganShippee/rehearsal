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

# 1. Metronome request editing Metronome section in web/music.js -> ALLOW
r = agy_edit("web/music.js", "METRONOME", "fix the metronome beat flash bug")
check("in-scope: metronome edit in music.js allowed", r.get("decision") == "allow", str(r))

# 2. Metronome request accidentally editing web/pdfview.js -> FORCE_ASK
r = agy_edit("web/pdfview.js", "const reRenderSharp = () => {", "fix the metronome beat flash bug")
check("out-of-scope + protected zone: pdfview.js zoom blocked", r.get("decision") == "force_ask" and "pdf-zoom-scroll" in r.get("reason", ""), str(r))

# 3. Metronome request accidentally editing .pdfv-view in web/styles.css -> FORCE_ASK
r = agy_edit("web/styles.css", ".pdfv-view { overflow: auto; -webkit-overflow-scrolling: touch; }", "fix the metronome beat flash bug")
check("protected zone: .pdfv-view CSS blocked during metronome fix", r.get("decision") == "force_ask" and "pdf-zoom-scroll" in r.get("reason", ""), str(r))

# 4. Metronome request accidentally editing pinch zoom in web/app.js -> FORCE_ASK
r = agy_edit("web/app.js", "window.__pinch = (x, y, mag, phase) => {", "fix the metronome beat flash bug")
check("protected zone: window.__pinch blocked during metronome fix", r.get("decision") == "force_ask" and "unified-pinch-zoom" in r.get("reason", ""), str(r))

# 5. Metronome request accidentally editing unrelated YouTube section in web/app.js -> FORCE_ASK
r = agy_edit("web/app.js", "async function ytTitle(v) {", "fix the metronome beat flash bug")
check("unrelated section in app.js: YouTube blocked during metronome fix", r.get("decision") == "force_ask" and "YouTube" in r.get("reason", ""), str(r))

# 6. Metronome request accidentally editing Sight Reading in web/sight.js -> FORCE_ASK
r = agy_edit("web/sight.js", "const applyLiveZoom =", "fix the metronome beat flash bug")
check("unrelated file + protected zone: sight.js zoom blocked", r.get("decision") == "force_ask", str(r))

# 7. Explicit PDF zoom bug request editing applyPdfZoom in web/pdfview.js -> ALLOW
r = agy_edit("web/pdfview.js", "const reRenderSharp = () => {", "fix the PDF zoom jitter when scrolling")
check("explicitly requested PDF zoom edit allowed", r.get("decision") == "allow", str(r))

# 8. Persistent IDs ALWAYS require confirmation even if mentioned
r = agy_edit("build.sh", "<key>CFBundleIdentifier</key><string>local.rehearsal.app</string>", "update build.sh identifier")
check("persistent-ids always requires permission", r.get("decision") == "force_ask" and "persistent-ids" in r.get("reason", ""), str(r))

# 9. Guardrail self-protection ALWAYS requires confirmation
r = agy_edit("tests/edit-guard.py", "GUARDRAIL_FILES", "update edit-guard.py")
check("self-protection: edit-guard.py always requires permission", r.get("decision") == "force_ask", str(r))
r = agy_edit(".agents/hooks.json", "rehearsal-edit-guard", "update hooks.json")
check("self-protection: .agents/hooks.json always requires permission", r.get("decision") == "force_ask", str(r))

# 10. Conversational follow-up ("yes go ahead") inherits active request from transcript
with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as tf:
    tf.write(json.dumps({"type": "USER_INPUT", "content": "fix the tuner needle jitter"}) + "\n")
    tf.write(json.dumps({"type": "USER_INPUT", "content": "yes go ahead"}) + "\n")
    tpath = tf.name
try:
    r_ok = agy_edit("web/music.js", "// TUNER", "yes go ahead", transcript=tpath)
    r_bad = agy_edit("web/score.js", "ctl.zoomBy = (f, cx, cy) => {", "yes go ahead", transcript=tpath)
    check("follow-up inherits tuner context -> music.js allowed", r_ok.get("decision") == "allow", str(r_ok))
    check("follow-up still blocks unrelated score.js zoom", r_bad.get("decision") == "force_ask", str(r_bad))
finally:
    os.unlink(tpath)

# 11. Claude Code host protocol (--host claude)
with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as tf:
    tf.write(json.dumps({"type": "user", "message": {"content": "fix the audio track loop marker"}}) + "\n")
    cpath = tf.name
try:
    r_ok = claude_edit("web/tools.js", "REHEARSAL AUDIO TRACK PLAYER", transcript=cpath)
    r_bad = claude_edit("web/pdfview.js", "view.style.overflow = 'auto';", transcript=cpath)
    check("claude host: in-scope audio edit returns empty {} (defer to normal)", r_ok == {}, str(r_ok))
    check("claude host: unrelated pdfview zoom returns permissionDecision=ask",
          r_bad.get("hookSpecificOutput", {}).get("permissionDecision") == "ask", str(r_bad))
finally:
    os.unlink(cpath)

print(f"edit-guard: {passed} passed, {failed} failed")
if failed > 0:
    sys.exit(1)
