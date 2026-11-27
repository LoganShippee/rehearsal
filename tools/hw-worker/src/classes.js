// Teacher Class & Student Roster Management + FERPA/COPPA Data Export & Deletion.
// Zero external dependencies; pure Cloudflare Worker ESM.

import {
  bestEffortDeleteR2Keys, cleanText, errResponse, getOwnedClass, jsonResponse,
  makeId, normalizeEmail, nowMs, readJsonBody, safeJsonParse,
} from './util.js';
import {
  decryptStudentCode, encryptStudentCode, generateReadableCode, hashStudentCode, studentCodeLookupKey,
} from './crypto.js';
import { assertTeacherWritable } from './billing.js';
import { createStudentSession } from './auth.js';

const MAX_BULK_STUDENTS = 250;
const MAX_CODE_GEN_ATTEMPTS = 10;

async function getOwnedStudent(env, classId, studentId) {
  return await env.DB.prepare(
    'SELECT * FROM students WHERE id = ? AND class_id = ?'
  ).bind(studentId, classId).first();
}

// Every class gets one built-in "Test Student" so a teacher can try homework as a student.
// It has no sign-in code (the teacher opens it from the roster), is never counted in
// student totals or grades, and its submissions are cleaned up by the daily job.
export async function ensureTestStudent(env, classId) {
  const existing = await env.DB.prepare(
    'SELECT id FROM students WHERE class_id = ? AND is_test = 1 LIMIT 1'
  ).bind(classId).first();
  if (existing) return existing.id;
  const id = makeId('stu');
  const now = nowMs(env);
  await env.DB.prepare(
    `INSERT INTO students (id, class_id, display_name, part, is_test, created_at, updated_at)
     VALUES (?, ?, 'Test Student', '', 1, ?, ?)`
  ).bind(id, classId, now, now).run();
  return id;
}

function formatClass(row) {
  const out = {
    id: row.id,
    name: row.name,
    joinCode: row.join_code,
    locked: !!row.locked,
    archivedAt: row.archived_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.student_count !== undefined) out.studentCount = Number(row.student_count || 0);
  if (row.assignment_count !== undefined) out.assignmentCount = Number(row.assignment_count || 0);
  if (row.submission_count !== undefined) out.submissionCount = Number(row.submission_count || 0);
  return out;
}

function formatStudentPublic(row, now) {
  const lastSessionAt = row.last_session_at ? Number(row.last_session_at) : null;
  const lastSubmissionAt = row.last_submission_at ? Number(row.last_submission_at) : null;
  let lastActiveAt = null;
  if (lastSessionAt && lastSubmissionAt) lastActiveAt = Math.max(lastSessionAt, lastSubmissionAt);
  else lastActiveAt = lastSessionAt || lastSubmissionAt || null;

  const cooldown = row.code_cooldown_until ? Number(row.code_cooldown_until) : null;
  const activeCooldown = cooldown && cooldown > now ? cooldown : null;

  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email || null,
    part: row.part || '',
    hasGoogle: Boolean(row.has_google !== undefined ? row.has_google : row.google_sub),
    hasCode: Boolean(row.has_code !== undefined ? row.has_code : row.code_hash),
    isTest: !!row.is_test,
    codeLocked: !!row.code_hard_locked,
    codeCooldownUntil: activeCooldown,
    archivedAt: row.archived_at ?? null,
    submissionCount: Number(row.submission_count || 0),
    lastActiveAt,
  };
}

function isUniqueConstraintError(err) {
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('unique') || msg.includes('constraint');
}

async function generateUniqueJoinCode(env, excludeCode = null) {
  for (let i = 0; i < MAX_CODE_GEN_ATTEMPTS; i++) {
    const candidate = generateReadableCode(6);
    if (excludeCode && candidate === excludeCode) continue;
    const existing = await env.DB.prepare(
      'SELECT id FROM classes WHERE join_code = ?'
    ).bind(candidate).first();
    if (!existing) return candidate;
  }
  return null;
}

async function generateUniqueStudentCode(env, classId, usedLookups = null) {
  for (let i = 0; i < MAX_CODE_GEN_ATTEMPTS; i++) {
    const code = generateReadableCode(6);
    const lookup = await studentCodeLookupKey(classId, code, env);
    if (usedLookups && usedLookups.has(lookup)) continue;
    const existing = await env.DB.prepare(
      'SELECT id FROM students WHERE class_id = ? AND code_lookup = ?'
    ).bind(classId, lookup).first();
    if (existing) continue;
    if (usedLookups) usedLookups.add(lookup);
    const { hash, salt } = await hashStudentCode(code);
    return { code, lookup, hash, salt };
  }
  return null;
}

