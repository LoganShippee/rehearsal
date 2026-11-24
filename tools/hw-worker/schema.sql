-- Rehearsal Online Homework — Cloudflare D1 (SQLite) Schema
-- Apply locally:  npx wrangler d1 execute rehearsal-hw --local --file=./schema.sql
-- Apply remote:   npx wrangler d1 execute rehearsal-hw --remote --file=./schema.sql

PRAGMA foreign_keys = ON;

-- 1. Teachers (accounts + subscription/trial/PO plan state)
CREATE TABLE IF NOT EXISTS teachers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  google_sub TEXT UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  plan_status TEXT NOT NULL DEFAULT 'trialing'
    CHECK (plan_status IN ('trialing', 'active', 'po_active', 'past_due', 'canceled', 'expired')),
  trial_ends_at INTEGER NOT NULL,
  plan_ends_at INTEGER,
  grace_ends_at INTEGER,
  student_soft_cap INTEGER NOT NULL DEFAULT 200,
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  po_reference TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_teachers_email ON teachers(email);
CREATE INDEX IF NOT EXISTS idx_teachers_google_sub ON teachers(google_sub);
CREATE INDEX IF NOT EXISTS idx_teachers_plan ON teachers(plan_status, trial_ends_at, grace_ends_at);

-- 2. Desktop OAuth Handoffs (Mac/Windows system-browser Google Sign-In, 60s TTL)
CREATE TABLE IF NOT EXISTS oauth_handoffs (
  state TEXT PRIMARY KEY,
  poll_secret_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'complete', 'claimed', 'expired')),
  teacher_id TEXT REFERENCES teachers(id) ON DELETE CASCADE,
  ephemeral INTEGER NOT NULL DEFAULT 0,
  session_token_plain TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_handoffs_expires ON oauth_handoffs(expires_at);

