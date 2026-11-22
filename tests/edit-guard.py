#!/usr/bin/env python3
"""
Pre-Edit Permission Gate for Rehearsal (supports both Antigravity and Claude Code).

Runs as a PreToolUse hook before any file edit/write:
  1. Always requires user permission if an agent tries to modify the guardrails themselves.
  2. Checks if the edited lines intersect any Protected Zone in tests/protected-zones.json;
     if the user's request did not explicitly mention that zone, prompts the user for permission.
  3. Checks if the edited file + feature section is related to the user's current request;
     if an agent tries to edit unrelated app code, prompts the user for permission.

Usage:
  Antigravity (.agents/hooks.json):  python3 ../tests/edit-guard.py --host agy
  Claude Code (.claude/settings.json): python3 "$CLAUDE_PROJECT_DIR/tests/edit-guard.py" --host claude
"""

import json
import os
import re
import sys

REPO_ROOT = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

# Guardrail / hook files that an agent must NEVER silently modify without explicit user confirmation.
GUARDRAIL_FILES = {
    "tests/edit-guard.py",
    "tests/protected-zones.json",
    "tests/invariants-test.js",
    "tests/check-diff.sh",
    ".agents/hooks.json",
    ".claude/settings.json",
}

# App code prefixes / files subject to strict request-relevance gating.
APP_CODE_PREFIXES = ("web/", "native/", "windows/")
APP_CODE_FILES = {"build.sh", "release.sh"}

# Feature-topic keyword catalog: each topic maps to the words a user might use when asking about it.
TOPIC_KEYWORDS = {
    "pdf": ["pdf", "pdfview", "pdfv", "page", "pages", "document", "sheet", "annotate pdf", "download pdf"],
    "sight": ["sight", "sight-reading", "sight reading", "rhythm", "solfege", "kodaly", "takadimi", "vexflow", "worksheet", "worksheets", "build", "melody", "canon", "harmony", "counts", "playhead", "measure", "measures"],
    "score": ["score", "scores", "osmd", "musicxml", "musescore", "mscz", "choir", "voice", "voices", "part", "parts", "loop", "spots", "tempo", "playhead", "measure", "measures", "solfege", "counts"],
    "grade": ["grade", "grader", "grading", "tap", "tapping", "pitch", "onset", "mic", "microphone", "clap", "clapping", "sing", "singing", "listen back", "report", "marks"],
    "tuner": ["tuner", "drone", "tune", "tuning", "cents", "needle", "pitch", "chord"],
    "metronome": ["metronome", "metro", "bpm", "tempo", "beat", "beats", "accent", "subdivision", "swing", "gap-click", "speed trainer", "count-off"],
    "piano": ["piano", "keyboard", "warm-up", "warmup", "vocalize", "vocal", "sequencer", "sustain", "chord", "chords"],
    "audio": ["audio", "track", "backing", "waveform", "mp3", "m4a", "wav", "marker", "markers", "loop"],
    "solfege_board": ["solfege", "ladder", "curwen", "hand sign", "hand signs", "boomwhacker", "echo", "mystery"],
    "toolbar": ["toolbar", "dock", "customize", "button", "buttons", "overflow", "idle", "emoji", "emojis", "icon", "icons"],
    "present": ["present", "stage", "agenda", "warm-up", "warmup", "clock", "tab", "tabs", "folder", "folders", "side panel", "divider", "maximize", "quick edit", "look", "theme", "background", "copy", "paste"],
    "windows": ["window", "windows", "tile", "snap", "bookmark", "bookmarks", "browser", "web window", "address bar", "external app", "mirror", "companion", "hud", "mini-hud"],
    "automations": ["automation", "automations", "routine", "routines", "bell", "schedule", "schedules", "timeline", "signal", "signals", "test mode", "event", "events", "announcement", "announcements", "birthday", "birthdays"],
    "calendar": ["calendar", "month", "day off", "no school", "early release", "ics"],
    "progress": ["progress", "tracker", "repertoire", "concert ready", "steps"],
    "recorder": ["recorder", "record", "recording", "recordings", "mic", "waveform", "take", "takes"],
    "youtube": ["youtube", "yt", "video", "playlist", "playlists"],
    "annotate": ["annotate", "annotation", "annotations", "ink", "draw", "drawing", "whiteboard", "board", "paper", "staff", "interact", "eraser", "pen"],
    "timers": ["timer", "timers", "countdown", "noise", "meter", "points", "team", "randomizer", "group", "groups", "floating tool", "tools"],
    "files": ["file", "files", "library", "drive", "google drive", "upload", "import", "export", "backup", "backups"],
    "help": ["help", "tutorial", "tutorials", "guide", "tour", "spotlight", "what's new", "whats new", "welcome", "bug", "feedback", "report"],
    "settings": ["setting", "settings", "editor", "setup", "update", "updates", "sync", "volume", "calibrate", "calibration", "notes", "print", "sub plan", "sub plans", "class", "classes"],
    "zoom": ["zoom", "pinch", "pan", "scroll", "scrollbar", "scrolling"],
    "paid": ["paid", "pro", "premium", "license", "licensing", "billing", "subscription", "subscribe", "checkout", "stripe", "lemon", "gumroad", "paddle", "paywall", "tier", "tiers", "plan", "plans", "upgrade", "account", "accounts", "cloud", "sync", "unlock", "trial", "purchase"],
    "native_mac": ["mac", "macos", "swift", "native", "wkwebview", "musescore", "drive", "app mirror", "screencapture", "updater", "signed", "keychain", "menubar", "fullscreen"],
    "native_win": ["windows", "win", "webview2", "csharp", "c#", "dotnet", "inno", "installer", "exe"],
    "build_release": ["build", "release", "publish", "version", "bundle", "icon", "icns", "sign", "github pages", "gh-pages", "installer"],
    "sw_shell": ["offline", "service worker", "sw.js", "cache", "manifest", "pwa", "ipad", "index.html", "script", "scripts", "load"],
}