function safeFileSlug(raw, fallback = 'student') {
  const slug = String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || fallback;
}

// ---------- Classes

export async function handleListClasses(request, env, auth) {
  const url = new URL(request.url);
  const inc = url.searchParams.get('includeArchived');
  const includeArchived = inc === '1' || inc === 'true';

  const whereArchived = includeArchived ? '' : 'AND c.archived_at IS NULL';
  const res = await env.DB.prepare(
    `SELECT
       c.*,
       (SELECT COUNT(*) FROM students st WHERE st.class_id = c.id AND st.archived_at IS NULL AND st.is_test = 0) AS student_count,
       (SELECT COUNT(*) FROM assignments a WHERE a.class_id = c.id AND a.archived_at IS NULL) AS assignment_count,
       (SELECT COUNT(*) FROM submissions sub WHERE sub.class_id = c.id) AS submission_count
     FROM classes c
     WHERE c.teacher_id = ? ${whereArchived}
     ORDER BY c.archived_at IS NOT NULL ASC, c.created_at DESC`
  ).bind(auth.teacher.id).all();

  const classes = (res?.results || []).map(formatClass);
  return jsonResponse({ ok: true, classes }, 200, request, env);
}

export async function handleCreateClass(request, env, auth) {
  const writableErr = assertTeacherWritable(auth.teacher, request, env);
  if (writableErr) return writableErr;

  const body = await readJsonBody(request);
  if (!body.ok) return errResponse(body.error, body.status, 'BAD_REQUEST', request, env);

  const name = cleanText(body.data.name, 120);
  if (!name) return errResponse('Enter a class name.', 400, 'INVALID_NAME', request, env);
  const locked = body.data.locked ? 1 : 0;

  const id = makeId('cls');
  const now = nowMs(env);
  let joinCode = null;

  for (let attempt = 0; attempt < MAX_CODE_GEN_ATTEMPTS; attempt++) {
    const candidate = generateReadableCode(6);
    const existing = await env.DB.prepare(
      'SELECT id FROM classes WHERE join_code = ?'
    ).bind(candidate).first();
    if (existing) continue;
    try {
      await env.DB.prepare(
        `INSERT INTO classes (id, teacher_id, name, join_code, locked, archived_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`
      ).bind(id, auth.teacher.id, name, candidate, locked, now, now).run();
      joinCode = candidate;
      break;
    } catch (err) {
      if (isUniqueConstraintError(err)) continue;
      throw err;
    }
  }

  if (!joinCode) {
    return errResponse('Could not generate a unique class join code. Please try again.', 500, 'CODE_COLLISION', request, env);
  }

  return jsonResponse({
    ok: true,
    class: {
      id,
      name,
      joinCode,
      locked: !!locked,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      studentCount: 0,
      assignmentCount: 0,
      submissionCount: 0,
    },
  }, 201, request, env);
}

export async function handleUpdateClass(request, env, auth, classId) {
  const cls = await getOwnedClass(env, classId, auth.teacher.id);
  if (!cls) return errResponse('Class not found', 404, 'CLASS_NOT_FOUND', request, env);

  const body = await readJsonBody(request);
  if (!body.ok) return errResponse(body.error, body.status, 'BAD_REQUEST', request, env);

  const hasName = body.data.name !== undefined;
  const hasLocked = body.data.locked !== undefined;
  const hasArchived = body.data.archived !== undefined;
  const wantRotate = body.data.rotateJoinCode === true;

  // Archiving is allowed even in read-only mode; all other edits require a writable plan.
  const needsWritable = hasName || hasLocked || wantRotate || (hasArchived && !body.data.archived);
  if (needsWritable) {
    const writableErr = assertTeacherWritable(auth.teacher, request, env);
    if (writableErr) return writableErr;
  }

  const now = nowMs(env);
  const updates = [];
  const binds = [];

  if (hasName) {
    const name = cleanText(body.data.name, 120);
    if (!name) return errResponse('Class name cannot be empty.', 400, 'INVALID_NAME', request, env);
    updates.push('name = ?');
    binds.push(name);
  }

  if (hasLocked) {
    updates.push('locked = ?');
    binds.push(body.data.locked ? 1 : 0);
  }

  if (hasArchived) {
    updates.push('archived_at = ?');
    binds.push(body.data.archived ? (cls.archived_at || now) : null);
  }

  if (wantRotate) {
    const nextCode = await generateUniqueJoinCode(env, cls.join_code);
    if (!nextCode) {
      return errResponse('Could not generate a unique class join code. Please try again.', 500, 'CODE_COLLISION', request, env);
    }
    updates.push('join_code = ?');
    binds.push(nextCode);
  }

  if (updates.length) {
    updates.push('updated_at = ?');
    binds.push(now, classId, auth.teacher.id);
    await env.DB.prepare(
      `UPDATE classes SET ${updates.join(', ')} WHERE id = ? AND teacher_id = ?`
    ).bind(...binds).run();
  }

  // Archiving a class immediately revokes all active student sessions for that class.
  let sessionsRevoked = 0;
  if (hasArchived && body.data.archived) {
    const rev = await env.DB.prepare(
      'UPDATE student_sessions SET revoked_at = ? WHERE class_id = ? AND revoked_at IS NULL'
    ).bind(now, classId).run();
    sessionsRevoked = Number(rev?.meta?.changes || 0);
  }

  const updated = await env.DB.prepare(
    `SELECT
       c.*,
       (SELECT COUNT(*) FROM students st WHERE st.class_id = c.id AND st.archived_at IS NULL AND st.is_test = 0) AS student_count,
       (SELECT COUNT(*) FROM assignments a WHERE a.class_id = c.id AND a.archived_at IS NULL) AS assignment_count,
       (SELECT COUNT(*) FROM submissions sub WHERE sub.class_id = c.id) AS submission_count
     FROM classes c
     WHERE c.id = ? AND c.teacher_id = ?`
  ).bind(classId, auth.teacher.id).first();

  const resp = { ok: true, class: formatClass(updated) };
  if (hasArchived && body.data.archived) resp.sessionsRevoked = sessionsRevoked;
  return jsonResponse(resp, 200, request, env);
}

