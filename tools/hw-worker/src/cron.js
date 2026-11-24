// Scheduled daily cleanup worker:
//   - Scrubs expired 90-day student audio from R2 while keeping grades intact
//   - Purges expired auth codes, OAuth handoffs, old sessions, and stale rate limits
//   - Marks lapsed trials and past-due grace windows as 'expired' (Read-Only Mode)

import { DAY_MS, nowMs } from './util.js';

const AUDIO_BATCH_SIZE = 200;
const AUDIO_MAX_BATCHES = 10;
const HOUR_MS = 60 * 60 * 1000;

export async function runDailyCleanup(env) {
  const now = nowMs(env);

  // 1. Batch-scrub expired 90-day audio (grades & results_json remain untouched)
  let audioScrubbed = 0;
  for (let batch = 0; batch < AUDIO_MAX_BATCHES; batch++) {
    const expiredRes = await env.DB.prepare(
      `SELECT id, audio_r2_key
       FROM submissions
       WHERE audio_r2_key IS NOT NULL AND audio_expires_at IS NOT NULL AND audio_expires_at <= ?
       LIMIT ?`
    ).bind(now, AUDIO_BATCH_SIZE).all();
    const rows = expiredRes?.results || [];
    if (!rows.length) break;

    for (const row of rows) {
      if (row.audio_r2_key && env.BUCKET) {
        await env.BUCKET.delete(row.audio_r2_key).catch(() => {});
      }
      await env.DB.prepare(
        'UPDATE submissions SET audio_r2_key = NULL, audio_deleted_at = ? WHERE id = ?'
      ).bind(now, row.id).run();
      audioScrubbed++;
    }

    if (rows.length < AUDIO_BATCH_SIZE) break;
  }

  // 2. Purge expired auth_codes (>24h past expiry)
  const authRes = await env.DB.prepare(
    'DELETE FROM auth_codes WHERE expires_at <= ?'
  ).bind(now - DAY_MS).run();
  const authCodesPurged = Number(authRes?.meta?.changes || 0);

  // 3. Purge expired oauth_handoffs (>1h past expiry)
  const handoffRes = await env.DB.prepare(
    'DELETE FROM oauth_handoffs WHERE expires_at <= ?'
  ).bind(now - HOUR_MS).run();
  const handoffsPurged = Number(handoffRes?.meta?.changes || 0);

  // 4. Purge expired teacher_sessions and student_sessions (>7d past expiry)
  const sessionCutoff = now - 7 * DAY_MS;
  const teacherSessRes = await env.DB.prepare(
    'DELETE FROM teacher_sessions WHERE expires_at <= ?'
  ).bind(sessionCutoff).run();
  const studentSessRes = await env.DB.prepare(
    'DELETE FROM student_sessions WHERE expires_at <= ?'
  ).bind(sessionCutoff).run();
  const sessionsPurged =
    Number(teacherSessRes?.meta?.changes || 0) +
    Number(studentSessRes?.meta?.changes || 0);

  // 5. Purge old rate_limits (>24h old and no active block)
  const rateRes = await env.DB.prepare(
    'DELETE FROM rate_limits WHERE window_start <= ? AND (blocked_until IS NULL OR blocked_until <= ?)'
  ).bind(now - DAY_MS, now).run();
  const rateLimitsPurged = Number(rateRes?.meta?.changes || 0);

  // 6. Mark expired trialing and lapsed past_due teachers as 'expired'
  const teachersRes = await env.DB.prepare(
    `UPDATE teachers
     SET plan_status = 'expired', updated_at = ?
     WHERE (plan_status = 'trialing' AND trial_ends_at > 0 AND trial_ends_at <= ?)
        OR (plan_status = 'past_due' AND grace_ends_at IS NOT NULL AND grace_ends_at <= ?)`
  ).bind(now, now, now).run();
  const teachersExpired = Number(teachersRes?.meta?.changes || 0);

  // 7. Test Student homework is only for trying things out: drop it after 7 days
  let testSubmissionsPurged = 0;
  const testRes = await env.DB.prepare(
    `SELECT s.id, s.audio_r2_key
     FROM submissions s
     JOIN students st ON st.id = s.student_id
     WHERE st.is_test = 1 AND s.submitted_at <= ?
     LIMIT ?`
  ).bind(now - 7 * DAY_MS, AUDIO_BATCH_SIZE).all();
  for (const row of testRes?.results || []) {
    if (row.audio_r2_key && env.BUCKET) {
      await env.BUCKET.delete(row.audio_r2_key).catch(() => {});
    }
    await env.DB.prepare('DELETE FROM submissions WHERE id = ?').bind(row.id).run();
    testSubmissionsPurged++;
  }

  return {
    audioScrubbed,
    testSubmissionsPurged,
    authCodesPurged,
    handoffsPurged,
    sessionsPurged,
    rateLimitsPurged,
    teachersExpired,
  };
}
