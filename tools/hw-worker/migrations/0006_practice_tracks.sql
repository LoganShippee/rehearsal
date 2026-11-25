-- Free-practice tracks a teacher shares with a whole class (not graded, not tied to an assignment).
-- Additive only. Run tools/hw-worker/backup-d1.sh before applying.
CREATE TABLE IF NOT EXISTS practice_tracks (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  score_r2_key TEXT NOT NULL,
  score_filename TEXT NOT NULL,
  score_bytes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  archived_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_practice_tracks_class ON practice_tracks(class_id, archived_at);