// ALLOWED even in read-only mode (FERPA right to delete)
export async function handleDeleteClass(request, env, auth, classId) {
  const cls = await getOwnedClass(env, classId, auth.teacher.id);
  if (!cls) return errResponse('Class not found', 404, 'CLASS_NOT_FOUND', request, env);

  const scoreRows = await env.DB.prepare(
    'SELECT score_r2_key FROM assignments WHERE class_id = ? AND score_r2_key IS NOT NULL'
  ).bind(classId).all();
  const audioRows = await env.DB.prepare(
    'SELECT audio_r2_key FROM submissions WHERE class_id = ? AND audio_r2_key IS NOT NULL'
  ).bind(classId).all();

  const practiceRows = await env.DB.prepare(
    'SELECT score_r2_key FROM practice_tracks WHERE class_id = ?'
  ).bind(classId).all();

  const r2Keys = [
    ...(scoreRows?.results || []).map(r => r.score_r2_key),
    ...(practiceRows?.results || []).map(r => r.score_r2_key),
    ...(audioRows?.results || []).map(r => r.audio_r2_key),
  ];
  const deletedR2Objects = await bestEffortDeleteR2Keys(env, r2Keys);

  await env.DB.prepare(
    'DELETE FROM classes WHERE id = ? AND teacher_id = ?'
  ).bind(classId, auth.teacher.id).run();

  return jsonResponse({ ok: true, deleted: true, classId, deletedR2Objects }, 200, request, env);
}

// ---------- Students

export async function handleListStudents(request, env, auth, classId) {
  const cls = await getOwnedClass(env, classId, auth.teacher.id);
  if (!cls) return errResponse('Class not found', 404, 'CLASS_NOT_FOUND', request, env);

  const url = new URL(request.url);
  const inc = url.searchParams.get('includeArchived');
  const includeArchived = inc === '1' || inc === 'true';
  const whereArchived = includeArchived ? '' : 'AND st.archived_at IS NULL';

  const now = nowMs(env);
  await ensureTestStudent(env, classId);
  // NEVER select or return code_hash, code_salt, or code_lookup.
  const res = await env.DB.prepare(
    `SELECT
       st.id,
       st.display_name,
       st.email,
       st.part,
       st.is_test,
       CASE WHEN st.google_sub IS NOT NULL AND st.google_sub != '' THEN 1 ELSE 0 END AS has_google,
       CASE WHEN st.code_hash IS NOT NULL AND st.code_hash != '' THEN 1 ELSE 0 END AS has_code,
       st.code_hard_locked,
       st.code_cooldown_until,
       st.archived_at,
       st.created_at,
       st.updated_at,
       (SELECT COUNT(*) FROM submissions sub WHERE sub.student_id = st.id) AS submission_count,
       (SELECT MAX(ss.last_seen_at) FROM student_sessions ss WHERE ss.student_id = st.id) AS last_session_at,
       (SELECT MAX(sub2.submitted_at) FROM submissions sub2 WHERE sub2.student_id = st.id) AS last_submission_at
     FROM students st
     WHERE st.class_id = ? ${whereArchived}
     ORDER BY st.is_test DESC, st.archived_at IS NOT NULL ASC, LOWER(st.display_name) ASC`
  ).bind(classId).all();

  const students = (res?.results || []).map(row => formatStudentPublic(row, now));
  return jsonResponse({ ok: true, class: formatClass(cls), students }, 200, request, env);
}

