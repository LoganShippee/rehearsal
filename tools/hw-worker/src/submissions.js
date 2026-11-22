// Student Attempt Lifecycle, Server-Side Score Recomputation & Integrity Checks,
// 90-Day Expiring R2 Audio Streaming (with HTTP Range 206), Teacher Gradebook & CSV Export.

import {
  AUDIO_RETENTION_DAYS, DAY_MS, MAX_AUDIO_BYTES,
  clamp, cleanText, corsHeaders, csvCell, errResponse, jsonResponse,
  makeId, nowMs, parseRangeHeader, readJsonBody, safeJsonParse,
} from './util.js';
import { requireStudent, requireTeacher } from './auth.js';
import { assertClassTeacherWritable, assertTeacherWritable } from './billing.js';

const VALID_NOTE_STATUSES = new Set(['ok', 'timing', 'pitch', 'wrong', 'missed']);
const MAX_NOTES = 2000;
const ALLOWED_AUDIO_MIME_PREFIXES = [
  'audio/webm',
  'audio/mp4',
  'audio/ogg',
  'audio/wav',
  'audio/x-wav',
  'audio/mpeg',
];

function isAllowedAudioMime(rawMime) {
  const m = String(rawMime || '').trim().toLowerCase();
  return ALLOWED_AUDIO_MIME_PREFIXES.some(prefix => m === prefix || m.startsWith(`${prefix};`));
}

function audioExtFromMime(rawMime) {
  const m = String(rawMime || '').trim().toLowerCase();
  if (m.startsWith('audio/webm')) return 'webm';
  if (m.startsWith('audio/mp4')) return 'm4a';
  if (m.startsWith('audio/ogg')) return 'ogg';
  if (m.startsWith('audio/wav') || m.startsWith('audio/x-wav')) return 'wav';
  if (m.startsWith('audio/mpeg')) return 'mp3';
  return 'bin';
}

function isFiniteNumeric(val) {
  if (val === null || val === undefined || val === '' || typeof val === 'boolean') return false;
  return Number.isFinite(Number(val));
}

function formatAttemptStart(row) {
  return {
    id: row.id,
    assignmentId: row.assignment_id,
    attemptNum: row.attempt_num,
    startedAt: row.started_at,
    studySeconds: row.study_seconds,
    expectedSec: row.expected_sec,
    consumedAt: row.consumed_at ?? null,
  };
}

function effectiveSubmissionScore(sub) {
  if (sub.teacher_override_pct !== null && sub.teacher_override_pct !== undefined) {
    return Number(sub.teacher_override_pct);
  }
  if (sub.overall_pct !== null && sub.overall_pct !== undefined) {
    return Number(sub.overall_pct);
  }
  return null;
}

