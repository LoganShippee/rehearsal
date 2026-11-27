// Shared response, validation, ID, CORS, and CSV helpers (zero external deps).

export const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_SCORE_BYTES = 10 * 1024 * 1024; // 10 MB (.mxl / .musicxml)
export const MAX_AUDIO_BYTES = 15 * 1024 * 1024; // 15 MB student recording
export const AUDIO_RETENTION_DAYS = 90;

export function nowMs(env) {
  if (env && typeof env.__now === 'function') return env.__now();
  return Date.now();
}

export function isDevMode(env) {
  return String(env?.DEV_MODE || '').toLowerCase() === 'true';
}

export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export function safeJsonParse(str, fallback = null) {
  if (typeof str !== 'string' || !str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

export function normalizeEmail(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s.length < 3 || s.length > 254) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return '';
  return s;
}

export function cleanText(raw, maxLen = 200) {
  return String(raw == null ? '' : raw).replace(/\r\n/g, '\n').trim().slice(0, maxLen);
}

export function makeId(prefix = '') {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return prefix ? `${prefix}_${hex}` : hex;
}

function originAllowed(origin, list) {
  if (!origin) return false;
  for (const entry of list) {
    if (entry === origin) return true;
    if (entry === 'http://localhost:*' && /^http:\/\/localhost(:\d+)?$/i.test(origin)) return true;
    if (entry === 'http://127.0.0.1:*' && /^http:\/\/127\.0\.0\.1(:\d+)?$/i.test(origin)) return true;
  }
  return false;
}

export function corsHeaders(request, env) {
  const origin = request?.headers?.get('origin') || '';
  const allowedRaw = String(env?.APP_ORIGINS || '*').trim();
  let allowOrigin = '*';
  if (allowedRaw !== '*') {
    const list = allowedRaw.split(',').map(s => s.trim()).filter(Boolean);
    if (originAllowed(origin, list)) allowOrigin = origin;
    else allowOrigin = list[0] || '';
  } else if (origin) {
    allowOrigin = origin;
  }
  const h = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, Range',
    'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length, Content-Disposition',
    'Access-Control-Max-Age': '86400',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
  if (allowOrigin) {
    h['Access-Control-Allow-Origin'] = allowOrigin;
    if (allowOrigin !== '*') h['Vary'] = 'Origin';
  }
  return h;
}

export function jsonResponse(data, status = 200, request = null, env = null, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(request, env),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

export function errResponse(error, status = 400, code = null, request = null, env = null, extra = {}) {
  const body = { ok: false, error };
  if (code) body.code = code;
  Object.assign(body, extra);
  return jsonResponse(body, status, request, env);
}

export async function readJsonBody(request, maxBytes = 512 * 1024) {
  const text = await request.text();
  if (text.length > maxBytes) {
    return { ok: false, error: 'Request body too large', status: 413 };
  }
  if (!text.trim()) return { ok: true, data: {} };
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'Expected JSON object', status: 400 };
    }
    return { ok: true, data: parsed };
  } catch {
    return { ok: false, error: 'Invalid JSON body', status: 400 };
  }
}

export function getBearerToken(request) {
  const auth = request.headers.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

export function getClientIp(request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    '127.0.0.1'
  );
}

