// Practice tracks: MusicXML files a teacher shares with a whole class for free practice.
// Not graded, never saved as a submission. Zero external dependencies.

import { bestEffortDeleteR2Key, cleanText, errResponse, jsonResponse, makeId, nowMs, readJsonBody, requireOwnedClass } from './util.js';
import { assertTeacherWritable } from './billing.js';
import { requireTeacherOrStudent } from './auth.js';
import { readValidatedScoreUpload, streamAssignmentScoreResponse } from './assignments.js';

// Each track can be up to 10 MB, so cap how many one class can hold.
export const MAX_TRACKS_PER_CLASS = 40;

// Never includes score_r2_key (storage path stays on the server).
function formatTrack(row) {
  return {
    id: row.id,
    classId: row.class_id,
    title: row.title,
    scoreFilename: row.score_filename,
    scoreBytes: Number(row.score_bytes || 0),
    createdAt: row.created_at,
    archivedAt: row.archived_at ?? null,
  };
}

async function getOwnedTrack(env, trackId, teacherId) {
  return env.DB.prepare(
    `SELECT p.* FROM practice_tracks p
     JOIN classes c ON c.id = p.class_id
     WHERE p.id = ? AND c.teacher_id = ?`
  ).bind(trackId, teacherId).first();
}

function trackNotFound(request, env) {
  return errResponse('Practice track not found.', 404, 'TRACK_NOT_FOUND', request, env);
}

export async function handleUploadPracticeTrack(request, env, auth, classId) {
  const blocked = assertTeacherWritable(auth.teacher, request, env);
  if (blocked) return blocked;

  const { error: clsErr } = await requireOwnedClass(request, env, classId, auth.teacher.id, { activeOnly: true });
  if (clsErr) return clsErr;

  // Check the limit first so a full class doesn't read a 10 MB file for nothing.
  const countRow = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM practice_tracks WHERE class_id = ? AND archived_at IS NULL'
  ).bind(classId).first();
  if (Number(countRow?.n || 0) >= MAX_TRACKS_PER_CLASS) {
    return errResponse(
      `This class already has ${MAX_TRACKS_PER_CLASS} practice tracks. Archive or delete one to add another.`,
      409, 'TRACK_LIMIT_REACHED', request, env
    );
  }

  const up = await readValidatedScoreUpload(request, env);
  if (up.error) return up.error;
  const { bytes, baseName, safeFilename, isMxl, mime, form } = up;

  const rawTitle = form ? form.get('title') : request.headers.get('x-title');
  let title = cleanText(typeof rawTitle === 'string' ? rawTitle : '', 120);
  if (!title) title = cleanText(baseName.replace(/\.[^.]+$/, ''), 120) || 'Practice track';

  const id = makeId('pt');
  const r2Key = `practice/${classId}/${id}.${isMxl ? 'mxl' : 'xml'}`;
  const now = nowMs(env);

  await env.BUCKET.put(r2Key, bytes, { httpMetadata: { contentType: mime } });
  try {
    await env.DB.prepare(
      `INSERT INTO practice_tracks (id, class_id, title, score_r2_key, score_filename, score_bytes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, classId, title, r2Key, safeFilename, bytes.byteLength, now).run();
  } catch (err) {
    await bestEffortDeleteR2Key(env, r2Key);
    throw err;
  }

  return jsonResponse({
    ok: true,
    track: formatTrack({
      id, class_id: classId, title, score_filename: safeFilename,
      score_bytes: bytes.byteLength, created_at: now, archived_at: null,
    }),
  }, 201, request, env);
}

export async function handleListClassPracticeTracks(request, env, auth, classId) {
  const { error: clsErr } = await requireOwnedClass(request, env, classId, auth.teacher.id);
  if (clsErr) return clsErr;

  const includeArchived = new URL(request.url).searchParams.get('includeArchived') === '1';
  const sql = includeArchived
    ? 'SELECT * FROM practice_tracks WHERE class_id = ? ORDER BY created_at DESC'
    : 'SELECT * FROM practice_tracks WHERE class_id = ? AND archived_at IS NULL ORDER BY created_at DESC';
  const rows = await env.DB.prepare(sql).bind(classId).all();
  return jsonResponse({ ok: true, tracks: (rows?.results || []).map(formatTrack) }, 200, request, env);
}

export async function handleUpdatePracticeTrack(request, env, auth, trackId) {
  const blocked = assertTeacherWritable(auth.teacher, request, env);
  if (blocked) return blocked;

  const existing = await getOwnedTrack(env, trackId, auth.teacher.id);
  if (!existing) return trackNotFound(request, env);

  const body = await readJsonBody(request);
  if (!body.ok) return errResponse(body.error, body.status, 'BAD_REQUEST', request, env);
  const d = body.data || {};

  let title = existing.title;
  if (d.title !== undefined) {
    title = cleanText(d.title, 120);
    if (!title) return errResponse('Practice track name is required.', 400, 'INVALID_TITLE', request, env);
  }
  let archivedAt = existing.archived_at ?? null;
  if (d.archived !== undefined) {
    archivedAt = d.archived ? (existing.archived_at || nowMs(env)) : null;
  }

  await env.DB.prepare(
    'UPDATE practice_tracks SET title = ?, archived_at = ? WHERE id = ?'
  ).bind(title, archivedAt, trackId).run();

  return jsonResponse({
    ok: true,
    track: formatTrack({ ...existing, title, archived_at: archivedAt }),
  }, 200, request, env);
}

// Allowed even in read-only mode: a teacher can always delete their own data.
export async function handleDeletePracticeTrack(request, env, auth, trackId) {
  const existing = await getOwnedTrack(env, trackId, auth.teacher.id);
  if (!existing) return trackNotFound(request, env);

  // Row first: if the file delete fails we only leave an orphan file, never a track students can see but can't open.
  await env.DB.prepare('DELETE FROM practice_tracks WHERE id = ?').bind(trackId).run();
  await bestEffortDeleteR2Key(env, existing.score_r2_key);

  return jsonResponse({ ok: true, deleted: true, id: trackId }, 200, request, env);
}

// A student only ever sees their own class (taken from the sign-in, never from the URL).
export async function handleStudentListPracticeTracks(request, env, auth) {
  const rows = await env.DB.prepare(
    `SELECT id, class_id, title, score_filename, score_bytes, created_at, archived_at
     FROM practice_tracks
     WHERE class_id = ? AND archived_at IS NULL
     ORDER BY created_at DESC`
  ).bind(auth.student.class_id).all();
  return jsonResponse({ ok: true, tracks: (rows?.results || []).map(formatTrack) }, 200, request, env);
}

export async function handleDownloadPracticeTrackScore(request, env, trackId) {
  const actor = await requireTeacherOrStudent(request, env);
  if (actor.error) return actor.error;

  const track = actor.role === 'teacher'
    ? await getOwnedTrack(env, trackId, actor.teacher.id)
    : await env.DB.prepare(
        'SELECT * FROM practice_tracks WHERE id = ? AND class_id = ? AND archived_at IS NULL'
      ).bind(trackId, actor.student.class_id).first();
  // Same answer whether the track is missing or belongs to another class.
  if (!track) return trackNotFound(request, env);

  return streamAssignmentScoreResponse(request, env, track, 'private, max-age=300', 'practice track');
}