-- 3. Teacher 6-Digit Email Login Codes (10-min TTL, single-use, locks after 5 wrong tries)
CREATE TABLE IF NOT EXISTS auth_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  used_at INTEGER,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_codes_email ON auth_codes(email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_codes_expires ON auth_codes(expires_at);

-- 4. Teacher Sessions (hashed bearer tokens, shared-computer ephemeral flag, revocable)
CREATE TABLE IF NOT EXISTS teacher_sessions (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  ephemeral INTEGER NOT NULL DEFAULT 0,
  user_agent TEXT NOT NULL DEFAULT '',
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_teacher_sessions_teacher ON teacher_sessions(teacher_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_teacher_sessions_expires ON teacher_sessions(expires_at);

-- 5. Classes (with Class Join Code, Lock Class toggle, and soft Archive)
CREATE TABLE IF NOT EXISTS classes (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  join_code TEXT NOT NULL UNIQUE,
  locked INTEGER NOT NULL DEFAULT 0,
  archived_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_classes_teacher ON classes(teacher_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_classes_join_code ON classes(join_code);

-- 6. Students (Google Sign-In bound by immutable google_sub AND/OR Personal 6-char PBKDF2 code)
CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  email TEXT,
  google_sub TEXT,
  part TEXT NOT NULL DEFAULT '',
  code_lookup TEXT,
  code_hash TEXT,
  code_salt TEXT,
  failed_code_attempts INTEGER NOT NULL DEFAULT 0,
  code_cooldown_until INTEGER,
  code_hard_locked INTEGER NOT NULL DEFAULT 0,
  archived_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(class_id, google_sub),
  UNIQUE(class_id, code_lookup)
);

CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_students_google_sub ON students(google_sub);
CREATE INDEX IF NOT EXISTS idx_students_class_email ON students(class_id, email);

-- 7. Student Sessions (default short TTL for shared Chromebooks; revocable by teacher)
CREATE TABLE IF NOT EXISTS student_sessions (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  auth_method TEXT NOT NULL CHECK (auth_method IN ('google', 'code')),
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_student_sessions_student ON student_sessions(student_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_student_sessions_class ON student_sessions(class_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_student_sessions_expires ON student_sessions(expires_at);

-- 8. Assignments (Sight Reading, Score Practice .mxl/.musicxml, Audio-Only)
CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  instructions TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL CHECK (type IN ('sight', 'score', 'audio')),
  mode TEXT NOT NULL DEFAULT 'practice' CHECK (mode IN ('practice', 'true_sight_read')),
  config_json TEXT NOT NULL DEFAULT '{}',
  score_r2_key TEXT,
  score_filename TEXT,
  score_bytes INTEGER NOT NULL DEFAULT 0,
  due_at INTEGER,
  max_attempts INTEGER,
  grade_policy TEXT NOT NULL DEFAULT 'best' CHECK (grade_policy IN ('best', 'last')),
  published INTEGER NOT NULL DEFAULT 1,
  archived_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assignments_class ON assignments(class_id, archived_at, published);
CREATE INDEX IF NOT EXISTS idx_assignments_teacher ON assignments(teacher_id);

-- 9. Attempt Starts (True Sight-Read server-side reveal timestamp & single-shot enforcement)
CREATE TABLE IF NOT EXISTS attempt_starts (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  attempt_num INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  study_seconds INTEGER NOT NULL DEFAULT 30,
  expected_sec REAL NOT NULL DEFAULT 0,
  consumed_at INTEGER,
  UNIQUE(assignment_id, student_id, attempt_num)
);

CREATE INDEX IF NOT EXISTS idx_attempt_starts_lookup
  ON attempt_starts(assignment_id, student_id, consumed_at);

-- 10. Submissions (server-recomputed scores, integrity flags, 90-day expiring R2 audio)
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  attempt_num INTEGER NOT NULL,
  attempt_start_id TEXT REFERENCES attempt_starts(id) ON DELETE SET NULL,
  overall_pct INTEGER CHECK (overall_pct IS NULL OR (overall_pct >= 0 AND overall_pct <= 100)),
  rhythm_pct INTEGER CHECK (rhythm_pct IS NULL OR (rhythm_pct >= 0 AND rhythm_pct <= 100)),
  pitch_pct INTEGER CHECK (pitch_pct IS NULL OR (pitch_pct >= 0 AND pitch_pct <= 100)),
  results_json TEXT,
  integrity_flags_json TEXT NOT NULL DEFAULT '[]',
  duration_sec REAL NOT NULL DEFAULT 0,
  expected_sec REAL,
  audio_r2_key TEXT,
  audio_mime TEXT,
  audio_bytes INTEGER NOT NULL DEFAULT 0,
  audio_expires_at INTEGER,
  audio_deleted_at INTEGER,
  teacher_override_pct INTEGER CHECK (teacher_override_pct IS NULL OR (teacher_override_pct >= 0 AND teacher_override_pct <= 100)),
  teacher_comment TEXT NOT NULL DEFAULT '',
  graded_at INTEGER,
  submitted_at INTEGER NOT NULL,
  UNIQUE(assignment_id, student_id, attempt_num)
);

CREATE INDEX IF NOT EXISTS idx_submissions_assignment ON submissions(assignment_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_class ON submissions(class_id, assignment_id, student_id);
CREATE INDEX IF NOT EXISTS idx_submissions_student ON submissions(student_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_audio_expiry ON submissions(audio_expires_at) WHERE audio_r2_key IS NOT NULL;

-- 11. Rate Limits (IP & login throttle counters)
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL,
  blocked_until INTEGER
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start);

-- 12-13. Beta codes + test students (same as migrations/0002_beta_and_test_students.sql)
CREATE TABLE IF NOT EXISTS beta_codes (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL DEFAULT '',
  max_uses INTEGER NOT NULL DEFAULT 1,
  uses INTEGER NOT NULL DEFAULT 0,
  plan_ends_at INTEGER NOT NULL,
  student_soft_cap INTEGER NOT NULL DEFAULT 300,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS beta_redemptions (
  code TEXT NOT NULL,
  teacher_id TEXT NOT NULL,
  redeemed_at INTEGER NOT NULL,
  PRIMARY KEY (code, teacher_id)
);

ALTER TABLE teachers ADD COLUMN beta_code TEXT;
ALTER TABLE students ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_students_test ON students(class_id, is_test);
