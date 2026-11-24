-- 0004: backs up a teacher's Rehearsal settings (classes, schedules, events; never library files)
-- so the browser version can sign in and restore them. Additive only.
-- sync_only on oauth_handoffs: a browser sign-in that must not start the Online Homework trial
-- (teachers.trial_ends_at = 0 means "trial not started"; see src/auth.js).
CREATE TABLE IF NOT EXISTS teacher_data (
  teacher_id TEXT PRIMARY KEY REFERENCES teachers(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

ALTER TABLE oauth_handoffs ADD COLUMN sync_only INTEGER NOT NULL DEFAULT 0;
