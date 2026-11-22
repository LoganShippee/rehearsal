// Teacher & Student Authentication:
//   - Teacher 6-digit email-code login (load-bearing Day 1, Resend or DEV_MODE)
//   - Teacher Google Sign-In (openid email profile, JWKS verified)
//   - Desktop OAuth Handoff scaffolding (oauth_handoffs, 60s TTL, Milestone 5)
//   - Student Personal 6-char Fallback Code login (PBKDF2-SHA256 + 16-byte salt,
//     no public roster dropdown, IP rate limit 20/15m, 5-fail 15m cooldown / 10-fail hard lock)
//   - Student Google Sign-In (immutable google_sub, Class Join Code, Lock Class toggle)

import {
  DAY_MS, cleanText, errResponse, getBearerToken, getClientIp, isDevMode,
  jsonResponse, makeId, normalizeEmail, nowMs, readJsonBody,
} from './util.js';
import {
  formatCode, generateEmailDigits, hashEmailCode, hashSessionToken, normalizeCode,
  randomHex, sha256Hex, studentCodeLookupKey, timingSafeEqual, verifyGoogleIdToken,
  verifyStudentCode,
} from './crypto.js';
import { checkRateLimit, clearRateLimit, recordRateFailure } from './rate-limit.js';
import { computePlanState, DEFAULT_STUDENT_SOFT_CAP, getServerCapabilities, TRIAL_DAYS } from './billing.js';

const EMAIL_CODE_TTL_MS = 10 * 60 * 1000;          // 10 minutes
const EMAIL_CODE_MAX_FAILS = 5;
const TEACHER_SESSION_TTL_MS = 30 * DAY_MS;        // 30 days
const TEACHER_EPHEMERAL_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours on shared computers
const STUDENT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;   // 24 hours on shared Chromebooks
const STUDENT_IP_LIMIT = 20;
const STUDENT_IP_WINDOW_MS = 15 * 60 * 1000;       // 20 tries / 15 min per IP
const STUDENT_COOLDOWN_FAILS = 5;
const STUDENT_COOLDOWN_MS = 15 * 60 * 1000;        // 15-min cooldown after 5 fails
const STUDENT_HARD_LOCK_FAILS = 10;                // Hard lock at 10 fails until regenerated
const HANDOFF_TTL_MS = 60 * 1000;                  // 60 seconds

