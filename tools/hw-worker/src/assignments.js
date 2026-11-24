// Assignments CRUD, MusicXML (.mxl / .musicxml) score storage, and Student Portal views.
// Zero external dependencies — pure Cloudflare Worker ESM.

import {
  MAX_SCORE_BYTES,
  clamp,
  cleanText,
  corsHeaders,
  errResponse,
  jsonResponse,
  makeId,
  nowMs,
  readJsonBody,
  safeJsonParse,
} from './util.js';
import { assertTeacherWritable } from './billing.js';
import { requireStudent, requireTeacher } from './auth.js';
import { PREVIEW_TOKEN_TTL_MS, signPreviewToken, verifyPreviewToken } from './crypto.js';

const MAX_CONFIG_BYTES = 128 * 1024; // 128 KB max assignment config JSON
const VALID_TYPES = new Set(['sight', 'score', 'audio']);
const VALID_MODES = new Set(['practice', 'true_sight_read']);
const VALID_GRADE_POLICIES = new Set(['best', 'last']);

const MUSESCORE_UNSUPPORTED_MSG =
  "MuseScore (.mscz) files aren't supported directly online. In MuseScore, choose File → Export → MusicXML (.mxl or .musicxml) and upload that file.";

function utf8ByteLength(str) {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str).length;
  }
  return str.length;
}

function sanitizeFilename(rawName, fallback) {
  let decoded = String(rawName || '');
  try { decoded = decodeURIComponent(decoded); } catch {}
  const base = decoded.split(/[/\\]/).pop() || '';
  const cleaned = base
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^\.+/, '');
  if (!cleaned) return fallback;
  if (cleaned.length <= 120) return cleaned;
  const dot = cleaned.lastIndexOf('.');
  if (dot > 0 && cleaned.length - dot <= 16) {
    const ext = cleaned.slice(dot);
    return cleaned.slice(0, 120 - ext.length) + ext;
  }
  return cleaned.slice(0, 120);
}

function isActiveAttemptStart(startRow, now) {
  if (!startRow || startRow.consumed_at != null) return false;
  const studySec = Number(startRow.study_seconds || 30);
  const expectedSec = Math.max(Number(startRow.expected_sec || 0), 15);
  const maxWindowSec = studySec + expectedSec + 120;
  const elapsedSec = (now - Number(startRow.started_at || 0)) / 1000;
  return elapsedSec <= maxWindowSec;
}

function formatAttemptStart(row) {
  if (!row) return null;
  return {
    id: row.id,
    attemptNum: Number(row.attempt_num),
    startedAt: Number(row.started_at),
    studySeconds: Number(row.study_seconds || 30),
    expectedSec: Number(row.expected_sec || 0),
  };
}

function formatAssignment(row, configOverride = undefined) {
  const config = configOverride !== undefined
    ? configOverride
    : safeJsonParse(row.config_json, {});
  return {
    id: row.id,
    classId: row.class_id,
    title: row.title,
    instructions: row.instructions || '',
    type: row.type,
    mode: row.mode,
    config,
    hasScoreFile: !!row.score_r2_key,
    scoreFilename: row.score_filename || null,
    scoreBytes: Number(row.score_bytes || 0),
    dueAt: row.due_at != null ? Number(row.due_at) : null,
    maxAttempts: row.max_attempts != null ? Number(row.max_attempts) : null,
    gradePolicy: row.grade_policy || 'best',
    published: !!row.published,
    archivedAt: row.archived_at != null ? Number(row.archived_at) : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

// Clean student-facing submission summary — NEVER exposes internal integrity flags or R2 keys.
function formatStudentSubmissionSummary(sub, now) {
  if (!sub) return null;
  const effectivePct = sub.teacher_override_pct != null
    ? Number(sub.teacher_override_pct)
    : (sub.overall_pct != null ? Number(sub.overall_pct) : null);
  const audioAvailable = !!(
    sub.audio_r2_key &&
    !sub.audio_deleted_at &&
    (!sub.audio_expires_at || Number(sub.audio_expires_at) > now)
  );
  return {
    id: sub.id,
    attemptNum: Number(sub.attempt_num),
    overallPct: sub.overall_pct != null ? Number(sub.overall_pct) : null,
    rhythmPct: sub.rhythm_pct != null ? Number(sub.rhythm_pct) : null,
    pitchPct: sub.pitch_pct != null ? Number(sub.pitch_pct) : null,
    effectivePct,
    teacherOverridePct: sub.teacher_override_pct != null ? Number(sub.teacher_override_pct) : null,
    teacherComment: sub.teacher_comment || '',
    gradedAt: sub.graded_at != null ? Number(sub.graded_at) : null,
    submittedAt: Number(sub.submitted_at),
    audioAvailable,
  };
}

function pickBestSubmission(cleanSubs) {
  if (!cleanSubs.length) return null;
  let best = null;
  for (const s of cleanSubs) {
    if (s.effectivePct == null) continue;
    if (!best || s.effectivePct > best.effectivePct ||
        (s.effectivePct === best.effectivePct && s.attemptNum > best.attemptNum)) {
      best = s;
    }
  }
  return best || cleanSubs[0];
}

// ---------- Config sanitization & True Sight-Read excerpt stripping

export function sanitizeAssignmentConfig(type, mode, rawConfig) {
  const input = rawConfig == null ? {} : rawConfig;
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Assignment config must be a JSON object.' };
  }

  let cfg;
  try {
    cfg = JSON.parse(JSON.stringify(input));
  } catch {
    return { ok: false, error: 'Assignment config could not be serialized as JSON.' };
  }

  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
    return { ok: false, error: 'Assignment config must be a JSON object.' };
  }

  const rawStrict = cfg.strictness && typeof cfg.strictness === 'object' && !Array.isArray(cfg.strictness)
    ? cfg.strictness
    : {};
  const rVal = Number(rawStrict.rhythm);
  const pVal = Number(rawStrict.pitch);
  cfg.strictness = {
    rhythm: Number.isFinite(rVal) ? clamp(Math.round(rVal), 0, 100) : 25,
    pitch: Number.isFinite(pVal) ? clamp(Math.round(pVal), 0, 100) : 25,
  };

  if (mode === 'true_sight_read') {
    const sVal = Number(cfg.studySeconds);
    cfg.studySeconds = Number.isFinite(sVal) ? clamp(Math.round(sVal), 15, 60) : 30;
  }

  const configJson = JSON.stringify(cfg);
  if (utf8ByteLength(configJson) > MAX_CONFIG_BYTES) {
    return { ok: false, error: 'Assignment config exceeds the 128 KB size limit.' };
  }

  return { ok: true, config: cfg, configJson };
}

