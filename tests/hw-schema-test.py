#!/usr/bin/env python3
"""
D1 / SQLite schema verification for tools/hw-worker/schema.sql.
Checks all 11 tables, UNIQUE constraints, CHECK constraints, and ON DELETE CASCADE.
Zero external dependencies (Python 3 stdlib sqlite3).
"""

import os
import sqlite3
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCHEMA_PATH = os.path.join(ROOT, "tools", "hw-worker", "schema.sql")

EXPECTED_TABLES = {
    "teachers",
    "oauth_handoffs",
    "auth_codes",
    "teacher_sessions",
    "classes",
    "students",
    "student_sessions",
    "assignments",
    "attempt_starts",
    "submissions",
    "rate_limits",
    "beta_codes",
    "beta_redemptions",
    "teacher_data",
    "practice_tracks",
}

passed = 0


def check(cond, msg):
    global passed
    if not cond:
        raise AssertionError(f"FAIL: {msg}")
    passed += 1


def expect_integrity_error(conn, sql, params, label):
    try:
        conn.execute(sql, params)
    except sqlite3.IntegrityError:
        check(True, label)
        return
    raise AssertionError(f"FAIL: expected IntegrityError for {label}")


def main():
    with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
        schema_sql = f.read()

    conn = sqlite3.connect(":memory:")
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.executescript(schema_sql)
    # executescript resets nothing, but verify foreign_keys is still ON
    fk_on = conn.execute("PRAGMA foreign_keys;").fetchone()[0]
    check(fk_on == 1, "PRAGMA foreign_keys is ON")

    # 1. Verify all 11 tables exist
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';"
    ).fetchall()
    actual_tables = {r[0] for r in rows}
    check(
        actual_tables == EXPECTED_TABLES,
        f"Expected 15 tables {sorted(EXPECTED_TABLES)}, got {sorted(actual_tables)}",
    )
    check(len(actual_tables) == 15, "Exactly 15 tables created")

    now = 1_700_000_000_000
    trial_end = now + 30 * 86_400_000

    # 2. Seed valid baseline rows
    conn.execute(
        """INSERT INTO teachers (id, email, google_sub, name, plan_status, trial_ends_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'trialing', ?, ?, ?)""",
        ("tch_1", "t1@school.edu", "gsub_t1", "Ms. One", trial_end, now, now),
    )
    conn.execute(
        """INSERT INTO classes (id, teacher_id, name, join_code, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        ("cls_1", "tch_1", "Band Period 1", "ABC-234", now, now),
    )
    conn.execute(
        """INSERT INTO students (id, class_id, display_name, email, google_sub, code_lookup, code_hash, code_salt, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        ("stu_1", "cls_1", "Alex Rivera", "alex@school.edu", "gsub_s1", "lk_1", "hash_1", "salt_1", now, now),
    )
    conn.execute(
        """INSERT INTO student_sessions (id, student_id, class_id, token_hash, auth_method, expires_at, created_at, last_seen_at)
           VALUES (?, ?, ?, ?, 'code', ?, ?, ?)""",
        ("ssess_1", "stu_1", "cls_1", "thash_s1", now + 86_400_000, now, now),
    )
    conn.execute(
        """INSERT INTO assignments (id, class_id, teacher_id, title, type, mode, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'sight', 'true_sight_read', ?, ?)""",
        ("asgn_1", "cls_1", "tch_1", "Unit 1 Sight-Read", now, now),
    )
    conn.execute(
        """INSERT INTO attempt_starts (id, assignment_id, student_id, attempt_num, started_at, study_seconds, expected_sec)
           VALUES (?, ?, ?, 1, ?, 30, 12.5)""",
        ("ast_1", "asgn_1", "stu_1", now),
    )
    conn.execute(
        """INSERT INTO submissions (id, assignment_id, class_id, student_id, attempt_num, attempt_start_id,
                                    overall_pct, rhythm_pct, pitch_pct, submitted_at)
           VALUES (?, ?, ?, ?, 1, 'ast_1', 92, 95, 89, ?)""",
        ("sub_1", "asgn_1", "cls_1", "stu_1", now + 20_000),
    )
    check(True, "Baseline valid inserts succeed")

    # 3. UNIQUE constraints
    expect_integrity_error(
        conn,
        """INSERT INTO students (id, class_id, display_name, google_sub, created_at, updated_at)
           VALUES ('stu_dup_g', 'cls_1', 'Dup Google', 'gsub_s1', ?, ?)""",
        (now, now),
        "UNIQUE(class_id, google_sub)",
    )
    expect_integrity_error(
        conn,
        """INSERT INTO students (id, class_id, display_name, code_lookup, created_at, updated_at)
           VALUES ('stu_dup_c', 'cls_1', 'Dup Code', 'lk_1', ?, ?)""",
        (now, now),
        "UNIQUE(class_id, code_lookup)",
    )
    expect_integrity_error(
        conn,
        """INSERT INTO submissions (id, assignment_id, class_id, student_id, attempt_num, overall_pct, submitted_at)
           VALUES ('sub_dup', 'asgn_1', 'cls_1', 'stu_1', 1, 80, ?)""",
        (now + 30_000,),
        "UNIQUE(assignment_id, student_id, attempt_num) on submissions",
    )
    expect_integrity_error(
        conn,
        """INSERT INTO attempt_starts (id, assignment_id, student_id, attempt_num, started_at)
           VALUES ('ast_dup', 'asgn_1', 'stu_1', 1, ?)""",
        (now + 5_000,),
        "UNIQUE(assignment_id, student_id, attempt_num) on attempt_starts",
    )

    # Same google_sub in a DIFFERENT class is allowed
    conn.execute(
        """INSERT INTO classes (id, teacher_id, name, join_code, created_at, updated_at)
           VALUES ('cls_2', 'tch_1', 'Jazz Band', 'XYZ-789', ?, ?)""",
        (now, now),
    )
    conn.execute(
        """INSERT INTO students (id, class_id, display_name, google_sub, created_at, updated_at)
           VALUES ('stu_other_cls', 'cls_2', 'Alex Rivera', 'gsub_s1', ?, ?)""",
        (now, now),
    )
    check(True, "Same google_sub allowed across different classes")

    # 4. CHECK constraints
    expect_integrity_error(
        conn,
        """INSERT INTO teachers (id, email, plan_status, trial_ends_at, created_at, updated_at)
           VALUES ('tch_bad', 'bad@school.edu', 'bogus_plan', ?, ?, ?)""",
        (trial_end, now, now),
        "CHECK teachers.plan_status",
    )
    for valid_plan in ("trialing", "active", "po_active", "past_due", "canceled", "expired"):
        conn.execute(
            """INSERT INTO teachers (id, email, plan_status, trial_ends_at, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (f"tch_p_{valid_plan}", f"{valid_plan}@school.edu", valid_plan, trial_end, now, now),
        )
    check(True, "All 6 valid plan_status values accepted")

    expect_integrity_error(
        conn,
        """INSERT INTO assignments (id, class_id, teacher_id, title, type, mode, created_at, updated_at)
           VALUES ('asgn_bad_type', 'cls_1', 'tch_1', 'Bad', 'video', 'practice', ?, ?)""",
        (now, now),
        "CHECK assignments.type",
    )
    expect_integrity_error(
        conn,
        """INSERT INTO assignments (id, class_id, teacher_id, title, type, mode, created_at, updated_at)
           VALUES ('asgn_bad_mode', 'cls_1', 'tch_1', 'Bad', 'sight', 'exam_mode', ?, ?)""",
        (now, now),
        "CHECK assignments.mode",
    )
    expect_integrity_error(
        conn,
        """INSERT INTO submissions (id, assignment_id, class_id, student_id, attempt_num, overall_pct, submitted_at)
           VALUES ('sub_high', 'asgn_1', 'cls_1', 'stu_1', 2, 101, ?)""",
        (now + 40_000,),
        "CHECK submissions.overall_pct <= 100",
    )
    expect_integrity_error(
        conn,
        """INSERT INTO submissions (id, assignment_id, class_id, student_id, attempt_num, overall_pct, submitted_at)
           VALUES ('sub_low', 'asgn_1', 'cls_1', 'stu_1', 3, -1, ?)""",
        (now + 40_000,),
        "CHECK submissions.overall_pct >= 0",
    )
    expect_integrity_error(
        conn,
        """INSERT INTO submissions (id, assignment_id, class_id, student_id, attempt_num, teacher_override_pct, submitted_at)
           VALUES ('sub_ov_bad', 'asgn_1', 'cls_1', 'stu_1', 4, 150, ?)""",
        (now + 40_000,),
        "CHECK submissions.teacher_override_pct <= 100",
    )
    # Boundary values 0, 100, and NULL are allowed
    conn.execute(
        """INSERT INTO submissions (id, assignment_id, class_id, student_id, attempt_num, overall_pct, rhythm_pct, pitch_pct, submitted_at)
           VALUES ('sub_bounds', 'asgn_1', 'cls_1', 'stu_1', 2, 0, 100, NULL, ?)""",
        (now + 50_000,),
    )
    check(True, "Submission score boundaries (0, 100, NULL) accepted")

    # Practice tracks: required columns, and they belong to a class
    conn.execute(
        """INSERT INTO practice_tracks (id, class_id, title, score_r2_key, score_filename, score_bytes, created_at)
           VALUES ('pt_1', 'cls_1', 'Ode', 'practice/cls_1/pt_1.mxl', 'ode.mxl', 100, ?)""",
        (now,),
    )
    expect_integrity_error(
        conn,
        """INSERT INTO practice_tracks (id, class_id, title, score_r2_key, score_filename, created_at)
           VALUES ('pt_bad', 'cls_missing', 'X', 'k', 'x.mxl', ?)""",
        (now,),
        "practice_tracks.class_id must reference a real class",
    )
    expect_integrity_error(
        conn,
        """INSERT INTO practice_tracks (id, class_id, title, score_r2_key, score_filename, created_at)
           VALUES ('pt_1', 'cls_1', 'Dup', 'k', 'x.mxl', ?)""",
        (now,),
        "practice_tracks.id is unique",
    )

    # 5. ON DELETE CASCADE — deleting cls_1 wipes students, student_sessions, assignments, attempt_starts, submissions
    conn.execute("DELETE FROM classes WHERE id = 'cls_1'")
    for table, where in [
        ("practice_tracks", "class_id = 'cls_1'"),
        ("students", "class_id = 'cls_1'"),
        ("student_sessions", "class_id = 'cls_1'"),
        ("assignments", "class_id = 'cls_1'"),
        ("attempt_starts", "assignment_id = 'asgn_1'"),
        ("submissions", "class_id = 'cls_1'"),
    ]:
        cnt = conn.execute(f"SELECT COUNT(*) FROM {table} WHERE {where}").fetchone()[0]
        check(cnt == 0, f"ON DELETE CASCADE wiped {table} for cls_1 (remaining={cnt})")

    # Verify cls_2 student survived
    cls2_cnt = conn.execute("SELECT COUNT(*) FROM students WHERE class_id = 'cls_2'").fetchone()[0]
    check(cls2_cnt == 1, "Unrelated class cls_2 student unaffected by cls_1 delete")

    # Also verify deleting teacher cascades to classes and teacher_sessions
    conn.execute(
        """INSERT INTO teacher_sessions (id, teacher_id, token_hash, expires_at, created_at, last_seen_at)
           VALUES ('tsess_1', 'tch_1', 'tthash_1', ?, ?, ?)""",
        (now + 86_400_000, now, now),
    )
    conn.execute(
        "INSERT INTO teacher_data (teacher_id, data, rev, updated_at) VALUES ('tch_1', '{}', 1, ?)", (now,)
    )
    conn.execute("DELETE FROM teachers WHERE id = 'tch_1'")
    check(conn.execute("SELECT COUNT(*) FROM teacher_data WHERE teacher_id = 'tch_1'").fetchone()[0] == 0,
          "Teacher delete cascades to teacher_data")
    check(conn.execute("SELECT COUNT(*) FROM classes WHERE teacher_id = 'tch_1'").fetchone()[0] == 0,
          "Teacher delete cascades to classes")
    check(conn.execute("SELECT COUNT(*) FROM teacher_sessions WHERE teacher_id = 'tch_1'").fetchone()[0] == 0,
          "Teacher delete cascades to teacher_sessions")
    check(conn.execute("SELECT COUNT(*) FROM students WHERE class_id = 'cls_2'").fetchone()[0] == 0,
          "Teacher delete transitively cascades to students")

    print(f"hw-schema-test: ALL {passed} checks passed")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
