#!/usr/bin/env node
// Integration test for beta codes and the built-in Test Student (needs a local worker, see hw-api-test.mjs).
// Before running, add the codes this test uses to the local database:
//   cd tools/hw-worker && npx wrangler d1 execute rehearsal-hw --local --command \
//   "INSERT INTO beta_codes (code,label,max_uses,uses,plan_ends_at,student_soft_cap,created_at) VALUES ('BETA-TEST-ONE','Test',1,0,4102444800000,300,1)"
const BASE = (process.env.HW_API_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');
let passed = 0;
const ok = (c, m) => { if (!c) throw new Error('FAILED: ' + m); passed++; };
async function req(method, path, { token, json, ip = '10.9.0.1' } = {}) {
  const h = { 'X-Forwarded-For': ip };
  if (token) h.Authorization = `Bearer ${token}`;
  if (json) h['Content-Type'] = 'application/json';
  const r = await fetch(BASE + path, { method, headers: h, body: json ? JSON.stringify(json) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
}
async function signIn(email) {
  const s = await req('POST', '/api/auth/teacher/email/start', { json: { email } });
  const v = await req('POST', '/api/auth/teacher/email/verify', { json: { email, code: s.data.devCode, name: 'Beta Tester' } });
  return v.data.token;
}

const run = Date.now().toString(36);
const t1 = await signIn(`beta1-${run}@school.edu`);
const t2 = await signIn(`beta2-${run}@school.edu`);

// ---- Test Student
const cls = await req('POST', '/api/classes', { token: t1, json: { name: 'Choir' } });
ok(cls.status < 300 && cls.data.class?.id, 'class created: ' + JSON.stringify(cls));
const classId = cls.data.class.id;
const list = await req('GET', `/api/classes/${classId}/students`, { token: t1 });
ok(list.data.students.length === 1 && list.data.students[0].isTest === true, 'class has one Test Student');
ok(list.data.students[0].hasCode === false, 'Test Student has no code');
const again = await req('GET', `/api/classes/${classId}/students`, { token: t1 });
ok(again.data.students.length === 1, 'Test Student is not duplicated');
const classes = await req('GET', '/api/classes', { token: t1 });
ok(classes.data.classes.find(c => c.id === classId).studentCount === 0, 'Test Student not counted');
const me1 = await req('GET', '/api/auth/teacher/me', { token: t1 });
ok(!JSON.stringify(me1.data).includes('"activeStudentCount":1'), 'Test Student not in teacher total');

const open = await req('POST', `/api/classes/${classId}/test-student/open`, { token: t1 });
ok(open.status === 200 && !!open.data.token, 'open test student returns a token');
const sme = await req('GET', '/api/auth/student/me', { token: open.data.token });
ok(sme.status === 200 && sme.data.student?.displayName === 'Test Student', 'token signs in as Test Student');
const other = await req('POST', `/api/classes/${classId}/test-student/open`, { token: t2 });
ok(other.status === 404, 'another teacher cannot open it');

// ---- Beta codes
const bad = await req('POST', '/api/teacher/redeem-beta', { token: t1, json: { code: 'NOPE' } });
ok(bad.status === 400 && bad.data.code === 'BETA_INVALID', 'bad code rejected');
const good = await req('POST', '/api/teacher/redeem-beta', { token: t1, json: { code: ' beta-test-one ' } });
ok(good.status === 200 && good.data.plan.beta === true && good.data.plan.status === 'po_active', 'good code gives beta access');
const me2 = await req('GET', '/api/auth/teacher/me', { token: t1 });
ok(me2.data.teacher.plan.beta === true, 'plan shows beta on later loads');
const full = await req('POST', '/api/teacher/redeem-beta', { token: t2, json: { code: 'BETA-TEST-ONE' } });
ok(full.status === 400 && full.data.code === 'BETA_FULL', 'used-up code rejected');

console.log(`hw-beta-test: ALL ${passed} checks passed`);
