// 90-day audio delete, JavaScript side: runs runDailyCleanup() from
// tools/hw-worker/src/cron.js with a fake database and file store, and checks
// it deletes each expired recording file, records the delete, keeps going if
// one file delete fails, and works through more than one batch.
// The SQL itself is checked against real SQLite by tests/hw-cleanup-test.py.
// Runs under macOS JavaScriptCore:
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -m tests/hw-cleanup-test.mjs

const log = typeof print === 'function' ? print : (...a) => console.log(...a);
let passed = 0;
function check(cond, msg) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
  passed++;
}

const cron = await import('../tools/hw-worker/src/cron.js');
const util = await import('../tools/hw-worker/src/util.js');

check(util.AUDIO_RETENTION_DAYS === 90, 'Audio is kept for 90 days');

// Fake D1: answers the audio SELECT from a list of expired rows (the real
// WHERE clause is tested in hw-cleanup-test.py) and records every UPDATE.
function makeEnv(expiredRows, { failKeys = [] } = {}) {
  const pending = expiredRows.map(r => ({ ...r }));
  const updates = [];
  const selects = [];
  const deleted = [];
  const NOW = 1_800_000_000_000;
  const DB = {
    prepare(sql) {
      const q = sql.replace(/\s+/g, ' ').trim();
      let params = [];
      const stmt = {
        bind(...a) { params = a; return stmt; },
        async all() {
          if (q.startsWith('SELECT id, audio_r2_key FROM submissions')) {
            selects.push(params);
            const [, limit] = params;
            return { results: pending.slice(0, limit).map(r => ({ id: r.id, audio_r2_key: r.audio_r2_key })) };
          }
          return { results: [] };
        },
        async run() {
          if (q.startsWith('UPDATE submissions SET audio_r2_key = NULL')) {
            updates.push({ sql: q, params });
            const i = pending.findIndex(r => r.id === params[1]);
            if (i >= 0) pending.splice(i, 1);
          }
          return { meta: { changes: 0 } };
        },
      };
      return stmt;
    },
  };
  const BUCKET = {
    async delete(key) {
      if (failKeys.includes(key)) throw new Error('R2 unavailable');
      deleted.push(key);
    },
  };
  return { env: { DB, BUCKET, __now: () => NOW }, NOW, updates, selects, deleted, pending };
}

// 1. Two expired recordings: both files deleted, both rows updated.
{
  const t = makeEnv([
    { id: 'sub_a', audio_r2_key: 'audio/a.webm' },
    { id: 'sub_b', audio_r2_key: 'audio/b.webm' },
  ]);
  const res = await cron.runDailyCleanup(t.env);
  check(res.audioScrubbed === 2, 'Reports 2 recordings deleted');
  check(t.selects[0][0] === t.NOW, 'Looks for audio due as of now');
  check(JSON.stringify(t.deleted) === '["audio/a.webm","audio/b.webm"]', 'Deletes exactly the expired files');
  check(t.updates.length === 2, 'Updates one row per deleted file');
  check(t.updates.every(u => u.params[0] === t.NOW), 'Stamps the delete time as now');
  check(JSON.stringify(t.updates.map(u => u.params[1])) === '["sub_a","sub_b"]', 'Updates the right submissions');
  // The UPDATE must never touch scores or comments.
  check(t.updates.every(u => !/pct|results_json|comment|graded_at/i.test(u.sql)), 'UPDATE leaves grades and comments alone');
}

// 2. Nothing expired: nothing deleted.
{
  const t = makeEnv([]);
  const res = await cron.runDailyCleanup(t.env);
  check(res.audioScrubbed === 0 && t.deleted.length === 0 && t.updates.length === 0, 'Nothing expired means nothing deleted');
}

// 3. One file delete fails: the rest still go, and the row is still cleared
//    so students can no longer reach the recording.
{
  const t = makeEnv([
    { id: 'sub_a', audio_r2_key: 'audio/a.webm' },
    { id: 'sub_b', audio_r2_key: 'audio/b.webm' },
    { id: 'sub_c', audio_r2_key: 'audio/c.webm' },
  ], { failKeys: ['audio/b.webm'] });
  const res = await cron.runDailyCleanup(t.env);
  check(res.audioScrubbed === 3, 'A failed file delete does not stop the cleanup');
  check(JSON.stringify(t.deleted) === '["audio/a.webm","audio/c.webm"]', 'Other files are still deleted');
}

// 4. More than one batch (batches of 200): 450 expired recordings all go.
{
  const rows = Array.from({ length: 450 }, (_, i) => ({ id: `sub_${i}`, audio_r2_key: `audio/${i}.webm` }));
  const t = makeEnv(rows);
  const res = await cron.runDailyCleanup(t.env);
  check(res.audioScrubbed === 450, 'All 450 recordings deleted across batches');
  check(t.selects.length === 3 && t.selects.every(p => p[1] === 200), 'Works in batches of 200');
  check(t.pending.length === 0, 'No expired recording is left behind');
}

// 5. No file store configured: rows are still cleared (no crash).
{
  const t = makeEnv([{ id: 'sub_a', audio_r2_key: 'audio/a.webm' }]);
  delete t.env.BUCKET;
  const res = await cron.runDailyCleanup(t.env);
  check(res.audioScrubbed === 1 && t.updates.length === 1, 'Works without a file store');
}

log(`hw-cleanup-test: ALL ${passed} checks passed`);
