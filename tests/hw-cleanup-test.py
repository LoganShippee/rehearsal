#!/usr/bin/env python3
"""
90-day audio delete: runs the exact SQL from tools/hw-worker/src/cron.js against
a real SQLite copy of tools/hw-worker/schema.sql and checks that it picks only
expired recordings and keeps every grade and comment.
(tests/hw-cleanup-test.mjs checks the JavaScript side: the file delete and batching.)
Zero external dependencies (Python 3 stdlib sqlite3).
"""

import os
import re
import sqlite3

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCHEMA_PATH = os.path.join(ROOT, "tools", "hw-worker", "schema.sql")
CRON_PATH = os.path.join(ROOT, "tools", "hw-worker", "src", "cron.js")

DAY_MS = 24 * 60 * 60 * 1000
passed = 0


def check(cond, msg):
    global passed
    if not cond:
        raise AssertionError(f"FAIL: {msg}")
    passed += 1


def cron_sql():
    """Pull the audio SELECT and UPDATE out of cron.js so the test runs what ships."""
    with open(CRON_PATH, "r", encoding="utf-8") as f:
        src = f.read()
    strings = re.findall(r"prepare\(\s*(`[^`]*`|'[^']*')", src)
    strings = [s[1:-1] for s in strings]
    select = [s for s in strings if "FROM submissions" in s and "audio_expires_at" in s and s.lstrip().upper().startswith("SELECT")]
    update = [s for s in strings if s.strip().upper().startswith("UPDATE SUBMISSIONS")]
    check(len(select) == 1, "cron.js has exactly one audio SELECT")
    check(len(update) == 1, "cron.js has exactly one submissions UPDATE")
    return select[0], update[0]


def main():
    select_sql, update_sql = cron_sql()

    with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
        schema_sql = f.read()
    conn = sqlite3.connect(":memory:")
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.executescript(schema_sql)

    now = 1_800_000_000_000
    conn.execute(
        """INSERT INTO teachers (id, email, plan_status, trial_ends_at, created_at, updated_at)
           VALUES ('tch_1', 't@school.edu', 'active', ?, ?, ?)""",
        (now + DAY_MS, now, now),
    )
    conn.execute(
        """INSERT INTO classes (id, teacher_id, name, join_code, created_at, updated_at)
           VALUES ('cls_1', 'tch_1', 'Choir', 'ABC-234', ?, ?)""",
        (now, now),
    )
    for sid in ("stu_1", "stu_2", "stu_3", "stu_4", "stu_5"):
        conn.execute(
            """INSERT INTO students (id, class_id, display_name, created_at, updated_at)
               VALUES (?, 'cls_1', ?, ?, ?)""",
            (sid, sid, now, now),
        )
    conn.execute(
        """INSERT INTO assignments (id, class_id, teacher_id, title, type, mode, created_at, updated_at)
           VALUES ('asgn_1', 'cls_1', 'tch_1', 'Unit 1', 'sight', 'practice', ?, ?)""",
        (now, now),
    )

    # (id, student, audio key, expires at, already deleted at)
    cases = [
        ("sub_old", "stu_1", "audio/old.webm", now - DAY_MS, None),          # expired a day ago
        ("sub_edge", "stu_2", "audio/edge.webm", now, None),                 # expires exactly now
        ("sub_fresh", "stu_3", "audio/fresh.webm", now + 1, None),           # 1 ms left: keep
        ("sub_noaudio", "stu_4", None, None, None),                          # never had audio
        ("sub_gone", "stu_5", None, now - 5 * DAY_MS, now - 4 * DAY_MS),     # already deleted
    ]
    for sub_id, stu, key, exp, deleted in cases:
        conn.execute(
            """INSERT INTO submissions (id, assignment_id, class_id, student_id, attempt_num,
                 overall_pct, rhythm_pct, pitch_pct, results_json, audio_r2_key, audio_bytes,
                 audio_expires_at, audio_deleted_at, teacher_override_pct, teacher_comment,
                 graded_at, submitted_at)
               VALUES (?, 'asgn_1', 'cls_1', ?, 1, 87, 91, 83, '{"notes":[1,2,3]}', ?, 1234,
                 ?, ?, 95, 'Nice phrasing', ?, ?)""",
            (sub_id, stu, key, exp, deleted, now - 80 * DAY_MS, now - 90 * DAY_MS),
        )

    grade_cols = ("overall_pct, rhythm_pct, pitch_pct, results_json, teacher_override_pct, "
                  "teacher_comment, graded_at, submitted_at, audio_expires_at")
    before = {r[0]: r[1:] for r in conn.execute(f"SELECT id, {grade_cols} FROM submissions")}

    # 1. The SELECT picks only recordings that still exist and are due.
    rows = conn.execute(select_sql, (now, 200)).fetchall()
    picked = sorted(r[0] for r in rows)
    check(picked == ["sub_edge", "sub_old"], f"SELECT picks expired + exactly-due audio only (got {picked})")
    check(sorted(r[1] for r in rows) == ["audio/edge.webm", "audio/old.webm"], "SELECT returns the R2 keys to delete")

    # 2. Running the UPDATE the way cron.js does clears the audio and nothing else.
    for sub_id, _key in rows:
        conn.execute(update_sql, (now, sub_id))

    state = {r[0]: r[1:] for r in conn.execute("SELECT id, audio_r2_key, audio_deleted_at FROM submissions")}
    check(state["sub_old"] == (None, now), "Expired audio: key cleared, deleted time stamped")
    check(state["sub_edge"] == (None, now), "Exactly-due audio: key cleared, deleted time stamped")
    check(state["sub_fresh"] == ("audio/fresh.webm", None), "Audio with time left is kept")
    check(state["sub_noaudio"] == (None, None), "Submission without audio is untouched")
    check(state["sub_gone"] == (None, now - 4 * DAY_MS), "Already-deleted audio keeps its original deleted time")

    after = {r[0]: r[1:] for r in conn.execute(f"SELECT id, {grade_cols} FROM submissions")}
    check(after == before, "Scores, results, teacher overrides and comments are unchanged for every submission")
    check(conn.execute("SELECT COUNT(*) FROM submissions").fetchone()[0] == 5, "No submission rows are deleted")

    # 3. A second run finds nothing left to do.
    check(conn.execute(select_sql, (now, 200)).fetchall() == [], "Second run finds nothing to delete")

    # 4. The batch LIMIT is honored.
    check(len(conn.execute(select_sql, (now + 2, 1)).fetchall()) == 1, "SELECT respects the batch size")

    print(f"hw-cleanup-test: ALL {passed} checks passed")


if __name__ == "__main__":
    main()