// ---------- Shared teacher upsert (auto-starts 30-day no-card trial on first sign-in)
async function upsertTeacher(env, { email, googleSub = null, name = '' }) {
  const now = nowMs(env);
  let teacher = null;
  if (googleSub) {
    teacher = await env.DB.prepare('SELECT * FROM teachers WHERE google_sub = ?').bind(googleSub).first();
  }
  if (!teacher && email) {
    teacher = await env.DB.prepare('SELECT * FROM teachers WHERE email = ?').bind(email).first();
  }

  if (!teacher) {
    const id = makeId('tch');
    const displayName = cleanText(name || email.split('@')[0] || 'Teacher', 120);
    const trialEnds = now + TRIAL_DAYS * DAY_MS;
    await env.DB.prepare(
      `INSERT INTO teachers
        (id, email, google_sub, name, plan_status, trial_ends_at, student_soft_cap, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'trialing', ?, ?, ?, ?)`
    ).bind(id, email, googleSub, displayName, trialEnds, DEFAULT_STUDENT_SOFT_CAP, now, now).run();
    return await env.DB.prepare('SELECT * FROM teachers WHERE id = ?').bind(id).first();
  }

  // Link google_sub or refresh name if newly provided
  const updates = [];
  const binds = [];
  if (googleSub && !teacher.google_sub) {
    updates.push('google_sub = ?');
    binds.push(googleSub);
  }
  if (name && !teacher.name) {
    updates.push('name = ?');
    binds.push(cleanText(name, 120));
  }
  if (updates.length) {
    updates.push('updated_at = ?');
    binds.push(now, teacher.id);
    await env.DB.prepare(`UPDATE teachers SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run();
    teacher = await env.DB.prepare('SELECT * FROM teachers WHERE id = ?').bind(teacher.id).first();
  }
  return teacher;
}

async function createTeacherSession(env, teacherId, request, ephemeral = false) {
  const now = nowMs(env);
  const rawToken = `rt_${randomHex(32)}`;
  const tokenHash = await hashSessionToken(rawToken, env);
  const sessId = makeId('tsess');
  const ttl = ephemeral ? TEACHER_EPHEMERAL_TTL_MS : TEACHER_SESSION_TTL_MS;
  const ua = cleanText(request?.headers?.get('user-agent') || '', 200);
  await env.DB.prepare(
    `INSERT INTO teacher_sessions
      (id, teacher_id, token_hash, ephemeral, user_agent, expires_at, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(sessId, teacherId, tokenHash, ephemeral ? 1 : 0, ua, now + ttl, now, now).run();
  return { token: rawToken, sessionId: sessId, expiresAt: now + ttl, ephemeral: !!ephemeral };
}

async function createStudentSession(env, studentId, classId, authMethod) {
  const now = nowMs(env);
  const rawToken = `rs_${randomHex(32)}`;
  const tokenHash = await hashSessionToken(rawToken, env);
  const sessId = makeId('ssess');
  const expiresAt = now + STUDENT_SESSION_TTL_MS;
  await env.DB.prepare(
    `INSERT INTO student_sessions
      (id, student_id, class_id, token_hash, auth_method, expires_at, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(sessId, studentId, classId, tokenHash, authMethod, expiresAt, now, now).run();
  return { token: rawToken, sessionId: sessId, expiresAt };
}

// ---------- Session authentication guards
export async function requireTeacher(request, env) {
  const token = getBearerToken(request);
  if (!token) return { error: errResponse('Sign in required', 401, 'UNAUTHORIZED', request, env) };
  const tokenHash = await hashSessionToken(token, env);
  const now = nowMs(env);
  const row = await env.DB.prepare(
    `SELECT s.id AS session_id, s.ephemeral, s.expires_at, t.*
     FROM teacher_sessions s
     JOIN teachers t ON t.id = s.teacher_id
     WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`
  ).bind(tokenHash, now).first();
  if (!row) return { error: errResponse('Session expired — please sign in again.', 401, 'SESSION_INVALID', request, env) };

  // Lightweight last_seen refresh
  await env.DB.prepare('UPDATE teacher_sessions SET last_seen_at = ? WHERE id = ?').bind(now, row.session_id).run();
  return { teacher: row, sessionId: row.session_id, ephemeral: !!row.ephemeral };
}

export async function requireStudent(request, env) {
  const token = getBearerToken(request);
  if (!token) return { error: errResponse('Student sign in required', 401, 'UNAUTHORIZED', request, env) };
  const tokenHash = await hashSessionToken(token, env);
  const now = nowMs(env);
  const row = await env.DB.prepare(
    `SELECT ss.id AS session_id, ss.auth_method, ss.expires_at,
            st.id AS student_id, st.class_id, st.display_name, st.email, st.part, st.archived_at AS student_archived,
            c.name AS class_name, c.join_code, c.teacher_id, c.archived_at AS class_archived
     FROM student_sessions ss
     JOIN students st ON st.id = ss.student_id
     JOIN classes c ON c.id = ss.class_id
     WHERE ss.token_hash = ? AND ss.revoked_at IS NULL AND ss.expires_at > ?`
  ).bind(tokenHash, now).first();

  if (!row || row.student_archived || row.class_archived) {
    return { error: errResponse('Session expired — please sign in again.', 401, 'SESSION_INVALID', request, env) };
  }
  await env.DB.prepare('UPDATE student_sessions SET last_seen_at = ? WHERE id = ?').bind(now, row.session_id).run();
  return { student: row, sessionId: row.session_id };
}

// ---------- Teacher 6-digit Email-Code Auth (Resend or DEV_MODE)
async function sendTeacherCodeEmail(env, email, code) {
  if (isDevMode(env)) {
    console.log(`[DEV_MODE] Teacher login code for ${email}: ${code}`);
    return { ok: true, devCode: code };
  }
  const apiKey = String(env?.RESEND_API_KEY || '').trim();
  if (!apiKey) return { ok: false, error: 'Email delivery is not configured on this server.' };
  const from = String(env?.FROM_EMAIL || 'Rehearsal <noreply@rehearsalmusic.com>').trim();

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: `Your Rehearsal sign-in code: ${code}`,
      text: `Enter this 6-digit code in Rehearsal to sign in:\n\n${code}\n\nThis code expires in 10 minutes and can only be used once. If you did not request it, you can ignore this email.`,
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    return { ok: false, error: `Could not send email (${res.status}): ${txt.slice(0, 120)}` };
  }
  return { ok: true };
}

export async function handleTeacherEmailStart(request, env) {
  const body = await readJsonBody(request);
  if (!body.ok) return errResponse(body.error, body.status, 'BAD_REQUEST', request, env);
  const email = normalizeEmail(body.data.email);
  if (!email) return errResponse('Enter a valid email address.', 400, 'INVALID_EMAIL', request, env);

  const ipHash = await sha256Hex(getClientIp(request));
  const ipLimit = await checkRateLimit(env, `temail_ip:${ipHash}`, 10, 15 * 60 * 1000);
  if (!ipLimit.allowed) {
    return errResponse('Too many sign-in emails requested. Wait a few minutes and try again.', 429, 'RATE_LIMITED', request, env, { retryAfterSec: ipLimit.retryAfterSec });
  }
  const emailLimit = await checkRateLimit(env, `temail_addr:${email}`, 5, 15 * 60 * 1000);
  if (!emailLimit.allowed) {
    return errResponse('Too many codes sent to this address. Wait a few minutes and try again.', 429, 'RATE_LIMITED', request, env, { retryAfterSec: emailLimit.retryAfterSec });
  }

  const now = nowMs(env);
  const code = generateEmailDigits();
  const salt = randomHex(16);
  const codeHash = await hashEmailCode(code, salt);

  // Invalidate any prior unused codes for this email so only the newest works
  await env.DB.prepare(
    'UPDATE auth_codes SET used_at = ? WHERE email = ? AND used_at IS NULL'
  ).bind(now, email).run();

  await env.DB.prepare(
    `INSERT INTO auth_codes (id, email, code_hash, salt, failed_attempts, expires_at, created_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)`
  ).bind(makeId('ac'), email, codeHash, salt, now + EMAIL_CODE_TTL_MS, now).run();

  const sent = await sendTeacherCodeEmail(env, email, code);
  if (!sent.ok) return errResponse(sent.error, 502, 'EMAIL_FAILED', request, env);

  const resp = { ok: true, sent: true, expiresInSec: Math.round(EMAIL_CODE_TTL_MS / 1000) };
  if (sent.devCode) resp.devCode = sent.devCode;
  return jsonResponse(resp, 200, request, env);
}

export async function handleTeacherEmailVerify(request, env) {
  const body = await readJsonBody(request);
  if (!body.ok) return errResponse(body.error, body.status, 'BAD_REQUEST', request, env);
  const email = normalizeEmail(body.data.email);
  const code = String(body.data.code || '').replace(/\s+/g, '');
  const ephemeral = !!body.data.ephemeral;
  const name = cleanText(body.data.name || '', 120);
  if (!email || !/^\d{6}$/.test(code)) {
    return errResponse('Enter your email and the 6-digit code.', 400, 'INVALID_INPUT', request, env);
  }

  const ipHash = await sha256Hex(getClientIp(request));
  const ipLimit = await checkRateLimit(env, `tverify_ip:${ipHash}`, 20, 15 * 60 * 1000);
  if (!ipLimit.allowed) {
    return errResponse('Too many attempts. Wait a few minutes and try again.', 429, 'RATE_LIMITED', request, env, { retryAfterSec: ipLimit.retryAfterSec });
  }

  const now = nowMs(env);
  const row = await env.DB.prepare(
    `SELECT * FROM auth_codes
     WHERE email = ? AND used_at IS NULL
     ORDER BY created_at DESC LIMIT 1`
  ).bind(email).first();

  if (!row || row.expires_at <= now) {
    return errResponse('That code expired or was already used. Request a fresh code.', 401, 'CODE_EXPIRED', request, env);
  }
  if (row.failed_attempts >= EMAIL_CODE_MAX_FAILS) {
    return errResponse('Too many wrong tries on this code. Request a new code.', 423, 'CODE_LOCKED', request, env);
  }

  const candidateHash = await hashEmailCode(code, row.salt);
  if (!timingSafeEqual(candidateHash, row.code_hash)) {
    const nextFails = row.failed_attempts + 1;
    await env.DB.prepare('UPDATE auth_codes SET failed_attempts = ? WHERE id = ?').bind(nextFails, row.id).run();
    if (nextFails >= EMAIL_CODE_MAX_FAILS) {
      return errResponse('Too many wrong tries on this code. Request a new code.', 423, 'CODE_LOCKED', request, env);
    }
    return errResponse('Incorrect code. Check your email and try again.', 401, 'INVALID_CODE', request, env, {
      attemptsLeft: EMAIL_CODE_MAX_FAILS - nextFails,
    });
  }

  // Mark single-use atomically
  const upd = await env.DB.prepare(
    'UPDATE auth_codes SET used_at = ? WHERE id = ? AND used_at IS NULL'
  ).bind(now, row.id).run();
  if (upd?.meta?.changes === 0) {
    return errResponse('That code was already used. Request a fresh code.', 401, 'CODE_USED', request, env);
  }

  const teacher = await upsertTeacher(env, { email, name });
  const session = await createTeacherSession(env, teacher.id, request, ephemeral);
  const capabilities = getServerCapabilities(env);
  const plan = { ...computePlanState(teacher, now), billingEnabled: capabilities.billingEnabled };
  return jsonResponse({
    ok: true,
    capabilities,
    token: session.token,
    expiresAt: session.expiresAt,
    ephemeral: session.ephemeral,
    teacher: formatTeacherPublic(teacher, plan),
  }, 200, request, env);
}

// ---------- Teacher Google Sign-In
export async function handleTeacherGoogleAuth(request, env) {
  const body = await readJsonBody(request);
  if (!body.ok) return errResponse(body.error, body.status, 'BAD_REQUEST', request, env);
  const ephemeral = !!body.data.ephemeral;
  const verified = await verifyGoogleIdToken(body.data.idToken, env);
  if (!verified.ok) return errResponse(verified.error, 401, 'GOOGLE_AUTH_FAILED', request, env);

  const now = nowMs(env);
  const teacher = await upsertTeacher(env, {
    email: verified.email,
    googleSub: verified.sub,
    name: verified.name,
  });
  const session = await createTeacherSession(env, teacher.id, request, ephemeral);
  const capabilities = getServerCapabilities(env);
  const plan = { ...computePlanState(teacher, now), billingEnabled: capabilities.billingEnabled };
  return jsonResponse({
    ok: true,
    capabilities,
    token: session.token,
    expiresAt: session.expiresAt,
    ephemeral: session.ephemeral,
    teacher: formatTeacherPublic(teacher, plan),
  }, 200, request, env);
}

// ---------- Desktop System-Browser OAuth Handoff (60s TTL, wired in Milestone 5)
export async function handleOAuthHandoffStart(request, env) {
  const body = await readJsonBody(request);
  if (!body.ok) return errResponse(body.error, body.status, 'BAD_REQUEST', request, env);
  const now = nowMs(env);
  const state = randomHex(20);
  const pollSecret = randomHex(24);
  const pollSecretHash = await sha256Hex(pollSecret);
  const ephemeral = body.data.ephemeral ? 1 : 0;

  await env.DB.prepare(
    `INSERT INTO oauth_handoffs (state, poll_secret_hash, status, ephemeral, expires_at, created_at)
     VALUES (?, ?, 'pending', ?, ?, ?)`
  ).bind(state, pollSecretHash, ephemeral, now + HANDOFF_TTL_MS, now).run();

  return jsonResponse({
    ok: true,
    state,
    pollSecret,
    expiresInSec: Math.round(HANDOFF_TTL_MS / 1000),
  }, 200, request, env);
}

export async function handleOAuthHandoffComplete(request, env) {
  const body = await readJsonBody(request);
  if (!body.ok) return errResponse(body.error, body.status, 'BAD_REQUEST', request, env);
  const state = cleanText(body.data.state, 100);
  if (!state) return errResponse('Missing handoff state', 400, 'BAD_REQUEST', request, env);

  const now = nowMs(env);
  const row = await env.DB.prepare(
    "SELECT * FROM oauth_handoffs WHERE state = ? AND status = 'pending' AND expires_at > ?"
  ).bind(state, now).first();
  if (!row) return errResponse('Sign-in link expired. Start again in Rehearsal.', 410, 'HANDOFF_EXPIRED', request, env);

  const verified = await verifyGoogleIdToken(body.data.idToken, env);
  if (!verified.ok) return errResponse(verified.error, 401, 'GOOGLE_AUTH_FAILED', request, env);

  const teacher = await upsertTeacher(env, {
    email: verified.email,
    googleSub: verified.sub,
    name: verified.name,
  });
  const session = await createTeacherSession(env, teacher.id, request, !!row.ephemeral);

  await env.DB.prepare(
    "UPDATE oauth_handoffs SET status = 'complete', teacher_id = ?, session_token_plain = ? WHERE state = ?"
  ).bind(teacher.id, session.token, state).run();

  return jsonResponse({ ok: true, completed: true }, 200, request, env);
}

export async function handleOAuthHandoffPoll(request, env) {
  const body = await readJsonBody(request);
  if (!body.ok) return errResponse(body.error, body.status, 'BAD_REQUEST', request, env);
  const state = cleanText(body.data.state, 100);
  const pollSecret = cleanText(body.data.pollSecret, 128);
  if (!state || !pollSecret) return errResponse('Missing poll credentials', 400, 'BAD_REQUEST', request, env);

  const now = nowMs(env);
  const row = await env.DB.prepare('SELECT * FROM oauth_handoffs WHERE state = ?').bind(state).first();
  if (!row || row.expires_at <= now || row.status === 'claimed') {
    return errResponse('Sign-in handoff expired', 410, 'HANDOFF_EXPIRED', request, env);
  }
  const secretHash = await sha256Hex(pollSecret);
  if (!timingSafeEqual(secretHash, row.poll_secret_hash)) {
    return errResponse('Unauthorized poll', 401, 'UNAUTHORIZED', request, env);
  }
  if (row.status === 'pending') {
    return jsonResponse({ ok: true, status: 'pending' }, 200, request, env);
  }

  const token = row.session_token_plain;
  await env.DB.prepare(
    "UPDATE oauth_handoffs SET status = 'claimed', session_token_plain = NULL WHERE state = ?"
  ).bind(state).run();

  const teacher = await env.DB.prepare('SELECT * FROM teachers WHERE id = ?').bind(row.teacher_id).first();
  const plan = computePlanState(teacher, now);
  return jsonResponse({
    ok: true,
    status: 'complete',
    token,
    teacher: formatTeacherPublic(teacher, plan),
  }, 200, request, env);
}

// ---------- Teacher /me, Logout, Sign Out All Devices
export async function handleTeacherMe(request, env, auth) {
  const now = nowMs(env);
  const capabilities = getServerCapabilities(env);
  const plan = {
    ...computePlanState(auth.teacher, now),
    billingEnabled: capabilities.billingEnabled,
  };
  const countRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n
     FROM students st
     JOIN classes c ON c.id = st.class_id
     WHERE c.teacher_id = ? AND c.archived_at IS NULL AND st.archived_at IS NULL`
  ).bind(auth.teacher.id).first();
  const activeStudentCount = Number(countRow?.n || 0);
  return jsonResponse({
    ok: true,
    capabilities,
    teacher: formatTeacherPublic(auth.teacher, plan),
    activeStudentCount,
    overSoftCap: activeStudentCount > (plan.studentSoftCap || DEFAULT_STUDENT_SOFT_CAP),
    ephemeral: auth.ephemeral,
  }, 200, request, env);
}

export async function handleTeacherLogout(request, env, auth) {
  await env.DB.prepare('UPDATE teacher_sessions SET revoked_at = ? WHERE id = ?')
    .bind(nowMs(env), auth.sessionId).run();
  return jsonResponse({ ok: true }, 200, request, env);
}

export async function handleTeacherLogoutAll(request, env, auth) {
  await env.DB.prepare(
    'UPDATE teacher_sessions SET revoked_at = ? WHERE teacher_id = ? AND revoked_at IS NULL'
  ).bind(nowMs(env), auth.teacher.id).run();
  return jsonResponse({ ok: true, signedOutAllDevices: true }, 200, request, env);
}

export function formatTeacherPublic(teacher, plan) {
  return {
    id: teacher.id,
    email: teacher.email,
    name: teacher.name || '',
    hasGoogle: !!teacher.google_sub,
    plan,
    createdAt: teacher.created_at,
  };
}

// ---------- Student Personal Fallback Code Login (load-bearing Day 1)
// Accepts { joinCode, studentCode, name? } — NO public roster dropdown ever exposed.
export async function handleStudentCodeLogin(request, env) {
  const ipHash = await sha256Hex(getClientIp(request));
  const ipKey = `stucode_ip:${ipHash}`;
  // Check IP block without incrementing so valid classroom NAT logins never consume the IP failure budget.
  const ipLimit = await checkRateLimit(env, ipKey, STUDENT_IP_LIMIT, STUDENT_IP_WINDOW_MS, { increment: false });
  if (!ipLimit.allowed) {
    return errResponse(
      'Too many login attempts from this connection. Wait 15 minutes or ask your teacher.',
      429,
      'RATE_LIMITED',
      request,
      env,
      { retryAfterSec: ipLimit.retryAfterSec }
    );
  }
  const chargeIpFailure = () => checkRateLimit(env, ipKey, STUDENT_IP_LIMIT, STUDENT_IP_WINDOW_MS, { increment: true });

  const body = await readJsonBody(request);
  if (!body.ok) return errResponse(body.error, body.status, 'BAD_REQUEST', request, env);

  const joinCode = formatCode(body.data.joinCode);
  const studentCode = normalizeCode(body.data.studentCode);
  const studentName = cleanText(body.data.name || '', 120);
  if (!joinCode || studentCode.length < 4) {
    return errResponse('Enter your Class Code and your 6-character Student Code.', 400, 'INVALID_INPUT', request, env);
  }

  const now = nowMs(env);
  const cls = await env.DB.prepare(
    'SELECT * FROM classes WHERE join_code = ? AND archived_at IS NULL'
  ).bind(joinCode).first();
  if (!cls) {
    await chargeIpFailure();
    return errResponse('Class code or student code did not match. Check for typos or ask your teacher.', 401, 'INVALID_CODE', request, env);
  }

  // Secondary class+IP throttle prevents hammering a class without a student name
  const clsIpKey = `stucode_clsip:${cls.id}:${ipHash}`;
  const clsIpRow = await env.DB.prepare('SELECT blocked_until FROM rate_limits WHERE key = ?').bind(clsIpKey).first();
  if (clsIpRow && clsIpRow.blocked_until && clsIpRow.blocked_until > now) {
    await chargeIpFailure();
    return errResponse(
      'Too many wrong codes for this class. Wait 15 minutes or ask your teacher.',
      429,
      'CODE_COOLDOWN',
      request,
      env,
      { retryAfterSec: Math.ceil((clsIpRow.blocked_until - now) / 1000) }
    );
  }

  const lookup = await studentCodeLookupKey(cls.id, studentCode, env);
  let student = null;
  let matchedByNameOnly = false;

  // 1. O(1) lookup by keyed code index first
  student = await env.DB.prepare(
    'SELECT * FROM students WHERE class_id = ? AND code_lookup = ? AND archived_at IS NULL'
  ).bind(cls.id, lookup).first();

  // 2. If student provided their name (free-text, no dropdown) and code didn't match,
  //    resolve the student row so per-student 5-fail cooldown & 10-fail hard lock apply directly.
  if (!student && studentName) {
    const byName = await env.DB.prepare(
      'SELECT * FROM students WHERE class_id = ? AND LOWER(TRIM(display_name)) = LOWER(?) AND archived_at IS NULL LIMIT 2'
    ).bind(cls.id, studentName).all();
    const list = byName?.results || [];
    if (list.length === 1) {
      student = list[0];
      matchedByNameOnly = true;
    }
  } else if (student && studentName) {
    // If they gave a name AND code matched, confirm the name isn't wildly unrelated? No — a student
    // might type a nickname; the cryptographic code proves identity, so accept it.
  }

  if (!student) {
    await chargeIpFailure();
    await recordRateFailure(env, clsIpKey, STUDENT_IP_WINDOW_MS, STUDENT_COOLDOWN_FAILS, STUDENT_COOLDOWN_MS, STUDENT_HARD_LOCK_FAILS, 60 * 60 * 1000);
    return errResponse('Class code or student code did not match. Check for typos or ask your teacher.', 401, 'INVALID_CODE', request, env);
  }

  // Enforce per-student hard lock (10 fails) and cooldown (5 fails = 15 min) BEFORE accepting code
  if (student.code_hard_locked) {
    await chargeIpFailure();
    return errResponse(
      'Your login code is locked after too many wrong tries. Ask your teacher to print you a new code.',
      423,
      'CODE_HARD_LOCKED',
      request,
      env
    );
  }
  if (student.code_cooldown_until && student.code_cooldown_until > now) {
    await chargeIpFailure();
    return errResponse(
      'Too many wrong tries. Wait 15 minutes or ask your teacher for a new code.',
      429,
      'CODE_COOLDOWN',
      request,
      env,
      { retryAfterSec: Math.ceil((student.code_cooldown_until - now) / 1000) }
    );
  }

  const pbkdfValid = !matchedByNameOnly && await verifyStudentCode(studentCode, student.code_salt, student.code_hash);
  if (!pbkdfValid) {
    await chargeIpFailure();
    const nextFails = Number(student.failed_code_attempts || 0) + 1;
    const hardLocked = nextFails >= STUDENT_HARD_LOCK_FAILS ? 1 : 0;
    const cooldownUntil = (!hardLocked && nextFails >= STUDENT_COOLDOWN_FAILS)
      ? now + STUDENT_COOLDOWN_MS
      : null;

    await env.DB.prepare(
      `UPDATE students
       SET failed_code_attempts = ?, code_cooldown_until = ?, code_hard_locked = ?, updated_at = ?
       WHERE id = ?`
    ).bind(nextFails, cooldownUntil, hardLocked, now, student.id).run();

    if (hardLocked) {
      return errResponse(
        'Your login code is locked after 10 wrong tries. Ask your teacher for a new code.',
        423,
        'CODE_HARD_LOCKED',
        request,
        env
      );
    }
    if (cooldownUntil) {
      return errResponse(
        'Too many wrong tries. Wait 15 minutes or ask your teacher for a new code.',
        429,
        'CODE_COOLDOWN',
        request,
        env,
        { retryAfterSec: Math.round(STUDENT_COOLDOWN_MS / 1000) }
      );
    }
    return errResponse('Class code or student code did not match. Check for typos or ask your teacher.', 401, 'INVALID_CODE', request, env);
  }

  // Success: reset failure counters & issue session
  await env.DB.prepare(
    'UPDATE students SET failed_code_attempts = 0, code_cooldown_until = NULL, updated_at = ? WHERE id = ?'
  ).bind(now, student.id).run();
  await clearRateLimit(env, clsIpKey);

  const session = await createStudentSession(env, student.id, cls.id, 'code');
  return jsonResponse({
    ok: true,
    token: session.token,
    expiresAt: session.expiresAt,
    authMethod: 'code',
    student: {
      id: student.id,
      displayName: student.display_name,
      part: student.part || '',
    },
    class: {
      id: cls.id,
      name: cls.name,
      joinCode: cls.join_code,
    },
  }, 200, request, env);
}

// ---------- Student Google Sign-In (immutable google_sub + Class Join Code + Lock Class)
export async function handleStudentGoogleLogin(request, env) {
  const body = await readJsonBody(request);
  if (!body.ok) return errResponse(body.error, body.status, 'BAD_REQUEST', request, env);

  const verified = await verifyGoogleIdToken(body.data.idToken, env);
  if (!verified.ok) return errResponse(verified.error, 401, 'GOOGLE_AUTH_FAILED', request, env);

  const now = nowMs(env);
  const rawJoin = body.data.joinCode ? formatCode(body.data.joinCode) : '';
  const requestedClassId = cleanText(body.data.classId || '', 64);

  // Path A: Joining / signing into a specific class via Join Code
  if (rawJoin) {
    const cls = await env.DB.prepare(
      'SELECT * FROM classes WHERE join_code = ? AND archived_at IS NULL'
    ).bind(rawJoin).first();
    if (!cls) return errResponse('Class code not found. Double-check with your teacher.', 404, 'CLASS_NOT_FOUND', request, env);

    // 1. Existing student bound by immutable google_sub
    let student = await env.DB.prepare(
      'SELECT * FROM students WHERE class_id = ? AND google_sub = ? AND archived_at IS NULL'
    ).bind(cls.id, verified.sub).first();

    // 2. Roster-imported student matching verified email (bind google_sub once)
    if (!student && verified.email) {
      const byEmail = await env.DB.prepare(
        'SELECT * FROM students WHERE class_id = ? AND LOWER(email) = ? AND google_sub IS NULL AND archived_at IS NULL'
      ).bind(cls.id, verified.email).first();
      if (byEmail) {
        await env.DB.prepare(
          'UPDATE students SET google_sub = ?, updated_at = ? WHERE id = ?'
        ).bind(verified.sub, now, byEmail.id).run();
        student = { ...byEmail, google_sub: verified.sub };
      }
    }

    // 3. Auto-enroll if class is unlocked
    if (!student) {
      if (cls.locked) {
        return errResponse(
          'This class is locked to new sign-ups. Ask your teacher to unlock it or add you.',
          403,
          'CLASS_LOCKED',
          request,
          env
        );
      }
      // Check teacher plan allows new enrollments
      const teacher = await env.DB.prepare('SELECT * FROM teachers WHERE id = ?').bind(cls.teacher_id).first();
      const plan = computePlanState(teacher, now);
      if (!plan.canWrite) {
        return errResponse('This class is not accepting new enrollments right now.', 402, 'CLASS_READ_ONLY', request, env);
      }
      const id = makeId('stu');
      const displayName = cleanText(verified.name || verified.email.split('@')[0] || 'Student', 120);
      await env.DB.prepare(
        `INSERT INTO students (id, class_id, display_name, email, google_sub, part, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, '', ?, ?)`
      ).bind(id, cls.id, displayName, verified.email, verified.sub, now, now).run();
      student = await env.DB.prepare('SELECT * FROM students WHERE id = ?').bind(id).first();
    }

    const session = await createStudentSession(env, student.id, cls.id, 'google');
    return jsonResponse({
      ok: true,
      token: session.token,
      expiresAt: session.expiresAt,
      authMethod: 'google',
      student: { id: student.id, displayName: student.display_name, part: student.part || '' },
      class: { id: cls.id, name: cls.name, joinCode: cls.join_code },
    }, 200, request, env);
  }

  // Path B: Returning Google student without a join code
  const memberships = await env.DB.prepare(
    `SELECT st.id AS student_id, st.display_name, st.part, c.id AS class_id, c.name AS class_name, c.join_code
     FROM students st
     JOIN classes c ON c.id = st.class_id
     WHERE st.google_sub = ? AND st.archived_at IS NULL AND c.archived_at IS NULL
     ORDER BY c.name ASC`
  ).bind(verified.sub).all();
  const rows = memberships?.results || [];
  if (!rows.length) {
    return errResponse('Enter your Class Join Code to join your class first.', 404, 'JOIN_CODE_REQUIRED', request, env);
  }

  const chosen = requestedClassId ? rows.find(r => r.class_id === requestedClassId) : (rows.length === 1 ? rows[0] : null);
  if (!chosen) {
    return jsonResponse({
      ok: true,
      selectClass: true,
      classes: rows.map(r => ({ classId: r.class_id, name: r.class_name, joinCode: r.join_code })),
    }, 200, request, env);
  }

  const session = await createStudentSession(env, chosen.student_id, chosen.class_id, 'google');
  return jsonResponse({
    ok: true,
    token: session.token,
    expiresAt: session.expiresAt,
    authMethod: 'google',
    student: { id: chosen.student_id, displayName: chosen.display_name, part: chosen.part || '' },
    class: { id: chosen.class_id, name: chosen.class_name, joinCode: chosen.join_code },
  }, 200, request, env);
}

export async function handleStudentMe(request, env, auth) {
  const teacher = await env.DB.prepare('SELECT id, name, plan_status, trial_ends_at, plan_ends_at, grace_ends_at FROM teachers WHERE id = ?')
    .bind(auth.student.teacher_id).first();
  const plan = computePlanState(teacher, nowMs(env));
  return jsonResponse({
    ok: true,
    student: {
      id: auth.student.student_id,
      displayName: auth.student.display_name,
      part: auth.student.part || '',
      authMethod: auth.student.auth_method,
    },
    class: {
      id: auth.student.class_id,
      name: auth.student.class_name,
      joinCode: auth.student.join_code,
      teacherName: teacher?.name || '',
      acceptingSubmissions: plan.canWrite,
    },
  }, 200, request, env);
}

export async function handleStudentLogout(request, env, auth) {
  await env.DB.prepare('UPDATE student_sessions SET revoked_at = ? WHERE id = ?')
    .bind(nowMs(env), auth.sessionId).run();
  return jsonResponse({ ok: true }, 200, request, env);
}