// RFC 4180 CSV cell escaping + spreadsheet formula-injection neutralization
export function csvCell(val) {
  let s = val == null ? '' : String(val);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function parseRangeHeader(rangeHeader, totalSize) {
  if (!rangeHeader || !Number.isFinite(totalSize) || totalSize <= 0) return null;
  const m = String(rangeHeader).trim().match(/^bytes=(\d*)-(\d*)$/i);
  if (!m) return { invalid: true };
  let start, end;
  if (m[1] === '' && m[2] === '') return { invalid: true };
  if (m[1] === '') {
    const suffix = Number(m[2]);
    if (!Number.isFinite(suffix) || suffix <= 0) return { invalid: true };
    start = Math.max(0, totalSize - suffix);
    end = totalSize - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? totalSize - 1 : Math.min(totalSize - 1, Number(m[2]));
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= totalSize) {
    return { invalid: true };
  }
  return { start, end, length: end - start + 1 };
}

export async function bestEffortDeleteR2Keys(env, rawKeys) {
  const uniqueKeys = [...new Set((rawKeys || []).filter(k => typeof k === 'string' && k.length > 0))];
  if (!uniqueKeys.length || !env?.BUCKET || typeof env.BUCKET.delete !== 'function') {
    return 0;
  }
  let deleted = 0;
  for (const key of uniqueKeys) {
    try {
      await env.BUCKET.delete(key);
      deleted++;
    } catch {
      // Best-effort cleanup; never block FERPA deletion on an R2 error.
    }
  }
  return deleted;
}

export async function bestEffortDeleteR2Key(env, key) {
  return (await bestEffortDeleteR2Keys(env, [key])) > 0;
}

export function formatAttemptStart(row, { includeMeta = false } = {}) {
  if (!row) return null;
  const out = {
    id: row.id,
    attemptNum: Number(row.attempt_num),
    startedAt: Number(row.started_at),
    studySeconds: Number(row.study_seconds || 30),
    expectedSec: Number(row.expected_sec || 0),
  };
  if (includeMeta) {
    out.assignmentId = row.assignment_id;
    out.consumedAt = row.consumed_at ?? null;
  }
  return out;
}

// ---------- Shared D1 ownership & published-assignment lookup helpers
export async function getOwnedClass(env, classId, teacherId, { activeOnly = false } = {}) {
  return env.DB.prepare(
    `SELECT * FROM classes WHERE id = ? AND teacher_id = ?${activeOnly ? ' AND archived_at IS NULL' : ''}`
  ).bind(classId, teacherId).first();
}

export async function requireOwnedClass(request, env, classId, teacherId, { activeOnly = false } = {}) {
  const cls = await getOwnedClass(env, classId, teacherId, { activeOnly });
  if (!cls) {
    return { error: errResponse(activeOnly ? 'Class not found or archived.' : 'Class not found.', 404, 'CLASS_NOT_FOUND', request, env) };
  }
  return { cls };
}

export async function requireOwnedAssignment(request, env, assignmentId, teacherId, { withClass = false } = {}) {
  const sql = withClass
    ? `SELECT a.*, c.name AS class_name FROM assignments a JOIN classes c ON c.id = a.class_id WHERE a.id = ? AND a.teacher_id = ?`
    : 'SELECT * FROM assignments WHERE id = ? AND teacher_id = ?';
  const assignment = await env.DB.prepare(sql).bind(assignmentId, teacherId).first();
  if (!assignment) {
    return { error: errResponse('Assignment not found.', 404, 'ASSIGNMENT_NOT_FOUND', request, env) };
  }
  return { assignment };
}

export async function requirePublishedAssignment(request, env, assignmentId, classId) {
  const assignment = await env.DB.prepare(
    `SELECT * FROM assignments
     WHERE id = ? AND class_id = ? AND published = 1 AND archived_at IS NULL`
  ).bind(assignmentId, classId).first();
  if (!assignment) {
    return { error: errResponse('Assignment not found.', 404, 'ASSIGNMENT_NOT_FOUND', request, env) };
  }
  return { assignment };
}

export async function requireOwnedSubmission(request, env, submissionId, teacherId) {
  const sub = await env.DB.prepare(
    `SELECT s.*
     FROM submissions s
     JOIN classes c ON c.id = s.class_id
     WHERE s.id = ? AND c.teacher_id = ?`
  ).bind(submissionId, teacherId).first();
  if (!sub) {
    return { error: errResponse('Submission not found', 404, 'SUBMISSION_NOT_FOUND', request, env) };
  }
  return { sub };
}