// Codes for the roster's "Show codes" toggle. Only the class's own teacher can ask.
// The list endpoint above never carries codes, so they are fetched on demand here.
// A student with no stored code (made before this existed) comes back as null.
export async function handleListStudentCodes(request, env, auth, classId) {
  const cls = await getOwnedClass(env, classId, auth.teacher.id);
  if (!cls) return errResponse('Class not found', 404, 'CLASS_NOT_FOUND', request, env);
  const res = await env.DB.prepare(
    'SELECT id, code_enc FROM students WHERE class_id = ? AND archived_at IS NULL AND is_test = 0'
  ).bind(classId).all();
  const codes = {};
  for (const row of (res?.results || [])) {
    codes[row.id] = row.code_enc ? await decryptStudentCode(env, row.id, row.code_enc) : null;
  }
  return jsonResponse({ ok: true, codes }, 200, request, env);
}

// Teacher clicks "Open as student": hand back a student session for the class's Test Student.
// The app puts the token in the URL #fragment, which browsers never send to any server.
export async function handleOpenTestStudent(request, env, auth, classId) {
  const cls = await getOwnedClass(env, classId, auth.teacher.id);
  if (!cls) return errResponse('Class not found', 404, 'CLASS_NOT_FOUND', request, env);
  const studentId = await ensureTestStudent(env, classId);
  const session = await createStudentSession(env, studentId, classId, 'code');
  return jsonResponse({ ok: true, token: session.token, expiresAt: session.expiresAt }, 200, request, env);
}