# Section banner regexes matching the repo's conventions
JS_BANNER_RE = re.compile(r"^\s*//\s*(?:={4,}|-{4,})\s*(.+?)\s*$")
CSS_BANNER_RE = re.compile(r"^\s*/\*\s*-{3,}\s*(.+?)(?:\s*-{3,})?\s*\*/\s*$")


def emit(host: str, allow: bool, reason: str = ""):
    if host == "claude":
        if allow:
            # Empty JSON lets Claude Code apply its normal permission rules.
            print("{}")
        else:
            print(json.dumps({
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "ask",
                    "permissionDecisionReason": reason,
                }
            }))
    else:
        if allow:
            print(json.dumps({"decision": "allow"}))
        else:
            print(json.dumps({
                "decision": "force_ask",
                "reason": reason,
            }))
    sys.exit(0)


def read_recent_user_messages(transcript_path: str, limit: int = 4) -> list[str]:
    """Read the last `limit` user messages from a JSONL transcript (Antigravity or Claude Code)."""
    if not transcript_path or not os.path.isfile(transcript_path):
        return []
    msgs = []
    try:
        with open(transcript_path, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
        for raw in reversed(lines):
            raw = raw.strip()
            if not raw:
                continue
            try:
                obj = json.loads(raw)
            except Exception:
                continue
            text = None
            # Antigravity transcript.jsonl format
            if obj.get("type") == "USER_INPUT" or obj.get("source") == "USER_EXPLICIT":
                c = obj.get("content")
                if isinstance(c, str) and c.strip():
                    text = c.strip()
            # Claude Code transcript JSONL format
            elif obj.get("type") == "user" or obj.get("role") == "user":
                msg = obj.get("message", obj)
                c = msg.get("content") if isinstance(msg, dict) else None
                if isinstance(c, str) and c.strip():
                    text = c.strip()
                elif isinstance(c, list):
                    parts = [
                        p.get("text", "")
                        for p in c
                        if isinstance(p, dict) and p.get("type") == "text"
                    ]
                    joined = " ".join(p.strip() for p in parts if p.strip())
                    if joined:
                        text = joined
            if text:
                msgs.append(text)
                if len(msgs) >= limit:
                    break
    except Exception:
        return []
    return list(reversed(msgs))


def normalize_text(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").lower()).strip()


def contains_keyword(text: str, kw: str) -> bool:
    kw = kw.lower().strip()
    if not kw:
        return False
    if " " in kw or "-" in kw or "." in kw or "_" in kw:
        return kw in text
    return re.search(r"\b" + re.escape(kw) + r"\b", text) is not None


def zone_matches_request(zone: dict, request_text: str) -> bool:
    if zone.get("alwaysAsk"):
        return False
    if not request_text:
        return False
    if "requirePair" in zone:
        group_a, group_b = zone["requirePair"]
        return (
            any(contains_keyword(request_text, k) for k in group_a)
            and any(contains_keyword(request_text, k) for k in group_b)
        )
    if "requireAny" in zone:
        return any(contains_keyword(request_text, k) for k in zone["requireAny"])
    return False


def read_file_lines(abs_path: str) -> list[str]:
    if not os.path.isfile(abs_path):
        return []
    with open(abs_path, "r", encoding="utf-8", errors="replace") as f:
        return f.read().splitlines()


def find_target_line_ranges(abs_path: str, target_text: str) -> list[tuple[int, int]]:
    """Locate 1-based inclusive (start, end) line ranges where `target_text` appears."""
    if not os.path.isfile(abs_path):
        return []
    if not target_text:
        lines = read_file_lines(abs_path)
        return [(1, max(1, len(lines)))]
    with open(abs_path, "r", encoding="utf-8", errors="replace") as f:
        content = f.read()
    ranges = []
    start = 0
    while True:
        idx = content.find(target_text, start)
        if idx == -1:
            break
        start_line = content.count("\n", 0, idx) + 1
        end_line = start_line + target_text.count("\n")
        ranges.append((start_line, end_line))
        start = idx + max(1, len(target_text))
    if not ranges:
        # Target not found verbatim — treat conservatively as unknown (whole file)
        lines = content.splitlines()
        return [(1, max(1, len(lines)))]
    return ranges


def compute_protected_ranges(rule: dict, lines: list[str]) -> list[tuple[int, int]]:
    if not lines:
        return []
    if rule.get("wholeFile"):
        return [(1, len(lines))]
    ranges = []
    if "startPattern" in rule and "endPattern" in rule:
        sp = re.compile(rule["startPattern"])
        ep = re.compile(rule["endPattern"])
        pad_b = rule.get("padBefore", 0)
        pad_a = rule.get("padAfter", 0)
        in_start = None
        for idx, txt in enumerate(lines, start=1):
            if in_start is None and sp.search(txt):
                in_start = max(1, idx - pad_b)
            elif in_start is not None and ep.search(txt):
                ranges.append((in_start, min(len(lines), idx + pad_a)))
                in_start = None
        if in_start is not None:
            ranges.append((in_start, len(lines)))
    if "matchLines" in rule:
        pats = [re.compile(p) for p in rule["matchLines"]]
        for idx, txt in enumerate(lines, start=1):
            if any(p.search(txt) for p in pats):
                ranges.append((idx, idx))
    return ranges


def overlaps(a1: int, a2: int, b1: int, b2: int) -> bool:
    return a1 <= b2 and b1 <= a2


def section_for_line(rel_path: str, lines: list[str], lineno: int) -> str:
    pat = CSS_BANNER_RE if rel_path.endswith(".css") else JS_BANNER_RE if rel_path.endswith(".js") else None
    if not pat:
        return "(file)"
    label = "(top of file)"
    for idx, txt in enumerate(lines, start=1):
        if idx > lineno:
            break
        m = pat.match(txt)
        if m:
            label = m.group(1).strip(" -=")
    return label


def classify_file_and_section(rel_path: str, section_label: str) -> tuple[str, list[str]]:
    """Return (human_feature_name, list_of_topic_keys) for a file + section."""
    low_sec = section_label.lower()
    base = os.path.basename(rel_path).lower()

    # Standalone feature files
    if rel_path == "web/pdfview.js":
        return ("PDF Viewer", ["pdf", "zoom"])
    if rel_path == "web/sight.js":
        return ("Sight Reading", ["sight", "zoom"])
    if rel_path == "web/score.js":
        return ("Score Practice", ["score", "zoom"])
    if rel_path == "web/grade.js":
        return ("Sight-Reading & Rhythm Grader", ["grade"])
    if rel_path == "web/icons.js":
        return ("Icons", ["toolbar", "present", "paid", "settings"])
    if rel_path in ("web/index.html", "web/sw.js", "web/manifest.webmanifest"):
        return ("App Shell / Offline Loader", ["sw_shell", "paid"])
    if rel_path == "web/music.js":
        if "metronome" in low_sec:
            return ("Metronome", ["metronome"])
        if "tuner" in low_sec or "drone" in low_sec:
            return ("Tuner & Drone", ["tuner"])
        return ("Tuner / Drone / Metronome", ["tuner", "metronome"])
    if rel_path == "web/tools.js":
        if "piano" in low_sec or "warm-up" in low_sec:
            return ("Classroom Piano & Warm-Up", ["piano"])
        if "audio" in low_sec or "track" in low_sec:
            return ("Audio Track Player", ["audio"])
        if "solfege" in low_sec or "curwen" in low_sec:
            return ("Solfege Board", ["solfege_board"])
        return ("Classroom Music Tools (Piano / Audio / Solfege)", ["piano", "audio", "solfege_board"])
    if rel_path.startswith("native/"):
        return (f"Mac Native Shell ({base})", ["native_mac"])
    if rel_path.startswith("windows/"):
        return (f"Windows Shell ({base})", ["native_win"])
    if rel_path in ("build.sh", "release.sh"):
        return (f"Build / Release ({rel_path})", ["build_release"])

    # Dedicated new feature files under web/ (e.g., web/pro.js, web/billing.js, web/license.js)
    if rel_path.startswith("web/") and rel_path not in ("web/app.js", "web/styles.css"):
        stem = os.path.splitext(base)[0]
        matched_topics = []
        for tkey, kws in TOPIC_KEYWORDS.items():
            if stem == tkey or any(stem in k or k in stem for k in kws if len(k) >= 3):
                matched_topics.append(tkey)
        return (f"Web module ({base})", matched_topics or ["paid"])

    # Section-based classification for web/app.js and web/styles.css
    section_rules = [
        (["pinch zoom", "zoom + maximized"], ("Zoom & Pan", ["zoom"])),
        (["pdf viewer", "pdf page"], ("PDF Viewer", ["pdf"])),
        (["sight-reading", "sight reading", "worksheet"], ("Sight Reading", ["sight"])),
        (["score practice", "music windows"], ("Score Practice", ["score", "sight"])),
        (["tuner", "drone"], ("Tuner & Drone", ["tuner"])),
        (["metronome"], ("Metronome", ["metronome"])),
        (["piano", "warm-up"], ("Classroom Piano & Warm-Up", ["piano"])),
        (["backing-track", "audio player", "audio marker"], ("Audio Track Player", ["audio"])),
        (["solfege", "curwen"], ("Solfege Board", ["solfege_board"])),
        (["grading", "grade"], ("Sight-Reading & Rhythm Grader", ["grade"])),
        (["toolbar", "dock", "customize panel", "icons panel", "menus v2"], ("Toolbar & Menus", ["toolbar"])),
        (["annotation", "ink"], ("Annotate & Whiteboard", ["annotate"])),
        (["automation", "timeline", "routines", "schedule"], ("Automations & Schedules", ["automations"])),
        (["calendar", "progress"], ("Calendar & Progress Tracker", ["calendar", "progress"])),
        (["recorder", "record vocals"], ("Recorder", ["recorder"])),
        (["youtube"], ("YouTube Window", ["youtube"])),
        (["timer", "floating tools", "overlay"], ("Timers & Floating Tools", ["timers"])),
        (["bookmark", "free window", "snap one window", "external app", "other apps", "companion", "mini-hud", "stage web"], ("Windows & External Apps", ["windows"])),
        (["files window", "files browser", "files (pdf", "library"], ("Files & Library", ["files"])),
        (["help", "tutorial", "spotlight", "bug report", "what's new", "welcome"], ("Help, Tour & Bug Report", ["help"])),
        (["settings", "updates", "editor", "notes & print", "classes", "events"], ("Settings & Setup Editor", ["settings", "paid"])),
        (["edit in place", "agenda", "tab folder", "class tab", "copy / paste", "look & background", "divider", "present", "stage tab", "render root", "present-state"], ("Present Screen", ["present"])),
        (["sound & music"], ("Sound & Audio Settings", ["settings", "audio", "sight", "score"])),
        (["paid", "pro", "license", "billing", "subscription", "account", "cloud"], ("Paid / Pro Features", ["paid"])),
    ]
    for needles, result in section_rules:
        if any(n in low_sec for n in needles):
            return result

    # Shared core sections in app.js (helpers, data, actions, global events, boot) or base CSS
    if rel_path in ("web/app.js", "web/styles.css"):
        return (f"{rel_path} ({section_label})", ["__shared__"])
    return (rel_path, [])


def request_matches_topics(request_text: str, topics: list[str], rel_path: str, section_label: str) -> bool:
    if not request_text:
        return False
    # Direct mention of the filename or stem (e.g., "pdfview.js" or "app.js")
    base = os.path.basename(rel_path).lower()
    stem = os.path.splitext(base)[0]
    if base in request_text or (len(stem) >= 4 and contains_keyword(request_text, stem)):
        return True
    # Shared core sections (actions, data, boot, buttons & fields): allowed ONLY if the user
    # actually asked to change/fix/add something in the app (and not blocked by Protected Zones).
    if "__shared__" in topics:
        return True
    for t in topics:
        kws = TOPIC_KEYWORDS.get(t, [])
        if any(contains_keyword(request_text, kw) for kw in kws):
            return True
    # Also check words from the section label itself (>= 4 chars)
    sec_words = [w for w in re.findall(r"[a-z]{4,}", section_label.lower()) if w not in ("feature", "polish", "phase", "section", "window", "windows", "panel", "button", "buttons", "screen", "top", "file")]
    if any(contains_keyword(request_text, w) for w in sec_words):
        return True
    return False


def main():
    host = "agy"
    if "--host" in sys.argv:
        idx = sys.argv.index("--host")
        if idx + 1 < len(sys.argv):
            host = sys.argv[idx + 1]

    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except Exception:
        emit(host, True)

    # Extract tool name, file path, and edit target(s) across both host schemas
    if host == "claude":
        tool_name = payload.get("tool_name", "")
        tool_args = payload.get("tool_input") or {}
        raw_path = tool_args.get("file_path") or ""
        targets = []
        if "old_string" in tool_args:
            targets = [tool_args.get("old_string") or ""]
        elif "edits" in tool_args and isinstance(tool_args["edits"], list):
            targets = [e.get("old_string") or "" for e in tool_args["edits"] if isinstance(e, dict)]
        transcript_path = payload.get("transcript_path") or ""
        last_user = payload.get("lastUserInput") or ""
    else:
        tc = payload.get("toolCall") or {}
        tool_name = tc.get("name", "")
        tool_args = tc.get("args") or {}
        raw_path = tool_args.get("Path") or tool_args.get("TargetFile") or ""
        targets = [tool_args.get("Target") or ""] if "Target" in tool_args else []
        transcript_path = payload.get("transcriptPath") or ""
        last_user = payload.get("lastUserInput") or ""

    if not raw_path:
        emit(host, True)

    abs_path = os.path.realpath(raw_path if os.path.isabs(raw_path) else os.path.join(REPO_ROOT, raw_path))
    artifact_dir = os.path.realpath(payload.get("artifactDirectoryPath") or "") if payload.get("artifactDirectoryPath") else ""

    # Allow edits inside the conversation's artifact/scratch directory without gating
    if artifact_dir and (abs_path == artifact_dir or abs_path.startswith(artifact_dir + os.sep)):
        emit(host, True)

    # Outside the repository? Always ask for permission.
    if not (abs_path == REPO_ROOT or abs_path.startswith(REPO_ROOT + os.sep)):
        emit(host, False, f"Permission check: Edit target is outside the Rehearsal repository ({raw_path}).")

    rel_path = os.path.relpath(abs_path, REPO_ROOT).replace(os.sep, "/")

    # 1. Self-protection: never silently edit guardrail / hook files
    if rel_path in GUARDRAIL_FILES:
        emit(
            host,
            False,
            f"Permission check: Agent is trying to edit guardrail file `{rel_path}`. Confirm before modifying permission rules or safety checks.",
        )

    # Build user request context from lastUserInput + recent user messages in transcript
    recent_msgs = read_recent_user_messages(transcript_path, limit=4)
    if last_user and (not recent_msgs or recent_msgs[-1] != last_user):
        recent_msgs.append(last_user)
    request_text = normalize_text(" \n ".join(recent_msgs))

    # Determine exact edited line ranges in the existing file
    file_lines = read_file_lines(abs_path)
    is_new_file = not os.path.isfile(abs_path)
    if is_new_file:
        edited_ranges = [(1, 1)]
    elif targets:
        edited_ranges = []
        for t in targets:
            edited_ranges.extend(find_target_line_ranges(abs_path, t))
    else:
        # Full-file overwrite (write_file / Write)
        edited_ranges = [(1, max(1, len(file_lines)))]

    # 2. Check Protected Zones (tests/protected-zones.json)
    manifest_path = os.path.join(REPO_ROOT, "tests", "protected-zones.json")
    if os.path.isfile(manifest_path) and not is_new_file:
        try:
            with open(manifest_path, "r", encoding="utf-8") as mf:
                manifest = json.load(mf)
        except Exception:
            manifest = {"zones": []}

        for zone in manifest.get("zones", []):
            for rule in zone.get("rules", []):
                if rule.get("file") != rel_path:
                    continue
                p_ranges = compute_protected_ranges(rule, file_lines)
                for e1, e2 in edited_ranges:
                    if any(overlaps(e1, e2, p1, p2) for p1, p2 in p_ranges):
                        if not zone_matches_request(zone, request_text):
                            emit(
                                host,
                                False,
                                f"Permission check (Protected Zone `{zone['id']}`): Agent wants to edit \"{zone['label']}\" at `{rel_path}:L{e1}` ({zone['reason']}), which wasn't requested. Allow this edit?",
                            )

    # 3. Check Unrelated App Code (any edit to web/, native/, windows/, build.sh, release.sh)
    is_app_code = rel_path in APP_CODE_FILES or rel_path.startswith(APP_CODE_PREFIXES)
    if is_app_code:
        # Collect every distinct section touched by this edit
        touched = []
        seen_sec = set()
        for e1, _ in edited_ranges:
            sec = "(new file)" if is_new_file else section_for_line(rel_path, file_lines, e1)
            if sec not in seen_sec:
                seen_sec.add(sec)
                touched.append((e1, sec))

        for line_no, sec in touched:
            feature_name, topics = classify_file_and_section(rel_path, sec)
            if not request_matches_topics(request_text, topics, rel_path, sec):
                loc = f"`{rel_path}`" if is_new_file else f"`{rel_path}:L{line_no}` (section: {sec})"
                emit(
                    host,
                    False,
                    f"Permission check (Unrelated Code): Agent wants to edit {feature_name} at {loc}, which does not appear related to your current request. Allow editing this code?",
                )

    emit(host, True)


if __name__ == "__main__":
    main()