export function stripTrueSightReadExcerpt(config) {
  if (!config || typeof config !== 'object') return {};
  let copy;
  try {
    copy = JSON.parse(JSON.stringify(config));
  } catch {
    return {};
  }
  if (!copy || typeof copy !== 'object' || Array.isArray(copy)) return {};

  delete copy.ex;
  if (copy.build && typeof copy.build === 'object') {
    delete copy.build.notes;
  }
  if (copy.srState && typeof copy.srState === 'object') {
    delete copy.srState.ex;
    if (copy.srState.build && typeof copy.srState.build === 'object') {
      delete copy.srState.build.notes;
    }
  }
  return copy;
}

// ---------- Teacher Assignment CRUD

export async function handleListClassAssignments(request, env, auth, classId) {
  const cls = await env.DB.prepare(
    'SELECT id FROM classes WHERE id = ? AND teacher_id = ?'
  ).bind(classId, auth.teacher.id).first();
  if (!cls) return errResponse('Class not found.', 404, 'CLASS_NOT_FOUND', request, env);

  let includeArchived = false;
  try {
    const url = new URL(request.url);
    const param = url.searchParams.get('includeArchived');
    includeArchived = param === '1' || param === 'true';
  } catch {}

  const archivedClause = includeArchived ? '' : 'AND a.archived_at IS NULL';
  const rowsRes = await env.DB.prepare(
    `SELECT a.*,
            (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id) AS submission_count,
            (SELECT COUNT(DISTINCT s.student_id) FROM submissions s WHERE s.assignment_id = a.id) AS unique_student_count,
            (SELECT AVG(COALESCE(s.teacher_override_pct, s.overall_pct))
             FROM submissions s
             WHERE s.assignment_id = a.id
               AND COALESCE(s.teacher_override_pct, s.overall_pct) IS NOT NULL) AS avg_pct
     FROM assignments a
     WHERE a.class_id = ? AND a.teacher_id = ? ${archivedClause}
     ORDER BY a.created_at DESC`
  ).bind(classId, auth.teacher.id).all();

  const assignments = (rowsRes?.results || []).map(row => ({
    ...formatAssignment(row),
    submissionCount: Number(row.submission_count || 0),
    uniqueStudentCount: Number(row.unique_student_count || 0),
    avgPct: row.avg_pct != null ? Math.round(Number(row.avg_pct)) : null,
  }));

  return jsonResponse({ ok: true, assignments }, 200, request, env);
}