function pickGradedSubmission(subs, policy) {
  if (!subs || !subs.length) return null;
  if (policy === 'last') return subs[subs.length - 1];
  let best = null;
  let bestScore = -1;
  for (const s of subs) {
    const score = effectiveSubmissionScore(s);
    if (score !== null && score >= bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best || subs[subs.length - 1];
}

// ---------- Pure synchronous score recomputation & anti-tamper integrity check
export function validateAndRecomputeSubmission({
  assignment,
  config = null,
  payload = {},
  audioBytes = 0,
  attemptStart = null,
  submittedAt = Date.now(),
}) {
  const safePayload = (payload && typeof payload === 'object') ? payload : {};
  const cfg = (config && typeof config === 'object')
    ? config
    : (safeJsonParse(assignment?.config_json, {}) || {});
  const flags = new Set();

  const audioSize = Math.max(0, Number(audioBytes || 0));
  const rawDuration = Number(safePayload.durationSec ?? safePayload.duration_sec ?? 0);
  const durationSec = Number.isFinite(rawDuration) && rawDuration > 0
    ? +rawDuration.toFixed(2)
    : 0;

  const rawExpected =
    safePayload.expectedSec ??
    safePayload.expected_sec ??
    attemptStart?.expected_sec ??
    cfg?.expectedSec ??
    null;
  const expectedSec = isFiniteNumeric(rawExpected) && Number(rawExpected) > 0
    ? +Number(rawExpected).toFixed(2)
    : null;

  const ts = isFiniteNumeric(submittedAt) ? Number(submittedAt) : Date.now();

  if (assignment?.type === 'audio') {
    if (audioSize <= 0) flags.add('missing_audio');
    return {
      ok: true,
      error: null,
      overallPct: null,
      rhythmPct: null,
      pitchPct: null,
      sanitizedResults: null,
      integrityFlags: [...flags],
      durationSec,
      expectedSec,
    };
  }

  const results = safePayload.results || safePayload.resultsJson;
  if (!results || typeof results !== 'object' || Array.isArray(results)) {
    return { ok: false, error: 'Missing grading results payload.' };
  }

  const rawNotes = results.notes;
  if (!Array.isArray(rawNotes) || rawNotes.length < 1 || rawNotes.length > MAX_NOTES) {
    return { ok: false, error: `Results must include between 1 and ${MAX_NOTES} graded notes.` };
  }

  const sanitizedNotes = [];
  for (let i = 0; i < rawNotes.length; i++) {
    const n = rawNotes[i];
    if (!n || typeof n !== 'object' || !VALID_NOTE_STATUSES.has(n.status)) {
      return { ok: false, error: `Invalid note status at index ${i}.` };
    }
    sanitizedNotes.push({
      bar: isFiniteNumeric(n.bar) ? Math.round(Number(n.bar)) : null,
      idx: isFiniteNumeric(n.idx) ? Math.round(Number(n.idx)) : i,
      status: n.status,
      pitch: typeof n.pitch === 'string' && n.pitch ? cleanText(n.pitch, 16) : null,
      cents: isFiniteNumeric(n.cents) ? Math.round(Number(n.cents)) : null,
      errMs: isFiniteNumeric(n.errMs) ? Math.round(Number(n.errMs)) : null,
    });
  }

  const total = sanitizedNotes.length;
  const rOk = sanitizedNotes.filter(n => n.status === 'ok' || n.status === 'pitch').length;
  const rHalf = sanitizedNotes.filter(n => n.status === 'timing').length;
  const rhythmPct = clamp(Math.round(((rOk + 0.5 * rHalf) / total) * 100), 0, 100);

  let expectsPitch = true;
  if (assignment?.type === 'score') {
    expectsPitch = (cfg?.gradeMode || cfg?.spState?.gradeMode || 'mic') === 'mic';
  } else {
    expectsPitch = !(
      cfg?.mode === 'rhythm' ||
      cfg?.srState?.mode === 'rhythm' ||
      cfg?.srState?.solRhythm ||
      (cfg?.srState?.mode === 'build' && cfg?.srState?.build?.kind === 'rhythm')
    );
  }

  let pitchPct = null;
  let overallPct = rhythmPct;
  if (expectsPitch) {
    const pOk = sanitizedNotes.filter(
      n => n.status === 'ok' || (n.status === 'timing' && n.pitch === 'ok')
    ).length;
    pitchPct = clamp(Math.round((pOk / total) * 100), 0, 100);
    overallPct = clamp(Math.round((rhythmPct + pitchPct) / 2), 0, 100);
  }

  // Amber integrity checks (never shown to students; server-recomputed score is always stored)
  const overallClaims = [
    safePayload.claimedOverallPct,
    safePayload.overallPct,
    results.recomputedOverallPct,
  ];
  for (const claimed of overallClaims) {
    if (isFiniteNumeric(claimed) && Math.abs(Number(claimed) - overallPct) > 3) {
      flags.add('score_mismatch');
    }
  }
  if (isFiniteNumeric(results.engineRhythmPct) && Math.abs(Number(results.engineRhythmPct) - rhythmPct) > 3) {
    flags.add('score_mismatch');
  }

  const inputMode = cleanText(results.inputMode || '', 32) || (expectsPitch ? 'mic_pitch_rhythm' : 'mic_rhythm');
  if (expectsPitch && inputMode === 'tap') {
    flags.add('unexpected_input_mode');
  }

  if (expectedSec && expectedSec > 1 && durationSec > 0 && durationSec < expectedSec * 0.5) {
    flags.add('duration_too_short');
  }

  const rmsPeak = isFiniteNumeric(results.rmsPeak) ? Number(results.rmsPeak) : 0;
  if (inputMode !== 'tap' && rmsPeak < 0.008 && overallPct >= 50) {
    flags.add('low_rms_high_score');
  }

  if (inputMode !== 'tap' && audioSize <= 0) {
    flags.add('missing_audio');
  }

  if (assignment?.mode === 'true_sight_read' && !attemptStart) {
    flags.add('true_sight_read_no_start');
  }

  if (attemptStart) {
    const elapsedSec = (ts - Number(attemptStart.started_at || 0)) / 1000;
    const studySec = Number(attemptStart.study_seconds || 30);
    const baseExpected = Math.max(expectedSec || Number(attemptStart.expected_sec || 0) || 15, 15);
    if (elapsedSec > studySec + baseExpected * 1.8 + 30) {
      flags.add('true_sight_read_overtime');
    }
    if (expectedSec && expectedSec > 2 && elapsedSec < expectedSec * 0.5) {
      flags.add('true_sight_read_too_fast');
    }
  }

  const sanitizedResults = {
    serverOverallPct: overallPct,
    serverRhythmPct: rhythmPct,
    serverPitchPct: pitchPct,
    expectsPitch,
    engineRhythmPct: isFiniteNumeric(results.engineRhythmPct) ? Math.round(Number(results.engineRhythmPct)) : null,
    enginePitchPct: isFiniteNumeric(results.enginePitchPct) ? Math.round(Number(results.enginePitchPct)) : null,
    strictness: results.strictness && typeof results.strictness === 'object'
      ? {
          rhythm: isFiniteNumeric(results.strictness.rhythm) ? clamp(Math.round(Number(results.strictness.rhythm)), 0, 100) : null,
          pitch: isFiniteNumeric(results.strictness.pitch) ? clamp(Math.round(Number(results.strictness.pitch)), 0, 100) : null,
        }
      : null,
    offsetMs: isFiniteNumeric(results.offsetMs) ? Math.round(Number(results.offsetMs)) : null,
    driftCents: isFiniteNumeric(results.driftCents) ? Math.round(Number(results.driftCents)) : null,
    extra: isFiniteNumeric(results.extra) ? Math.max(0, Math.round(Number(results.extra))) : 0,
    rmsPeak: +rmsPeak.toFixed(4),
    inputMode,
    noteCount: total,
    notes: sanitizedNotes,
  };

  return {
    ok: true,
    error: null,
    overallPct,
    rhythmPct,
    pitchPct,
    sanitizedResults,
    integrityFlags: [...flags],
    durationSec,
    expectedSec,
  };
}

// ---------- POST /api/student/assignments/:id/start
export async function handleStartAttempt(request, env, auth, assignmentId) {
  const student = auth.student;
  const assignment = await env.DB.prepare(
    `SELECT * FROM assignments
     WHERE id = ? AND class_id = ? AND published = 1 AND archived_at IS NULL`
  ).bind(assignmentId, student.class_id).first();
  if (!assignment) {
    return errResponse('Assignment not found', 404, 'ASSIGNMENT_NOT_FOUND', request, env);
  }

  const writable = await assertClassTeacherWritable(student.class_id, request, env);
  if (writable.error) return writable.error;

  const body = await readJsonBody(request);
  if (!body.ok) return errResponse(body.error, body.status, 'BAD_REQUEST', request, env);

  const config = safeJsonParse(assignment.config_json, {}) || {};
  const now = nowMs(env);

  // Reuse an active unconsumed attempt_starts row within its live window so an accidental
  // page refresh does not burn an attempt or reset the server-side True Sight-Read timer.
  const active = await env.DB.prepare(
    `SELECT * FROM attempt_starts
     WHERE assignment_id = ? AND student_id = ? AND consumed_at IS NULL
     ORDER BY attempt_num DESC LIMIT 1`
  ).bind(assignment.id, student.student_id).first();

  if (active) {
    const windowSec = Number(active.study_seconds || 30) + Math.max(Number(active.expected_sec || 0), 15) + 120;
    if ((now - Number(active.started_at || 0)) <= windowSec * 1000) {
      return jsonResponse({
        ok: true,
        reused: true,
        attemptStart: formatAttemptStart(active),
        config,
      }, 200, request, env);
    }
  }

  const subMaxRow = await env.DB.prepare(
    'SELECT COALESCE(MAX(attempt_num), 0) AS n FROM submissions WHERE assignment_id = ? AND student_id = ?'
  ).bind(assignment.id, student.student_id).first();
  const startMaxRow = await env.DB.prepare(
    'SELECT COALESCE(MAX(attempt_num), 0) AS n FROM attempt_starts WHERE assignment_id = ? AND student_id = ?'
  ).bind(assignment.id, student.student_id).first();

  const nextAttemptNum = Math.max(Number(subMaxRow?.n || 0), Number(startMaxRow?.n || 0)) + 1;
  if (assignment.max_attempts !== null && assignment.max_attempts !== undefined && nextAttemptNum > Number(assignment.max_attempts)) {
    return errResponse(
      'You have used all allowed attempts for this assignment.',
      409,
      'ATTEMPT_LIMIT_REACHED',
      request,
      env,
      { maxAttempts: Number(assignment.max_attempts) }
    );
  }

  const studySeconds = clamp(Math.round(Number(config?.studySeconds ?? 30) || 30), 15, 60);
  const rawExp = body.data?.expectedSec ?? config?.expectedSec ?? 0;
  const expectedSec = isFiniteNumeric(rawExp) && Number(rawExp) > 0
    ? Math.min(3600, +Number(rawExp).toFixed(2))
    : 0;

  const startId = makeId('att');
  await env.DB.prepare(
    `INSERT INTO attempt_starts (id, assignment_id, student_id, attempt_num, started_at, study_seconds, expected_sec)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(startId, assignment.id, student.student_id, nextAttemptNum, now, studySeconds, expectedSec).run();

  const created = {
    id: startId,
    assignment_id: assignment.id,
    attempt_num: nextAttemptNum,
    started_at: now,
    study_seconds: studySeconds,
    expected_sec: expectedSec,
    consumed_at: null,
  };

  return jsonResponse({
    ok: true,
    reused: false,
    attemptStart: formatAttemptStart(created),
    config,
  }, 200, request, env);
}

// ---------- POST /api/student/assignments/:id/submissions
export async function handleSubmitAttempt(request, env, auth, assignmentId) {
  const student = auth.student;
  const assignment = await env.DB.prepare(
    `SELECT * FROM assignments
     WHERE id = ? AND class_id = ? AND published = 1 AND archived_at IS NULL`
  ).bind(assignmentId, student.class_id).first();
  if (!assignment) {
    return errResponse('Assignment not found', 404, 'ASSIGNMENT_NOT_FOUND', request, env);
  }

  const writable = await assertClassTeacherWritable(student.class_id, request, env);
  if (writable.error) return writable.error;

  const contentType = (request.headers.get('content-type') || '').toLowerCase();
  let payload = {};
  let audioBuffer = null;
  let audioMime = null;
  let audioBytes = 0;

  if (contentType.includes('multipart/form-data')) {
    let form;
    try {
      form = await request.formData();
    } catch {
      return errResponse('Invalid multipart form data', 400, 'BAD_REQUEST', request, env);
    }

    const rawPayload = form.get('payload');
    if (rawPayload !== null && rawPayload !== undefined) {
      let text = '';
      if (typeof rawPayload === 'string') text = rawPayload;
      else if (typeof rawPayload.text === 'function') text = await rawPayload.text();
      if (text.length > 1024 * 1024) {
        return errResponse('Submission payload too large', 413, 'PAYLOAD_TOO_LARGE', request, env);
      }
      if (text.trim()) {
        const parsed = safeJsonParse(text, null);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return errResponse('Invalid payload JSON', 400, 'BAD_REQUEST', request, env);
        }
        payload = parsed;
      }
    }

    const audioField = form.get('audio');
    if (audioField && typeof audioField === 'object' && typeof audioField.arrayBuffer === 'function') {
      if (Number(audioField.size || 0) > MAX_AUDIO_BYTES) {
        return errResponse('Audio recording exceeds the 15 MB limit.', 413, 'AUDIO_TOO_LARGE', request, env);
      }
      const buf = await audioField.arrayBuffer();
      if (buf.byteLength > MAX_AUDIO_BYTES) {
        return errResponse('Audio recording exceeds the 15 MB limit.', 413, 'AUDIO_TOO_LARGE', request, env);
      }
      if (buf.byteLength > 0) {
        const rawMime = String(audioField.type || payload.audioMime || '').trim().toLowerCase();
        if (!isAllowedAudioMime(rawMime)) {
          return errResponse(
            'Unsupported audio format. Record with WebM, MP4/M4A, Ogg, WAV, or MP3.',
            415,
            'UNSUPPORTED_AUDIO_FORMAT',
            request,
            env
          );
        }
        audioBuffer = buf;
        audioMime = rawMime;
        audioBytes = buf.byteLength;
      }
    }
  } else {
    const parsed = await readJsonBody(request, 1024 * 1024);
    if (!parsed.ok) return errResponse(parsed.error, parsed.status, 'BAD_REQUEST', request, env);
    payload = parsed.data;
  }

  const attemptStartId = cleanText(payload.attemptStartId || payload.attempt_start_id || '', 64) || null;
  let attemptStart = null;
  if (attemptStartId) {
    attemptStart = await env.DB.prepare(
      `SELECT * FROM attempt_starts
       WHERE id = ? AND assignment_id = ? AND student_id = ?`
    ).bind(attemptStartId, assignment.id, student.student_id).first();
    if (!attemptStart) {
      return errResponse('Attempt session not found.', 400, 'INVALID_ATTEMPT_START', request, env);
    }
    if (attemptStart.consumed_at) {
      return errResponse('This attempt has already been submitted.', 409, 'ATTEMPT_ALREADY_CONSUMED', request, env);
    }
  }

  const maxRow = await env.DB.prepare(
    'SELECT COALESCE(MAX(attempt_num), 0) AS n FROM submissions WHERE assignment_id = ? AND student_id = ?'
  ).bind(assignment.id, student.student_id).first();
  const maxExisting = Number(maxRow?.n || 0);
  const attemptNum = attemptStart
    ? Math.max(Number(attemptStart.attempt_num), maxExisting + 1)
    : maxExisting + 1;

  if (assignment.max_attempts !== null && assignment.max_attempts !== undefined && attemptNum > Number(assignment.max_attempts)) {
    return errResponse(
      'You have used all allowed attempts for this assignment.',
      409,
      'ATTEMPT_LIMIT_REACHED',
      request,
      env,
      { maxAttempts: Number(assignment.max_attempts) }
    );
  }

  const config = safeJsonParse(assignment.config_json, {}) || {};
  const now = nowMs(env);
  const validated = validateAndRecomputeSubmission({
    assignment,
    config,
    payload,
    audioBytes,
    attemptStart,
    submittedAt: now,
  });
  if (!validated.ok) {
    return errResponse(validated.error || 'Invalid submission data.', 400, 'INVALID_SUBMISSION', request, env);
  }

  const submissionId = makeId('sub');
  let audioKey = null;
  let audioExpiresAt = null;

  if (audioBuffer && audioBytes > 0) {
    const ext = audioExtFromMime(audioMime);
    audioKey = `audio/${student.class_id}/${assignment.id}/${student.student_id}/${submissionId}.${ext}`;
    audioExpiresAt = now + AUDIO_RETENTION_DAYS * DAY_MS;
    await env.BUCKET.put(audioKey, audioBuffer, {
      httpMetadata: { contentType: audioMime },
    });
  }

  try {
    await env.DB.prepare(
      `INSERT INTO submissions (
        id, assignment_id, class_id, student_id, attempt_num, attempt_start_id,
        overall_pct, rhythm_pct, pitch_pct, results_json, integrity_flags_json,
        duration_sec, expected_sec, audio_r2_key, audio_mime, audio_bytes,
        audio_expires_at, submitted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      submissionId,
      assignment.id,
      student.class_id,
      student.student_id,
      attemptNum,
      attemptStart ? attemptStart.id : null,
      validated.overallPct,
      validated.rhythmPct,
      validated.pitchPct,
      validated.sanitizedResults ? JSON.stringify(validated.sanitizedResults) : null,
      JSON.stringify(validated.integrityFlags),
      validated.durationSec,
      validated.expectedSec,
      audioKey,
      audioMime,
      audioBytes,
      audioExpiresAt,
      now
    ).run();
  } catch (err) {
    if (audioKey && env.BUCKET) {
      await env.BUCKET.delete(audioKey).catch(() => {});
    }
    const msg = String(err?.message || '');
    if (msg.toLowerCase().includes('unique')) {
      return errResponse('This attempt was already submitted.', 409, 'DUPLICATE_ATTEMPT', request, env);
    }
    throw err;
  }

  if (attemptStart) {
    await env.DB.prepare(
      'UPDATE attempt_starts SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL'
    ).bind(now, attemptStart.id).run();
  }

  // IMPORTANT: Never expose integrityFlags to students.
  return jsonResponse({
    ok: true,
    submission: {
      id: submissionId,
      attemptNum,
      overallPct: validated.overallPct,
      rhythmPct: validated.rhythmPct,
      pitchPct: validated.pitchPct,
      submittedAt: now,
      audioSaved: !!audioKey,
    },
  }, 201, request, env);
}

// ---------- GET /api/submissions/:id/audio (owning teacher OR submitting student; read-only allowed)
export async function handleStreamSubmissionAudio(request, env, submissionId) {
  let actor = null;
  const tAuth = await requireTeacher(request, env);
  if (!tAuth.error) {
    actor = { role: 'teacher', teacher: tAuth.teacher };
  } else {
    const sAuth = await requireStudent(request, env);
    if (!sAuth.error) {
      actor = { role: 'student', student: sAuth.student };
    }
  }
  if (!actor) {
    return errResponse('Sign in required', 401, 'UNAUTHORIZED', request, env);
  }

  const sub = await env.DB.prepare(
    `SELECT s.*, c.teacher_id
     FROM submissions s
     JOIN classes c ON c.id = s.class_id
     WHERE s.id = ?`
  ).bind(submissionId).first();
  if (!sub) {
    return errResponse('Submission not found', 404, 'SUBMISSION_NOT_FOUND', request, env);
  }

  if (actor.role === 'teacher') {
    if (sub.teacher_id !== actor.teacher.id) {
      return errResponse('You do not have access to this submission.', 403, 'FORBIDDEN', request, env);
    }
  } else if (sub.student_id !== actor.student.student_id || sub.class_id !== actor.student.class_id) {
    return errResponse('You do not have access to this submission.', 403, 'FORBIDDEN', request, env);
  }

  const now = nowMs(env);
  if (!sub.audio_r2_key || sub.audio_deleted_at || (sub.audio_expires_at && Number(sub.audio_expires_at) <= now)) {
    return errResponse('This audio recording has expired or been deleted.', 410, 'AUDIO_EXPIRED', request, env);
  }

  const rangeHeader = request.headers.get('range');
  if (rangeHeader) {
    const head = await env.BUCKET.head(sub.audio_r2_key);
    if (!head) {
      return errResponse('This audio recording has expired or been deleted.', 410, 'AUDIO_EXPIRED', request, env);
    }
    const totalSize = Number(head.size ?? sub.audio_bytes ?? 0);
    const parsed = parseRangeHeader(rangeHeader, totalSize);
    if (parsed && parsed.invalid) {
      return new Response(null, {
        status: 416,
        headers: {
          ...corsHeaders(request, env),
          'Content-Range': `bytes */${totalSize}`,
          'Accept-Ranges': 'bytes',
        },
      });
    }
    if (parsed) {
      const obj = await env.BUCKET.get(sub.audio_r2_key, {
        range: { offset: parsed.start, length: parsed.length },
      });
      if (!obj) {
        return errResponse('This audio recording has expired or been deleted.', 410, 'AUDIO_EXPIRED', request, env);
      }
      return new Response(obj.body, {
        status: 206,
        headers: {
          ...corsHeaders(request, env),
          'Content-Type': sub.audio_mime || obj.httpMetadata?.contentType || 'application/octet-stream',
          'Content-Length': String(parsed.length),
          'Content-Range': `bytes ${parsed.start}-${parsed.end}/${totalSize}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'private, max-age=3600',
        },
      });
    }
  }

  const obj = await env.BUCKET.get(sub.audio_r2_key);
  if (!obj) {
    return errResponse('This audio recording has expired or been deleted.', 410, 'AUDIO_EXPIRED', request, env);
  }
  const totalSize = Number(obj.size ?? sub.audio_bytes ?? 0);
  const headers = {
    ...corsHeaders(request, env),
    'Content-Type': sub.audio_mime || obj.httpMetadata?.contentType || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
  };
  if (totalSize > 0) headers['Content-Length'] = String(totalSize);
  return new Response(obj.body, { status: 200, headers });
}

// ---------- GET /api/classes/:classId/gradebook (allowed in read-only mode)
export async function handleGetGradebook(request, env, auth, classId) {
  const cls = await env.DB.prepare(
    'SELECT * FROM classes WHERE id = ? AND teacher_id = ?'
  ).bind(classId, auth.teacher.id).first();
  if (!cls) return errResponse('Class not found', 404, 'CLASS_NOT_FOUND', request, env);

  const studentsRes = await env.DB.prepare(
    `SELECT id, display_name, email, part, archived_at
     FROM students
     WHERE class_id = ? AND archived_at IS NULL
     ORDER BY LOWER(display_name) ASC, created_at ASC`
  ).bind(classId).all();
  const students = studentsRes?.results || [];

  const assignmentsRes = await env.DB.prepare(
    `SELECT id, title, type, mode, due_at, max_attempts, grade_policy, published, created_at
     FROM assignments
     WHERE class_id = ? AND archived_at IS NULL
     ORDER BY COALESCE(due_at, created_at) ASC, created_at ASC`
  ).bind(classId).all();
  const assignments = assignmentsRes?.results || [];

  const subsRes = await env.DB.prepare(
    `SELECT id, assignment_id, student_id, attempt_num, overall_pct, rhythm_pct, pitch_pct,
            integrity_flags_json, teacher_override_pct, teacher_comment, graded_at,
            audio_r2_key, audio_expires_at, audio_deleted_at, submitted_at
     FROM submissions
     WHERE class_id = ?
     ORDER BY submitted_at ASC, attempt_num ASC`
  ).bind(classId).all();
  const subs = subsRes?.results || [];

  const byPair = new Map();
  for (const s of subs) {
    const key = `${s.student_id}:${s.assignment_id}`;
    let arr = byPair.get(key);
    if (!arr) { arr = []; byPair.set(key, arr); }
    arr.push(s);
  }

  const now = nowMs(env);
  const studentRows = students.map(st => {
    const cells = {};
    let scoreSum = 0;
    let scoreCount = 0;

    for (const a of assignments) {
      const list = byPair.get(`${st.id}:${a.id}`) || [];
      if (!list.length) {
        cells[a.id] = {
          status: 'missing',
          score: null,
          attempts: 0,
          hasFlags: false,
          submissionId: null,
          submittedAt: null,
          audioAvailable: false,
          overridden: false,
        };
        continue;
      }

      const chosen = pickGradedSubmission(list, a.grade_policy);
      const score = effectiveSubmissionScore(chosen);
      if (score !== null) {
        scoreSum += score;
        scoreCount++;
      }
      const hasFlags = list.some(s => (safeJsonParse(s.integrity_flags_json, []) || []).length > 0);
      const chosenFlags = safeJsonParse(chosen.integrity_flags_json, []) || [];
      const audioAvailable = !!(
        chosen.audio_r2_key &&
        !chosen.audio_deleted_at &&
        (!chosen.audio_expires_at || Number(chosen.audio_expires_at) > now)
      );

      cells[a.id] = {
        status: score === null ? 'submitted' : 'graded',
        score,
        overallPct: chosen.overall_pct,
        rhythmPct: chosen.rhythm_pct,
        pitchPct: chosen.pitch_pct,
        teacherOverridePct: chosen.teacher_override_pct,
        overridden: chosen.teacher_override_pct !== null && chosen.teacher_override_pct !== undefined,
        attempts: list.length,
        hasFlags,
        flagCount: chosenFlags.length,
        submissionId: chosen.id,
        submittedAt: chosen.submitted_at,
        audioAvailable,
        hasComment: !!chosen.teacher_comment,
      };
    }

    return {
      id: st.id,
      displayName: st.display_name,
      email: st.email || null,
      part: st.part || '',
      averagePct: scoreCount ? Math.round(scoreSum / scoreCount) : null,
      cells,
    };
  });

  return jsonResponse({
    ok: true,
    class: { id: cls.id, name: cls.name, joinCode: cls.join_code },
    assignments: assignments.map(a => ({
      id: a.id,
      title: a.title,
      type: a.type,
      mode: a.mode,
      dueAt: a.due_at,
      maxAttempts: a.max_attempts,
      gradePolicy: a.grade_policy,
      published: !!a.published,
    })),
    students: studentRows,
  }, 200, request, env);
}

// ---------- GET /api/assignments/:id/submissions (teacher view; allowed in read-only mode)
export async function handleListAssignmentSubmissions(request, env, auth, assignmentId) {
  const assignment = await env.DB.prepare(
    `SELECT a.*, c.name AS class_name
     FROM assignments a
     JOIN classes c ON c.id = a.class_id
     WHERE a.id = ? AND a.teacher_id = ?`
  ).bind(assignmentId, auth.teacher.id).first();
  if (!assignment) {
    return errResponse('Assignment not found', 404, 'ASSIGNMENT_NOT_FOUND', request, env);
  }

  const rowsRes = await env.DB.prepare(
    `SELECT s.*, st.display_name AS student_name, st.email AS student_email, st.part AS student_part
     FROM submissions s
     JOIN students st ON st.id = s.student_id
     WHERE s.assignment_id = ?
     ORDER BY s.submitted_at DESC, s.attempt_num DESC`
  ).bind(assignmentId).all();
  const rows = rowsRes?.results || [];

  const now = nowMs(env);
  const submissions = rows.map(s => {
    const flags = safeJsonParse(s.integrity_flags_json, []) || [];
    const audioAvailable = !!(
      s.audio_r2_key &&
      !s.audio_deleted_at &&
      (!s.audio_expires_at || Number(s.audio_expires_at) > now)
    );
    return {
      id: s.id,
      assignmentId: s.assignment_id,
      classId: s.class_id,
      studentId: s.student_id,
      studentName: s.student_name,
      studentEmail: s.student_email || null,
      studentPart: s.student_part || '',
      attemptNum: s.attempt_num,
      attemptStartId: s.attempt_start_id || null,
      overallPct: s.overall_pct,
      rhythmPct: s.rhythm_pct,
      pitchPct: s.pitch_pct,
      effectivePct: effectiveSubmissionScore(s),
      resultsJson: safeJsonParse(s.results_json, null),
      integrityFlags: flags,
      durationSec: s.duration_sec,
      expectedSec: s.expected_sec,
      audioAvailable,
      audioMime: s.audio_mime || null,
      audioBytes: s.audio_bytes || 0,
      audioExpiresAt: s.audio_expires_at || null,
      audioDeletedAt: s.audio_deleted_at || null,
      teacherOverridePct: s.teacher_override_pct,
      teacherComment: s.teacher_comment || '',
      gradedAt: s.graded_at || null,
      submittedAt: s.submitted_at,
    };
  });

  return jsonResponse({
    ok: true,
    assignment: {
      id: assignment.id,
      classId: assignment.class_id,
      title: assignment.title,
      type: assignment.type,
      mode: assignment.mode,
      gradePolicy: assignment.grade_policy,
    },
    submissions,
  }, 200, request, env);
}

// ---------- PATCH /api/submissions/:id (teacher grade override & comment; requires writable plan)
export async function handleGradeSubmission(request, env, auth, submissionId) {
  const planErr = assertTeacherWritable(auth.teacher, request, env);
  if (planErr) return planErr;

  const sub = await env.DB.prepare(
    `SELECT s.*, c.teacher_id
     FROM submissions s
     JOIN classes c ON c.id = s.class_id
     WHERE s.id = ? AND c.teacher_id = ?`
  ).bind(submissionId, auth.teacher.id).first();
  if (!sub) return errResponse('Submission not found', 404, 'SUBMISSION_NOT_FOUND', request, env);

  const body = await readJsonBody(request);
  if (!body.ok) return errResponse(body.error, body.status, 'BAD_REQUEST', request, env);

  const updates = [];
  const binds = [];

  const hasOverride = Object.prototype.hasOwnProperty.call(body.data, 'teacherOverridePct') ||
    Object.prototype.hasOwnProperty.call(body.data, 'teacher_override_pct');
  if (hasOverride) {
    const raw = Object.prototype.hasOwnProperty.call(body.data, 'teacherOverridePct')
      ? body.data.teacherOverridePct
      : body.data.teacher_override_pct;
    if (raw === null || raw === '') {
      updates.push('teacher_override_pct = NULL');
    } else {
      const num = Number(raw);
      if (!Number.isInteger(num) || num < 0 || num > 100) {
        return errResponse('Grade override must be a whole number from 0 to 100.', 400, 'INVALID_OVERRIDE', request, env);
      }
      updates.push('teacher_override_pct = ?');
      binds.push(num);
    }
  }

  const hasComment = Object.prototype.hasOwnProperty.call(body.data, 'teacherComment') ||
    Object.prototype.hasOwnProperty.call(body.data, 'teacher_comment');
  if (hasComment) {
    const rawComment = Object.prototype.hasOwnProperty.call(body.data, 'teacherComment')
      ? body.data.teacherComment
      : body.data.teacher_comment;
    updates.push('teacher_comment = ?');
    binds.push(cleanText(rawComment, 2000));
  }

  if (!updates.length) {
    return errResponse('Provide teacherOverridePct and/or teacherComment to update.', 400, 'NO_CHANGES', request, env);
  }

  const now = nowMs(env);
  updates.push('graded_at = ?');
  binds.push(now, sub.id);

  await env.DB.prepare(`UPDATE submissions SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run();
  const updated = await env.DB.prepare('SELECT * FROM submissions WHERE id = ?').bind(sub.id).first();

  return jsonResponse({
    ok: true,
    submission: {
      id: updated.id,
      overallPct: updated.overall_pct,
      rhythmPct: updated.rhythm_pct,
      pitchPct: updated.pitch_pct,
      teacherOverridePct: updated.teacher_override_pct,
      effectivePct: effectiveSubmissionScore(updated),
      teacherComment: updated.teacher_comment || '',
      gradedAt: updated.graded_at,
    },
  }, 200, request, env);
}

// ---------- DELETE /api/submissions/:id/audio (allowed in read-only mode; keeps grades)
export async function handleDeleteSubmissionAudio(request, env, auth, submissionId) {
  const sub = await env.DB.prepare(
    `SELECT s.*, c.teacher_id
     FROM submissions s
     JOIN classes c ON c.id = s.class_id
     WHERE s.id = ? AND c.teacher_id = ?`
  ).bind(submissionId, auth.teacher.id).first();
  if (!sub) return errResponse('Submission not found', 404, 'SUBMISSION_NOT_FOUND', request, env);

  if (sub.audio_r2_key && env.BUCKET) {
    await env.BUCKET.delete(sub.audio_r2_key).catch(() => {});
  }

  const now = nowMs(env);
  await env.DB.prepare(
    'UPDATE submissions SET audio_r2_key = NULL, audio_deleted_at = COALESCE(audio_deleted_at, ?) WHERE id = ?'
  ).bind(now, sub.id).run();

  return jsonResponse({
    ok: true,
    submissionId: sub.id,
    audioDeleted: true,
    audioDeletedAt: sub.audio_deleted_at || now,
  }, 200, request, env);
}

// ---------- DELETE /api/submissions/:id (allowed in read-only mode)
export async function handleDeleteSubmission(request, env, auth, submissionId) {
  const sub = await env.DB.prepare(
    `SELECT s.*, c.teacher_id
     FROM submissions s
     JOIN classes c ON c.id = s.class_id
     WHERE s.id = ? AND c.teacher_id = ?`
  ).bind(submissionId, auth.teacher.id).first();
  if (!sub) return errResponse('Submission not found', 404, 'SUBMISSION_NOT_FOUND', request, env);

  if (sub.audio_r2_key && env.BUCKET) {
    await env.BUCKET.delete(sub.audio_r2_key).catch(() => {});
  }

  await env.DB.prepare('DELETE FROM submissions WHERE id = ?').bind(sub.id).run();
  return jsonResponse({ ok: true, deleted: true, submissionId: sub.id }, 200, request, env);
}

// ---------- GET /api/classes/:classId/gradebook.csv (allowed in read-only mode)
export async function handleExportGradebookCsv(request, env, auth, classId) {
  const cls = await env.DB.prepare(
    'SELECT * FROM classes WHERE id = ? AND teacher_id = ?'
  ).bind(classId, auth.teacher.id).first();
  if (!cls) return errResponse('Class not found', 404, 'CLASS_NOT_FOUND', request, env);

  const url = new URL(request.url);
  const filterAssignmentId = cleanText(url.searchParams.get('assignmentId') || '', 64);

  const studentsRes = await env.DB.prepare(
    `SELECT id, display_name, email, part
     FROM students
     WHERE class_id = ? AND archived_at IS NULL
     ORDER BY LOWER(display_name) ASC, created_at ASC`
  ).bind(classId).all();
  const students = studentsRes?.results || [];

  let assignments = [];
  if (filterAssignmentId) {
    const one = await env.DB.prepare(
      'SELECT id, title, type, grade_policy FROM assignments WHERE id = ? AND class_id = ? AND archived_at IS NULL'
    ).bind(filterAssignmentId, classId).first();
    if (!one) return errResponse('Assignment not found', 404, 'ASSIGNMENT_NOT_FOUND', request, env);
    assignments = [one];
  } else {
    const aRes = await env.DB.prepare(
      `SELECT id, title, type, grade_policy
       FROM assignments
       WHERE class_id = ? AND archived_at IS NULL
       ORDER BY COALESCE(due_at, created_at) ASC, created_at ASC`
    ).bind(classId).all();
    assignments = aRes?.results || [];
  }

  const subsQuery = filterAssignmentId
    ? env.DB.prepare(
        `SELECT id, assignment_id, student_id, attempt_num, overall_pct, rhythm_pct, pitch_pct,
                teacher_override_pct, teacher_comment, submitted_at
         FROM submissions
         WHERE class_id = ? AND assignment_id = ?
         ORDER BY submitted_at ASC, attempt_num ASC`
      ).bind(classId, filterAssignmentId)
    : env.DB.prepare(
        `SELECT id, assignment_id, student_id, attempt_num, overall_pct, rhythm_pct, pitch_pct,
                teacher_override_pct, teacher_comment, submitted_at
         FROM submissions
         WHERE class_id = ?
         ORDER BY submitted_at ASC, attempt_num ASC`
      ).bind(classId);
  const subsRes = await subsQuery.all();
  const subs = subsRes?.results || [];

  const byPair = new Map();
  for (const s of subs) {
    const key = `${s.student_id}:${s.assignment_id}`;
    let arr = byPair.get(key);
    if (!arr) { arr = []; byPair.set(key, arr); }
    arr.push(s);
  }

  const lines = [];
  if (filterAssignmentId) {
    const a = assignments[0];
    lines.push([
      'Student', 'Part', 'Email', a.title, 'Attempts', 'Comment',
    ].map(csvCell).join(','));

    for (const st of students) {
      const list = byPair.get(`${st.id}:${a.id}`) || [];
      const chosen = pickGradedSubmission(list, a.grade_policy);
      const score = chosen ? effectiveSubmissionScore(chosen) : null;
      lines.push([
        st.display_name,
        st.part || '',
        st.email || '',
        score === null ? '' : score,
        list.length,
        chosen?.teacher_comment || '',
      ].map(csvCell).join(','));
    }
  } else {
    lines.push([
      'Student', 'Part', 'Email', ...assignments.map(a => a.title), 'Average (%)',
    ].map(csvCell).join(','));

    for (const st of students) {
      let scoreSum = 0;
      let scoreCount = 0;
      const cells = assignments.map(a => {
        const list = byPair.get(`${st.id}:${a.id}`) || [];
        const chosen = pickGradedSubmission(list, a.grade_policy);
        const score = chosen ? effectiveSubmissionScore(chosen) : null;
        if (score !== null) {
          scoreSum += score;
          scoreCount++;
        }
        return score === null ? '' : score;
      });
      const avg = scoreCount ? Math.round(scoreSum / scoreCount) : '';
      lines.push([
        st.display_name,
        st.part || '',
        st.email || '',
        ...cells,
        avg,
      ].map(csvCell).join(','));
    }
  }

  const csv = `${lines.join('\r\n')}\r\n`;
  const safeName = (cls.name || 'gradebook')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'gradebook';

  return new Response(csv, {
    status: 200,
    headers: {
      ...corsHeaders(request, env),
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safeName}-gradebook.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
