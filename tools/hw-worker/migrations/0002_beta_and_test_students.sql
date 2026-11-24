-- 0002: beta codes for teachers + a built-in test student per class.
-- Additive only: no existing table is dropped or rebuilt.

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