export async function handleAddStudents(request, env, auth, classId) {
  const writableErr = assertTeacherWritable(auth.teacher, request, env);
  if (writableErr) return writableErr;

  const cls = await getOwnedClass(env, classId, auth.teacher.id);
  if (!cls) return errResponse('Class not found', 404, 'CLASS_NOT_FOUND', request, env);

  const body = await readJsonBody(request);
  if (!body.ok) return errResponse(body.error, body.status, 'BAD_REQUEST', request, env);

  const rawList = Array.isArray(body.data.students) ? body.data.students : [body.data];
  if (!rawList.length) {
    return errResponse('Add at least one student.', 400, 'INVALID_INPUT', request, env);
  }
  if (rawList.length > MAX_BULK_STUDENTS) {
    return errResponse(
      `You can add up to ${MAX_BULK_STUDENTS} students at a time.`,
      400,
      'TOO_MANY_STUDENTS',
      request,
      env
    );
  }

  const defaultGenerateCode = body.data.generateCode !== false;
  const prepared = [];
  for (let i = 0; i < rawList.length; i++) {
    const item = rawList[i];
    if (!item || typeof item !== 'object') {
      return errResponse(`Student entry #${i + 1} is invalid.`, 400, 'INVALID_INPUT', request, env);
    }
    const displayName = cleanText(item.displayName !== undefined ? item.displayName : item.name, 120);
    if (!displayName) {
      return errResponse(`Student #${i + 1} needs a name.`, 400, 'INVALID_NAME', request, env);
    }
    let email = null;
    if (item.email !== undefined && item.email !== null && String(item.email).trim() !== '') {
      email = normalizeEmail(item.email);
      if (!email) {
        return errResponse(`Invalid email address for ${displayName}.`, 400, 'INVALID_EMAIL', request, env);
      }
    }
    const part = cleanText(item.part || '', 80);
    const generateCode = item.generateCode !== undefined ? item.generateCode !== false : defaultGenerateCode;
    prepared.push({ displayName, email, part, generateCode });
  }

  const now = nowMs(env);
  const usedLookups = new Set();
  const createdStudents = [];
  const generatedCodes = [];

  for (const item of prepared) {
    const studentId = makeId('stu');
    let plainCode = null;
    let codeLookup = null;
    let codeHash = null;
    let codeSalt = null;

    if (item.generateCode) {
      let inserted = false;
      for (let attempt = 0; attempt < MAX_CODE_GEN_ATTEMPTS; attempt++) {
        const gen = await generateUniqueStudentCode(env, classId, usedLookups);
        if (!gen) break;
        try {
          const codeEnc = await encryptStudentCode(env, studentId, gen.code);
          await env.DB.prepare(
            `INSERT INTO students
               (id, class_id, display_name, email, part, code_lookup, code_hash, code_salt, code_enc, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            studentId, classId, item.displayName, item.email, item.part,
            gen.lookup, gen.hash, gen.salt, codeEnc, now, now
          ).run();
          plainCode = gen.code;
          codeLookup = gen.lookup;
          codeHash = gen.hash;
          codeSalt = gen.salt;
          inserted = true;
          break;
        } catch (err) {
          if (isUniqueConstraintError(err)) continue;
          throw err;
        }
      }
      if (!inserted) {
        return errResponse('Could not generate a unique student code. Please try again.', 500, 'CODE_COLLISION', request, env);
      }
    } else {
      await env.DB.prepare(
        `INSERT INTO students
           (id, class_id, display_name, email, part, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(studentId, classId, item.displayName, item.email, item.part, now, now).run();
    }

    createdStudents.push({
      id: studentId,
      displayName: item.displayName,
      email: item.email,
      part: item.part,
      hasGoogle: false,
      hasCode: Boolean(codeHash && codeSalt && codeLookup),
      codeLocked: false,
      codeCooldownUntil: null,
      archivedAt: null,
      submissionCount: 0,
      lastActiveAt: null,
    });

    if (plainCode) {
      generatedCodes.push({
        studentId,
        displayName: item.displayName,
        part: item.part,
        code: plainCode,
      });
    }
  }

  return jsonResponse({
    ok: true,
    students: createdStudents,
    generatedCodes,
    count: createdStudents.length,
  }, 201, request, env);
}

export async function handleUpdateStudent(request, env, auth, classId, studentId) {
  const cls = await getOwnedClass(env, classId, auth.teacher.id);
  if (!cls) return errResponse('Class not found', 404, 'CLASS_NOT_FOUND', request, env);

  const student = await getOwnedStudent(env, classId, studentId);
  if (!student) return errResponse('Student not found', 404, 'STUDENT_NOT_FOUND', request, env);

  const body = await readJsonBody(request);
  if (!body.ok) return errResponse(body.error, body.status, 'BAD_REQUEST', request, env);

  const hasName = body.data.displayName !== undefined;
  const hasEmail = body.data.email !== undefined;
  const hasPart = body.data.part !== undefined;
  const hasArchived = body.data.archived !== undefined;

  // Archiving a student is allowed in read-only mode; non-archive edits require writable plan.
  const needsWritable = hasName || hasEmail || hasPart || (hasArchived && !body.data.archived);
  if (needsWritable) {
    const writableErr = assertTeacherWritable(auth.teacher, request, env);
    if (writableErr) return writableErr;
  }

  const now = nowMs(env);
  const updates = [];
  const binds = [];

  if (hasName) {
    const displayName = cleanText(body.data.displayName, 120);
    if (!displayName) return errResponse('Student name cannot be empty.', 400, 'INVALID_NAME', request, env);
    updates.push('display_name = ?');
    binds.push(displayName);
  }

  if (hasEmail) {
    if (body.data.email === null || String(body.data.email).trim() === '') {
      updates.push('email = NULL');
    } else {
      const email = normalizeEmail(body.data.email);
      if (!email) return errResponse('Enter a valid email address.', 400, 'INVALID_EMAIL', request, env);
      updates.push('email = ?');
      binds.push(email);
    }
  }

  if (hasPart) {
    updates.push('part = ?');
    binds.push(cleanText(body.data.part, 80));
  }

  if (hasArchived) {
    updates.push('archived_at = ?');
    binds.push(body.data.archived ? (student.archived_at || now) : null);
  }

  if (updates.length) {
    updates.push('updated_at = ?');
    binds.push(now, studentId, classId);
    await env.DB.prepare(
      `UPDATE students SET ${updates.join(', ')} WHERE id = ? AND class_id = ?`
    ).bind(...binds).run();
  }

  let sessionsRevoked = 0;
  if (hasArchived && body.data.archived) {
    const rev = await env.DB.prepare(
      'UPDATE student_sessions SET revoked_at = ? WHERE student_id = ? AND class_id = ? AND revoked_at IS NULL'
    ).bind(now, studentId, classId).run();
    sessionsRevoked = Number(rev?.meta?.changes || 0);
  }

  const updated = await env.DB.prepare(
    `SELECT
       st.id, st.display_name, st.email, st.part, st.is_test,
       CASE WHEN st.google_sub IS NOT NULL AND st.google_sub != '' THEN 1 ELSE 0 END AS has_google,
       CASE WHEN st.code_hash IS NOT NULL AND st.code_hash != '' THEN 1 ELSE 0 END AS has_code,
       st.code_hard_locked, st.code_cooldown_until, st.archived_at,
       (SELECT COUNT(*) FROM submissions sub WHERE sub.student_id = st.id) AS submission_count,
       (SELECT MAX(ss.last_seen_at) FROM student_sessions ss WHERE ss.student_id = st.id) AS last_session_at,
       (SELECT MAX(sub2.submitted_at) FROM submissions sub2 WHERE sub2.student_id = st.id) AS last_submission_at
     FROM students st
     WHERE st.id = ? AND st.class_id = ?`
  ).bind(studentId, classId).first();

  const resp = { ok: true, student: formatStudentPublic(updated, now) };
  if (hasArchived && body.data.archived) resp.sessionsRevoked = sessionsRevoked;
  return jsonResponse(resp, 200, request, env);
}

export async function handleRegenerateStudentCode(request, env, auth, classId, studentId) {
  const writableErr = assertTeacherWritable(auth.teacher, request, env);
  if (writableErr) return writableErr;

  const cls = await getOwnedClass(env, classId, auth.teacher.id);
  if (!cls) return errResponse('Class not found', 404, 'CLASS_NOT_FOUND', request, env);

  const student = await getOwnedStudent(env, classId, studentId);
  if (!student) return errResponse('Student not found', 404, 'STUDENT_NOT_FOUND', request, env);

  const body = await readJsonBody(request);
  if (!body.ok) return errResponse(body.error, body.status, 'BAD_REQUEST', request, env);

  const now = nowMs(env);
  let newCode = null;

  for (let attempt = 0; attempt < MAX_CODE_GEN_ATTEMPTS; attempt++) {
    const gen = await generateUniqueStudentCode(env, classId);
    if (!gen) break;
    try {
      const codeEnc = await encryptStudentCode(env, studentId, gen.code);
      await env.DB.prepare(
        `UPDATE students
         SET code_lookup = ?, code_hash = ?, code_salt = ?, code_enc = ?,
             failed_code_attempts = 0, code_cooldown_until = NULL, code_hard_locked = 0,
             updated_at = ?
         WHERE id = ? AND class_id = ?`
      ).bind(gen.lookup, gen.hash, gen.salt, codeEnc, now, studentId, classId).run();
      newCode = gen.code;
      break;
    } catch (err) {
      if (isUniqueConstraintError(err)) continue;
      throw err;
    }
  }

  if (!newCode) {
    return errResponse('Could not generate a unique student code. Please try again.', 500, 'CODE_COLLISION', request, env);
  }

  const revokeSessions = body.data.revokeSessions !== false;
  if (revokeSessions) {
    await env.DB.prepare(
      'UPDATE student_sessions SET revoked_at = ? WHERE student_id = ? AND class_id = ? AND revoked_at IS NULL'
    ).bind(now, studentId, classId).run();
  }

  return jsonResponse({
    ok: true,
    studentId: student.id,
    displayName: student.display_name,
    part: student.part || '',
    code: newCode,
    sessionsRevoked: revokeSessions,
  }, 200, request, env);
}

export async function handleRegenerateClassCodes(request, env, auth, classId) {
  const writableErr = assertTeacherWritable(auth.teacher, request, env);
  if (writableErr) return writableErr;

  const cls = await getOwnedClass(env, classId, auth.teacher.id);
  if (!cls) return errResponse('Class not found', 404, 'CLASS_NOT_FOUND', request, env);

  const body = await readJsonBody(request);
  if (!body.ok) return errResponse(body.error, body.status, 'BAD_REQUEST', request, env);

  let students = [];
  if (Array.isArray(body.data.studentIds) && body.data.studentIds.length > 0) {
    const ids = [...new Set(body.data.studentIds.map(s => cleanText(s, 64)).filter(Boolean))];
    if (ids.length > MAX_BULK_STUDENTS) {
      return errResponse(
        `You can regenerate up to ${MAX_BULK_STUDENTS} student codes at once.`,
        400,
        'TOO_MANY_STUDENTS',
        request,
        env
      );
    }
    if (ids.length) {
      const placeholders = ids.map(() => '?').join(', ');
      const res = await env.DB.prepare(
        `SELECT id, display_name, part
         FROM students
         WHERE class_id = ? AND archived_at IS NULL AND is_test = 0 AND id IN (${placeholders})
         ORDER BY LOWER(display_name) ASC`
      ).bind(classId, ...ids).all();
      students = res?.results || [];
    }
  } else {
    const res = await env.DB.prepare(
      `SELECT id, display_name, part
       FROM students
       WHERE class_id = ? AND archived_at IS NULL AND is_test = 0
       ORDER BY LOWER(display_name) ASC`
    ).bind(classId).all();
    students = res?.results || [];
  }

  const now = nowMs(env);
  const revokeSessions = body.data.revokeSessions !== false;
  const usedLookups = new Set();
  const generatedCodes = [];

  for (const st of students) {
    let newCode = null;
    for (let attempt = 0; attempt < MAX_CODE_GEN_ATTEMPTS; attempt++) {
      const gen = await generateUniqueStudentCode(env, classId, usedLookups);
      if (!gen) break;
      try {
        const codeEnc = await encryptStudentCode(env, st.id, gen.code);
        await env.DB.prepare(
          `UPDATE students
           SET code_lookup = ?, code_hash = ?, code_salt = ?, code_enc = ?,
               failed_code_attempts = 0, code_cooldown_until = NULL, code_hard_locked = 0,
               updated_at = ?
           WHERE id = ? AND class_id = ?`
        ).bind(gen.lookup, gen.hash, gen.salt, codeEnc, now, st.id, classId).run();
        newCode = gen.code;
        break;
      } catch (err) {
        if (isUniqueConstraintError(err)) continue;
        throw err;
      }
    }
    if (!newCode) {
      return errResponse('Could not generate unique student codes. Please try again.', 500, 'CODE_COLLISION', request, env);
    }

    if (revokeSessions) {
      await env.DB.prepare(
        'UPDATE student_sessions SET revoked_at = ? WHERE student_id = ? AND class_id = ? AND revoked_at IS NULL'
      ).bind(now, st.id, classId).run();
    }

    generatedCodes.push({
      studentId: st.id,
      displayName: st.display_name,
      part: st.part || '',
      code: newCode,
    });
  }

  return jsonResponse({
    ok: true,
    classId,
    generatedCodes,
    count: generatedCodes.length,
    sessionsRevoked: revokeSessions,
  }, 200, request, env);
}

export async function handleRevokeStudentSessions(request, env, auth, classId, studentId) {
  const cls = await getOwnedClass(env, classId, auth.teacher.id);
  if (!cls) return errResponse('Class not found', 404, 'CLASS_NOT_FOUND', request, env);

  const student = await getOwnedStudent(env, classId, studentId);
  if (!student) return errResponse('Student not found', 404, 'STUDENT_NOT_FOUND', request, env);

  const now = nowMs(env);
  const res = await env.DB.prepare(
    'UPDATE student_sessions SET revoked_at = ? WHERE student_id = ? AND class_id = ? AND revoked_at IS NULL'
  ).bind(now, studentId, classId).run();

  return jsonResponse({
    ok: true,
    studentId,
    revokedCount: Number(res?.meta?.changes || 0),
  }, 200, request, env);
}

export async function handleRevokeClassSessions(request, env, auth, classId) {
  const cls = await getOwnedClass(env, classId, auth.teacher.id);
  if (!cls) return errResponse('Class not found', 404, 'CLASS_NOT_FOUND', request, env);

  const now = nowMs(env);
  const res = await env.DB.prepare(
    'UPDATE student_sessions SET revoked_at = ? WHERE class_id = ? AND revoked_at IS NULL'
  ).bind(now, classId).run();

  return jsonResponse({
    ok: true,
    classId,
    revokedCount: Number(res?.meta?.changes || 0),
  }, 200, request, env);
}

// ALLOWED even in read-only mode (FERPA right to delete)
export async function handleDeleteStudent(request, env, auth, classId, studentId) {
  const cls = await getOwnedClass(env, classId, auth.teacher.id);
  if (!cls) return errResponse('Class not found', 404, 'CLASS_NOT_FOUND', request, env);

  const student = await getOwnedStudent(env, classId, studentId);
  if (!student) return errResponse('Student not found', 404, 'STUDENT_NOT_FOUND', request, env);

  const audioRows = await env.DB.prepare(
    'SELECT audio_r2_key FROM submissions WHERE student_id = ? AND class_id = ? AND audio_r2_key IS NOT NULL'
  ).bind(studentId, classId).all();

  const r2Keys = (audioRows?.results || []).map(r => r.audio_r2_key);
  const deletedR2Objects = await bestEffortDeleteR2Keys(env, r2Keys);

  await env.DB.prepare(
    'DELETE FROM students WHERE id = ? AND class_id = ?'
  ).bind(studentId, classId).run();

  return jsonResponse({
    ok: true,
    deleted: true,
    studentId,
    deletedR2Objects,
  }, 200, request, env);
}

// ALLOWED even in read-only mode (FERPA/COPPA right to access & export student data)
export async function handleExportStudentData(request, env, auth, classId, studentId) {
  const cls = await getOwnedClass(env, classId, auth.teacher.id);
  if (!cls) return errResponse('Class not found', 404, 'CLASS_NOT_FOUND', request, env);

  const student = await getOwnedStudent(env, classId, studentId);
  if (!student) return errResponse('Student not found', 404, 'STUDENT_NOT_FOUND', request, env);

  const now = nowMs(env);
  const res = await env.DB.prepare(
    `SELECT
       sub.id,
       sub.assignment_id,
       a.title AS assignment_title,
       a.type AS assignment_type,
       a.mode AS assignment_mode,
       sub.attempt_num,
       sub.overall_pct,
       sub.rhythm_pct,
       sub.pitch_pct,
       sub.results_json,
       sub.integrity_flags_json,
       sub.duration_sec,
       sub.expected_sec,
       sub.audio_r2_key,
       sub.audio_mime,
       sub.audio_bytes,
       sub.audio_expires_at,
       sub.audio_deleted_at,
       sub.teacher_override_pct,
       sub.teacher_comment,
       sub.graded_at,
       sub.submitted_at
     FROM submissions sub
     LEFT JOIN assignments a ON a.id = sub.assignment_id
     WHERE sub.student_id = ? AND sub.class_id = ?
     ORDER BY sub.submitted_at ASC`
  ).bind(studentId, classId).all();

  const submissions = (res?.results || []).map(sub => {
    let audioStatus = 'none';
    if (sub.audio_deleted_at) {
      audioStatus = 'deleted';
    } else if (sub.audio_r2_key) {
      audioStatus = (sub.audio_expires_at && Number(sub.audio_expires_at) <= now)
        ? 'expired'
        : 'available';
    }

    const overallPct = sub.overall_pct !== null && sub.overall_pct !== undefined ? Number(sub.overall_pct) : null;
    const rhythmPct = sub.rhythm_pct !== null && sub.rhythm_pct !== undefined ? Number(sub.rhythm_pct) : null;
    const pitchPct = sub.pitch_pct !== null && sub.pitch_pct !== undefined ? Number(sub.pitch_pct) : null;
    const teacherOverridePct = sub.teacher_override_pct !== null && sub.teacher_override_pct !== undefined
      ? Number(sub.teacher_override_pct)
      : null;

    return {
      id: sub.id,
      assignmentId: sub.assignment_id,
      assignmentTitle: sub.assignment_title || '',
      assignmentType: sub.assignment_type || null,
      assignmentMode: sub.assignment_mode || null,
      attemptNum: Number(sub.attempt_num),
      overallPct,
      rhythmPct,
      pitchPct,
      teacherOverridePct,
      effectivePct: teacherOverridePct !== null ? teacherOverridePct : overallPct,
      teacherComment: sub.teacher_comment || '',
      gradedAt: sub.graded_at ?? null,
      submittedAt: sub.submitted_at,
      durationSec: Number(sub.duration_sec || 0),
      expectedSec: sub.expected_sec !== null && sub.expected_sec !== undefined ? Number(sub.expected_sec) : null,
      audio: {
        status: audioStatus,
        mime: sub.audio_mime || null,
        bytes: Number(sub.audio_bytes || 0),
        expiresAt: sub.audio_expires_at ?? null,
        deletedAt: sub.audio_deleted_at ?? null,
      },
      resultsJson: safeJsonParse(sub.results_json, null),
      integrityFlags: safeJsonParse(sub.integrity_flags_json, []),
    };
  });

  const payload = {
    ok: true,
    exportedAt: now,
    exportedAtIso: new Date(now).toISOString(),
    class: {
      id: cls.id,
      name: cls.name,
      joinCode: cls.join_code,
      archivedAt: cls.archived_at ?? null,
      createdAt: cls.created_at,
    },
    student: {
      id: student.id,
      displayName: student.display_name,
      email: student.email || null,
      part: student.part || '',
      hasGoogle: Boolean(student.google_sub),
      hasCode: Boolean(student.code_hash),
      codeLocked: !!student.code_hard_locked,
      archivedAt: student.archived_at ?? null,
      createdAt: student.created_at,
      updatedAt: student.updated_at,
    },
    submissions,
  };

  const filename = `student-data-${safeFileSlug(student.display_name, student.id)}.json`;
  return jsonResponse(payload, 200, request, env, {
    'Content-Disposition': `attachment; filename="${filename}"`,
  });
}
