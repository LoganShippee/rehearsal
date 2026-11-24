// Teacher settings backup for the browser version's sign-in gate.
//   GET /api/teacher/data  -> {data, rev, updatedAt}   (data null / rev 0 when nothing saved yet)
//   PUT /api/teacher/data  body {data, baseRev}         -> {rev, updatedAt}; stale baseRev -> 409 {error:'conflict', rev, data}
//   POST /api/teacher/start-trial                       -> starts the Online Homework trial for a sync-only account
// Sign-in for the gate sends `syncOnly: true` in the existing auth bodies (email/verify, google, oauth/start) so a
// backup-only account does not silently start the 30-day homework trial (see upsertTeacher in auth.js).
// Only settings are stored: S keys classes/templates/events/settings etc. File blobs are stripped.

import { errResponse, jsonResponse, nowMs, readJsonBody, safeJsonParse } from './util.js';
import { computePlanState } from './billing.js';
import { formatTeacherPublic, startTrialIfPending } from './auth.js';

const MAX_BODY = 1536 * 1024;   // ~1.5 MB request
const MAX_STORED = 1400 * 1024; // after stripping
const KNOWN_KEYS = ['classes', 'settings'];
const BLOB_KEY = /^(blob|blobs|filedata|dataurl|base64|audio|pdfdata)$/i;

function isPlain(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Remove anything shaped like a file blob: big data: URLs and blob-ish keys.
function strip(v, depth = 0) {
  if (depth > 40) return undefined;
  if (typeof v === 'string') return /^data:[^,]{0,80};base64,/i.test(v) && v.length > 2048 ? undefined : v;
  if (Array.isArray(v)) return v.map(x => strip(x, depth + 1)).filter(x => x !== undefined);
  if (isPlain(v)) {
    const out = {};
    for (const k of Object.keys(v)) {
      if (BLOB_KEY.test(k)) continue;
      const r = strip(v[k], depth + 1);
      if (r !== undefined) out[k] = r;
    }
    return out;
  }
  return v;
}

export async function handleGetTeacherData(request, env, auth) {
  const row = await env.DB.prepare('SELECT data, rev, updated_at FROM teacher_data WHERE teacher_id = ?')
    .bind(auth.teacher.id).first();
  if (!row) return jsonResponse({ ok: true, data: null, rev: 0, updatedAt: 0 }, 200, request, env);
  return jsonResponse({ ok: true, data: safeJsonParse(row.data, null), rev: Number(row.rev), updatedAt: Number(row.updated_at) }, 200, request, env);
}

export async function handlePutTeacherData(request, env, auth) {
  const body = await readJsonBody(request, MAX_BODY);
  if (!body.ok) return errResponse(body.error, body.status, 'BAD_REQUEST', request, env);
  const { data, baseRev } = body.data;
  if (!isPlain(data)) return errResponse('Expected data object', 400, 'INVALID_INPUT', request, env);
  if (!KNOWN_KEYS.some(k => k in data)) return errResponse('That does not look like Rehearsal data', 400, 'INVALID_INPUT', request, env);
  if (!Number.isInteger(baseRev) || baseRev < 0) return errResponse('baseRev must be a whole number', 400, 'INVALID_INPUT', request, env);

  const text = JSON.stringify(strip(data));
  if (text.length > MAX_STORED) return errResponse('Too much data to back up', 413, 'TOO_LARGE', request, env);

  const now = nowMs(env);
  const id = auth.teacher.id;
  let changed = 0;
  if (baseRev === 0) {
    const r = await env.DB.prepare(
      'INSERT INTO teacher_data (teacher_id, data, rev, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(teacher_id) DO NOTHING'
    ).bind(id, text, now).run();
    changed = r?.meta?.changes || 0;
  } else {
    const r = await env.DB.prepare(
      'UPDATE teacher_data SET data = ?, rev = rev + 1, updated_at = ? WHERE teacher_id = ? AND rev = ?'
    ).bind(text, now, id, baseRev).run();
    changed = r?.meta?.changes || 0;
  }
  if (!changed) {
    const cur = await env.DB.prepare('SELECT data, rev FROM teacher_data WHERE teacher_id = ?').bind(id).first();
    return jsonResponse({
      ok: false, error: 'conflict', code: 'CONFLICT',
      rev: Number(cur?.rev || 0), data: safeJsonParse(cur?.data, null),
    }, 409, request, env);
  }
  const row = await env.DB.prepare('SELECT rev, updated_at FROM teacher_data WHERE teacher_id = ?').bind(id).first();
  return jsonResponse({ ok: true, rev: Number(row.rev), updatedAt: Number(row.updated_at) }, 200, request, env);
}

export async function handleStartTrial(request, env, auth) {
  const teacher = await startTrialIfPending(env, auth.teacher);
  const plan = computePlanState(teacher, nowMs(env));
  return jsonResponse({ ok: true, teacher: formatTeacherPublic(teacher, plan) }, 200, request, env);
}
