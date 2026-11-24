'use strict';
/* Rehearsal Online Homework — API Client & Faithful Local Preview Mode.
   Connects hw.html / hw-student.js to tools/hw-worker (Cloudflare Worker + D1 + R2).
   When no live API URL is configured (?api=..., window.HW_API_BASE, or localStorage
   'rehearsal-hw-api'), automatically runs in Local Preview Mode implementing the
   exact Milestone 2 API contracts, error codes, True Sight-Read excerpt locking,
   code lockouts, and server-side score recomputation so teachers & students can
   click through every flow immediately. */

(function () {
  const SESSION_TOKEN_KEY = 'rehearsal-hw-student-token';
  const SESSION_API_KEY = 'rehearsal-hw-api-session';
  const SESSION_ACTIVE_BASE_KEY = 'rehearsal-hw-api-active-base';
  const LOCAL_API_KEY = 'rehearsal-hw-api';
  const LEGACY_WORKERS_BASE = 'https://rehearsal-hw.logan-shippee.workers.dev';
  const DEFAULT_API_BASE = 'https://api.rehearsalmusic.com';
  const DEMO_SENTINEL = 'demo';
  const DEMO_OFFLINE_KEY = 'rehearsal-hw-demo-offline';
  const DEMO_DB_KEY = 'rehearsal-hw-demo-db-v1';
  const PREVIEW_DRAFT_KEY = 'rehearsal-hw-preview-draft-v1';
  const DAY_MS = 24 * 60 * 60 * 1000;
  const capsByBase = new Map();

  function syncActiveBaseToken(resolved) {
    try {
      const prev = sessionStorage.getItem(SESSION_ACTIVE_BASE_KEY);
      if (prev !== null && prev !== resolved) {
        sessionStorage.removeItem(SESSION_TOKEN_KEY);
      }
      sessionStorage.setItem(SESSION_ACTIVE_BASE_KEY, resolved);
    } catch { }
  }

  function normalizeCode(raw) {
    return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function formatCode(raw) {
    const n = normalizeCode(raw);
    return n.length === 6 ? `${n.slice(0, 3)}-${n.slice(3)}` : n;
  }

  function clone(obj) {
    return obj == null ? obj : JSON.parse(JSON.stringify(obj));
  }

  // ---------- API Base Resolution (URL ?demo=1 / ?api= -> sessionStorage -> window -> localStorage -> prod default)
  function resolveApiBaseRaw() {
    try {
      const qs = new URLSearchParams(location.search);
      if (qs.get('demo') === '1') return '';
      const paramApi = qs.get('api');
      if (paramApi !== null) {
        const clean = paramApi.trim().replace(/\/+$/, '');
        if (!clean || clean.toLowerCase() === DEMO_SENTINEL) {
          sessionStorage.setItem(SESSION_API_KEY, DEMO_SENTINEL);
          return '';
        }
        sessionStorage.setItem(SESSION_API_KEY, clean);
        return clean;
      }
      const sessApi = sessionStorage.getItem(SESSION_API_KEY);
      if (sessApi === DEMO_SENTINEL) return '';
      if (sessApi) return sessApi;
    } catch { }
    if (typeof window.HW_API_BASE === 'string') {
      const clean = window.HW_API_BASE.trim().replace(/\/+$/, '');
      if (!clean || clean.toLowerCase() === DEMO_SENTINEL) return '';
      return clean;
    }
    try {
      const stored = localStorage.getItem(LOCAL_API_KEY);
      if (stored !== null) {
        const clean = stored.trim().replace(/\/+$/, '');
        if (clean.toLowerCase() === DEMO_SENTINEL || clean === LEGACY_WORKERS_BASE) {
          localStorage.removeItem(LOCAL_API_KEY);
        } else if (clean) {
          return clean;
        }
      }
    } catch { }
    return DEFAULT_API_BASE;
  }

  function getApiBase() {
    const resolved = resolveApiBaseRaw();
    syncActiveBaseToken(resolved);
    return resolved;
  }

  function isDemoMode() {
    return !getApiBase();
  }

  // Students stay signed in on their own (1:1) Chromebook: the token is kept in localStorage, tagged with the
  // server it belongs to, until Sign Out or the server lets it expire. Each student's Chromebook profile keeps
  // its own storage. Falls back to the tab-only copy if localStorage is blocked.
  const KEEP_TOKEN_KEY = 'rehearsal-hw-student-keep';
  function getToken() {
    try {
      const kept = JSON.parse(localStorage.getItem(KEEP_TOKEN_KEY) || 'null');
      if (kept?.token && kept.base === getApiBase()) return kept.token;
    } catch { }
    try { return sessionStorage.getItem(SESSION_TOKEN_KEY) || ''; } catch { return ''; }
  }

  function setToken(token) {
    try {
      if (token) sessionStorage.setItem(SESSION_TOKEN_KEY, token);
      else sessionStorage.removeItem(SESSION_TOKEN_KEY);
    } catch { }
    try {
      if (token) localStorage.setItem(KEEP_TOKEN_KEY, JSON.stringify({ base: getApiBase(), token }));
      else localStorage.removeItem(KEEP_TOKEN_KEY);
    } catch { }
  }

  function clearSession() {
    setToken('');
  }

  function isDemoOffline() {
    try { return sessionStorage.getItem(DEMO_OFFLINE_KEY) === '1'; } catch { return false; }
  }

  function setDemoOffline(flag) {
    try {
      if (flag) sessionStorage.setItem(DEMO_OFFLINE_KEY, '1');
      else sessionStorage.removeItem(DEMO_OFFLINE_KEY);
    } catch { }
  }

  // ---------- Excerpt stripping & server-side score recomputation mirror
  function stripTrueSightReadExcerpt(config) {
    const out = clone(config || {});
    if (!out || typeof out !== 'object') return {};
    delete out.ex;
    if (out.srState && typeof out.srState === 'object') {
      delete out.srState.ex;
      if (out.srState.build && typeof out.srState.build === 'object') {
        delete out.srState.build.notes;
      }
    }
    if (out.build && typeof out.build === 'object') {
      delete out.build.notes;
    }
    return out;
  }

  function recomputeDemoSubmission(assignment, config, payload, audioBytes) {
    if (assignment.type === 'audio') {
      return {
        ok: true,
        overallPct: null,
        rhythmPct: null,
        pitchPct: null,
        audioSaved: audioBytes > 0,
      };
    }
    const results = payload?.results || payload?.resultsJson || {};
    const notes = Array.isArray(results.notes) ? results.notes : [];
    const total = notes.length;
    if (!total) {
      return {
        ok: false,
        status: 400,
        code: 'INVALID_RESULTS',
        error: 'No graded notes were recorded for this take.',
      };
    }
    const rOk = notes.filter(n => n.status === 'ok' || n.status === 'pitch').length;
    const rHalf = notes.filter(n => n.status === 'timing').length;
    const rhythmPct = Math.max(0, Math.min(100, Math.round(((rOk + 0.5 * rHalf) / total) * 100)));

    let expectsPitch = false;
    if (assignment.type === 'sight') {
      const sr = config?.srState || config || {};
      expectsPitch = !(sr.mode === 'rhythm' || sr.solRhythm || (sr.mode === 'build' && sr.build?.kind === 'rhythm'));
    } else if (assignment.type === 'score') {
      const gm = config?.gradeMode || config?.spState?.gradeMode || 'mic';
      expectsPitch = gm === 'mic';
    }

    let pitchPct = null;
    let overallPct = rhythmPct;
    if (expectsPitch) {
      const pOk = notes.filter(n => n.status === 'ok' || (n.status === 'timing' && n.pitch === 'ok')).length;
      pitchPct = Math.max(0, Math.min(100, Math.round((pOk / total) * 100)));
      overallPct = Math.max(0, Math.min(100, Math.round((rhythmPct + pitchPct) / 2)));
    }
    return {
      ok: true,
      overallPct,
      rhythmPct,
      pitchPct,
      audioSaved: audioBytes > 0,
    };
  }

  // ---------- Faithful Local Preview Mode Seed & State
  function createFreshDemoDb() {
    const t0 = Date.now();
    return {
      cls: {
        id: 'cls_demo_1',
        name: 'Concert Choir — Period 2',
        joinCode: 'K7M-4P2',
        teacherName: 'Ms. Rivera',
        locked: false,
        acceptingSubmissions: true,
      },
      students: [
        {
          id: 'stu_maya',
          displayName: 'Maya Lin',
          part: 'Soprano',
          email: '',
          googleSub: null,
          codeNorm: 'H7P9KM',
          codeDisplay: 'H7P-9KM',
          failedAttempts: 0,
          cooldownUntil: null,
          hardLocked: false,
        },
        {
          id: 'stu_jordan',
          displayName: 'Jordan Ortiz',
          part: 'Tenor',
          email: '',
          googleSub: null,
          codeNorm: 'M4R8TX',
          codeDisplay: 'M4R-8TX',
          failedAttempts: 0,
          cooldownUntil: null,
          hardLocked: false,
        },
      ],
      sessions: {}, // token -> { studentId, authMethod, expiresAt }
      assignments: [
        {
          id: 'asgn_true_sr',
          classId: 'cls_demo_1',
          title: 'True Sight-Reading Check #1',
          instructions: 'Read carefully during the 30-second study window. Your microphone starts automatically at 0:00 and submits once finished.',
          type: 'sight',
          mode: 'true_sight_read',
          dueAt: t0 + 3 * DAY_MS,
          maxAttempts: 1,
          gradePolicy: 'best',
          published: true,
          scoreFilename: null,
          config: {
            studySeconds: 30,
            countingSystem: 'numbers',
            strictness: { rhythm: 25, pitch: 25 },
            srState: {
              mode: 'solfege',
              show: false,
              showCounts: false,
              playhead: 'off',
              solfege: {
                key: 'C',
                scale: 'major',
                clef: 'treble',
                range: 'do-sol',
                leap: 'step',
                ts: '4/4',
                measures: 4,
                tempo: 80,
                metronome: true,
                measureNums: true,
                startDo: true,
                cells: ['q', 'h', 'w'],
                showCounts: false,
              },
              ex: {},
            },
          },
        },
        {
          id: 'asgn_rhythm_drill',
          classId: 'cls_demo_1',
          title: 'Rhythm Tap Drill — Quarter & Eighth Notes',
          instructions: 'Practice as many times as you like using Spacebar or Tap, then submit your best take.',
          type: 'sight',
          mode: 'practice',
          dueAt: t0 + 5 * DAY_MS,
          maxAttempts: 3,
          gradePolicy: 'best',
          published: true,
          scoreFilename: null,
          config: {
            studySeconds: 0,
            countingSystem: 'numbers',
            strictness: { rhythm: 25, pitch: 25 },
            srState: {
              mode: 'rhythm',
              show: true,
              showCounts: true,
              playhead: 'off',
              rhythm: {
                ts: '4/4',
                measures: 4,
                tempo: 84,
                metronome: true,
                measureNums: true,
                sound: 'clap',
                cells: ['q', 'h', 'ee', 'qr'],
                showCounts: true,
              },
              ex: {},
            },
          },
        },
        {
          id: 'asgn_score_vocal',
          classId: 'cls_demo_1',
          title: 'Vocal Part Check-In (Soprano / Alto)',
          instructions: 'Choose your assigned voice part, use Starting Pitch if needed, and record your take into the microphone.',
          type: 'score',
          mode: 'practice',
          dueAt: t0 + 7 * DAY_MS,
          maxAttempts: null,
          gradePolicy: 'best',
          published: true,
          scoreFilename: 'Ode to Joy.mxl',
          config: {
            gradeMode: 'mic',
            countingSystem: 'numbers',
            strictness: { rhythm: 25, pitch: 25 },
            spState: {
              name: 'Ode to Joy',
              gradeMode: 'mic',
              tempo: 84,
              solfege: false,
              counts: false,
              focus: 0,
              zoom: 0.85,
            },
          },
        },
        {
          id: 'asgn_audio_scale',
          classId: 'cls_demo_1',
          title: '5-Note Major Scale Warm-Up',
          instructions: 'Sing a 5-note major scale (do–re–mi–fa–sol–fa–mi–re–do) on "ah" after the 4-beat count-in, then click Submit.',
          type: 'audio',
          mode: 'practice',
          dueAt: t0 + 4 * DAY_MS,
          maxAttempts: 3,
          gradePolicy: 'last',
          published: true,
          scoreFilename: null,
          config: {
            countIn: true,
            bpm: 84,
            prompt: 'Sing a 5-note major scale (do–re–mi–fa–sol–fa–mi–re–do) on "ah" with steady breath support.',
            strictness: { rhythm: 25, pitch: 25 },
          },
        },
      ],
      attemptStarts: [], // { id, assignmentId, studentId, attemptNum, startedAt, studySeconds, expectedSec, consumedAt }
      submissions: [],   // { id, assignmentId, studentId, attemptNum, attemptStartId, overallPct, rhythmPct, pitchPct, submittedAt, audioSaved }
    };
  }

  let memDemoDb = null;

  function loadDemoDb() {
    if (memDemoDb) return memDemoDb;
    try {
      const raw = sessionStorage.getItem(DEMO_DB_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.cls && Array.isArray(parsed.assignments)) {
          memDemoDb = parsed;
          return memDemoDb;
        }
      }
    } catch { }
    memDemoDb = createFreshDemoDb();
    saveDemoDb();
    return memDemoDb;
  }

  function saveDemoDb() {
    if (!memDemoDb) return;
    try { sessionStorage.setItem(DEMO_DB_KEY, JSON.stringify(memDemoDb)); } catch { }
  }

  function demoErr(status, code, error, extra = {}) {
    return { ok: false, status, code, error, ...extra };
  }

  function demoAuthStudent(db) {
    const tok = getToken();
    if (!tok) return null;
    const sess = db.sessions[tok];
    if (!sess || sess.expiresAt <= Date.now()) {
      if (sess) { delete db.sessions[tok]; saveDemoDb(); }
      return null;
    }
    const stu = db.students.find(s => s.id === sess.studentId);
    if (!stu) return null;
    return { token: tok, sess, stu };
  }

  function buildStudentAssignmentSummary(db, a, studentId) {
    const subs = db.submissions
      .filter(s => s.assignmentId === a.id && s.studentId === studentId)
      .sort((x, y) => x.attemptNum - y.attemptNum);
    const activeStart = db.attemptStarts.find(
      st => st.assignmentId === a.id && st.studentId === studentId && !st.consumedAt
    ) || null;
    const attemptsUsed = subs.length;
    const attemptsRemaining = a.maxAttempts == null ? null : Math.max(0, a.maxAttempts - attemptsUsed);
    const latest = subs.length ? subs[subs.length - 1] : null;
    const scored = subs.filter(s => s.overallPct != null);
    const best = scored.length
      ? scored.reduce((b, cur) => (cur.overallPct >= b.overallPct ? cur : b), scored[0])
      : latest;
    const effective = a.gradePolicy === 'last' ? latest : best;

    return {
      id: a.id,
      classId: a.classId,
      title: a.title,
      instructions: a.instructions,
      type: a.type,
      mode: a.mode,
      dueAt: a.dueAt,
      maxAttempts: a.maxAttempts,
      gradePolicy: a.gradePolicy,
      scoreFilename: a.scoreFilename,
      attemptsUsed,
      attemptsRemaining,
      activeStart: activeStart ? clone(activeStart) : null,
      latestSubmission: latest ? {
        id: latest.id,
        attemptNum: latest.attemptNum,
        overallPct: latest.overallPct,
        rhythmPct: latest.rhythmPct,
        pitchPct: latest.pitchPct,
        submittedAt: latest.submittedAt,
        audioSaved: !!latest.audioSaved,
      } : null,
      bestSubmission: effective ? {
        id: effective.id,
        attemptNum: effective.attemptNum,
        overallPct: effective.overallPct,
        rhythmPct: effective.rhythmPct,
        pitchPct: effective.pitchPct,
        submittedAt: effective.submittedAt,
        audioSaved: !!effective.audioSaved,
      } : null,
    };
  }

  function demoNetworkGuard() {
    if (isDemoOffline() || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
      return { ok: false, networkError: true, status: 0, code: 'OFFLINE', error: 'No internet connection (Offline simulation active).' };
    }
    return null;
  }

  // ---------- Live Fetch Helper
  async function liveFetch(path, { method = 'GET', json = undefined, formData = undefined, auth = true, responseType = 'json' } = {}) {
    const base = getApiBase();
    const headers = {};
    if (auth) {
      const tok = getToken();
      if (tok) headers.Authorization = `Bearer ${tok}`;
    }
    let body;
    if (formData) {
      body = formData;
    } else if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    }

    let res;
    try {
      res = await fetch(`${base}${path}`, { method, headers, body });
    } catch (err) {
      return {
        ok: false,
        networkError: true,
        status: 0,
        code: 'NETWORK_ERROR',
        error: 'Could not reach the server. Your recording is safe on this device.',
      };
    }

    if (responseType === 'blob') {
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        return {
          ok: false,
          status: res.status,
          code: errData.code || 'HTTP_ERROR',
          error: errData.error || `Request failed (${res.status})`,
        };
      }
      const blob = await res.blob();
      const disp = res.headers.get('content-disposition') || '';
      const fnMatch = disp.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
      return {
        ok: true,
        status: res.status,
        blob,
        filename: fnMatch ? decodeURIComponent(fnMatch[1]) : 'score.musicxml',
      };
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      return {
        ok: false,
        status: res.status,
        code: data.code || 'HTTP_ERROR',
        error: data.error || `Request failed (${res.status})`,
        retryAfterSec: data.retryAfterSec,
      };
    }
    return { ok: true, status: res.status, ...data };
  }

  // ---------- Public API (Live Worker + Faithful Local Preview Mode)
  const HW_API = {
    isDemoMode,
    getApiBase,
    getToken,
    setToken,
    clearSession,
    isDemoOffline,
    setDemoOffline,

    async getCapabilities(force = false) {
      const base = getApiBase();
      if (!base) {
        return { ok: true, devMode: true, googleSignInEnabled: true, billingEnabled: true };
      }
      if (!force && capsByBase.has(base)) return capsByBase.get(base);
      const res = await liveFetch('/api/health', { method: 'GET', auth: false });
      const caps = res.ok
        ? {
            ok: true,
            devMode: !!res.devMode,
            googleSignInEnabled: !!res.googleSignInEnabled,
            googleClientId: String(res.googleClientId || ''),
            billingEnabled: !!res.billingEnabled,
          }
        : { ok: false, devMode: false, googleSignInEnabled: false, googleClientId: '', billingEnabled: false };
      if (res.ok) capsByBase.set(base, caps);
      return caps;
    },

    getDemoCredentials() {
      const db = loadDemoDb();
      return {
        joinCode: db.cls.joinCode,
        className: db.cls.name,
        students: db.students
          .filter(s => s.codeDisplay)
          .map(s => ({ displayName: s.displayName, part: s.part, code: s.codeDisplay })),
      };
    },

    upsertDemoAssignment(partial) {
      if (!isDemoMode()) return null;
      const db = loadDemoDb();
      const idx = db.assignments.findIndex(a => a.id === partial.id);
      if (idx >= 0) {
        db.assignments[idx] = { ...db.assignments[idx], ...clone(partial) };
      } else {
        db.assignments.unshift(clone(partial));
      }
      saveDemoDb();
      return partial;
    },

    async loginWithCode({ joinCode, studentCode, name = '' }) {
      if (!isDemoMode()) {
        const res = await liveFetch('/api/auth/student/code', {
          method: 'POST',
          auth: false,
          json: { joinCode, studentCode, name },
        });
        if (res.ok && res.token) setToken(res.token);
        return res;
      }

      const netErr = demoNetworkGuard();
      if (netErr) return netErr;

      const db = loadDemoDb();
      const jc = formatCode(joinCode);
      const sc = normalizeCode(studentCode);
      const cleanName = String(name || '').trim().toLowerCase();
      if (!jc || sc.length < 4) {
        return demoErr(400, 'INVALID_INPUT', 'Enter your Class Code and your 6-character Student Code.');
      }
      if (jc !== db.cls.joinCode) {
        return demoErr(401, 'INVALID_CODE', 'Class code or student code did not match. Check for typos or ask your teacher.');
      }

      let student = db.students.find(s => s.codeNorm === sc);
      let matchedByNameOnly = false;
      if (!student && cleanName) {
        student = db.students.find(s => s.displayName.trim().toLowerCase() === cleanName) || null;
        if (student) matchedByNameOnly = true;
      }
      if (!student) {
        return demoErr(401, 'INVALID_CODE', 'Class code or student code did not match. Check for typos or ask your teacher.');
      }
      const nowTs = Date.now();
      if (student.hardLocked) {
        return demoErr(423, 'CODE_HARD_LOCKED', 'Your login code is locked after too many wrong tries. Ask your teacher to print you a new code.');
      }
      if (student.cooldownUntil && student.cooldownUntil > nowTs) {
        return demoErr(429, 'CODE_COOLDOWN', 'Too many wrong tries. Wait 15 minutes or ask your teacher for a new code.', {
          retryAfterSec: Math.ceil((student.cooldownUntil - nowTs) / 1000),
        });
      }
      if (matchedByNameOnly || student.codeNorm !== sc) {
        student.failedAttempts = (student.failedAttempts || 0) + 1;
        if (student.failedAttempts >= 10) {
          student.hardLocked = true;
          saveDemoDb();
          return demoErr(423, 'CODE_HARD_LOCKED', 'Your login code is locked after 10 wrong tries. Ask your teacher for a new code.');
        }
        if (student.failedAttempts >= 5) {
          student.cooldownUntil = nowTs + 15 * 60 * 1000;
          saveDemoDb();
          return demoErr(429, 'CODE_COOLDOWN', 'Too many wrong tries. Wait 15 minutes or ask your teacher for a new code.', {
            retryAfterSec: 900,
          });
        }
        saveDemoDb();
        return demoErr(401, 'INVALID_CODE', 'Class code or student code did not match. Check for typos or ask your teacher.');
      }

      student.failedAttempts = 0;
      student.cooldownUntil = null;
      const token = 'demo_stu_' + Math.random().toString(36).slice(2, 12);
      const expiresAt = nowTs + DAY_MS;
      db.sessions[token] = { studentId: student.id, authMethod: 'code', expiresAt };
      saveDemoDb();
      setToken(token);
      return {
        ok: true,
        token,
        expiresAt,
        authMethod: 'code',
        student: { id: student.id, displayName: student.displayName, part: student.part || '' },
        class: { id: db.cls.id, name: db.cls.name, joinCode: db.cls.joinCode },
      };
    },

    // Signed in with a code: tie this Google account to the same student, so "Sign in with Google" finds them next time.
    async linkGoogle(idToken) {
      if (!isDemoMode()) {
        return liveFetch('/api/auth/student/link-google', { method: 'POST', json: { idToken } });
      }
      return { ok: true, linked: true };
    },

    async loginWithGoogle({ idToken, joinCode = '', classId = '' }) {
      if (!isDemoMode()) {
        const res = await liveFetch('/api/auth/student/google', {
          method: 'POST',
          auth: false,
          json: { idToken, joinCode, classId },
        });
        if (res.ok && res.token) setToken(res.token);
        return res;
      }

      const netErr = demoNetworkGuard();
      if (netErr) return netErr;

      const db = loadDemoDb();
      const jc = joinCode ? formatCode(joinCode) : db.cls.joinCode;
      if (jc !== db.cls.joinCode) {
        return demoErr(404, 'CLASS_NOT_FOUND', 'Class code not found. Double-check with your teacher.');
      }
      const sub = 'demo-google-alex';
      let student = db.students.find(s => s.googleSub === sub);
      if (!student) {
        if (db.cls.locked) {
          return demoErr(403, 'CLASS_LOCKED', 'This class is locked to new sign-ups. Ask your teacher to unlock it or add you.');
        }
        student = {
          id: 'stu_alex_google',
          displayName: 'Alex Rivera',
          part: 'Alto',
          email: 'alex.rivera@school.edu',
          googleSub: sub,
          codeNorm: null,
          codeDisplay: null,
          failedAttempts: 0,
          cooldownUntil: null,
          hardLocked: false,
        };
        db.students.push(student);
      }
      const token = 'demo_gstu_' + Math.random().toString(36).slice(2, 12);
      const expiresAt = Date.now() + DAY_MS;
      db.sessions[token] = { studentId: student.id, authMethod: 'google', expiresAt };
      saveDemoDb();
      setToken(token);
      return {
        ok: true,
        token,
        expiresAt,
        authMethod: 'google',
        student: { id: student.id, displayName: student.displayName, part: student.part || '' },
        class: { id: db.cls.id, name: db.cls.name, joinCode: db.cls.joinCode },
      };
    },

    async getMe() {
      if (!isDemoMode()) {
        return liveFetch('/api/auth/student/me');
      }
      const db = loadDemoDb();
      const auth = demoAuthStudent(db);
      if (!auth) return demoErr(401, 'SESSION_INVALID', 'Session expired — please sign in again.');
      return {
        ok: true,
        student: {
          id: auth.stu.id,
          displayName: auth.stu.displayName,
          part: auth.stu.part || '',
          authMethod: auth.sess.authMethod,
        },
        class: {
          id: db.cls.id,
          name: db.cls.name,
          joinCode: db.cls.joinCode,
          teacherName: db.cls.teacherName,
          acceptingSubmissions: db.cls.acceptingSubmissions,
        },
      };
    },

    async logout() {
      if (!isDemoMode()) {
        const res = await liveFetch('/api/auth/student/logout', { method: 'POST', json: {} }).catch(() => ({ ok: true }));
        clearSession();
        return res;
      }
      const db = loadDemoDb();
      const tok = getToken();
      if (tok && db.sessions[tok]) {
        delete db.sessions[tok];
        saveDemoDb();
      }
      clearSession();
      return { ok: true };
    },

    async listAssignments() {
      if (!isDemoMode()) {
        return liveFetch('/api/student/assignments');
      }
      const db = loadDemoDb();
      const auth = demoAuthStudent(db);
      if (!auth) return demoErr(401, 'SESSION_INVALID', 'Session expired — please sign in again.');
      return {
        ok: true,
        assignments: db.assignments
          .filter(a => a.published)
          .map(a => buildStudentAssignmentSummary(db, a, auth.stu.id)),
      };
    },

    async getAssignment(assignmentId) {
      if (!isDemoMode()) {
        return liveFetch(`/api/student/assignments/${encodeURIComponent(assignmentId)}`);
      }
      const db = loadDemoDb();
      const auth = demoAuthStudent(db);
      if (!auth) return demoErr(401, 'SESSION_INVALID', 'Session expired — please sign in again.');
      const a = db.assignments.find(x => x.id === assignmentId && x.published);
      if (!a) return demoErr(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment not found.');

      const summary = buildStudentAssignmentSummary(db, a, auth.stu.id);
      const isTrueSr = a.type === 'sight' && a.mode === 'true_sight_read';
      const hasCompleted = summary.attemptsUsed > 0;
      const locked = isTrueSr && !summary.activeStart && !hasCompleted;
      const cfg = locked ? stripTrueSightReadExcerpt(a.config) : clone(a.config);
      return {
        ok: true,
        assignment: {
          ...summary,
          config: cfg,
          excerptLocked: locked,
        },
      };
    },

    async startAttempt(assignmentId) {
      if (!isDemoMode()) {
        return liveFetch(`/api/student/assignments/${encodeURIComponent(assignmentId)}/start`, {
          method: 'POST',
          json: {},
        });
      }
      const netErr = demoNetworkGuard();
      if (netErr) return netErr;

      const db = loadDemoDb();
      const auth = demoAuthStudent(db);
      if (!auth) return demoErr(401, 'SESSION_INVALID', 'Session expired — please sign in again.');
      const a = db.assignments.find(x => x.id === assignmentId && x.published);
      if (!a) return demoErr(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment not found.');

      const nowTs = Date.now();
      const active = db.attemptStarts.find(
        st => st.assignmentId === a.id && st.studentId === auth.stu.id && !st.consumedAt
      );
      if (active) {
        return { ok: true, resumed: true, attemptStart: clone(active), config: clone(a.config) };
      }

      const maxSub = db.submissions
        .filter(s => s.assignmentId === a.id && s.studentId === auth.stu.id)
        .reduce((m, s) => Math.max(m, s.attemptNum), 0);
      const maxStart = db.attemptStarts
        .filter(st => st.assignmentId === a.id && st.studentId === auth.stu.id)
        .reduce((m, st) => Math.max(m, st.attemptNum), 0);
      const nextAttempt = Math.max(maxSub, maxStart) + 1;
      if (a.maxAttempts != null && nextAttempt > a.maxAttempts) {
        return demoErr(409, 'ATTEMPT_LIMIT_REACHED', 'You have already used all allowed attempts for this assignment.');
      }

      const studySeconds = Math.max(15, Math.min(60, Number(a.config?.studySeconds || 30)));
      const startRow = {
        id: 'ast_' + Math.random().toString(36).slice(2, 12),
        assignmentId: a.id,
        studentId: auth.stu.id,
        attemptNum: nextAttempt,
        startedAt: nowTs,
        studySeconds,
        expectedSec: 15,
        consumedAt: null,
      };
      db.attemptStarts.push(startRow);
      saveDemoDb();
      return { ok: true, resumed: false, attemptStart: clone(startRow), config: clone(a.config) };
    },

    async submitAttempt(assignmentId, { payload, audioBlob = null }) {
      if (!isDemoMode()) {
        if (audioBlob instanceof Blob && audioBlob.size > 0) {
          const fd = new FormData();
          fd.append('payload', JSON.stringify(payload || {}));
          const ext = (audioBlob.type || '').includes('mp4')
            ? 'm4a'
            : (audioBlob.type || '').includes('ogg')
              ? 'ogg'
              : (audioBlob.type || '').includes('wav')
                ? 'wav'
                : 'webm';
          fd.append('audio', audioBlob, `recording.${ext}`);
          return liveFetch(`/api/student/assignments/${encodeURIComponent(assignmentId)}/submissions`, {
            method: 'POST',
            formData: fd,
          });
        }
        return liveFetch(`/api/student/assignments/${encodeURIComponent(assignmentId)}/submissions`, {
          method: 'POST',
          json: payload || {},
        });
      }

      const netErr = demoNetworkGuard();
      if (netErr) return netErr;

      const db = loadDemoDb();
      const auth = demoAuthStudent(db);
      if (!auth) return demoErr(401, 'SESSION_INVALID', 'Session expired — please sign in again.');
      const a = db.assignments.find(x => x.id === assignmentId && x.published);
      if (!a) return demoErr(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment not found.');

      const existing = db.submissions.filter(s => s.assignmentId === a.id && s.studentId === auth.stu.id);
      const nextAttempt = existing.reduce((m, s) => Math.max(m, s.attemptNum), 0) + 1;
      if (a.maxAttempts != null && nextAttempt > a.maxAttempts) {
        return demoErr(409, 'ATTEMPT_LIMIT_REACHED', 'You have already submitted the maximum number of attempts for this assignment.');
      }

      const audioBytes = audioBlob instanceof Blob ? audioBlob.size : 0;
      const calc = recomputeDemoSubmission(a, a.config, payload, audioBytes);
      if (!calc.ok) return demoErr(calc.status || 400, calc.code, calc.error);

      const nowTs = Date.now();
      if (payload?.attemptStartId) {
        const st = db.attemptStarts.find(
          x => x.id === payload.attemptStartId && x.assignmentId === a.id && x.studentId === auth.stu.id && !x.consumedAt
        );
        if (st) st.consumedAt = nowTs;
      }

      const subRow = {
        id: 'sub_' + Math.random().toString(36).slice(2, 12),
        assignmentId: a.id,
        studentId: auth.stu.id,
        attemptNum: nextAttempt,
        attemptStartId: payload?.attemptStartId || null,
        overallPct: calc.overallPct,
        rhythmPct: calc.rhythmPct,
        pitchPct: calc.pitchPct,
        submittedAt: nowTs,
        audioSaved: calc.audioSaved,
      };
      db.submissions.push(subRow);
      saveDemoDb();

      // Clean student response — NEVER includes internal integrityFlags
      return {
        ok: true,
        submission: {
          id: subRow.id,
          attemptNum: subRow.attemptNum,
          overallPct: subRow.overallPct,
          rhythmPct: subRow.rhythmPct,
          pitchPct: subRow.pitchPct,
          submittedAt: subRow.submittedAt,
          audioSaved: subRow.audioSaved,
        },
      };
    },

    async downloadScoreBlob(assignmentId) {
      if (!isDemoMode()) {
        return liveFetch(`/api/assignments/${encodeURIComponent(assignmentId)}/score`, {
          method: 'GET',
          responseType: 'blob',
        });
      }
      const db = loadDemoDb();
      const a = db.assignments.find(x => x.id === assignmentId);
      // The demo plays a real .mxl file (Ode to Joy), so teachers see an actual score; the built-in sample is the fallback
      if (!a?.config?.demoXml) {
        try {
          const r = await fetch('demo/ode-to-joy.mxl');
          if (r.ok) return { ok: true, blob: await r.blob(), filename: 'Ode to Joy.mxl' };
        } catch {}
      }
      const xml = a?.config?.demoXml || (typeof HW_SAMPLE_MUSICXML !== 'undefined' ? HW_SAMPLE_MUSICXML : '');
      const blob = new Blob([xml], { type: 'application/xml' });
      return {
        ok: true,
        blob,
        filename: a?.scoreFilename || 'Sample Vocal Check-In.musicxml',
      };
    },

    async fetchSubmissionAudioUrl(submissionId) {
      const res = await liveFetch(`/api/submissions/${encodeURIComponent(submissionId)}/audio`, {
        method: 'GET',
        responseType: 'blob',
      });
      if (!res.ok) return res;
      return { ok: true, url: URL.createObjectURL(res.blob) };
    },

    async getPreviewAssignment(previewToken) {
      const tok = String(previewToken || '').trim();
      if (!tok) {
        return demoErr(400, 'PREVIEW_INVALID', 'Missing preview link token.');
      }
      if (tok.startsWith('demo:')) {
        const id = tok.slice(5);
        let entry = null;
        try {
          const map = JSON.parse(localStorage.getItem(PREVIEW_DRAFT_KEY) || '{}') || {};
          entry = map[id] || null;
        } catch { entry = null; }
        if (!entry || !entry.assignment) {
          return demoErr(404, 'PREVIEW_EXPIRED', 'This preview link expired. Click Preview as Student again from Rehearsal.');
        }
        return {
          ok: true,
          preview: true,
          class: clone(entry.class || { id: entry.assignment.classId, name: 'Preview Class', joinCode: '', teacherName: 'Teacher', acceptingSubmissions: true }),
          assignment: {
            ...clone(entry.assignment),
            excerptLocked: false,
            attemptsUsed: 0,
            attemptsRemaining: entry.assignment.maxAttempts ?? null,
            expiredStartsCount: 0,
            activeStart: null,
            latestSubmission: null,
            bestSubmission: null,
          },
        };
      }
      return liveFetch(`/api/preview/assignment?token=${encodeURIComponent(tok)}`, {
        method: 'GET',
        auth: false,
      });
    },

    async downloadPreviewScoreBlob(previewToken) {
      const tok = String(previewToken || '').trim();
      if (tok.startsWith('demo:')) {
        const id = tok.slice(5);
        let entry = null;
        try {
          const map = JSON.parse(localStorage.getItem(PREVIEW_DRAFT_KEY) || '{}') || {};
          entry = map[id] || null;
        } catch { entry = null; }
        if (!entry || !entry.assignment) {
          return demoErr(404, 'PREVIEW_EXPIRED', 'This preview link expired. Click Preview as Student again from Rehearsal.');
        }
        const xml = entry.assignment?.config?.demoXml || (typeof HW_SAMPLE_MUSICXML !== 'undefined' ? HW_SAMPLE_MUSICXML : '');
        const blob = new Blob([xml], { type: 'application/xml' });
        return {
          ok: true,
          blob,
          filename: entry.assignment?.scoreFilename || 'Sample Vocal Check-In.musicxml',
        };
      }
      return liveFetch(`/api/preview/score?token=${encodeURIComponent(tok)}`, {
        method: 'GET',
        auth: false,
        responseType: 'blob',
      });
    },
  };

  window.HW_API = HW_API;
})();
