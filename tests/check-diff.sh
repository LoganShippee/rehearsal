#!/bin/zsh
# Change-Scope & Protected-Zones Audit for Rehearsal.
# Checks git diff to show EVERY file & feature section touched and fails if any
# Protected Zone (zoom, scrolling, stacking, persistent IDs, grader, etc.) changed
# without explicit acknowledgement.
#
# Usage:
#   tests/check-diff.sh                          # audit uncommitted changes vs HEAD
#   tests/check-diff.sh v1.2.2                   # audit everything since tag/commit v1.2.2
#   tests/check-diff.sh --allow pdf-zoom-scroll  # allow a specific protected zone change
#   tests/check-diff.sh --only web/app.js,web/styles.css  # fail if any other file changed

set -e
cd "$(dirname "$0")/.."

/usr/bin/python3 - "$@" <<'PY'
import json
import os
import re
import subprocess
import sys

args = sys.argv[1:]
base_ref = "HEAD"
allowed_zones = set()
only_files = None

i = 0
while i < len(args):
    a = args[i]
    if a == "--allow" and i + 1 < len(args):
        for z in args[i + 1].split(","):
            if z.strip():
                allowed_zones.add(z.strip())
        i += 2
    elif a == "--only" and i + 1 < len(args):
        only_files = {p.strip() for p in args[i + 1].split(",") if p.strip()}
        i += 2
    elif a in ("-h", "--help"):
        print("Usage: tests/check-diff.sh [base-ref] [--allow zone1,zone2] [--only file1,file2]")
        sys.exit(0)
    else:
        base_ref = a
        i += 1

with open("tests/protected-zones.json", "r", encoding="utf-8") as f:
    manifest = json.load(f)

def git(*cmd):
    return subprocess.check_output(["git", *cmd], text=True, stderr=subprocess.STDOUT)

# Include both staged and unstaged changes against base_ref
diff_text = git("diff", "--unified=0", base_ref)
untracked = [
    line for line in git("ls-files", "--others", "--exclude-standard").splitlines()
    if line.strip()
]

if not diff_text.strip() and not untracked:
    print(f"check-diff: clean (no differences vs {base_ref}).")
    sys.exit(0)

# Parse unified=0 diff into per-file hunks
# file_hunks[path] = list of {"old_start", "old_count", "new_start", "new_count", "added", "removed"}
file_hunks = {}
cur_file = None
cur_hunk = None
hunk_re = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")

for line in diff_text.splitlines():
    if line.startswith("+++ b/"):
        cur_file = line[6:]
        file_hunks.setdefault(cur_file, [])
        cur_hunk = None
    elif line.startswith("+++ /dev/null"):
        cur_file = None
        cur_hunk = None
    elif line.startswith("@@ ") and cur_file is not None:
        m = hunk_re.match(line)
        if m:
            cur_hunk = {
                "old_start": int(m.group(1)),
                "old_count": int(m.group(2)) if m.group(2) is not None else 1,
                "new_start": int(m.group(3)),
                "new_count": int(m.group(4)) if m.group(4) is not None else 1,
                "added": [],
                "removed": [],
            }
            file_hunks[cur_file].append(cur_hunk)
    elif cur_hunk is not None:
        if line.startswith("+") and not line.startswith("+++"):
            cur_hunk["added"].append(line[1:])
        elif line.startswith("-") and not line.startswith("---"):
            cur_hunk["removed"].append(line[1:])

# Helper: find feature section label for a line number in a file
JS_BANNER = re.compile(r"^\s*//\s*(?:={4,}|-{4,})\s*(.+?)\s*$")
CSS_BANNER = re.compile(r"^\s*/\*\s*-{3,}\s*(.+?)(?:\s*-{3,})?\s*\*/\s*$")
file_lines_cache = {}
file_sections_cache = {}

def read_lines(path):
    if path not in file_lines_cache:
        if os.path.isfile(path):
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                file_lines_cache[path] = f.read().splitlines()
        else:
            file_lines_cache[path] = []
    return file_lines_cache[path]

def section_for_line(path, lineno):
    if path not in file_sections_cache:
        secs = []
        lines = read_lines(path)
        pat = CSS_BANNER if path.endswith(".css") else JS_BANNER if path.endswith(".js") else None
        if pat:
            for idx, txt in enumerate(lines, start=1):
                m = pat.match(txt)
                if m:
                    secs.append((idx, m.group(1).strip(" -=")))
        file_sections_cache[path] = secs
    secs = file_sections_cache[path]
    label = "(top of file)"
    for sline, sname in secs:
        if sline <= lineno:
            label = sname
        else:
            break
    return label

