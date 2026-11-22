#!/usr/bin/env node
// Live HTTP integration test suite for tools/hw-worker (Rehearsal Online Homework Backend).
// Requires Node.js 18+ (built-in fetch, FormData, Blob, WebCrypto). Zero npm dependencies.
//
// Usage:
//   1. Start local worker:
//        cd tools/hw-worker
//        npx wrangler d1 execute rehearsal-hw --local --file=./schema.sql
//        npx wrangler dev --env dev --local
//   2. Run suite:
//        HW_API_URL=http://127.0.0.1:8787 \
//        STRIPE_WEBHOOK_SECRET=whsec_test_secret \
//        ADMIN_SECRET=test_admin_secret \
//        node tests/hw-api-test.mjs

const BASE_URL = (process.env.HW_API_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_secret';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'test_admin_secret';

let passed = 0;
let skipped = 0;

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  passed++;
}

function assertEq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`ASSERTION FAILED: ${msg} (expected ${e}, got ${a})`);
  passed++;
}

async function req(method, path, { token = null, json = undefined, body = undefined, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h['Authorization'] = `Bearer ${token}`;
  let payload = body;
  if (json !== undefined) {
    h['Content-Type'] = 'application/json';
    payload = JSON.stringify(json);
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: h,
    body: payload,
    redirect: 'manual',
  });
  const ct = res.headers.get('content-type') || '';
  let data = null;
  if (ct.includes('application/json')) {
    data = await res.json().catch(() => null);
  }
  return { res, status: res.status, headers: res.headers, data };
}

async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function postStripeEvent(eventObj, secret = STRIPE_WEBHOOK_SECRET) {
  const rawBody = JSON.stringify(eventObj);
  const ts = Math.floor(Date.now() / 1000);
  const sig = await hmacSha256Hex(secret, `${ts}.${rawBody}`);
  return req('POST', '/api/billing/webhook', {
    body: rawBody,
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': `t=${ts},v1=${sig}`,
    },
  });
}