export async function handleCreateAssignment(request, env, auth, classId) {
  const blocked = assertTeacherWritable(auth.teacher, request, env);
  if (blocked) return blocked;

  const cls = await env.DB.prepare(
    'SELECT id FROM classes WHERE id = ? AND teacher_id = ? AND archived_at IS NULL'
  ).bind(classId, auth.teacher.id).first();
  if (!cls) return errResponse('Class not found or archived.', 404, 'CLASS_NOT_FOUND', request, env);

  const body = await readJsonBody(request);
  if (!body.ok) return errResponse(body.error, body.status, 'BAD_REQUEST', request, env);
  const d = body.data;

  const title = cleanText(d.title, 200);
  if (!title) {
    return errResponse('Assignment title is required.', 400, 'INVALID_TITLE', request, env);
  }

  const type = String(d.type || '').trim();
  if (!VALID_TYPES.has(type)) {
    return errResponse('Assignment type must be sight, score, or audio.', 400, 'INVALID_TYPE', request, env);
  }

  let mode = 'practice';
  if (d.mode !== undefined && d.mode !== null && d.mode !== '') {
    const rawMode = String(d.mode).trim();
    if (!VALID_MODES.has(rawMode)) {
      return errResponse('Assignment mode must be practice or true_sight_read.', 400, 'INVALID_MODE', request, env);
    }
    mode = rawMode;
  }
  if (type !== 'sight') {
    mode = 'practice';
  }

  const instructions = cleanText(d.instructions || '', 4000);
  const cfgOut = sanitizeAssignmentConfig(type, mode, d.config);
  if (!cfgOut.ok) {
    return errResponse(cfgOut.error, 400, 'INVALID_CONFIG', request, env);
  }

  let dueAt = null;
  if (d.dueAt !== undefined && d.dueAt !== null && d.dueAt !== '') {
    const n = Number(d.dueAt);
    if (!Number.isFinite(n) || n <= 0) {
      return errResponse('Due date must be a valid timestamp.', 400, 'INVALID_DUE_AT', request, env);
    }
    dueAt = Math.round(n);
  }

  let maxAttempts = mode === 'true_sight_read' ? 1 : null;
  if (d.maxAttempts !== undefined && d.maxAttempts !== null && d.maxAttempts !== '') {
    const n = Number(d.maxAttempts);
    if (!Number.isFinite(n) || n < 1 || n > 1000) {
      return errResponse('Max attempts must be between 1 and 1000.', 400, 'INVALID_MAX_ATTEMPTS', request, env);
    }
    maxAttempts = Math.floor(n);
  }

  const gradePolicy = d.gradePolicy == null || d.gradePolicy === ''
    ? 'best'
    : String(d.gradePolicy).trim();
  if (!VALID_GRADE_POLICIES.has(gradePolicy)) {
    return errResponse('Grade policy must be best or last.', 400, 'INVALID_GRADE_POLICY', request, env);
  }

  const published = d.published === undefined ? 1 : (d.published ? 1 : 0);
  const now = nowMs(env);
  const id = makeId('asgn');

  await env.DB.prepare(
    `INSERT INTO assignments
      (id, class_id, teacher_id, title, instructions, type, mode, config_json,
       due_at, max_attempts, grade_policy, published, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, classId, auth.teacher.id, title, instructions, type, mode, cfgOut.configJson,
    dueAt, maxAttempts, gradePolicy, published, now, now
  ).run();

  const row = await env.DB.prepare('SELECT * FROM assignments WHERE id = ?').bind(id).first();
  return jsonResponse({ ok: true, assignment: formatAssignment(row) }, 201, request, env);
}

export async function handleGetAssignment(request, env, auth, assignmentId) {
  const row = await env.DB.prepare(
    'SELECT * FROM assignments WHERE id = ? AND teacher_id = ?'
  ).bind(assignmentId, auth.teacher.id).first();
  if (!row) return errResponse('Assignment not found.', 404, 'ASSIGNMENT_NOT_FOUND', request, env);

  return jsonResponse({ ok: true, assignment: formatAssignment(row) }, 200, request, env);
}

export async function handleUpdateAssignment(request, env, auth, assignmentId) {
  const existing = await env.DB.prepare(
    'SELECT * FROM assignments WHERE id = ? AND teacher_id = ?'
  ).bind(assignmentId, auth.teacher.id).first();
  if (!existing) return errResponse('Assignment not found.', 404, 'ASSIGNMENT_NOT_FOUND', request, env);

  const body = await readJsonBody(request);
  if (!body.ok) return errResponse(body.error, body.status, 'BAD_REQUEST', request, env);
  const d = body.data;

  // Archiving is allowed even in read-only mode; all other edits require an active/writable plan.
  const nonArchiveKeys = Object.keys(d).filter(k => k !== 'archived');
  const isArchiveOnly = nonArchiveKeys.length === 0 && d.archived === true;
  if (!isArchiveOnly) {
    const blocked = assertTeacherWritable(auth.teacher, request, env);
    if (blocked) return blocked;
  }

  const updates = [];
  const binds = [];
  const now = nowMs(env);

  if (d.title !== undefined) {
    const title = cleanText(d.title, 200);
    if (!title) return errResponse('Assignment title cannot be empty.', 400, 'INVALID_TITLE', request, env);
    updates.push('title = ?');
    binds.push(title);
  }

  if (d.instructions !== undefined) {
    updates.push('instructions = ?');
    binds.push(cleanText(d.instructions, 4000));
  }

  let nextMode = existing.mode;
  if (d.mode !== undefined) {
    const rawMode = String(d.mode || '').trim();
    if (!VALID_MODES.has(rawMode)) {
      return errResponse('Assignment mode must be practice or true_sight_read.', 400, 'INVALID_MODE', request, env);
    }
    nextMode = existing.type === 'sight' ? rawMode : 'practice';
    updates.push('mode = ?');
    binds.push(nextMode);
  }

  if (d.config !== undefined || nextMode !== existing.mode) {
    const rawCfg = d.config !== undefined ? d.config : safeJsonParse(existing.config_json, {});
    const cfgOut = sanitizeAssignmentConfig(existing.type, nextMode, rawCfg);
    if (!cfgOut.ok) return errResponse(cfgOut.error, 400, 'INVALID_CONFIG', request, env);
    updates.push('config_json = ?');
    binds.push(cfgOut.configJson);
  }

  if (d.dueAt !== undefined) {
    let dueAt = null;
    if (d.dueAt !== null && d.dueAt !== '') {
      const n = Number(d.dueAt);
      if (!Number.isFinite(n) || n <= 0) {
        return errResponse('Due date must be a valid timestamp.', 400, 'INVALID_DUE_AT', request, env);
      }
      dueAt = Math.round(n);
    }
    updates.push('due_at = ?');
    binds.push(dueAt);
  }

  if (d.maxAttempts !== undefined) {
    let maxAttempts = null;
    if (d.maxAttempts !== null && d.maxAttempts !== '') {
      const n = Number(d.maxAttempts);
      if (!Number.isFinite(n) || n < 1 || n > 1000) {
        return errResponse('Max attempts must be between 1 and 1000.', 400, 'INVALID_MAX_ATTEMPTS', request, env);
      }
      maxAttempts = Math.floor(n);
    }
    updates.push('max_attempts = ?');
    binds.push(maxAttempts);
  }

  if (d.gradePolicy !== undefined) {
    const gp = String(d.gradePolicy || '').trim();
    if (!VALID_GRADE_POLICIES.has(gp)) {
      return errResponse('Grade policy must be best or last.', 400, 'INVALID_GRADE_POLICY', request, env);
    }
    updates.push('grade_policy = ?');
    binds.push(gp);
  }

  if (d.published !== undefined) {
    updates.push('published = ?');
    binds.push(d.published ? 1 : 0);
  }

  if (d.archived !== undefined) {
    updates.push('archived_at = ?');
    binds.push(d.archived ? (existing.archived_at || now) : null);
  }

  if (updates.length) {
    updates.push('updated_at = ?');
    binds.push(now, assignmentId, auth.teacher.id);
    await env.DB.prepare(
      `UPDATE assignments SET ${updates.join(', ')} WHERE id = ? AND teacher_id = ?`
    ).bind(...binds).run();
  }

  const updated = await env.DB.prepare('SELECT * FROM assignments WHERE id = ?').bind(assignmentId).first();
  return jsonResponse({ ok: true, assignment: formatAssignment(updated) }, 200, request, env);
}

// Allowed even in read-only mode (teacher right to delete data).
export async function handleDeleteAssignment(request, env, auth, assignmentId) {
  const existing = await env.DB.prepare(
    'SELECT id, score_r2_key FROM assignments WHERE id = ? AND teacher_id = ?'
  ).bind(assignmentId, auth.teacher.id).first();
  if (!existing) return errResponse('Assignment not found.', 404, 'ASSIGNMENT_NOT_FOUND', request, env);

  const subAudioRes = await env.DB.prepare(
    'SELECT audio_r2_key FROM submissions WHERE assignment_id = ? AND audio_r2_key IS NOT NULL'
  ).bind(assignmentId).all();

  const keysToDelete = [];
  if (existing.score_r2_key) keysToDelete.push(existing.score_r2_key);
  for (const r of (subAudioRes?.results || [])) {
    if (r.audio_r2_key) keysToDelete.push(r.audio_r2_key);
  }

  if (env.BUCKET && keysToDelete.length) {
    for (const key of keysToDelete) {
      try { await env.BUCKET.delete(key); } catch {}
    }
  }

  await env.DB.prepare(
    'DELETE FROM assignments WHERE id = ? AND teacher_id = ?'
  ).bind(assignmentId, auth.teacher.id).run();

  return jsonResponse({ ok: true, deleted: true, id: assignmentId }, 200, request, env);
}

// ---------- Score Upload & Download (.mxl / .musicxml / .xml)

function hasZipMagic(bytes) {
  return bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4B &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04;
}

function hasXmlMagic(bytes) {
  let i = 0;
  // Skip optional UTF-8 BOM (EF BB BF)
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    i = 3;
  }
  // Skip leading ASCII whitespace
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0A || bytes[i] === 0x0D)) {
    i++;
  }
  return i < bytes.length && bytes[i] === 0x3C; // '<'
}

export async function handleUploadAssignmentScore(request, env, auth, assignmentId) {
  const blocked = assertTeacherWritable(auth.teacher, request, env);
  if (blocked) return blocked;

  const assignment = await env.DB.prepare(
    'SELECT * FROM assignments WHERE id = ? AND teacher_id = ?'
  ).bind(assignmentId, auth.teacher.id).first();
  if (!assignment) return errResponse('Assignment not found.', 404, 'ASSIGNMENT_NOT_FOUND', request, env);

  if (assignment.type !== 'score') {
    return errResponse('Score files can only be uploaded to Score Practice assignments.', 400, 'NOT_SCORE_ASSIGNMENT', request, env);
  }

  const contentType = (request.headers.get('content-type') || '').toLowerCase();
  let rawFilename = '';
  let bytes = null;

  if (contentType.includes('multipart/form-data')) {
    let form;
    try {
      form = await request.formData();
    } catch {
      return errResponse('Could not read uploaded file.', 400, 'INVALID_UPLOAD', request, env);
    }
    const file = form.get('file');
    if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') {
      return errResponse('Attach a MusicXML (.mxl or .musicxml) file in the "file" field.', 400, 'MISSING_FILE', request, env);
    }
    rawFilename = file.name || request.headers.get('x-filename') || '';

    // Check MuseScore rejection before rejecting on size or reading buffer
    const lowerPre = rawFilename.trim().toLowerCase();
    if (lowerPre.endsWith('.mscz') || lowerPre.endsWith('.mscx')) {
      return errResponse(MUSESCORE_UNSUPPORTED_MSG, 415, 'UNSUPPORTED_SCORE_FORMAT', request, env);
    }
    if (typeof file.size === 'number' && file.size > MAX_SCORE_BYTES) {
      return errResponse('Score file is too large (10 MB maximum).', 413, 'SCORE_TOO_LARGE', request, env);
    }
    bytes = new Uint8Array(await file.arrayBuffer());
  } else {
    rawFilename = request.headers.get('x-filename') || '';
    const lowerPre = rawFilename.trim().toLowerCase();
    if (lowerPre.endsWith('.mscz') || lowerPre.endsWith('.mscx')) {
      return errResponse(MUSESCORE_UNSUPPORTED_MSG, 415, 'UNSUPPORTED_SCORE_FORMAT', request, env);
    }
    const contentLen = Number(request.headers.get('content-length') || 0);
    if (Number.isFinite(contentLen) && contentLen > MAX_SCORE_BYTES) {
      return errResponse('Score file is too large (10 MB maximum).', 413, 'SCORE_TOO_LARGE', request, env);
    }
    bytes = new Uint8Array(await request.arrayBuffer());
  }

  let decodedName = rawFilename;
  try { decodedName = decodeURIComponent(rawFilename); } catch {}
  const baseName = (decodedName.split(/[/\\]/).pop() || '').trim();
  const lowerName = baseName.toLowerCase();

  if (lowerName.endsWith('.mscz') || lowerName.endsWith('.mscx')) {
    return errResponse(MUSESCORE_UNSUPPORTED_MSG, 415, 'UNSUPPORTED_SCORE_FORMAT', request, env);
  }

  const isMxl = lowerName.endsWith('.mxl');
  const isXml = lowerName.endsWith('.musicxml') || lowerName.endsWith('.xml');
  if (!isMxl && !isXml) {
    return errResponse('Upload a MusicXML file (.mxl, .musicxml, or .xml).', 415, 'UNSUPPORTED_SCORE_FORMAT', request, env);
  }

  if (!bytes || bytes.byteLength === 0) {
    return errResponse('Uploaded score file is empty.', 400, 'EMPTY_FILE', request, env);
  }
  if (bytes.byteLength > MAX_SCORE_BYTES) {
    return errResponse('Score file is too large (10 MB maximum).', 413, 'SCORE_TOO_LARGE', request, env);
  }

  if (isMxl && !hasZipMagic(bytes)) {
    return errResponse(
      'This .mxl file does not look like a valid compressed MusicXML archive. Re-export it as MusicXML (.mxl) and try again.',
      415,
      'INVALID_SCORE_FILE',
      request,
      env
    );
  }
  if (isXml && !hasXmlMagic(bytes)) {
    return errResponse(
      'This file does not look like valid MusicXML. Re-export it from your notation app and try again.',
      415,
      'INVALID_SCORE_FILE',
      request,
      env
    );
  }

  if (!env.BUCKET) {
    return errResponse('Score file storage is not configured.', 503, 'STORAGE_UNAVAILABLE', request, env);
  }

  const safeFilename = sanitizeFilename(baseName, isMxl ? 'score.mxl' : 'score.musicxml');
  const r2Key = `scores/${auth.teacher.id}/${assignmentId}/${safeFilename}`;
  const mime = isMxl ? 'application/vnd.recordare.musicxml' : 'application/xml; charset=utf-8';
  const oldKey = assignment.score_r2_key;

  await env.BUCKET.put(r2Key, bytes, {
    httpMetadata: { contentType: mime },
  });

  if (oldKey && oldKey !== r2Key) {
    try { await env.BUCKET.delete(oldKey); } catch {}
  }

  const now = nowMs(env);
  try {
    await env.DB.prepare(
      `UPDATE assignments
       SET score_r2_key = ?, score_filename = ?, score_bytes = ?, updated_at = ?
       WHERE id = ? AND teacher_id = ?`
    ).bind(r2Key, safeFilename, bytes.byteLength, now, assignmentId, auth.teacher.id).run();
  } catch (err) {
    if (r2Key !== oldKey) {
      try { await env.BUCKET.delete(r2Key); } catch {}
    }
    throw err;
  }

  return jsonResponse({
    ok: true,
    assignmentId,
    scoreFilename: safeFilename,
    scoreBytes: bytes.byteLength,
    contentType: mime,
    updatedAt: now,
  }, 200, request, env);
}

async function streamAssignmentScoreResponse(request, env, assignment, cacheControl = 'private, max-age=300') {
  if (!assignment.score_r2_key) {
    return errResponse('No score file has been uploaded for this assignment.', 404, 'SCORE_NOT_FOUND', request, env);
  }
  if (!env.BUCKET) {
    return errResponse('Score file storage is not configured.', 503, 'STORAGE_UNAVAILABLE', request, env);
  }

  const obj = await env.BUCKET.get(assignment.score_r2_key);
  if (!obj) {
    return errResponse('Score file not found.', 404, 'SCORE_NOT_FOUND', request, env);
  }

  const filename = (assignment.score_filename || 'score.musicxml').replace(/["\\\r\n]/g, '_');
  const isMxl = filename.toLowerCase().endsWith('.mxl');
  const contentType = isMxl
    ? 'application/vnd.recordare.musicxml'
    : 'application/xml; charset=utf-8';

  const headers = {
    ...corsHeaders(request, env),
    'Content-Type': contentType,
    'Content-Disposition': `inline; filename="${filename}"`,
    'Cache-Control': cacheControl,
  };
  if (typeof obj.size === 'number') {
    headers['Content-Length'] = String(obj.size);
  }

  return new Response(obj.body, { status: 200, headers });
}

export async function handleDownloadAssignmentScore(request, env, assignmentId) {
  let assignment = null;

  const teacherAuth = await requireTeacher(request, env);
  if (!teacherAuth.error) {
    assignment = await env.DB.prepare(
      'SELECT * FROM assignments WHERE id = ? AND teacher_id = ?'
    ).bind(assignmentId, teacherAuth.teacher.id).first();
    if (!assignment) {
      return errResponse('Assignment not found.', 404, 'ASSIGNMENT_NOT_FOUND', request, env);
    }
  } else {
    const studentAuth = await requireStudent(request, env);
    if (studentAuth.error) {
      return errResponse('Sign in required.', 401, 'UNAUTHORIZED', request, env);
    }
    assignment = await env.DB.prepare(
      `SELECT * FROM assignments
       WHERE id = ? AND class_id = ? AND published = 1 AND archived_at IS NULL`
    ).bind(assignmentId, studentAuth.student.class_id).first();
    if (!assignment) {
      return errResponse('Assignment not found.', 404, 'ASSIGNMENT_NOT_FOUND', request, env);
    }
  }

  return streamAssignmentScoreResponse(request, env, assignment, 'private, max-age=300');
}

// ---------- Teacher Preview Sandbox (stateless signed token, read-only)

function readPreviewTokenFromRequest(request) {
  try {
    const url = new URL(request.url);
    const param = url.searchParams.get('token');
    if (param) return param.trim();
  } catch { }
  return String(request.headers.get('x-preview-token') || '').trim();
}

export async function handleCreateAssignmentPreview(request, env, auth, assignmentId) {
  const row = await env.DB.prepare(
    'SELECT id, class_id, teacher_id FROM assignments WHERE id = ? AND teacher_id = ?'
  ).bind(assignmentId, auth.teacher.id).first();
  if (!row) {
    return errResponse('Assignment not found.', 404, 'ASSIGNMENT_NOT_FOUND', request, env);
  }
  const expiresAt = nowMs(env) + PREVIEW_TOKEN_TTL_MS;
  const previewToken = await signPreviewToken(
    { assignmentId: row.id, teacherId: auth.teacher.id, expiresAt },
    env
  );
  return jsonResponse({
    ok: true,
    previewToken,
    expiresAt,
    assignmentId: row.id,
  }, 200, request, env);
}

export async function handleGetPreviewAssignment(request, env) {
  const token = readPreviewTokenFromRequest(request);
  const verified = await verifyPreviewToken(token, env);
  if (!verified.ok) {
    return errResponse(verified.error, 401, verified.code, request, env);
  }

  const row = await env.DB.prepare(
    `SELECT a.*, c.name AS class_name, c.join_code AS class_join_code, t.name AS teacher_name
     FROM assignments a
     JOIN classes c ON c.id = a.class_id
     JOIN teachers t ON t.id = a.teacher_id
     WHERE a.id = ? AND a.teacher_id = ?`
  ).bind(verified.assignmentId, verified.teacherId).first();
  if (!row) {
    return errResponse('This assignment is no longer available.', 404, 'ASSIGNMENT_NOT_FOUND', request, env);
  }

  const config = safeJsonParse(row.config_json, {});
  const res = jsonResponse({
    ok: true,
    preview: true,
    expiresAt: verified.expiresAt,
    class: {
      id: row.class_id,
      name: row.class_name,
      joinCode: row.class_join_code,
      teacherName: row.teacher_name || '',
      acceptingSubmissions: true,
    },
    assignment: {
      ...formatAssignment(row, config),
      excerptLocked: false,
      attemptsUsed: 0,
      attemptsRemaining: row.max_attempts != null ? Number(row.max_attempts) : null,
      expiredStartsCount: 0,
      activeStart: null,
      latestSubmission: null,
      bestSubmission: null,
    },
  }, 200, request, env);
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

export async function handleDownloadPreviewScore(request, env) {
  const token = readPreviewTokenFromRequest(request);
  const verified = await verifyPreviewToken(token, env);
  if (!verified.ok) {
    return errResponse(verified.error, 401, verified.code, request, env);
  }

  const assignment = await env.DB.prepare(
    'SELECT * FROM assignments WHERE id = ? AND teacher_id = ?'
  ).bind(verified.assignmentId, verified.teacherId).first();
  if (!assignment) {
    return errResponse('This assignment is no longer available.', 404, 'ASSIGNMENT_NOT_FOUND', request, env);
  }

  return streamAssignmentScoreResponse(request, env, assignment, 'private, no-store');
}

// ---------- Student Assignment Portal

export function buildStudentAssignmentSummary(row, rawSubs = [], unconsumedStarts = [], now = Date.now()) {
  const cleanSubs = (rawSubs || []).map(s => formatStudentSubmissionSummary(s, now));
  const linkedStartIds = new Set();
  for (const s of (rawSubs || [])) {
    if (s?.attempt_start_id) linkedStartIds.add(s.attempt_start_id);
  }

  let activeStart = null;
  let expiredStartsCount = 0;
  for (const st of (unconsumedStarts || [])) {
    if (!st || st.consumed_at != null || linkedStartIds.has(st.id)) continue;
    if (isActiveAttemptStart(st, now)) {
      if (!activeStart) activeStart = formatAttemptStart(st);
    } else if (row.mode === 'true_sight_read') {
      expiredStartsCount++;
    }
  }

  const attemptsUsed = cleanSubs.length + expiredStartsCount;
  const maxAttempts = row.max_attempts != null ? Number(row.max_attempts) : null;
  const attemptsRemaining = maxAttempts != null ? Math.max(0, maxAttempts - attemptsUsed) : null;
  const latestSubmission = cleanSubs[0] || null;
  const bestSubmission = pickBestSubmission(cleanSubs);

  const parsedConfig = safeJsonParse(row.config_json, {});
  // Keep excerpt locked until an attempt is actively open or at least one submission exists
  const excerptLocked = row.mode === 'true_sight_read' && !activeStart && cleanSubs.length === 0;
  const outConfig = excerptLocked ? stripTrueSightReadExcerpt(parsedConfig) : parsedConfig;

  return {
    ...formatAssignment(row, outConfig),
    excerptLocked,
    attemptsUsed,
    attemptsRemaining,
    expiredStartsCount,
    activeStart,
    latestSubmission,
    bestSubmission,
  };
}

export async function handleStudentListAssignments(request, env, auth) {
  const now = nowMs(env);
  const classId = auth.student.class_id;
  const studentId = auth.student.student_id;

  const asgnRes = await env.DB.prepare(
    `SELECT * FROM assignments
     WHERE class_id = ? AND published = 1 AND archived_at IS NULL
     ORDER BY CASE WHEN due_at IS NULL THEN 1 ELSE 0 END, due_at ASC, created_at DESC`
  ).bind(classId).all();
  const rows = asgnRes?.results || [];

  const subsRes = await env.DB.prepare(
    `SELECT id, assignment_id, attempt_num, attempt_start_id, overall_pct, rhythm_pct, pitch_pct,
            audio_r2_key, audio_expires_at, audio_deleted_at,
            teacher_override_pct, teacher_comment, graded_at, submitted_at
     FROM submissions
     WHERE student_id = ? AND class_id = ?
     ORDER BY attempt_num DESC, submitted_at DESC`
  ).bind(studentId, classId).all();

  const subsByAsgn = new Map();
  for (const s of (subsRes?.results || [])) {
    let list = subsByAsgn.get(s.assignment_id);
    if (!list) {
      list = [];
      subsByAsgn.set(s.assignment_id, list);
    }
    list.push(s);
  }

  const startsRes = await env.DB.prepare(
    `SELECT a_s.id, a_s.assignment_id, a_s.attempt_num, a_s.started_at, a_s.study_seconds, a_s.expected_sec, a_s.consumed_at
     FROM attempt_starts a_s
     LEFT JOIN submissions s ON s.attempt_start_id = a_s.id
     WHERE a_s.student_id = ? AND a_s.consumed_at IS NULL AND s.id IS NULL
     ORDER BY a_s.started_at DESC`
  ).bind(studentId).all();

  const startsByAsgn = new Map();
  for (const st of (startsRes?.results || [])) {
    let list = startsByAsgn.get(st.assignment_id);
    if (!list) {
      list = [];
      startsByAsgn.set(st.assignment_id, list);
    }
    list.push(st);
  }

  const assignments = rows.map(row =>
    buildStudentAssignmentSummary(row, subsByAsgn.get(row.id) || [], startsByAsgn.get(row.id) || [], now)
  );

  return jsonResponse({ ok: true, assignments }, 200, request, env);
}

export async function handleStudentGetAssignment(request, env, auth, assignmentId) {
  const now = nowMs(env);
  const classId = auth.student.class_id;
  const studentId = auth.student.student_id;

  const row = await env.DB.prepare(
    `SELECT * FROM assignments
     WHERE id = ? AND class_id = ? AND published = 1 AND archived_at IS NULL`
  ).bind(assignmentId, classId).first();
  if (!row) return errResponse('Assignment not found.', 404, 'ASSIGNMENT_NOT_FOUND', request, env);

  const subsRes = await env.DB.prepare(
    `SELECT id, assignment_id, attempt_num, attempt_start_id, overall_pct, rhythm_pct, pitch_pct,
            audio_r2_key, audio_expires_at, audio_deleted_at,
            teacher_override_pct, teacher_comment, graded_at, submitted_at
     FROM submissions
     WHERE assignment_id = ? AND student_id = ?
     ORDER BY attempt_num DESC, submitted_at DESC`
  ).bind(assignmentId, studentId).all();

  const rawSubs = subsRes?.results || [];
  const cleanSubs = rawSubs.map(s => formatStudentSubmissionSummary(s, now));

  const startsRes = await env.DB.prepare(
    `SELECT a_s.id, a_s.assignment_id, a_s.attempt_num, a_s.started_at, a_s.study_seconds, a_s.expected_sec, a_s.consumed_at
     FROM attempt_starts a_s
     LEFT JOIN submissions s ON s.attempt_start_id = a_s.id
     WHERE a_s.assignment_id = ? AND a_s.student_id = ? AND a_s.consumed_at IS NULL AND s.id IS NULL
     ORDER BY a_s.started_at DESC`
  ).bind(assignmentId, studentId).all();

  const summary = buildStudentAssignmentSummary(row, rawSubs, startsRes?.results || [], now);

  return jsonResponse({
    ok: true,
    assignment: summary,
    excerptLocked: summary.excerptLocked,
    attemptsUsed: summary.attemptsUsed,
    attemptsRemaining: summary.attemptsRemaining,
    expiredStartsCount: summary.expiredStartsCount,
    activeStart: summary.activeStart,
    submissions: cleanSubs,
  }, 200, request, env);
}