def old_file_lines(path):
    key = f"OLD::{path}"
    if key not in file_lines_cache:
        try:
            content = git("show", f"{base_ref}:{path}")
            file_lines_cache[key] = content.splitlines()
        except subprocess.CalledProcessError:
            file_lines_cache[key] = []
    return file_lines_cache[key]

def compute_protected_ranges(rule, lines):
    """Return list of (start_1based, end_1based) tuples in `lines` matching `rule`."""
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

def overlaps(a1, a2, b1, b2):
    return a1 <= b2 and b1 <= a2

# 1. Print Section Impact Summary
print(f"==== Change-Scope Audit (vs {base_ref})")
all_changed_files = sorted(set(file_hunks.keys()) | set(untracked))

for path in all_changed_files:
    if path in untracked and path not in file_hunks:
        print(f"  + [NEW FILE] {path}")
        continue
    hunks = file_hunks.get(path, [])
    sec_stats = {}
    for h in hunks:
        sec = section_for_line(path, max(1, h["new_start"]))
        st = sec_stats.setdefault(sec, [0, 0])
        st[0] += len(h["added"])
        st[1] += len(h["removed"])
    tot_a = sum(len(h["added"]) for h in hunks)
    tot_r = sum(len(h["removed"]) for h in hunks)
    print(f"  * {path} (+{tot_a} / -{tot_r})")
    if path.endswith((".js", ".css")):
        for sec, (a, r) in sec_stats.items():
            print(f"      section: {sec} (+{a} / -{r})")

# 2. Check --only strict scope if requested
scope_violations = []
if only_files is not None:
    for path in all_changed_files:
        if path not in only_files:
            scope_violations.append(path)

# 3. Check Protected Zones against BOTH old lines (deletions/modifications) and new lines (insertions/modifications)
zone_hits = {}
for zone in manifest["zones"]:
    zid = zone["id"]
    for rule in zone["rules"]:
        target = rule["file"]
        if target not in file_hunks:
            continue
        new_lines = read_lines(target)
        old_lines = old_file_lines(target)
        new_ranges = compute_protected_ranges(rule, new_lines)
        old_ranges = compute_protected_ranges(rule, old_lines)
        for h in file_hunks[target]:
            hit = False
            if h["new_count"] > 0:
                n1, n2 = h["new_start"], h["new_start"] + h["new_count"] - 1
                if any(overlaps(n1, n2, r1, r2) for r1, r2 in new_ranges):
                    hit = True
            if not hit and h["old_count"] > 0:
                o1, o2 = h["old_start"], h["old_start"] + h["old_count"] - 1
                if any(overlaps(o1, o2, r1, r2) for r1, r2 in old_ranges):
                    hit = True
            # Also catch pure insertions directly inside an old protected range
            if not hit and h["old_count"] == 0 and h["new_count"] > 0:
                o_pos = max(1, h["old_start"])
                if any(r1 <= o_pos <= r2 for r1, r2 in old_ranges):
                    hit = True
            if hit:
                zone_hits.setdefault(zid, []).append((target, h, zone))

blocked = []
if zone_hits:
    print("")
    print("==== Protected Zones Touched")
    for zid, entries in zone_hits.items():
        zone = entries[0][2]
        allowed = zid in allowed_zones
        status = "ALLOWED (--allow)" if allowed else "BLOCKED"
        print(f"  [{status}] {zid} — {zone['label']}")
        print(f"    Why protected: {zone['reason']}")
        seen = set()
        for target, h, _ in entries:
            loc = f"{target}:L{h['new_start']}"
            if loc in seen:
                continue
            seen.add(loc)
            print(f"    Location: {loc} (+{len(h['added'])} / -{len(h['removed'])})")
        if not allowed:
            blocked.append(zid)

if scope_violations:
    print("")
    print("==== Out-of-Scope Files Touched (--only violation)")
    for p in scope_violations:
        print(f"  [BLOCKED] {p}")

if blocked or scope_violations:
    print("")
    if blocked:
        print("check-diff FAILED: Protected zone(s) modified without approval: " + ", ".join(blocked))
        print("  If this change is intentional and approved, re-run with:")
        print("    tests/check-diff.sh --allow " + ",".join(blocked))
    if scope_violations:
        print("check-diff FAILED: Files outside --only scope were modified.")
    sys.exit(1)

print("")
print("check-diff OK: no unapproved protected-zone changes.")
PY