async function main() {
  const runId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  console.log(`Running hw-api-test against ${BASE_URL} (runId=${runId})`);

  // ==========================================================================
  // 1. Health check & /privacy redirect
  // ==========================================================================
  {
    const h = await req('GET', '/api/health');
    assertEq(h.status, 200, 'GET /api/health 200');
    assertEq(h.data?.ok, true, 'health ok=true');
    assertEq(h.data?.service, 'rehearsal-hw', 'health service');
    assertEq(h.data?.devMode, true, 'Worker must be running with DEV_MODE=true (--env dev)');

    const p = await req('GET', '/privacy');
    assertEq(p.status, 302, 'GET /privacy returns 302');
    assert(!!p.headers.get('location'), 'GET /privacy sets Location header');
  }

  // ==========================================================================
  // 2. Teacher Email-Code Auth (5-fail lockout + single-use + logout)
  // ==========================================================================
  const emailTeacherAddr = `email-teacher-${runId}@school.edu`;
  {
    const start1 = await req('POST', '/api/auth/teacher/email/start', {
      json: { email: emailTeacherAddr },
      headers: { 'X-Forwarded-For': `10.1.0.1` },
    });
    assertEq(start1.status, 200, 'email/start 200');
    assert(/^\d{6}$/.test(start1.data?.devCode || ''), 'email/start returns 6-digit devCode in DEV_MODE');
    const wrongCode = start1.data.devCode === '000000' ? '111111' : '000000';

    // 4 wrong attempts -> 401, 5th wrong attempt -> 423 CODE_LOCKED
    for (let i = 1; i <= 4; i++) {
      const bad = await req('POST', '/api/auth/teacher/email/verify', {
        json: { email: emailTeacherAddr, code: wrongCode },
        headers: { 'X-Forwarded-For': `10.1.0.1` },
      });
      assertEq(bad.status, 401, `email/verify wrong attempt ${i} -> 401`);
    }
    const locked = await req('POST', '/api/auth/teacher/email/verify', {
      json: { email: emailTeacherAddr, code: wrongCode },
      headers: { 'X-Forwarded-For': `10.1.0.1` },
    });
    assertEq(locked.status, 423, 'email/verify 5th wrong attempt -> 423 CODE_LOCKED');
    assertEq(locked.data?.code, 'CODE_LOCKED', 'email/verify error code CODE_LOCKED');

    // Fresh code succeeds
    const start2 = await req('POST', '/api/auth/teacher/email/start', {
      json: { email: emailTeacherAddr },
      headers: { 'X-Forwarded-For': `10.1.0.1` },
    });
    assertEq(start2.status, 200, 'second email/start 200');
    const goodCode = start2.data.devCode;

    const okVerify = await req('POST', '/api/auth/teacher/email/verify', {
      json: { email: emailTeacherAddr, code: goodCode, name: 'Mr. Email' },
      headers: { 'X-Forwarded-For': `10.1.0.1` },
    });
    assertEq(okVerify.status, 200, 'email/verify valid code -> 200');
    assert(!!okVerify.data?.token, 'email/verify issues token');
    assertEq(okVerify.data?.teacher?.plan?.status, 'trialing', 'new teacher starts 30-day trial');

    // Single-use enforcement
    const reuse = await req('POST', '/api/auth/teacher/email/verify', {
      json: { email: emailTeacherAddr, code: goodCode },
      headers: { 'X-Forwarded-For': `10.1.0.1` },
    });
    assertEq(reuse.status, 401, 'reusing single-use email code rejected with 401');

    // /me and logout
    const me = await req('GET', '/api/auth/teacher/me', { token: okVerify.data.token });
    assertEq(me.status, 200, 'teacher/me 200');
    const out = await req('POST', '/api/auth/teacher/logout', { token: okVerify.data.token });
    assertEq(out.status, 200, 'teacher/logout 200');
    const meAfter = await req('GET', '/api/auth/teacher/me', { token: okVerify.data.token });
    assertEq(meAfter.status, 401, 'revoked teacher token returns 401');
  }

  // ==========================================================================
  // 3. Teacher Google Dev-Token Login
  // ==========================================================================
  const teacherEmail = `director-${runId}@lincolnhigh.edu`;
  const teacherGoogleRes = await req('POST', '/api/auth/teacher/google', {
    json: { idToken: `dev-google:sub_tch_${runId}|${teacherEmail}|Ms. Rivera` },
  });
  assertEq(teacherGoogleRes.status, 200, 'teacher Google dev-token login 200');
  const teacherToken = teacherGoogleRes.data.token;
  const teacherId = teacherGoogleRes.data.teacher.id;
  assert(!!teacherToken && !!teacherId, 'teacher token & id present');

  // ==========================================================================
  // 4. Classes + Lock Class + Google Student Auto-Enroll + Archive
  // ==========================================================================
  const clsCreate = await req('POST', '/api/classes', {
    token: teacherToken,
    json: { name: `Concert Band ${runId}` },
  });
  assertEq(clsCreate.status, 201, 'POST /api/classes 201');
  const classId = clsCreate.data.class.id;
  const joinCode = clsCreate.data.class.joinCode;
  assert(/^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/.test(joinCode), 'class joinCode valid readable format');

  // Lock class -> Google auto-enroll blocked with 403 CLASS_LOCKED
  const lockRes = await req('PATCH', `/api/classes/${classId}`, {
    token: teacherToken,
    json: { locked: true },
  });
  assertEq(lockRes.status, 200, 'PATCH lock class 200');

  const lockedJoin = await req('POST', '/api/auth/student/google', {
    json: {
      idToken: `dev-google:sub_stu_g_${runId}|gstudent-${runId}@school.edu|Jordan Lee`,
      joinCode,
    },
  });
  assertEq(lockedJoin.status, 403, 'locked class blocks new Google enrollment (403)');
  assertEq(lockedJoin.data?.code, 'CLASS_LOCKED', 'locked class code CLASS_LOCKED');

  // Unlock class -> Google auto-enroll succeeds
  const unlockRes = await req('PATCH', `/api/classes/${classId}`, {
    token: teacherToken,
    json: { locked: false },
  });
  assertEq(unlockRes.status, 200, 'PATCH unlock class 200');

  const unlockedJoin = await req('POST', '/api/auth/student/google', {
    json: {
      idToken: `dev-google:sub_stu_g_${runId}|gstudent-${runId}@school.edu|Jordan Lee`,
      joinCode,
    },
  });
  assertEq(unlockedJoin.status, 200, 'unlocked class allows Google enrollment (200)');
  assert(!!unlockedJoin.data?.token, 'Google student receives session token');

  // Temporary class archive check
  {
    const tmpCls = await req('POST', '/api/classes', { token: teacherToken, json: { name: 'Archive Test' } });
    assertEq(tmpCls.status, 201, 'create temp class for archive test');
    const tmpId = tmpCls.data.class.id;
    const arch = await req('PATCH', `/api/classes/${tmpId}`, { token: teacherToken, json: { archived: true } });
    assertEq(arch.status, 200, 'archive class 200');
    const listDefault = await req('GET', '/api/classes', { token: teacherToken });
    assert(!listDefault.data.classes.some(c => c.id === tmpId), 'archived class hidden by default');
    const listAll = await req('GET', '/api/classes?includeArchived=1', { token: teacherToken });
    assert(listAll.data.classes.some(c => c.id === tmpId), 'archived class shown with includeArchived=1');
    const delTmp = await req('DELETE', `/api/classes/${tmpId}`, { token: teacherToken });
    assertEq(delTmp.status, 200, 'delete temp archived class 200');
  }

  // ==========================================================================
  // 5. Student 6-Char Code Login + 5-Fail Cooldown + Teacher Regenerate
  // ==========================================================================
  const addStudentsRes = await req('POST', `/api/classes/${classId}/students`, {
    token: teacherToken,
    json: {
      students: [
        { displayName: 'Alex Rivera', part: 'Clarinet' },
        { displayName: 'Sam Chen', part: 'Trumpet' },
      ],
    },
  });
  assertEq(addStudentsRes.status, 201, 'POST add students 201');
  assertEq(addStudentsRes.data.generatedCodes.length, 2, 'returns 2 generatedCodes once');

  const alex = addStudentsRes.data.generatedCodes.find(s => s.displayName === 'Alex Rivera');
  const sam = addStudentsRes.data.generatedCodes.find(s => s.displayName === 'Sam Chen');
  assert(!!alex?.code && !!sam?.code, 'both students have 6-char codes');

  // Verify GET /students NEVER leaks code_hash / code_salt / code_lookup
  const listStu = await req('GET', `/api/classes/${classId}/students`, { token: teacherToken });
  assertEq(listStu.status, 200, 'GET /students 200');
  for (const st of listStu.data.students) {
    assert(st.code_hash === undefined && st.codeHash === undefined, 'never leaks code_hash');
    assert(st.code_salt === undefined && st.codeSalt === undefined, 'never leaks code_salt');
    assert(st.code_lookup === undefined && st.codeLookup === undefined, 'never leaks code_lookup');
  }

  // Alex valid code login
  const alexLogin = await req('POST', '/api/auth/student/code', {
    json: { joinCode, studentCode: alex.code },
    headers: { 'X-Forwarded-For': `10.2.0.1` },
  });
  assertEq(alexLogin.status, 200, 'Alex valid 6-char code login 200');
  const alexToken = alexLogin.data.token;

  // Sam: 4 wrong tries (401) + 5th wrong try -> 429 CODE_COOLDOWN
  const badStuCode = sam.code === 'AAA-222' ? 'BBB-333' : 'AAA-222';
  for (let i = 1; i <= 4; i++) {
    const f = await req('POST', '/api/auth/student/code', {
      json: { joinCode, studentCode: badStuCode, name: 'Sam Chen' },
      headers: { 'X-Forwarded-For': `10.2.0.2` },
    });
    assertEq(f.status, 401, `Sam wrong code attempt ${i} -> 401`);
  }
  const cooldownHit = await req('POST', '/api/auth/student/code', {
    json: { joinCode, studentCode: badStuCode, name: 'Sam Chen' },
    headers: { 'X-Forwarded-For': `10.2.0.2` },
  });
  assertEq(cooldownHit.status, 429, 'Sam 5th wrong code triggers 429 CODE_COOLDOWN');
  assertEq(cooldownHit.data?.code, 'CODE_COOLDOWN', 'error code is CODE_COOLDOWN');

  // Teacher regenerates Sam's code -> clears cooldown/lock and invalidates old code
  const regen = await req('POST', `/api/classes/${classId}/students/${sam.studentId}/regenerate-code`, {
    token: teacherToken,
    json: {},
  });
  assertEq(regen.status, 200, 'regenerate-code 200');
  const samNewCode = regen.data.code;
  assert(!!samNewCode && samNewCode !== sam.code, 'regenerated code is fresh');

  const samOldTry = await req('POST', '/api/auth/student/code', {
    json: { joinCode, studentCode: sam.code },
    headers: { 'X-Forwarded-For': `10.2.0.3` },
  });
  assertEq(samOldTry.status, 401, 'old regenerated student code rejected');

  const samNewLogin = await req('POST', '/api/auth/student/code', {
    json: { joinCode, studentCode: samNewCode },
    headers: { 'X-Forwarded-For': `10.2.0.3` },
  });
  assertEq(samNewLogin.status, 200, 'new regenerated student code succeeds immediately');

  // ==========================================================================
  // 6. True Sight-Read Excerpt Hiding, /start, Score Tampering, Audio + Range 206, Attempt Limit 409
  // ==========================================================================
  const tsrCreate = await req('POST', `/api/classes/${classId}/assignments`, {
    token: teacherToken,
    json: {
      title: 'True Sight-Read Exam 1',
      instructions: 'You have 15 seconds to study before recording.',
      type: 'sight',
      mode: 'true_sight_read',
      maxAttempts: 1,
      gradePolicy: 'best',
      config: {
        studySeconds: 15,
        expectedSec: 12,
        strictness: { rhythm: 60, pitch: 55 },
        ex: { notes: [{ midi: 60, beats: 1 }, { midi: 62, beats: 1 }] },
        srState: {
          mode: 'melodic',
          tempo: 90,
          ex: { notes: [{ midi: 64, beats: 1 }] },
          build: { kind: 'melodic', notes: [{ midi: 65, beats: 1 }] },
        },
      },
    },
  });
  assertEq(tsrCreate.status, 201, 'create True Sight-Read assignment 201');
  const tsrId = tsrCreate.data.assignment.id;

  // Before /start: excerpt MUST be stripped
  const beforeStart = await req('GET', `/api/student/assignments/${tsrId}`, { token: alexToken });
  assertEq(beforeStart.status, 200, 'student GET TSR before start 200');
  assertEq(beforeStart.data.excerptLocked, true, 'excerptLocked=true before /start');
  assertEq(beforeStart.data.assignment.config.ex, undefined, 'top-level ex stripped before /start');
  assertEq(beforeStart.data.assignment.config.srState?.ex, undefined, 'srState.ex stripped before /start');
  assertEq(beforeStart.data.assignment.config.srState?.build?.notes, undefined, 'srState.build.notes stripped before /start');

  // Call /start -> reveals full excerpt + returns attemptStart
  const startRes = await req('POST', `/api/student/assignments/${tsrId}/start`, {
    token: alexToken,
    json: { expectedSec: 12 },
  });
  assertEq(startRes.status, 200, 'POST /start 200');
  const attemptStartId = startRes.data.attemptStart?.id;
  assert(!!attemptStartId, 'attemptStart.id returned');
  assert(Array.isArray(startRes.data.config?.ex?.notes), '/start reveals full excerpt config.ex.notes');

  // Submit with tampered claimedOverallPct=100 while notes recompute to 50%, plus 512 bytes audio
  const fakeAudioBytes = new Uint8Array(512);
  for (let i = 0; i < fakeAudioBytes.length; i++) fakeAudioBytes[i] = (i * 17) & 0xff;
  const form = new FormData();
  form.set(
    'payload',
    JSON.stringify({
      attemptStartId,
      claimedOverallPct: 100,
      durationSec: 12,
      expectedSec: 12,
      results: {
        inputMode: 'mic',
        rmsPeak: 0.08,
        notes: [
          { bar: 1, idx: 0, status: 'ok' },
          { bar: 1, idx: 1, status: 'ok' },
          { bar: 2, idx: 2, status: 'wrong' },
          { bar: 2, idx: 3, status: 'missed' },
        ],
      },
    })
  );
  form.set('audio', new Blob([fakeAudioBytes], { type: 'audio/webm' }), 'attempt1.webm');

  const subRes = await req('POST', `/api/student/assignments/${tsrId}/submissions`, {
    token: alexToken,
    body: form,
  });
  assertEq(subRes.status, 201, 'POST submission with audio 201');
  const submissionId = subRes.data.submission.id;
  assertEq(subRes.data.submission.overallPct, 50, 'server recomputed score is 50% (not claimed 100%)');
  assertEq(subRes.data.submission.audioSaved, true, 'audioSaved=true');
  assert(
    subRes.data.submission.integrityFlags === undefined && subRes.data.integrityFlags === undefined,
    'student submission response NEVER leaks integrityFlags'
  );

  // Attempt limit enforcement (maxAttempts: 1 -> 2nd /start and /submissions return 409)
  const startAgain = await req('POST', `/api/student/assignments/${tsrId}/start`, {
    token: alexToken,
    json: {},
  });
  assertEq(startAgain.status, 409, '2nd /start past maxAttempts -> 409');
  assertEq(startAgain.data?.code, 'ATTEMPT_LIMIT_REACHED', 'ATTEMPT_LIMIT_REACHED code');

  // Teacher sees integrityFlags including score_mismatch
  const teacherSubs = await req('GET', `/api/assignments/${tsrId}/submissions`, { token: teacherToken });
  assertEq(teacherSubs.status, 200, 'teacher GET assignment submissions 200');
  const alexSub = teacherSubs.data.submissions.find(s => s.id === submissionId);
  assert(!!alexSub, 'teacher sees Alex submission');
  assertEq(alexSub.overallPct, 50, 'stored overallPct is 50');
  assert(alexSub.integrityFlags.includes('score_mismatch'), 'teacher sees score_mismatch integrity flag');
  assertEq(alexSub.audioAvailable, true, 'audioAvailable=true');

  // ==========================================================================
  // 7. Score Upload (.mxl accepted, .mscz rejected 415) & Student Download
  // ==========================================================================
  const scoreAsgnCreate = await req('POST', `/api/classes/${classId}/assignments`, {
    token: teacherToken,
    json: { title: 'Concert Piece Excerpt', type: 'score', mode: 'practice' },
  });
  assertEq(scoreAsgnCreate.status, 201, 'create score assignment 201');
  const scoreAsgnId = scoreAsgnCreate.data.assignment.id;

  const msczUpload = await req('PUT', `/api/assignments/${scoreAsgnId}/score`, {
    token: teacherToken,
    body: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]),
    headers: { 'X-Filename': 'march.mscz', 'Content-Type': 'application/octet-stream' },
  });
  assertEq(msczUpload.status, 415, '.mscz upload rejected with 415');
  assertEq(msczUpload.data?.code, 'UNSUPPORTED_SCORE_FORMAT', 'UNSUPPORTED_SCORE_FORMAT code');

  const mxlBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]);
  const mxlUpload = await req('PUT', `/api/assignments/${scoreAsgnId}/score`, {
    token: teacherToken,
    body: mxlBytes,
    headers: { 'X-Filename': 'march.mxl', 'Content-Type': 'application/vnd.recordare.musicxml' },
  });
  assertEq(mxlUpload.status, 200, '.mxl upload accepted with 200');

  const mxlDl = await req('GET', `/api/assignments/${scoreAsgnId}/score`, { token: alexToken });
  assertEq(mxlDl.status, 200, 'student downloads .mxl score 200');
  const dlBytes = new Uint8Array(await mxlDl.res.arrayBuffer());
  assertEq(dlBytes.length, mxlBytes.length, 'downloaded .mxl byte length matches');

  // ==========================================================================
  // 8. Audio Streaming HTTP Range 206 + Early Audio Delete (410, Grade Kept)
  // ==========================================================================
  const rangeRes = await req('GET', `/api/submissions/${submissionId}/audio`, {
    token: teacherToken,
    headers: { Range: 'bytes=0-63' },
  });
  assertEq(rangeRes.status, 206, 'audio Range request returns 206 Partial Content');
  assertEq(rangeRes.headers.get('accept-ranges'), 'bytes', 'Accept-Ranges: bytes');
  assert((rangeRes.headers.get('content-range') || '').startsWith('bytes 0-63/512'), 'Content-Range matches bytes 0-63/512');
  const rangeBuf = new Uint8Array(await rangeRes.res.arrayBuffer());
  assertEq(rangeBuf.length, 64, '206 body has exact 64 bytes');

  const delAudio = await req('DELETE', `/api/submissions/${submissionId}/audio`, { token: teacherToken });
  assertEq(delAudio.status, 200, 'DELETE submission audio 200');

  const audioAfterDel = await req('GET', `/api/submissions/${submissionId}/audio`, { token: teacherToken });
  assertEq(audioAfterDel.status, 410, 'deleted audio returns 410 AUDIO_EXPIRED');

  // ==========================================================================
  // 9. Gradebook + Override + CSV + FERPA Student Data JSON Export
  // ==========================================================================
  const gradePatch = await req('PATCH', `/api/submissions/${submissionId}`, {
    token: teacherToken,
    json: { teacherOverridePct: 88, teacherComment: 'Solid rhythm, keep steady tempo!' },
  });
  assertEq(gradePatch.status, 200, 'PATCH teacher override 200');

  const gb = await req('GET', `/api/classes/${classId}/gradebook`, { token: teacherToken });
  assertEq(gb.status, 200, 'GET gradebook 200');
  const alexRow = gb.data.students.find(s => s.studentId === alex.studentId || s.id === alex.studentId);
  assert(!!alexRow, 'Alex present in gradebook');

  const csvRes = await req('GET', `/api/classes/${classId}/gradebook.csv`, { token: teacherToken });
  assertEq(csvRes.status, 200, 'GET gradebook.csv 200');
  const csvText = await csvRes.res.text();
  assert(csvText.includes('Alex Rivera') && csvText.includes('88'), 'CSV contains student name and overridden grade 88');

  const ferpaRes = await req('GET', `/api/classes/${classId}/students/${alex.studentId}/export`, { token: teacherToken });
  assertEq(ferpaRes.status, 200, 'GET student FERPA JSON export 200');
  assertEq(ferpaRes.data.student.displayName, 'Alex Rivera', 'FERPA export student name');
  assert(ferpaRes.data.student.code_hash === undefined, 'FERPA export excludes code_hash');
  assertEq(ferpaRes.data.submissions.length, 1, 'FERPA export includes submission');
  assertEq(ferpaRes.data.submissions[0].overallPct, 50, 'grade kept after audio deletion');
  assertEq(ferpaRes.data.submissions[0].teacherOverridePct, 88, 'FERPA export includes teacher override');

  // ==========================================================================
  // 10. Stripe Webhooks (past_due grace & canceled read-only 402) + PO Grant
  // ==========================================================================
  const whCheckout = await postStripeEvent({
    type: 'checkout.session.completed',
    data: { object: { client_reference_id: teacherId, customer: `cus_${runId}`, subscription: `sub_${runId}` } },
  });
  if (whCheckout.status === 503 && whCheckout.data?.code === 'WEBHOOK_UNCONFIGURED') {
    console.log('NOTE: Skipping Stripe webhook assertions (STRIPE_WEBHOOK_SECRET not set in wrangler .dev.vars)');
    skipped++;
  } else {
    assertEq(whCheckout.status, 200, 'Stripe checkout.session.completed 200');

    // past_due -> 7-day grace window (still writable!)
    const whPastDue = await postStripeEvent({
      type: 'invoice.payment_failed',
      data: { object: { customer: `cus_${runId}` } },
    });
    assertEq(whPastDue.status, 200, 'Stripe invoice.payment_failed 200');
    const meGrace = await req('GET', '/api/auth/teacher/me', { token: teacherToken });
    assertEq(meGrace.data.teacher.plan.status, 'past_due', 'teacher plan is past_due');
    assertEq(meGrace.data.teacher.plan.inGrace, true, 'teacher is in 7-day grace');
    assertEq(meGrace.data.teacher.plan.canWrite, true, 'teacher can still write during grace');

    // canceled -> Read-Only Mode (blocks writes with 402, allows reads/exports/deletes)
    const whCancel = await postStripeEvent({
      type: 'customer.subscription.deleted',
      data: { object: { customer: `cus_${runId}` } },
    });
    assertEq(whCancel.status, 200, 'Stripe customer.subscription.deleted 200');

    const roCreateCls = await req('POST', '/api/classes', { token: teacherToken, json: { name: 'Blocked Class' } });
    assertEq(roCreateCls.status, 402, 'canceled plan blocks POST /api/classes with 402');

    const roCreateAsgn = await req('POST', `/api/classes/${classId}/assignments`, {
      token: teacherToken,
      json: { title: 'Blocked Asgn', type: 'audio' },
    });
    assertEq(roCreateAsgn.status, 402, 'canceled plan blocks POST assignment with 402');

    const roSub = await req('POST', `/api/student/assignments/${scoreAsgnId}/submissions`, {
      token: alexToken,
      json: { results: { notes: [{ status: 'ok' }] } },
    });
    assertEq(roSub.status, 402, 'canceled plan blocks student submission with 402');

    // Reads & exports still allowed in read-only mode
    const roGb = await req('GET', `/api/classes/${classId}/gradebook`, { token: teacherToken });
    assertEq(roGb.status, 200, 'read-only mode still allows gradebook view');
    const roCsv = await req('GET', `/api/classes/${classId}/gradebook.csv`, { token: teacherToken });
    assertEq(roCsv.status, 200, 'read-only mode still allows CSV export');
    const roFerpa = await req('GET', `/api/classes/${classId}/students/${alex.studentId}/export`, { token: teacherToken });
    assertEq(roFerpa.status, 200, 'read-only mode still allows FERPA Student Data JSON export');
  }

  // PO license grant
  const poRes = await req('POST', '/api/admin/po-grant', {
    token: ADMIN_SECRET,
    json: {
      email: teacherEmail,
      poReference: `PO-${runId}`,
      durationDays: 365,
      studentSoftCap: 500,
    },
  });
  if (poRes.status === 503 && poRes.data?.code === 'ADMIN_UNCONFIGURED') {
    console.log('NOTE: Skipping PO grant assertions (ADMIN_SECRET not set in wrangler .dev.vars)');
    skipped++;
  } else {
    assertEq(poRes.status, 200, 'POST /api/admin/po-grant 200');
    assertEq(poRes.data.teacher.plan.status, 'po_active', 'PO grant sets plan_status=po_active');
    assertEq(poRes.data.teacher.plan.canWrite, true, 'PO grant restores write access');
  }

  // ==========================================================================
  // 11. Cascade Class Delete (allowed even in read-only mode)
  // ==========================================================================
  const delCls = await req('DELETE', `/api/classes/${classId}`, { token: teacherToken });
  assertEq(delCls.status, 200, 'DELETE /api/classes/:id 200');

  const afterDelStudents = await req('GET', `/api/classes/${classId}/students`, { token: teacherToken });
  assertEq(afterDelStudents.status, 404, 'deleted class students return 404');

  const afterDelAsgn = await req('GET', `/api/assignments/${tsrId}`, { token: teacherToken });
  assertEq(afterDelAsgn.status, 404, 'cascade-deleted assignment returns 404');

  console.log(`hw-api-test: ALL ${passed} assertions passed (${skipped} optional secret section(s) skipped)`);
}

main().catch(err => {
  console.error(err?.stack || err);
  process.exit(1);
});
