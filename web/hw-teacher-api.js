'use strict';
/* Rehearsal Online Homework — Teacher API Client, Offline Gradebook Cache & Local Preview Mode.
   Connects Rehearsal Setup (web/hw-teacher.js & web/hw-teacher-drawer.js) to tools/hw-worker.
   Never touches localStorage['rehearsal'] or IndexedDB 'rehearsal-files'. */

(function () {
  const LOCAL_API_KEY = 'rehearsal-hw-api';
  const LEGACY_WORKERS_BASE = 'https://rehearsal-hw.logan-shippee.workers.dev';
  const DEFAULT_API_BASE = 'https://api.rehearsalmusic.com';
  const DEMO_SENTINEL = 'demo';
  const TOKEN_KEY = 'rehearsal-hw-teacher-token';
  const CACHE_KEY = 'rehearsal-hw-teacher-cache-v1';
  const DEMO_DB_KEY = 'rehearsal-hw-teacher-demo-v1';
  const DEMO_OFFLINE_KEY = 'rehearsal-hw-teacher-demo-offline';
  const DEMO_HANDOFFS_KEY = 'rehearsal-hw-demo-handoffs-v1';
  const PREVIEW_DRAFT_KEY = 'rehearsal-hw-preview-draft-v1';

  const DAY_MS = 24 * 60 * 60 * 1000;
  const capsByBase = new Map();
  const MAX_SCORE_BYTES = 10 * 1024 * 1024;
  const AUDIO_RETENTION_DAYS = 90;
  const DEFAULT_SOFT_CAP = 200;
  const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const MUSESCORE_UNSUPPORTED_MSG =
    "MuseScore (.mscz) files aren't supported directly online. In MuseScore, choose File -> Export -> MusicXML (.mxl or .musicxml) and upload that file.";

  const INTEGRITY_FLAG_INFO = {
    score_mismatch: {
      title: 'Score Mismatch',
      description: 'The score reported by the browser did not match the server recalculation. The server-verified score is shown.',
    },
    unexpected_input_mode: {
      title: 'Tap Mode Used on Pitch Assignment',
      description: 'This assignment expected microphone singing or playing, but the submission used tap-only input.',
    },
    duration_too_short: {
      title: 'Recording Too Short',
      description: 'The submission finished in less than half of the expected duration for this piece.',
    },
    low_rms_high_score: {
      title: 'Very Quiet Audio with High Score',
      description: 'The microphone picked up very little sound energy even though the score was 50% or higher.',
    },
    missing_audio: {
      title: 'No Audio Attached',
      description: 'This microphone assignment was submitted without an attached audio recording.',
    },
    true_sight_read_no_start: {
      title: 'Missing Sight-Read Start Timer',
      description: 'No server start timestamp was recorded before this True Sight-Read submission arrived.',
    },
    true_sight_read_overtime: {
      title: 'Overtime Study & Performance Window',
      description: 'Total time from opening the True Sight-Read excerpt to submitting exceeded the allowed study and performance window.',
    },
    true_sight_read_too_fast: {
      title: 'Submitted Too Quickly',
      description: 'The True Sight-Read attempt was submitted in less than half of the expected performance duration.',
    },
  };

  let memDemoOffline = false;
  let memDemoDb = null;

  function clone(val) {
    return val == null ? val : JSON.parse(JSON.stringify(val));
  }

  function normalizeCode(raw) {
    return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function formatCode(raw) {
    const n = normalizeCode(raw);
    return n.length === 6 ? `${n.slice(0, 3)}-${n.slice(3)}` : n;
  }

  function generateCode6(usedSet) {
    for (let attempt = 0; attempt < 20; attempt++) {
      let raw = '';
      for (let i = 0; i < 6; i++) {
        raw += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      }
      const formatted = `${raw.slice(0, 3)}-${raw.slice(3)}`;
      if (!usedSet || !usedSet.has(formatted)) {
        if (usedSet) usedSet.add(formatted);
        return formatted;
      }
    }
    return 'X9K-2M4';
  }

  function normalizeEmail(raw) {
    const s = String(raw || '').trim().toLowerCase();
    if (s.length < 3 || s.length > 254) return '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return '';
    return s;
  }

  function makeId(prefix) {
    const rand = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    return prefix ? `${prefix}_${rand}` : rand;
  }

  function csvCell(val) {
    let s = val == null ? '' : String(val);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function safeSlug(raw, fallback) {
    const slug = String(raw || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
    return slug || fallback || 'export';
  }

  // ---------- Config / Mode
  function getApiBase() {
    try {
      if (typeof location !== 'undefined' && location.search) {
        const qs = new URLSearchParams(location.search);
        if (qs.get('demo') === '1') return '';
        if (qs.has('hwApi')) {
          const v = (qs.get('hwApi') || '').trim().replace(/\/+$/, '');
          if (!v || v.toLowerCase() === DEMO_SENTINEL) return '';
          return v;
        }
        if (qs.has('api')) {
          const v = (qs.get('api') || '').trim().replace(/\/+$/, '');
          if (!v || v.toLowerCase() === DEMO_SENTINEL) return '';
          return v;
        }
      }
    } catch { }
    if (typeof window !== 'undefined' && typeof window.HW_API_BASE === 'string') {
      const v = window.HW_API_BASE.trim().replace(/\/+$/, '');
      if (!v || v.toLowerCase() === DEMO_SENTINEL) return '';
      return v;
    }
    try {
      const stored = localStorage.getItem(LOCAL_API_KEY);
      if (stored !== null) {
        const v = stored.trim().replace(/\/+$/, '');
        if (v.toLowerCase() === DEMO_SENTINEL || v === LEGACY_WORKERS_BASE) {
          localStorage.removeItem(LOCAL_API_KEY);
        } else if (v) {
          return v;
        }
      }
    } catch { }
    return DEFAULT_API_BASE;
  }

  function normalizeServerUrl(url) {
    let clean = String(url == null ? '' : url).trim().replace(/\/+$/, '');
    if (!clean || clean.toLowerCase() === DEMO_SENTINEL) return '';
    if (!/^https?:\/\//i.test(clean)) {
      const isLocal = /^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(clean);
      clean = `${isLocal ? 'http' : 'https'}://${clean}`;
    }
    return clean;
  }

  function setApiBase(url) {
    const prevBase = getApiBase();
    const clean = normalizeServerUrl(url);
    try {
      if (!clean) localStorage.setItem(LOCAL_API_KEY, DEMO_SENTINEL);
      else if (clean === DEFAULT_API_BASE) localStorage.removeItem(LOCAL_API_KEY);
      else localStorage.setItem(LOCAL_API_KEY, clean);
    } catch { }
    const nextBase = getApiBase();
    if (nextBase !== prevBase) {
      clearSession();
      clearCache();
      capsByBase.delete(nextBase);
    }
    return nextBase;
  }

  function isDemoMode() {
    return !getApiBase();
  }

  function getDemoOffline() {
    try {
      return sessionStorage.getItem(DEMO_OFFLINE_KEY) === '1';
    } catch {
      return memDemoOffline;
    }
  }

  function setDemoOffline(flag) {
    memDemoOffline = !!flag;
    try {
      if (flag) sessionStorage.setItem(DEMO_OFFLINE_KEY, '1');
      else sessionStorage.removeItem(DEMO_OFFLINE_KEY);
    } catch { }
    return getDemoOffline();
  }

  function isOffline() {
    if (getDemoOffline()) return true;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
    return false;
  }

  const PUBLIC_SITE_BASE = 'https://app.rehearsalmusic.com/';

  function getPublicDocUrl(relPath) {
    const clean = String(relPath || '').replace(/^\/+/, '');
    if (!clean) return PUBLIC_SITE_BASE;
    try {
      const apiBase = getApiBase();
      const locHref = (typeof location !== 'undefined' && location.href) ? location.href : '';
      const isLoopback = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(locHref);
      if (!isDemoMode() && isLoopback && apiBase && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/i.test(apiBase)) {
        return new URL(clean, PUBLIC_SITE_BASE).href;
      }
      if (locHref) return new URL(clean, locHref).href;
    } catch { }
    return new URL(clean, PUBLIC_SITE_BASE).href;
  }

  function getStudentPortalUrl(joinCode) {
    let base = 'hw.html';
    try {
      const apiBase = getApiBase();
      const locHref = (typeof location !== 'undefined' && location.href) ? location.href : '';
      const isLoopback = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(locHref);
      if (!isDemoMode() && isLoopback && apiBase && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/i.test(apiBase)) {
        base = (typeof window !== 'undefined' && window.HW_STUDENT_PORTAL_URL) || 'https://app.rehearsalmusic.com/hw.html';
      } else if (locHref) {
        base = new URL('hw.html', locHref).href;
      }
    } catch { }
    if (joinCode) {
      const code = formatCode(joinCode) || String(joinCode).trim();
      if (code) {
        const sep = base.includes('?') ? '&' : '?';
        return `${base}${sep}code=${encodeURIComponent(code)}`;
      }
    }
    return base;
  }

  function buildPreviewPortalUrl(previewToken, { demo = false } = {}) {
    const base = getStudentPortalUrl('');
    try {
      const u = new URL(base, (typeof location !== 'undefined' && location.href) ? location.href : PUBLIC_SITE_BASE);
      u.searchParams.set('preview', String(previewToken || ''));
      if (demo) {
        u.searchParams.set('demo', '1');
      } else {
        const apiBase = getApiBase();
        if (apiBase && apiBase !== DEFAULT_API_BASE) {
          u.searchParams.set('api', apiBase);
        }
      }
      return u.href;
    } catch {
      const sep = base.includes('?') ? '&' : '?';
      return `${base}${sep}preview=${encodeURIComponent(String(previewToken || ''))}${demo ? '&demo=1' : ''}`;
    }
  }

  function triggerDownload(content, filename, mimeType) {
    try {
      const blob = content instanceof Blob
        ? content
        : new Blob([content], { type: mimeType || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || 'download';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        try { document.body.removeChild(a); } catch { }
        try { URL.revokeObjectURL(url); } catch { }
      }, 1000);
      return true;
    } catch {
      return false;
    }
  }

  // ---------- Auth / Session (isolated from localStorage['rehearsal'] & IndexedDB 'rehearsal-files')
  function getToken() {
    try {
      const sessTok = sessionStorage.getItem(TOKEN_KEY);
      if (sessTok) return sessTok;
    } catch { }
    try {
      return localStorage.getItem(TOKEN_KEY) || '';
    } catch {
      return '';
    }
  }

  function isEphemeral() {
    try {
      return !!sessionStorage.getItem(TOKEN_KEY);
    } catch {
      return false;
    }
  }

  function setSession(token, ephemeral) {
    try {
      if (!token) {
        clearSession();
        return;
      }
      if (ephemeral) {
        sessionStorage.setItem(TOKEN_KEY, token);
        localStorage.removeItem(TOKEN_KEY);
      } else {
        localStorage.setItem(TOKEN_KEY, token);
        sessionStorage.removeItem(TOKEN_KEY);
      }
    } catch { }
  }

  function clearSession() {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch { }
    try { localStorage.removeItem(TOKEN_KEY); } catch { }
  }

  // ---------- Offline Gradebook Cache
  function emptyCache() {
    return {
      updatedAt: null,
      me: null,
      classes: null,
      studentsByClass: {},
      assignmentsByClass: {},
      gradebookByClass: {},
      submissionsByAsgn: {},
    };
  }

  function loadCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return emptyCache();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return emptyCache();
      return {
        updatedAt: parsed.updatedAt || null,
        me: parsed.me || null,
        classes: Array.isArray(parsed.classes) ? parsed.classes : null,
        studentsByClass: parsed.studentsByClass || {},
        assignmentsByClass: parsed.assignmentsByClass || {},
        gradebookByClass: parsed.gradebookByClass || {},
        submissionsByAsgn: parsed.submissionsByAsgn || {},
      };
    } catch {
      return emptyCache();
    }
  }

  function saveCache(cache) {
    try {
      cache.updatedAt = Date.now();
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch { }
  }

  function clearCache() {
    try { localStorage.removeItem(CACHE_KEY); } catch { }
  }

  function getCacheInfo() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) {
        return {
          hasCache: false,
          updatedAt: null,
          classCount: 0,
          studentCount: 0,
          assignmentCount: 0,
          gradebookCount: 0,
          submissionListCount: 0,
          bytes: 0,
        };
      }
      const c = JSON.parse(raw);
      const classes = Array.isArray(c.classes) ? c.classes : [];
      const studentsByClass = c.studentsByClass || {};
      const assignmentsByClass = c.assignmentsByClass || {};
      const gradebookByClass = c.gradebookByClass || {};
      const submissionsByAsgn = c.submissionsByAsgn || {};
      let studentCount = 0;
      for (const cid of Object.keys(studentsByClass)) {
        studentCount += (studentsByClass[cid]?.students || []).length;
      }
      let assignmentCount = 0;
      for (const cid of Object.keys(assignmentsByClass)) {
        assignmentCount += (assignmentsByClass[cid]?.assignments || []).length;
      }
      return {
        hasCache: true,
        updatedAt: c.updatedAt || null,
        classCount: classes.length,
        studentCount,
        assignmentCount,
        gradebookCount: Object.keys(gradebookByClass).length,
        submissionListCount: Object.keys(submissionsByAsgn).length,
        bytes: raw.length,
      };
    } catch {
      return {
        hasCache: false,
        updatedAt: null,
        classCount: 0,
        studentCount: 0,
        assignmentCount: 0,
        gradebookCount: 0,
        submissionListCount: 0,
        bytes: 0,
      };
    }
  }

  function offlineErr(msg) {
    return {
      ok: false,
      offline: true,
      networkError: true,
      status: 0,
      code: 'OFFLINE',
      error: msg || 'You are offline. Connect to the internet to make changes.',
    };
  }

  // ---------- Client-side CSV Builder (used offline & in Demo Mode)
  function buildGradebookCsvString(gb, assignmentId, subsForAsgn) {
    const clsName = gb?.class?.name || 'gradebook';
    const students = gb?.students || [];
    const assignments = gb?.assignments || [];
    const lines = [];

    if (assignmentId) {
      const a = assignments.find(x => x.id === assignmentId);
      if (!a) return null;
      const subMap = new Map();
      if (Array.isArray(subsForAsgn)) {
        for (const s of subsForAsgn) {
          let arr = subMap.get(s.studentId);
          if (!arr) { arr = []; subMap.set(s.studentId, arr); }
          arr.push(s);
        }
      }
      lines.push(['Student', 'Part', 'Email', a.title, 'Attempts', 'Comment'].map(csvCell).join(','));
      for (const st of students) {
        const cell = (st.cells && st.cells[a.id]) || {};
        const score = cell.score !== undefined && cell.score !== null ? cell.score : '';
        const attempts = cell.attempts || 0;
        let comment = '';
        if (cell.submissionId && subMap.has(st.id)) {
          const match = subMap.get(st.id).find(x => x.id === cell.submissionId);
          if (match) comment = match.teacherComment || '';
        }
        lines.push([
          st.displayName || '',
          st.part || '',
          st.email || '',
          score,
          attempts,
          comment,
        ].map(csvCell).join(','));
      }
    } else {
      lines.push([
        'Student', 'Part', 'Email', ...assignments.map(a => a.title), 'Average (%)',
      ].map(csvCell).join(','));
      for (const st of students) {
        const rowScores = assignments.map(a => {
          const cell = (st.cells && st.cells[a.id]) || {};
          return cell.score !== undefined && cell.score !== null ? cell.score : '';
        });
        const avg = st.averagePct !== undefined && st.averagePct !== null ? st.averagePct : '';
        lines.push([
          st.displayName || '',
          st.part || '',
          st.email || '',
          ...rowScores,
          avg,
        ].map(csvCell).join(','));
      }
    }

    const safeName = (clsName || 'gradebook')
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'gradebook';

    return {
      csv: `${lines.join('\r\n')}\r\n`,
      filename: `${safeName}-gradebook.csv`,
    };
  }

  // ---------- Live Fetch Helper
  async function liveFetch(path, { method = 'GET', json = undefined, formData = undefined, auth = true, responseType = 'json' } = {}) {
    if (isOffline()) {
      return offlineErr('Offline mode is active. Connect to the internet to reach the homework server.');
    }
    const base = getApiBase();
    const headers = {};
    if (auth) {
      const tok = getToken();
      if (tok) headers.Authorization = `Bearer ${tok}`;
    }
    let body;
    if (formData) {
      // Never set Content-Type manually for FormData; browser sets multipart boundary.
      body = formData;
    } else if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    }

    let res;
    try {
      res = await fetch(`${base}${path}`, { method, headers, body });
    } catch {
      return {
        ok: false,
        networkError: true,
        offline: true,
        status: 0,
        code: 'NETWORK_ERROR',
        error: 'Could not reach the homework server. Check your connection.',
      };
    }

    if (responseType === 'text' || responseType === 'blob') {
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        return {
          ok: false,
          status: res.status,
          code: errData.code || 'HTTP_ERROR',
          error: errData.error || `Request failed (${res.status})`,
        };
      }
      const disp = res.headers.get('content-disposition') || '';
      const fnMatch = disp.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
      const filename = fnMatch ? decodeURIComponent(fnMatch[1]) : '';
      if (responseType === 'text') {
        const text = await res.text();
        return { ok: true, status: res.status, text, filename };
      }
      const blob = await res.blob();
      return {
        ok: true,
        status: res.status,
        blob,
        mime: blob.type || res.headers.get('content-type') || 'application/octet-stream',
        filename,
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
        plan: data.plan,
      };
    }
    return { ok: true, status: res.status, ...data };
  }

  // ---------- Synthesized 5-Note C-Major Scale PCM WAV Generator (for Local Preview Audio)
  function createScaleWavBlob() {
    const sampleRate = 22050;
    const freqs = [261.63, 293.66, 329.63, 349.23, 392.00]; // C4 D4 E4 F4 G4
    const noteSec = 0.42;
    const noteSamples = Math.floor(sampleRate * noteSec);
    const totalSamples = noteSamples * freqs.length;
    const dataBytes = totalSamples * 2;
    const buffer = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(buffer);

    function writeAscii(offset, str) {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    }

    writeAscii(0, 'RIFF');
    view.setUint32(4, 36 + dataBytes, true);
    writeAscii(8, 'WAVE');
    writeAscii(12, 'fmt ');
    view.setUint32(16, 16, true);       // PCM chunk size
    view.setUint16(20, 1, true);        // PCM format
    view.setUint16(22, 1, true);        // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeAscii(36, 'data');
    view.setUint32(40, dataBytes, true);

    const fadeSamples = Math.floor(sampleRate * 0.025);
    let offset = 44;
    for (let n = 0; n < freqs.length; n++) {
      const f = freqs[n];
      for (let i = 0; i < noteSamples; i++) {
        let env = 1;
        if (i < fadeSamples) env = i / fadeSamples;
        else if (i > noteSamples - fadeSamples) env = (noteSamples - i) / fadeSamples;
        const t = i / sampleRate;
        const sig =
          0.75 * Math.sin(2 * Math.PI * f * t) +
          0.18 * Math.sin(2 * Math.PI * f * 2 * t) +
          0.07 * Math.sin(2 * Math.PI * f * 3 * t);
        const sample = Math.max(-1, Math.min(1, sig * env * 0.42));
        view.setInt16(offset, Math.round(sample * 32767), true);
        offset += 2;
      }
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }

  // ---------- Rich Local Preview Mode (persisted in localStorage['rehearsal-hw-teacher-demo-v1'])
  function computeDemoPlan(teacher, now) {
    const t = teacher || {};
    const status = t.planStatus || 'trialing';
    const softCap = Number(t.studentSoftCap || DEFAULT_SOFT_CAP);

    if (status === 'trialing') {
      const endsAt = Number(t.trialEndsAt || (now + 24 * DAY_MS));
      if (endsAt > now) {
        return {
          status: 'trialing',
          canWrite: true,
          readOnly: false,
          inGrace: false,
          trialEndsAt: endsAt,
          daysLeft: Math.max(1, Math.ceil((endsAt - now) / DAY_MS)),
          studentSoftCap: softCap,
        };
      }
      return {
        status: 'expired',
        canWrite: false,
        readOnly: true,
        inGrace: false,
        trialEndsAt: endsAt,
        daysLeft: 0,
        studentSoftCap: softCap,
        reason: 'Your 30-day free trial has ended. Your gradebook is in read-only mode — upgrade to create new assignments or accept submissions.',
      };
    }

    if (status === 'active' || status === 'po_active') {
      const endsAt = t.planEndsAt ? Number(t.planEndsAt) : null;
      return {
        status,
        canWrite: true,
        readOnly: false,
        inGrace: false,
        planEndsAt: endsAt,
        poReference: t.poReference || null,
        daysLeft: endsAt ? Math.max(1, Math.ceil((endsAt - now) / DAY_MS)) : null,
        studentSoftCap: softCap,
      };
    }

    if (status === 'past_due') {
      const graceEnds = Number(t.graceEndsAt || (now + 4 * DAY_MS));
      if (graceEnds > now) {
        const graceDaysLeft = Math.max(1, Math.ceil((graceEnds - now) / DAY_MS));
        return {
          status: 'past_due',
          canWrite: true,
          readOnly: false,
          inGrace: true,
          graceEndsAt: graceEnds,
          graceDaysLeft,
          studentSoftCap: softCap,
          warning: `Payment issue — ${graceDaysLeft} day${graceDaysLeft === 1 ? '' : 's'} left in your grace period. Update billing to avoid read-only mode.`,
        };
      }
      return {
        status: 'expired',
        canWrite: false,
        readOnly: true,
        inGrace: false,
        graceEndsAt: graceEnds,
        daysLeft: 0,
        studentSoftCap: softCap,
        reason: 'Your payment grace period ended. Your gradebook is in read-only mode until billing is updated.',
      };
    }

    return {
      status: status === 'canceled' ? 'canceled' : 'expired',
      canWrite: false,
      readOnly: true,
      inGrace: false,
      daysLeft: 0,
      studentSoftCap: softCap,
      reason: status === 'canceled'
        ? 'Your plan is inactive. You can still view grades, play saved audio, export CSVs, and delete data.'
        : 'Your 30-day free trial has ended. Your gradebook is in read-only mode — upgrade to create new assignments or accept submissions.',
    };
  }

  function createDemoSightExcerpts() {
    const H = { id: 'h', ev: [['h', 2]] };
    const Q = { id: 'q', ev: [['q', 1]] };
    const W = { id: 'w', ev: [['w', 4]] };
    const EE = { id: 'ee', ev: [['8', 0.5], ['8', 0.5]] };
    const QR = { id: 'qr', ev: [['q', 1, 1]] };
    const HR = { id: 'hr', ev: [['h', 2, 1]] };
    return {
      solfegeEx: {
        solfege: {
          rhythm: [[H, H], [Q, Q, H], [H, H], [W]],
          pitches: [0, 1, 2, 3, 4, 3, 2, 0],
        },
      },
      rhythmEx: {
        rhythm: [[Q, QR, H], [Q, EE, H], [H, HR], [W]],
      },
    };
  }

  function buildDemoNotes(statuses) {
    const pitches = ['C4', 'D4', 'E4', 'F4', 'G4', 'F4', 'E4', 'C4'];
    const bars = [1, 1, 2, 2, 2, 3, 3, 4];
    const wrongNames = ['D4', 'F#4', 'F4', 'E4', 'A4', 'G4', 'D4', 'D4'];
    return statuses.map((st, i) => {
      const bar = bars[i] || (Math.floor(i / 4) + 1);
      const idx = i;
      const pitch = pitches[i % pitches.length];
      let cents = 4;
      let errMs = 18;
      let sungAs = null;
      if (st === 'timing') {
        cents = 9;
        errMs = i % 2 === 0 ? 128 : -118;
      } else if (st === 'pitch') {
        cents = i % 2 === 0 ? 58 : -54;
        errMs = 22;
        sungAs = wrongNames[i % wrongNames.length];
      } else if (st === 'wrong') {
        cents = 145;
        errMs = 95;
        sungAs = wrongNames[i % wrongNames.length];
      } else if (st === 'missed') {
        cents = null;
        errMs = null;
      }
      const out = { bar, idx, status: st, pitch, cents, errMs };
      if (sungAs) out.sungAs = sungAs;
      return out;
    });
  }

  function makeDemoResultPayload(notes, inputMode, rmsPeak, expectsPitch) {
    const total = notes.length;
    const rOk = notes.filter(n => n.status === 'ok' || n.status === 'pitch').length;
    const rHalf = notes.filter(n => n.status === 'timing').length;
    const rhythmPct = Math.max(0, Math.min(100, Math.round(((rOk + 0.5 * rHalf) / total) * 100)));
    let pitchPct = null;
    let overallPct = rhythmPct;
    if (expectsPitch) {
      const pOk = notes.filter(n => n.status === 'ok').length;
      pitchPct = Math.max(0, Math.min(100, Math.round((pOk / total) * 100)));
      overallPct = Math.max(0, Math.min(100, Math.round((rhythmPct + pitchPct) / 2)));
    }
    return {
      overallPct,
      rhythmPct,
      pitchPct,
      resultsJson: {
        serverOverallPct: overallPct,
        serverRhythmPct: rhythmPct,
        serverPitchPct: pitchPct,
        expectsPitch,
        engineRhythmPct: rhythmPct,
        enginePitchPct: pitchPct,
        strictness: { rhythm: 50, pitch: 50 },
        offsetMs: 14,
        driftCents: 6,
        extra: 0,
        rmsPeak,
        inputMode,
        noteCount: total,
        notes,
      },
    };
  }

  function createFreshDemoDb() {
    const now = Date.now();
    const clsId = 'cls_demo_1';

    const n1 = makeDemoResultPayload(
      buildDemoNotes(['ok', 'ok', 'timing', 'ok', 'ok', 'ok', 'ok', 'ok']),
      'mic_pitch_rhythm', 0.24, true
    );
    const n2 = makeDemoResultPayload(
      buildDemoNotes(['ok', 'pitch', 'ok', 'timing', 'ok', 'ok', 'missed', 'ok']),
      'mic_pitch_rhythm', 0.19, true
    );
    const n3 = makeDemoResultPayload(
      buildDemoNotes(['ok', 'ok', 'ok', 'ok', 'timing', 'ok', 'ok', 'ok']),
      'mic_pitch_rhythm', 0.004, true
    );
    const n4 = makeDemoResultPayload(
      buildDemoNotes(['ok', 'wrong', 'timing', 'missed', 'pitch', 'ok', 'timing', 'missed']),
      'mic_pitch_rhythm', 0.14, true
    );
    const n5 = makeDemoResultPayload(
      buildDemoNotes(['ok', 'ok', 'ok', 'timing', 'ok', 'ok', 'ok', 'ok']),
      'tap', 0, false
    );
    const n6 = makeDemoResultPayload(
      buildDemoNotes(['ok', 'timing', 'ok', 'timing', 'ok', 'ok', 'timing', 'ok']),
      'tap', 0, false
    );
    const n7 = makeDemoResultPayload(
      buildDemoNotes(['ok', 'ok', 'pitch', 'ok', 'ok', 'ok', 'ok', 'timing']),
      'mic_pitch_rhythm', 0.28, true
    );
    const n8 = makeDemoResultPayload(
      buildDemoNotes(['ok', 'pitch', 'timing', 'wrong', 'ok', 'pitch', 'ok', 'ok']),
      'mic_pitch_rhythm', 0.21, true
    );

    return {
      teacher: {
        id: 'tch_demo_rivera',
        email: 'ms.rivera@oakridge.edu',
        name: 'Ms. Rivera',
        hasGoogle: true,
        planStatus: 'trialing',
        trialEndsAt: now + 24 * DAY_MS,
        planEndsAt: null,
        graceEndsAt: null,
        studentSoftCap: DEFAULT_SOFT_CAP,
        poReference: null,
        createdAt: now - 6 * DAY_MS,
      },
      pendingEmailCodes: {},
      sessions: {},
      classes: [
        {
          id: clsId,
          name: 'Concert Choir — Period 2',
          joinCode: 'K7M-4P2',
          locked: false,
          archivedAt: null,
          createdAt: now - 6 * DAY_MS,
          updatedAt: now - DAY_MS,
        },
      ],
      students: [
        {
          id: 'stu_maya',
          classId: clsId,
          displayName: 'Maya Lin',
          email: 'maya.lin@oakridge.edu',
          part: 'Soprano',
          hasGoogle: true,
          hasCode: true,
          codePlain: 'H7P-9KM',
          codeLocked: false,
          codeCooldownUntil: null,
          archivedAt: null,
          lastActiveAt: now - 3 * 60 * 60 * 1000,
          createdAt: now - 5 * DAY_MS,
          updatedAt: now - 3 * 60 * 60 * 1000,
        },
        {
          id: 'stu_jordan',
          classId: clsId,
          displayName: 'Jordan Ortiz',
          email: 'jordan.ortiz@oakridge.edu',
          part: 'Tenor',
          hasGoogle: false,
          hasCode: true,
          codePlain: 'M4R-8TX',
          codeLocked: false,
          codeCooldownUntil: null,
          archivedAt: null,
          lastActiveAt: now - 5 * 60 * 60 * 1000,
          createdAt: now - 5 * DAY_MS,
          updatedAt: now - 5 * 60 * 60 * 1000,
        },
        {
          id: 'stu_priya',
          classId: clsId,
          displayName: 'Priya Patel',
          email: 'priya.patel@oakridge.edu',
          part: 'Alto',
          hasGoogle: true,
          hasCode: true,
          codePlain: 'P9W-3KN',
          codeLocked: false,
          codeCooldownUntil: null,
          archivedAt: null,
          lastActiveAt: now - 8 * 60 * 60 * 1000,
          createdAt: now - 5 * DAY_MS,
          updatedAt: now - 8 * 60 * 60 * 1000,
        },
        {
          id: 'stu_devon',
          classId: clsId,
          displayName: 'Devon Brooks',
          email: 'devon.brooks@oakridge.edu',
          part: 'Bass',
          hasGoogle: false,
          hasCode: true,
          codePlain: 'C6V-2YF',
          codeLocked: true,
          codeCooldownUntil: null,
          archivedAt: null,
          lastActiveAt: now - 2 * DAY_MS,
          createdAt: now - 5 * DAY_MS,
          updatedAt: now - DAY_MS,
        },
      ],
      assignments: [
        {
          id: 'asgn_true_sr',
          classId: clsId,
          title: 'True Sight-Reading Check #1',
          instructions: 'Study the 4-measure melody during the 30-second countdown. Your microphone starts automatically at 0:00.',
          type: 'sight',
          mode: 'true_sight_read',
          config: {
            studySeconds: 30,
            countingSystem: 'numbers',
            strictness: { rhythm: 50, pitch: 50 },
            srState: {
              mode: 'solfege',
              show: false,
              showCounts: false,
              playhead: 'beat',
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
              ex: createDemoSightExcerpts().solfegeEx,
            },
          },
          hasScoreFile: false,
          scoreFilename: null,
          scoreBytes: 0,
          dueAt: now + 3 * DAY_MS,
          maxAttempts: 1,
          gradePolicy: 'best',
          published: true,
          archivedAt: null,
          createdAt: now - 4 * DAY_MS,
          updatedAt: now - 4 * DAY_MS,
        },
        {
          id: 'asgn_rhythm_drill',
          classId: clsId,
          title: 'Rhythm Tap Drill',
          instructions: 'Practice quarter and eighth-note patterns using Spacebar or Tap. Up to 3 attempts.',
          type: 'sight',
          mode: 'practice',
          config: {
            studySeconds: 0,
            countingSystem: 'numbers',
            strictness: { rhythm: 50, pitch: 50 },
            srState: {
              mode: 'rhythm',
              show: true,
              showCounts: true,
              playhead: 'beat',
              rhythm: {
                ts: '4/4',
                measures: 4,
                tempo: 84,
                metronome: true,
                measureNums: true,
                sound: 'clap',
                cells: ['q', 'h', 'ee', 'qr', 'hr', 'w'],
                showCounts: true,
              },
              ex: createDemoSightExcerpts().rhythmEx,
            },
          },
          hasScoreFile: false,
          scoreFilename: null,
          scoreBytes: 0,
          dueAt: now + 5 * DAY_MS,
          maxAttempts: 3,
          gradePolicy: 'best',
          published: true,
          archivedAt: null,
          createdAt: now - 3 * DAY_MS,
          updatedAt: now - 3 * DAY_MS,
        },
        {
          id: 'asgn_score_vocal',
          classId: clsId,
          title: 'Vocal Part Check-In',
          instructions: 'Select your voice part, take your starting pitch, and record measures 1–8 into the microphone.',
          type: 'score',
          mode: 'practice',
          config: {
            gradeMode: 'mic',
            countingSystem: 'numbers',
            strictness: { rhythm: 50, pitch: 50 },
            spState: {
              name: 'Vocal Part Check-In',
              gradeMode: 'mic',
              tempo: 84,
              solfege: false,
              counts: false,
              focus: 0,
              zoom: 0.85,
            },
          },
          hasScoreFile: true,
          scoreFilename: 'Vocal-Part-Check-In.musicxml',
          scoreBytes: 18420,
          dueAt: now + 7 * DAY_MS,
          maxAttempts: null,
          gradePolicy: 'best',
          published: true,
          archivedAt: null,
          createdAt: now - 2 * DAY_MS,
          updatedAt: now - 2 * DAY_MS,
        },
        {
          id: 'asgn_audio_scale',
          classId: clsId,
          title: '5-Note Major Scale Warm-Up',
          instructions: 'Sing do-re-mi-fa-sol on "ah" with steady breath support after the count-in.',
          type: 'audio',
          mode: 'practice',
          config: {
            countIn: true,
            bpm: 84,
            prompt: 'Sing a 5-note C-major scale (do-re-mi-fa-sol) on "ah" after the 4-beat count-in.',
            strictness: { rhythm: 50, pitch: 50 },
          },
          hasScoreFile: false,
          scoreFilename: null,
          scoreBytes: 0,
          dueAt: now + 4 * DAY_MS,
          maxAttempts: 3,
          gradePolicy: 'last',
          published: true,
          archivedAt: null,
          createdAt: now - DAY_MS,
          updatedAt: now - DAY_MS,
        },
      ],
      submissions: [
        // Maya Lin — True Sight-Read (clean high score)
        {
          id: 'sub_maya_sr_1',
          assignmentId: 'asgn_true_sr',
          classId: clsId,
          studentId: 'stu_maya',
          attemptNum: 1,
          attemptStartId: 'att_demo_1',
          overallPct: n1.overallPct,
          rhythmPct: n1.rhythmPct,
          pitchPct: n1.pitchPct,
          resultsJson: n1.resultsJson,
          integrityFlags: [],
          durationSec: 12.4,
          expectedSec: 12.0,
          audioAvailable: true,
          audioMime: 'audio/wav',
          audioBytes: 88244,
          audioExpiresAt: now + 87 * DAY_MS,
          audioDeletedAt: null,
          teacherOverridePct: null,
          teacherComment: '',
          gradedAt: null,
          submittedAt: now - 2 * DAY_MS,
        },
        // Priya Patel — True Sight-Read (good score)
        {
          id: 'sub_priya_sr_1',
          assignmentId: 'asgn_true_sr',
          classId: clsId,
          studentId: 'stu_priya',
          attemptNum: 1,
          attemptStartId: 'att_demo_2',
          overallPct: n2.overallPct,
          rhythmPct: n2.rhythmPct,
          pitchPct: n2.pitchPct,
          resultsJson: n2.resultsJson,
          integrityFlags: [],
          durationSec: 11.8,
          expectedSec: 12.0,
          audioAvailable: true,
          audioMime: 'audio/wav',
          audioBytes: 88244,
          audioExpiresAt: now + 88 * DAY_MS,
          audioDeletedAt: null,
          teacherOverridePct: null,
          teacherComment: 'Nice pitch center on measure 2!',
          gradedAt: now - DAY_MS,
          submittedAt: now - DAY_MS - 3600000,
        },
        // Jordan Ortiz — True Sight-Read (amber flags: low_rms_high_score & true_sight_read_overtime)
        {
          id: 'sub_jordan_sr_1',
          assignmentId: 'asgn_true_sr',
          classId: clsId,
          studentId: 'stu_jordan',
          attemptNum: 1,
          attemptStartId: 'att_demo_3',
          overallPct: n3.overallPct,
          rhythmPct: n3.rhythmPct,
          pitchPct: n3.pitchPct,
          resultsJson: n3.resultsJson,
          integrityFlags: ['low_rms_high_score', 'true_sight_read_overtime'],
          durationSec: 12.1,
          expectedSec: 12.0,
          audioAvailable: true,
          audioMime: 'audio/wav',
          audioBytes: 88244,
          audioExpiresAt: now + 88 * DAY_MS,
          audioDeletedAt: null,
          teacherOverridePct: null,
          teacherComment: '',
          gradedAt: null,
          submittedAt: now - 20 * 3600 * 1000,
        },
        // Devon Brooks — True Sight-Read (needs practice, low score)
        {
          id: 'sub_devon_sr_1',
          assignmentId: 'asgn_true_sr',
          classId: clsId,
          studentId: 'stu_devon',
          attemptNum: 1,
          attemptStartId: 'att_demo_4',
          overallPct: n4.overallPct,
          rhythmPct: n4.rhythmPct,
          pitchPct: n4.pitchPct,
          resultsJson: n4.resultsJson,
          integrityFlags: [],
          durationSec: 11.2,
          expectedSec: 12.0,
          audioAvailable: true,
          audioMime: 'audio/wav',
          audioBytes: 88244,
          audioExpiresAt: now + 86 * DAY_MS,
          audioDeletedAt: null,
          teacherOverridePct: null,
          teacherComment: 'Let us review measures 1–2 together before Friday.',
          gradedAt: now - DAY_MS,
          submittedAt: now - 2 * DAY_MS,
        },
        // Maya Lin — Rhythm Tap Drill (2 attempts showing improvement)
        {
          id: 'sub_maya_rhy_1',
          assignmentId: 'asgn_rhythm_drill',
          classId: clsId,
          studentId: 'stu_maya',
          attemptNum: 1,
          attemptStartId: null,
          overallPct: n6.overallPct,
          rhythmPct: n6.rhythmPct,
          pitchPct: null,
          resultsJson: n6.resultsJson,
          integrityFlags: [],
          durationSec: 11.4,
          expectedSec: 11.4,
          audioAvailable: false,
          audioMime: null,
          audioBytes: 0,
          audioExpiresAt: null,
          audioDeletedAt: null,
          teacherOverridePct: null,
          teacherComment: '',
          gradedAt: null,
          submittedAt: now - 2 * DAY_MS,
        },
        {
          id: 'sub_maya_rhy_2',
          assignmentId: 'asgn_rhythm_drill',
          classId: clsId,
          studentId: 'stu_maya',
          attemptNum: 2,
          attemptStartId: null,
          overallPct: n5.overallPct,
          rhythmPct: n5.rhythmPct,
          pitchPct: null,
          resultsJson: n5.resultsJson,
          integrityFlags: [],
          durationSec: 11.5,
          expectedSec: 11.4,
          audioAvailable: false,
          audioMime: null,
          audioBytes: 0,
          audioExpiresAt: null,
          audioDeletedAt: null,
          teacherOverridePct: null,
          teacherComment: 'Solid subdivision on beat 3!',
          gradedAt: now - DAY_MS,
          submittedAt: now - DAY_MS - 7200000,
        },
        // Jordan Ortiz — Rhythm Tap Drill
        {
          id: 'sub_jordan_rhy_1',
          assignmentId: 'asgn_rhythm_drill',
          classId: clsId,
          studentId: 'stu_jordan',
          attemptNum: 1,
          attemptStartId: null,
          overallPct: n6.overallPct,
          rhythmPct: n6.rhythmPct,
          pitchPct: null,
          resultsJson: n6.resultsJson,
          integrityFlags: [],
          durationSec: 11.1,
          expectedSec: 11.4,
          audioAvailable: false,
          audioMime: null,
          audioBytes: 0,
          audioExpiresAt: null,
          audioDeletedAt: null,
          teacherOverridePct: null,
          teacherComment: '',
          gradedAt: null,
          submittedAt: now - 18 * 3600 * 1000,
        },
        // Maya Lin — Vocal Part Check-In (2 attempts)
        {
          id: 'sub_maya_score_1',
          assignmentId: 'asgn_score_vocal',
          classId: clsId,
          studentId: 'stu_maya',
          attemptNum: 1,
          attemptStartId: null,
          overallPct: n8.overallPct,
          rhythmPct: n8.rhythmPct,
          pitchPct: n8.pitchPct,
          resultsJson: n8.resultsJson,
          integrityFlags: [],
          durationSec: 16.0,
          expectedSec: 16.0,
          audioAvailable: true,
          audioMime: 'audio/wav',
          audioBytes: 88244,
          audioExpiresAt: now + 89 * DAY_MS,
          audioDeletedAt: null,
          teacherOverridePct: null,
          teacherComment: '',
          gradedAt: null,
          submittedAt: now - 16 * 3600 * 1000,
        },
        {
          id: 'sub_maya_score_2',
          assignmentId: 'asgn_score_vocal',
          classId: clsId,
          studentId: 'stu_maya',
          attemptNum: 2,
          attemptStartId: null,
          overallPct: n7.overallPct,
          rhythmPct: n7.rhythmPct,
          pitchPct: n7.pitchPct,
          resultsJson: n7.resultsJson,
          integrityFlags: [],
          durationSec: 16.2,
          expectedSec: 16.0,
          audioAvailable: true,
          audioMime: 'audio/wav',
          audioBytes: 88244,
          audioExpiresAt: now + 89 * DAY_MS,
          audioDeletedAt: null,
          teacherOverridePct: null,
          teacherComment: '',
          gradedAt: null,
          submittedAt: now - 14 * 3600 * 1000,
        },
        // Priya Patel — Vocal Part Check-In
        {
          id: 'sub_priya_score_1',
          assignmentId: 'asgn_score_vocal',
          classId: clsId,
          studentId: 'stu_priya',
          attemptNum: 1,
          attemptStartId: null,
          overallPct: n2.overallPct,
          rhythmPct: n2.rhythmPct,
          pitchPct: n2.pitchPct,
          resultsJson: n2.resultsJson,
          integrityFlags: [],
          durationSec: 15.6,
          expectedSec: 16.0,
          audioAvailable: true,
          audioMime: 'audio/wav',
          audioBytes: 88244,
          audioExpiresAt: now + 89 * DAY_MS,
          audioDeletedAt: null,
          teacherOverridePct: null,
          teacherComment: '',
          gradedAt: null,
          submittedAt: now - 10 * 3600 * 1000,
        },
        // Priya Patel — 5-Note Major Scale Warm-Up (UNGRADED audio-only submission)
        {
          id: 'sub_priya_audio_1',
          assignmentId: 'asgn_audio_scale',
          classId: clsId,
          studentId: 'stu_priya',
          attemptNum: 1,
          attemptStartId: null,
          overallPct: null,
          rhythmPct: null,
          pitchPct: null,
          resultsJson: null,
          integrityFlags: [],
          durationSec: 2.1,
          expectedSec: null,
          audioAvailable: true,
          audioMime: 'audio/wav',
          audioBytes: 88244,
          audioExpiresAt: now + 89 * DAY_MS,
          audioDeletedAt: null,
          teacherOverridePct: null,
          teacherComment: '',
          gradedAt: null,
          submittedAt: now - 6 * 3600 * 1000,
        },
        // Maya Lin — 5-Note Major Scale Warm-Up (teacher-graded audio submission)
        {
          id: 'sub_maya_audio_1',
          assignmentId: 'asgn_audio_scale',
          classId: clsId,
          studentId: 'stu_maya',
          attemptNum: 1,
          attemptStartId: null,
          overallPct: null,
          rhythmPct: null,
          pitchPct: null,
          resultsJson: null,
          integrityFlags: [],
          durationSec: 2.1,
          expectedSec: null,
          audioAvailable: true,
          audioMime: 'audio/wav',
          audioBytes: 88244,
          audioExpiresAt: now + 89 * DAY_MS,
          audioDeletedAt: null,
          teacherOverridePct: 95,
          teacherComment: 'Warm, centered tone on "ah"!',
          gradedAt: now - 2 * 3600 * 1000,
          submittedAt: now - 5 * 3600 * 1000,
        },
      ],
    };
  }

  function backfillDemoExcerpts(db) {
    if (!db || !Array.isArray(db.assignments)) return false;
    let changed = false;
    const { solfegeEx, rhythmEx } = createDemoSightExcerpts();
    for (const a of db.assignments) {
      const sr = a?.config?.srState;
      if (a.id === 'asgn_true_sr' && sr && (!sr.ex || !sr.ex.solfege)) {
        sr.ex = clone(solfegeEx);
        changed = true;
      } else if (a.id === 'asgn_rhythm_drill' && sr && (!sr.ex || !sr.ex.rhythm)) {
        sr.ex = clone(rhythmEx);
        changed = true;
      }
    }
    return changed;
  }

  function loadDemoDb() {
    if (memDemoDb) return memDemoDb;
    try {
      const raw = localStorage.getItem(DEMO_DB_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.teacher && Array.isArray(parsed.classes) && Array.isArray(parsed.assignments)) {
          memDemoDb = parsed;
          if (backfillDemoExcerpts(memDemoDb)) saveDemoDb();
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
    try { localStorage.setItem(DEMO_DB_KEY, JSON.stringify(memDemoDb)); } catch { }
  }

  function demoErr(status, code, error, extra) {
    return { ok: false, status, code, error, ...(extra || {}) };
  }

  function formatDemoTeacherPublic(db) {
    const t = db.teacher;
    const plan = computeDemoPlan(t, Date.now());
    return {
      id: t.id,
      email: t.email,
      name: t.name || '',
      hasGoogle: !!t.hasGoogle,
      plan,
      createdAt: t.createdAt,
    };
  }

  function demoAuth(db) {
    const tok = getToken();
    if (!tok) return null;
    const sess = db.sessions && db.sessions[tok];
    if (!sess || sess.expiresAt <= Date.now()) {
      if (sess) {
        delete db.sessions[tok];
        saveDemoDb();
      }
      return null;
    }
    return { token: tok, sess, teacher: db.teacher, plan: computeDemoPlan(db.teacher, Date.now()) };
  }

  function assertDemoWritable(auth) {
    if (auth.plan.canWrite) return null;
    return demoErr(
      402,
      'PLAN_READ_ONLY',
      auth.plan.reason || 'Your Online Homework plan is in read-only mode.',
      { plan: auth.plan }
    );
  }

  function demoEffectiveScore(sub) {
    if (sub.teacherOverridePct !== null && sub.teacherOverridePct !== undefined) {
      return Number(sub.teacherOverridePct);
    }
    if (sub.overallPct !== null && sub.overallPct !== undefined) {
      return Number(sub.overallPct);
    }
    return null;
  }

  function demoPickGraded(subs, policy) {
    if (!subs || !subs.length) return null;
    if (policy === 'last') return subs[subs.length - 1];
    let best = null;
    let bestScore = -1;
    for (const s of subs) {
      const sc = demoEffectiveScore(s);
      if (sc !== null && sc >= bestScore) {
        bestScore = sc;
        best = s;
      }
    }
    return best || subs[subs.length - 1];
  }

  function demoFormatClass(db, c) {
    const studentCount = db.students.filter(s => s.classId === c.id && !s.archivedAt).length;
    const assignmentCount = db.assignments.filter(a => a.classId === c.id && !a.archivedAt).length;
    const submissionCount = db.submissions.filter(sub => sub.classId === c.id).length;
    return {
      id: c.id,
      name: c.name,
      joinCode: c.joinCode,
      locked: !!c.locked,
      archivedAt: c.archivedAt ?? null,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      studentCount,
      assignmentCount,
      submissionCount,
    };
  }

  function demoFormatStudent(db, s) {
    const subs = db.submissions.filter(sub => sub.studentId === s.id);
    const maxSubAt = subs.reduce((m, x) => Math.max(m, x.submittedAt || 0), 0) || null;
    const lastActiveAt = s.lastActiveAt && maxSubAt
      ? Math.max(s.lastActiveAt, maxSubAt)
      : (s.lastActiveAt || maxSubAt || null);
    return {
      id: s.id,
      displayName: s.displayName,
      email: s.email || null,
      part: s.part || '',
      hasGoogle: !!s.hasGoogle,
      hasCode: !!s.hasCode,
      codeLocked: !!s.codeLocked,
      codeCooldownUntil: s.codeCooldownUntil && s.codeCooldownUntil > Date.now() ? s.codeCooldownUntil : null,
      archivedAt: s.archivedAt ?? null,
      submissionCount: subs.length,
      lastActiveAt,
    };
  }

  function demoFormatAssignment(db, a, includeStats) {
    const out = {
      id: a.id,
      classId: a.classId,
      title: a.title,
      instructions: a.instructions || '',
      type: a.type,
      mode: a.mode,
      config: clone(a.config || {}),
      hasScoreFile: !!a.hasScoreFile,
      scoreFilename: a.scoreFilename || null,
      scoreBytes: Number(a.scoreBytes || 0),
      dueAt: a.dueAt ?? null,
      maxAttempts: a.maxAttempts ?? null,
      gradePolicy: a.gradePolicy || 'best',
      published: !!a.published,
      archivedAt: a.archivedAt ?? null,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    };
    if (includeStats) {
      const subs = db.submissions.filter(s => s.assignmentId === a.id);
      const uniqueIds = new Set(subs.map(s => s.studentId));
      const scored = subs.map(demoEffectiveScore).filter(v => v !== null);
      out.submissionCount = subs.length;
      out.uniqueStudentCount = uniqueIds.size;
      out.avgPct = scored.length ? Math.round(scored.reduce((acc, v) => acc + v, 0) / scored.length) : null;
    }
    return out;
  }

  function demoBuildGradebook(db, classId) {
    const cls = db.classes.find(c => c.id === classId);
    if (!cls) return null;
    const now = Date.now();

    const students = db.students
      .filter(s => s.classId === classId && !s.archivedAt)
      .sort((a, b) => a.displayName.toLowerCase().localeCompare(b.displayName.toLowerCase()));

    const assignments = db.assignments
      .filter(a => a.classId === classId && !a.archivedAt)
      .sort((a, b) => ((a.dueAt || a.createdAt) - (b.dueAt || b.createdAt)) || (a.createdAt - b.createdAt));

    const subs = db.submissions
      .filter(s => s.classId === classId)
      .sort((a, b) => (a.submittedAt - b.submittedAt) || (a.attemptNum - b.attemptNum));

    const byPair = new Map();
    for (const s of subs) {
      const key = `${s.studentId}:${s.assignmentId}`;
      let arr = byPair.get(key);
      if (!arr) { arr = []; byPair.set(key, arr); }
      arr.push(s);
    }

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
        const chosen = demoPickGraded(list, a.gradePolicy);
        const score = demoEffectiveScore(chosen);
        if (score !== null) {
          scoreSum += score;
          scoreCount++;
        }
        const hasFlags = list.some(x => (x.integrityFlags || []).length > 0);
        const chosenFlags = chosen.integrityFlags || [];
        const audioAvailable = !!(
          chosen.audioAvailable &&
          !chosen.audioDeletedAt &&
          (!chosen.audioExpiresAt || chosen.audioExpiresAt > now)
        );
        cells[a.id] = {
          status: score === null ? 'submitted' : 'graded',
          score,
          overallPct: chosen.overallPct,
          rhythmPct: chosen.rhythmPct,
          pitchPct: chosen.pitchPct,
          teacherOverridePct: chosen.teacherOverridePct,
          overridden: chosen.teacherOverridePct !== null && chosen.teacherOverridePct !== undefined,
          attempts: list.length,
          hasFlags,
          flagCount: chosenFlags.length,
          submissionId: chosen.id,
          submittedAt: chosen.submittedAt,
          audioAvailable,
          hasComment: !!chosen.teacherComment,
        };
      }
      return {
        id: st.id,
        displayName: st.displayName,
        email: st.email || null,
        part: st.part || '',
        averagePct: scoreCount ? Math.round(scoreSum / scoreCount) : null,
        cells,
      };
    });

    return {
      ok: true,
      class: { id: cls.id, name: cls.name, joinCode: cls.joinCode },
      assignments: assignments.map(a => ({
        id: a.id,
        title: a.title,
        type: a.type,
        mode: a.mode,
        dueAt: a.dueAt,
        maxAttempts: a.maxAttempts,
        gradePolicy: a.gradePolicy,
        published: !!a.published,
      })),
      students: studentRows,
    };
  }

  function demoActiveStudentCount(db) {
    const activeClasses = new Set(db.classes.filter(c => !c.archivedAt).map(c => c.id));
    return db.students.filter(s => activeClasses.has(s.classId) && !s.archivedAt).length;
  }

  function setDemoPlan(status) {
    const db = loadDemoDb();
    const now = Date.now();
    const next = String(status || '').trim();
    if (next === 'trialing') {
      db.teacher.planStatus = 'trialing';
      db.teacher.trialEndsAt = now + 24 * DAY_MS;
      db.teacher.graceEndsAt = null;
      db.teacher.planEndsAt = null;
    } else if (next === 'active' || next === 'po_active') {
      db.teacher.planStatus = next;
      db.teacher.planEndsAt = now + 30 * DAY_MS;
      db.teacher.graceEndsAt = null;
    } else if (next === 'past_due') {
      db.teacher.planStatus = 'past_due';
      db.teacher.graceEndsAt = now + 4 * DAY_MS;
    } else if (next === 'expired' || next === 'canceled') {
      db.teacher.planStatus = next;
      db.teacher.trialEndsAt = now - DAY_MS;
      db.teacher.graceEndsAt = null;
      db.teacher.planEndsAt = null;
    } else {
      return demoErr(400, 'INVALID_PLAN', 'Unknown plan status.');
    }
    saveDemoDb();
    return {
      ok: true,
      teacher: formatDemoTeacherPublic(db),
      plan: computeDemoPlan(db.teacher, now),
    };
  }

  function resetDemoData() {
    const prevToken = getToken();
    const wasEphemeral = isEphemeral();
    memDemoDb = createFreshDemoDb();
    if (prevToken) {
      memDemoDb.sessions[prevToken] = {
        createdAt: Date.now(),
        expiresAt: Date.now() + 30 * DAY_MS,
        ephemeral: wasEphemeral,
      };
    }
    setDemoOffline(false);
    saveDemoDb();
    clearCache();
    return { ok: true, reset: true };
  }

  function getOAuthHandoffUrl({ state, googleClientId = '' } = {}) {
    let base = 'hw-oauth.html';
    try {
      const apiBase = getApiBase();
      const locHref = (typeof location !== 'undefined' && location.href) ? location.href : '';
      const isLoopback = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(locHref);
      if (!isDemoMode() && isLoopback && apiBase && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/i.test(apiBase)) {
        base = window.HW_OAUTH_PAGE_URL || 'https://app.rehearsalmusic.com/hw-oauth.html';
      } else if (locHref) {
        base = new URL('hw-oauth.html', locHref).href;
      }
    } catch { }
    const sep = base.includes('?') ? '&' : '?';
    const params = new URLSearchParams();
    if (state) params.set('state', state);
    if (isDemoMode()) {
      params.set('demo', '1');
    } else {
      const apiBase = getApiBase();
      if (apiBase) params.set('api', apiBase);
      if (googleClientId) params.set('googleClientId', googleClientId);
    }
    return `${base}${sep}${params.toString()}`;
  }

  function randomHandoffHex(bytes = 16) {
    let out = '';
    for (let i = 0; i < bytes * 2; i++) {
      out += Math.floor(Math.random() * 16).toString(16);
    }
    return out;
  }

  function loadDemoHandoffs() {
    try {
      return JSON.parse(localStorage.getItem(DEMO_HANDOFFS_KEY) || '{}') || {};
    } catch {
      return {};
    }
  }

  function saveDemoHandoffs(map) {
    try { localStorage.setItem(DEMO_HANDOFFS_KEY, JSON.stringify(map || {})); } catch { }
  }

  // ---------- Public API Object
  const HW_TEACHER_API = {
    INTEGRITY_FLAG_INFO,

    // Config & Mode
    getApiBase,
    setApiBase,
    isDemoMode,
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
            billingEnabled: !!res.billingEnabled,
          }
        : { ok: false, devMode: false, googleSignInEnabled: false, billingEnabled: false };
      if (res.ok) capsByBase.set(base, caps);
      return caps;
    },
    isOffline,
    getDemoOffline,
    setDemoOffline,
    setDemoPlan,
    resetDemoData,
    getPublicDocUrl,
    getStudentPortalUrl,
    getOAuthHandoffUrl,
    getCacheInfo,
    triggerDownload,
    formatCode,

    // Auth & Session
    getToken,
    isEphemeral,
    setSession,
    clearSession,

    async emailStart({ email }) {
      if (!isDemoMode()) {
        return liveFetch('/api/auth/teacher/email/start', {
          method: 'POST',
          auth: false,
          json: { email },
        });
      }
      if (isOffline()) return offlineErr('Connect to the internet to request a sign-in code.');
      const norm = normalizeEmail(email);
      if (!norm) return demoErr(400, 'INVALID_EMAIL', 'Enter a valid email address.');
      const db = loadDemoDb();
      const devCode = '482913';
      db.pendingEmailCodes[norm] = { code: devCode, expiresAt: Date.now() + 10 * 60 * 1000 };
      saveDemoDb();
      return { ok: true, sent: true, expiresInSec: 600, devCode };
    },

    async emailVerify({ email, code, ephemeral = false, name = '' }) {
      if (!isDemoMode()) {
        const res = await liveFetch('/api/auth/teacher/email/verify', {
          method: 'POST',
          auth: false,
          json: { email, code, ephemeral: !!ephemeral, name },
        });
        if (res.ok && res.token) setSession(res.token, !!ephemeral);
        return res;
      }
      if (isOffline()) return offlineErr('Connect to the internet to verify your sign-in code.');
      const norm = normalizeEmail(email);
      const cleanCode = String(code || '').replace(/\s+/g, '');
      if (!norm || !/^\d{6}$/.test(cleanCode)) {
        return demoErr(400, 'INVALID_INPUT', 'Enter your email and the 6-digit code.');
      }
      const db = loadDemoDb();
      const pending = db.pendingEmailCodes[norm];
      if (!pending || pending.expiresAt <= Date.now()) {
        return demoErr(401, 'CODE_EXPIRED', 'That code expired or was already used. Request a fresh code.');
      }
      if (pending.code !== cleanCode) {
        return demoErr(401, 'INVALID_CODE', 'Incorrect code. Check your email and try again.');
      }
      delete db.pendingEmailCodes[norm];

      if (norm !== 'ms.rivera@oakridge.edu') {
        db.teacher.email = norm;
        if (name && name.trim()) db.teacher.name = name.trim().slice(0, 120);
        else if (!db.teacher.name) db.teacher.name = norm.split('@')[0];
      } else if (name && name.trim()) {
        db.teacher.name = name.trim().slice(0, 120);
      }

      const now = Date.now();
      const ttl = ephemeral ? 12 * 60 * 60 * 1000 : 30 * DAY_MS;
      const token = 'demo_tch_' + Math.random().toString(36).slice(2, 12);
      db.sessions[token] = { createdAt: now, expiresAt: now + ttl, ephemeral: !!ephemeral };
      saveDemoDb();
      setSession(token, !!ephemeral);
      return {
        ok: true,
        token,
        expiresAt: now + ttl,
        ephemeral: !!ephemeral,
        teacher: formatDemoTeacherPublic(db),
      };
    },

    async oauthHandoffStart({ ephemeral = false } = {}) {
      if (!isDemoMode()) {
        return liveFetch('/api/auth/teacher/oauth/start', {
          method: 'POST',
          auth: false,
          json: { ephemeral: !!ephemeral },
        });
      }
      if (isOffline()) return offlineErr('Connect to the internet to start browser sign-in.');
      const now = Date.now();
      const state = 'ho_' + randomHandoffHex(12);
      const pollSecret = randomHandoffHex(16);
      const map = loadDemoHandoffs();
      // Prune expired demo entries
      for (const k of Object.keys(map)) {
        if (!map[k] || (map[k].expiresAt && map[k].expiresAt <= now)) delete map[k];
      }
      map[state] = {
        state,
        pollSecret,
        ephemeral: !!ephemeral,
        status: 'pending',
        expiresAt: now + 60 * 1000,
        createdAt: now,
      };
      saveDemoHandoffs(map);
      return { ok: true, state, pollSecret, expiresInSec: 60 };
    },

    async oauthHandoffPoll({ state, pollSecret, ephemeral = false } = {}) {
      if (!isDemoMode()) {
        const res = await liveFetch('/api/auth/teacher/oauth/poll', {
          method: 'POST',
          auth: false,
          json: { state, pollSecret },
        });
        if (res.ok && res.status === 'complete' && res.token) {
          setSession(res.token, !!ephemeral);
        }
        return res;
      }
      if (isOffline()) return offlineErr('You are offline.');
      const now = Date.now();
      const map = loadDemoHandoffs();
      const entry = map[state];
      if (!entry || entry.expiresAt <= now || entry.status === 'claimed') {
        return demoErr(410, 'HANDOFF_EXPIRED', 'Sign-in handoff expired.');
      }
      if (entry.pollSecret !== pollSecret) {
        return demoErr(401, 'UNAUTHORIZED', 'Unauthorized poll.');
      }
      if (entry.status !== 'complete') {
        return { ok: true, status: 'pending' };
      }

      const db = loadDemoDb();
      db.teacher.hasGoogle = true;
      const useEphemeral = !!(entry.ephemeral || ephemeral);
      const ttl = useEphemeral ? 12 * 60 * 60 * 1000 : 30 * DAY_MS;
      const token = 'demo_hotch_' + Math.random().toString(36).slice(2, 12);
      db.sessions[token] = { createdAt: now, expiresAt: now + ttl, ephemeral: useEphemeral };
      saveDemoDb();

      entry.status = 'claimed';
      saveDemoHandoffs(map);
      setSession(token, useEphemeral);
      return {
        ok: true,
        status: 'complete',
        token,
        teacher: formatDemoTeacherPublic(db),
      };
    },

    async googleAuth({ idToken, ephemeral = false }) {
      if (!isDemoMode()) {
        const res = await liveFetch('/api/auth/teacher/google', {
          method: 'POST',
          auth: false,
          json: { idToken, ephemeral: !!ephemeral },
        });
        if (res.ok && res.token) setSession(res.token, !!ephemeral);
        return res;
      }
      if (isOffline()) return offlineErr('Connect to the internet to sign in with Google.');
      const db = loadDemoDb();
      db.teacher.hasGoogle = true;
      const now = Date.now();
      const ttl = ephemeral ? 12 * 60 * 60 * 1000 : 30 * DAY_MS;
      const token = 'demo_gtch_' + Math.random().toString(36).slice(2, 12);
      db.sessions[token] = { createdAt: now, expiresAt: now + ttl, ephemeral: !!ephemeral };
      saveDemoDb();
      setSession(token, !!ephemeral);
      return {
        ok: true,
        token,
        expiresAt: now + ttl,
        ephemeral: !!ephemeral,
        teacher: formatDemoTeacherPublic(db),
      };
    },

    async getMe() {
      if (!isDemoMode()) {
        const res = await liveFetch('/api/auth/teacher/me');
        if (res.ok) {
          const cache = loadCache();
          cache.me = {
            teacher: res.teacher,
            activeStudentCount: res.activeStudentCount,
            overSoftCap: res.overSoftCap,
            ephemeral: res.ephemeral,
          };
          saveCache(cache);
          return res;
        }
        if ((res.networkError || res.offline) && getToken()) {
          const cache = loadCache();
          if (cache.me) return { ok: true, fromCache: true, offline: true, ...clone(cache.me) };
        }
        return res;
      }

      const db = loadDemoDb();
      const auth = demoAuth(db);
      if (!auth) return demoErr(401, 'SESSION_INVALID', 'Session expired — please sign in again.');
      const teacher = formatDemoTeacherPublic(db);
      const activeStudentCount = demoActiveStudentCount(db);
      const overSoftCap = activeStudentCount > (teacher.plan.studentSoftCap || DEFAULT_SOFT_CAP);
      const out = {
        ok: true,
        teacher,
        activeStudentCount,
        overSoftCap,
        ephemeral: !!auth.sess.ephemeral,
      };
      const cache = loadCache();
      cache.me = {
        teacher: out.teacher,
        activeStudentCount: out.activeStudentCount,
        overSoftCap: out.overSoftCap,
        ephemeral: out.ephemeral,
      };
      saveCache(cache);
      if (isOffline()) out.offline = true;
      return out;
    },

    async logout() {
      if (!isDemoMode()) {
        const res = await liveFetch('/api/auth/teacher/logout', { method: 'POST', json: {} }).catch(() => ({ ok: true }));
        clearSession();
        clearCache();
        return res.ok ? res : { ok: true };
      }
      const db = loadDemoDb();
      const tok = getToken();
      if (tok && db.sessions[tok]) {
        delete db.sessions[tok];
        saveDemoDb();
      }
      clearSession();
      clearCache();
      return { ok: true };
    },

    async logoutAll() {
      if (!isDemoMode()) {
        const res = await liveFetch('/api/auth/teacher/logout-all', { method: 'POST', json: {} });
        if (res.ok) {
          clearSession();
          clearCache();
        }
        return res;
      }
      if (isOffline()) return offlineErr('Connect to the internet to sign out all devices.');
      const db = loadDemoDb();
      const auth = demoAuth(db);
      if (!auth) return demoErr(401, 'SESSION_INVALID', 'Session expired — please sign in again.');
      db.sessions = {};
      saveDemoDb();
      clearSession();
      clearCache();
      return { ok: true, signedOutAllDevices: true };
    },

    // Billing
    async billingCheckout(interval) {
      if (!isDemoMode()) {
        let returnBase = '';
        try {
          if (typeof location !== 'undefined' && /^https?:/.test(location.protocol)) {
            returnBase = `${location.origin}${location.pathname}`;
          }
        } catch { }
        const body = { interval: interval === 'annual' ? 'annual' : 'monthly' };
        if (returnBase) {
          body.successUrl = `${returnBase}?billing=success`;
          body.cancelUrl = `${returnBase}?billing=canceled`;
        }
        return liveFetch('/api/billing/checkout', { method: 'POST', json: body });
      }
      if (isOffline()) return offlineErr();
      return demoErr(
        400,
        'DEMO_MODE',
        'Stripe Checkout requires a live homework server. Use the Plan State preview buttons below to test Trialing, Active, Past-Due, and Expired modes.'
      );
    },

    async billingPortal() {
      if (!isDemoMode()) {
        let returnUrl = '';
        try {
          if (typeof location !== 'undefined' && /^https?:/.test(location.protocol)) {
            returnUrl = `${location.origin}${location.pathname}`;
          }
        } catch { }
        return liveFetch('/api/billing/portal', {
          method: 'POST',
          json: returnUrl ? { returnUrl } : {},
        });
      }
      if (isOffline()) return offlineErr();
      return demoErr(
        400,
        'DEMO_MODE',
        'Billing Portal requires a live homework server. Use the Plan State preview buttons below to test plan states.'
      );
    },

    // Classes
    async listClasses(includeArchived = false) {
      if (!isDemoMode()) {
        const qs = includeArchived ? '?includeArchived=1' : '';
        const res = await liveFetch(`/api/classes${qs}`);
        if (res.ok) {
          const cache = loadCache();
          if (includeArchived || !cache.classes) {
            cache.classes = clone(res.classes);
          } else {
            const archived = (cache.classes || []).filter(c => !!c.archivedAt);
            const activeIds = new Set((res.classes || []).map(c => c.id));
            cache.classes = [...clone(res.classes), ...archived.filter(c => !activeIds.has(c.id))];
          }
          saveCache(cache);
          return res;
        }
        if (res.networkError || res.offline) {
          const cache = loadCache();
          if (cache.classes) {
            const list = includeArchived ? cache.classes : cache.classes.filter(c => !c.archivedAt);
            return { ok: true, fromCache: true, offline: true, classes: clone(list) };
          }
        }
        return res;
      }

      const db = loadDemoDb();
      const auth = demoAuth(db);
      if (!auth) return demoErr(401, 'SESSION_INVALID', 'Session expired — please sign in again.');
      if (isOffline()) {
        const cache = loadCache();
        if (cache.classes) {
          const list = includeArchived ? cache.classes : cache.classes.filter(c => !c.archivedAt);
          return { ok: true, fromCache: true, offline: true, classes: clone(list) };
        }
      }
      const classes = db.classes
        .filter(c => includeArchived || !c.archivedAt)
        .sort((a, b) => (!!a.archivedAt - !!b.archivedAt) || (b.createdAt - a.createdAt))
        .map(c => demoFormatClass(db, c));
      const cache = loadCache();
      cache.classes = db.classes.map(c => demoFormatClass(db, c));
      saveCache(cache);
      return { ok: true, classes };
    },

    async createClass({ name, locked = false }) {
      if (!isDemoMode()) {
        return liveFetch('/api/classes', { method: 'POST', json: { name, locked: !!locked } });
      }
      if (isOffline()) return offlineErr();
      const db = loadDemoDb();
      const auth = demoAuth(db);
      if (!auth) return demoErr(401, 'SESSION_INVALID', 'Session expired — please sign in again.');
      const blocked = assertDemoWritable(auth);
      if (blocked) return blocked;

      const cleanName = String(name || '').trim().slice(0, 120);
      if (!cleanName) return demoErr(400, 'INVALID_NAME', 'Enter a class name.');
      const used = new Set(db.classes.map(c => c.joinCode));
      const now = Date.now();
      const cls = {
        id: makeId('cls'),
        name: cleanName,
        joinCode: generateCode6(used),
        locked: !!locked,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      db.classes.unshift(cls);
      saveDemoDb();
      return { ok: true, class: demoFormatClass(db, cls) };
    },

    async updateClass(classId, patch) {
      if (!isDemoMode()) {
        return liveFetch(`/api/classes/${encodeURIComponent(classId)}`, { method: 'PATCH', json: patch || {} });
      }
      if (isOffline()) return offlineErr();
      const db = loadDemoDb();
      const auth = demoAuth(db);
      if (!auth) return demoErr(401, 'SESSION_INVALID', 'Session expired — please sign in again.');
      const cls = db.classes.find(c => c.id === classId);
      if (!cls) return demoErr(404, 'CLASS_NOT_FOUND', 'Class not found.');

      const p = patch || {};
      const needsWritable = p.name !== undefined || p.locked !== undefined || p.rotateJoinCode === true || (p.archived !== undefined && !p.archived);
      if (needsWritable) {
        const blocked = assertDemoWritable(auth);
        if (blocked) return blocked;
      }

      const now = Date.now();
      if (p.name !== undefined) {
        const cleanName = String(p.name || '').trim().slice(0, 120);
        if (!cleanName) return demoErr(400, 'INVALID_NAME', 'Class name cannot be empty.');
        cls.name = cleanName;
      }
      if (p.locked !== undefined) cls.locked = !!p.locked;
      if (p.archived !== undefined) cls.archivedAt = p.archived ? (cls.archivedAt || now) : null;
      if (p.rotateJoinCode === true) {
        const used = new Set(db.classes.map(c => c.joinCode));
        cls.joinCode = generateCode6(used);
      }
      cls.updatedAt = now;
      saveDemoDb();
      const out = { ok: true, class: demoFormatClass(db, cls) };
      if (p.archived) out.sessionsRevoked = 0;
      return out;
    },

    async deleteClass(classId) {
      if (!isDemoMode()) {
        return liveFetch(`/api/classes/${encodeURIComponent(classId)}`, { method: 'DELETE' });
      }
      if (isOffline()) return offlineErr();
      const db = loadDemoDb();
      const auth = demoAuth(db);
      if (!auth) return demoErr(401, 'SESSION_INVALID', 'Session expired — please sign in again.');
      const idx = db.classes.findIndex(c => c.id === classId);
      if (idx < 0) return demoErr(404, 'CLASS_NOT_FOUND', 'Class not found.');
      db.classes.splice(idx, 1);
      db.students = db.students.filter(s => s.classId !== classId);
      db.assignments = db.assignments.filter(a => a.classId !== classId);
      db.submissions = db.submissions.filter(sub => sub.classId !== classId);
      saveDemoDb();
      return { ok: true, deleted: true, classId, deletedR2Objects: 0 };
    },

    // Students
    async listStudents(classId, includeArchived = false) {
      if (!isDemoMode()) {
        const qs = includeArchived ? '?includeArchived=1' : '';
        const res = await liveFetch(`/api/classes/${encodeURIComponent(classId)}/students${qs}`);
        if (res.ok) {
          const cache = loadCache();
          cache.studentsByClass[classId] = { class: res.class, students: res.students, updatedAt: Date.now() };
          saveCache(cache);
          return res;
        }
        if (res.networkError || res.offline) {
          const cache = loadCache();
          const entry = cache.studentsByClass[classId];
          if (entry) {
            const list = includeArchived ? entry.students : (entry.students || []).filter(s => !s.archivedAt);
            return { ok: true, fromCache: true, offline: true, class: clone(entry.class), students: clone(list) };
          }
        }
        return res;
      }

      const db = loadDemoDb();
      const auth = demoAuth(db);
      if (!auth) return demoErr(401, 'SESSION_INVALID', 'Session expired — please sign in again.');
      if (isOffline()) {
        const cache = loadCache();
        const entry = cache.studentsByClass[classId];
        if (entry) {
          const list = includeArchived ? entry.students : (entry.students || []).filter(s => !s.archivedAt);
          return { ok: true, fromCache: true, offline: true, class: clone(entry.class), students: clone(list) };
        }
      }
      const cls = db.classes.find(c => c.id === classId);
      if (!cls) return demoErr(404, 'CLASS_NOT_FOUND', 'Class not found.');
      const students = db.students
        .filter(s => s.classId === classId && (includeArchived || !s.archivedAt))
        .sort((a, b) => (!!a.archivedAt - !!b.archivedAt) || a.displayName.toLowerCase().localeCompare(b.displayName.toLowerCase()))
        .map(s => demoFormatStudent(db, s));
      const formattedCls = demoFormatClass(db, cls);
      const cache = loadCache();
      cache.studentsByClass[classId] = {
        class: formattedCls,
        students: db.students.filter(s => s.classId === classId).map(s => demoFormatStudent(db, s)),
        updatedAt: Date.now(),
      };
      saveCache(cache);
      return { ok: true, class: formattedCls, students };
    },

    async addStudents(classId, students, generateCode = true) {
      const list = Array.isArray(students) ? students : [students];
      if (!isDemoMode()) {
        return liveFetch(`/api/classes/${encodeURIComponent(classId)}/students`, {
          method: 'POST',
          json: { students: list, generateCode: generateCode !== false },
        });
      }
      if (isOffline()) return offlineErr();
      const db = loadDemoDb();
      const auth = demoAuth(db);
      if (!auth) return demoErr(401, 'SESSION_INVALID', 'Session expired — please sign in again.');
      const blocked = assertDemoWritable(auth);
      if (blocked) return blocked;
      const cls = db.classes.find(c => c.id === classId);
      if (!cls) return demoErr(404, 'CLASS_NOT_FOUND', 'Class not found.');
      if (!list.length) return demoErr(400, 'INVALID_INPUT', 'Add at least one student.');
      if (list.length > 250) return demoErr(400, 'TOO_MANY_STUDENTS', 'You can add up to 250 students at a time.');

      const used = new Set(db.students.filter(s => s.classId === classId && s.codePlain).map(s => s.codePlain));
      const now = Date.now();
      const createdStudents = [];
      const generatedCodes = [];

      for (let i = 0; i < list.length; i++) {
        const item = list[i] || {};
        const displayName = String(item.displayName !== undefined ? item.displayName : (item.name || '')).trim().slice(0, 120);
        if (!displayName) return demoErr(400, 'INVALID_NAME', `Student #${i + 1} needs a name.`);
        let email = null;
        if (item.email !== undefined && item.email !== null && String(item.email).trim() !== '') {
          email = normalizeEmail(item.email);
          if (!email) return demoErr(400, 'INVALID_EMAIL', `Invalid email address for ${displayName}.`);
        }
        const part = String(item.part || '').trim().slice(0, 80);
        const wantCode = item.generateCode !== undefined ? item.generateCode !== false : (generateCode !== false);
        const codePlain = wantCode ? generateCode6(used) : null;
        const row = {
          id: makeId('stu'),
          classId,
          displayName,
          email,
          part,
          hasGoogle: false,
          hasCode: !!codePlain,
          codePlain,
          codeLocked: false,
          codeCooldownUntil: null,
          archivedAt: null,
          lastActiveAt: null,
          createdAt: now,
          updatedAt: now,
        };
        db.students.push(row);
        createdStudents.push(demoFormatStudent(db, row));
        if (codePlain) {
          generatedCodes.push({ studentId: row.id, displayName, part, code: codePlain });
        }
      }
      saveDemoDb();
      return { ok: true, students: createdStudents, generatedCodes, count: createdStudents.length };
    },

    async updateStudent(classId, studentId, patch) {
      if (!isDemoMode()) {
        return liveFetch(
          `/api/classes/${encodeURIComponent(classId)}/students/${encodeURIComponent(studentId)}`,
          { method: 'PATCH', json: patch || {} }
        );
      }
      if (isOffline()) return offlineErr();
      const db = loadDemoDb();
      const auth = demoAuth(db);
      if (!auth) return demoErr(401, 'SESSION_INVALID', 'Session expired — please sign in again.');
      const cls = db.classes.find(c => c.id === classId);
      if (!cls) return demoErr(404, 'CLASS_NOT_FOUND', 'Class not found.');
      const stu = db.students.find(s => s.id === studentId && s.classId === classId);
      if (!stu) return demoErr(404, 'STUDENT_NOT_FOUND', 'Student not found.');

      const p = patch || {};
      const needsWritable = p.displayName !== undefined || p.email !== undefined || p.part !== undefined || (p.archived !== undefined && !p.archived);
      if (needsWritable) {
        const blocked = assertDemoWritable(auth);
        if (blocked) return blocked;
      }

      const now = Date.now();
      if (p.displayName !== undefined) {
        const dn = String(p.displayName || '').trim().slice(0, 120);
        if (!dn) return demoErr(400, 'INVALID_NAME', 'Student name cannot be empty.');
        stu.displayName = dn;
      }
      if (p.email !== undefined) {
        if (p.email === null || String(p.email).trim() === '') stu.email = null;
        else {
          const em = normalizeEmail(p.email);
          if (!em) return demoErr(400, 'INVALID_EMAIL', 'Enter a valid email address.');
          stu.email = em;
        }
      }
      if (p.part !== undefined) stu.part = String(p.part || '').trim().slice(0, 80);
      if (p.archived !== undefined) stu.archivedAt = p.archived ? (stu.archivedAt || now) : null;
      stu.updatedAt = now;
      saveDemoDb();
      const out = { ok: true, student: demoFormatStudent(db, stu) };
      if (p.archived) out.sessionsRevoked = 0;
      return out;
    },

    async deleteStudent(classId, studentId) {
      if (!isDemoMode()) {
        return liveFetch(
          `/api/classes/${encodeURIComponent(classId)}/students/${encodeURIComponent(studentId)}`,
          { method: 'DELETE' }
        );
      }
      if (isOffline()) return offlineErr();
      const db = loadDemoDb();
      const auth = demoAuth(db);
      if (!auth) return demoErr(401, 'SESSION_INVALID', 'Session expired — please sign in again.');
      const cls = db.classes.find(c => c.id === classId);
      if (!cls) return demoErr(404, 'CLASS_NOT_FOUND', 'Class not found.');
      const idx = db.students.findIndex(s => s.id === studentId && s.classId === classId);
      if (idx < 0) return demoErr(404, 'STUDENT_NOT_FOUND', 'Student not found.');
      db.students.splice(idx, 1);
      db.submissions = db.submissions.filter(sub => !(sub.studentId === studentId && sub.classId === classId));
      saveDemoDb();
      return { ok: true, deleted: true, studentId, deletedR2Objects: 0 };
    },

    async regenerateStudentCode(classId, studentId, revokeSessions = true) {
      if (!isDemoMode()) {
        return liveFetch(
          `/api/classes/${encodeURIComponent(classId)}/students/${encodeURIComponent(studentId)}/regenerate-code`,
          { method: 'POST', json: { revokeSessions: revokeSessions !== false } }
        );
      }
      if (isOffline()) return offlineErr();
      const db = loadDemoDb();
      const auth = demoAuth(db);
      if (!auth) return demoErr(401, 'SESSION_INVALID', 'Session expired — please sign in again.');
      const blocked = assertDemoWritable(auth);
      if (blocked) return blocked;
      const cls = db.classes.find(c => c.id === classId);
      if (!cls) return demoErr(404, 'CLASS_NOT_FOUND', 'Class not found.');
      const stu = db.students.find(s => s.id === studentId && s.classId === classId);
      if (!stu) return demoErr(404, 'STUDENT_NOT_FOUND', 'Student not found.');

      const used = new Set(db.students.filter(s => s.classId === classId && s.codePlain).map(s => s.codePlain));
      const newCode = generateCode6(used);
      stu.hasCode = true;
      stu.codePlain = newCode;
      stu.codeLocked = false;
      stu.codeCooldownUntil = null;
      stu.updatedAt = Date.now();
      saveDemoDb();
      return {
        ok: true,
        studentId: stu.id,
        displayName: stu.displayName,
        part: stu.part || '',
        code: newCode,
        sessionsRevoked: revokeSessions !== false,
      };
    },

    async regenerateClassCodes(classId, opts = {}) {
      if (!isDemoMode()) {
        return liveFetch(
          `/api/classes/${encodeURIComponent(classId)}/regenerate-codes`,
          { method: 'POST', json: opts || {} }
        );
      }
      if (isOffline()) return offlineErr();
      const db = loadDemoDb();
      const auth = demoAuth(db);
      if (!auth) return demoErr(401, 'SESSION_INVALID', 'Session expired — please sign in again.');
      const blocked = assertDemoWritable(auth);
      if (blocked) return blocked;
      const cls = db.classes.find(c => c.id === classId);
      if (!cls) return demoErr(404, 'CLASS_NOT_FOUND', 'Class not found.');

      const filterIds = Array.isArray(opts?.studentIds) && opts.studentIds.length ? new Set(opts.studentIds) : null;
      const targets = db.students
        .filter(s => s.classId === classId && !s.archivedAt && (!filterIds || filterIds.has(s.id)))
        .sort((a, b) => a.displayName.toLowerCase().localeCompare(b.displayName.toLowerCase()));
      const used = new Set();
      const now = Date.now();
      const generatedCodes = [];
      for (const st of targets) {
        const newCode = generateCode6(used);
        st.hasCode = true;
        st.codePlain = newCode;
        st.codeLocked = false;
        st.codeCooldownUntil = null;
        st.updatedAt = now;
        generatedCodes.push({
          studentId: st.id,
          displayName: st.displayName,
          part: st.part || '',
          code: newCode,
        });
      }
      saveDemoDb();
      return {
        ok: true,
        classId,
        generatedCodes,
        count: generatedCodes.length,
        sessionsRevoked: opts?.revokeSessions !== false,
      };
    },

    async revokeStudentSessions(classId, studentId) {
      if (!isDemoMode()) {
        return liveFetch(
          `/api/classes/${encodeURIComponent(classId)}/students/${encodeURIComponent(studentId)}/revoke-sessions`,
          { method: 'POST', json: {} }
        );
      }
      if (isOffline()) return offlineErr();
      const db = loadDemoDb();
      const auth = demoAuth(db);
      if (!auth) return demoErr(401, 'SESSION_INVALID', 'Session expired — please sign in again.');
      const cls = db.classes.find(c => c.id === classId);
      if (!cls) return demoErr(404, 'CLASS_NOT_FOUND', 'Class not found.');
      const stu = db.students.find(s => s.id === studentId && s.classId === classId);
      if (!stu) return demoErr(404, 'STUDENT_NOT_FOUND', 'Student not found.');
      return { ok: true, studentId, revokedCount: 1 };
    },

    async revokeClassSessions(classId) {
      if (!isDemoMode()) {
        return liveFetch(
          `/api/classes/${encodeURIComponent(classId)}/revoke-sessions`,
          { method: 'POST', json: {} }
        );
      }
      if (isOffline()) return offlineErr();
      const db = loadDemoDb();
      const auth = demoAuth(db);
      if (!auth) return demoErr(401, 'SESSION_INVALID', 'Session expired — please sign in again.');
      const cls = db.classes.find(c => c.id === classId);
      if (!cls) return demoErr(404, 'CLASS_NOT_FOUND', 'Class not found.');
      const count = db.students.filter(s => s.classId === classId && !s.archivedAt).length;
      return { ok: true, classId, revokedCount: count };
    },

    async exportStudentData(classId, studentId) {
      if (!isDemoMode()) {
        const res = await liveFetch(
          `/api/classes/${encodeURIComponent(classId)}/students/${encodeURIComponent(studentId)}/export`
        );
        if (res.ok && !res.filename && res.student) {
          res.filename = `student-data-${safeSlug(res.student.displayName, res.student.id)}.json`;
        }
        return res;
      }

      const db = loadDemoDb();
      const auth = demoAuth(db);
      if (!auth) return demoErr(401, 'SESSION_INVALID', 'Session expired — please sign in again.');
      const cls = db.classes.find(c => c.id === classId);
      if (!cls) return demoErr(404, 'CLASS_NOT_FOUND', 'Class not found.');
      const stu = db.students.find(s => s.id === studentId && s.classId === classId);
      if (!stu) return demoErr(404, 'STUDENT_NOT_FOUND', 'Student not found.');

      const now = Date.now();
      const asgnById = new Map(db.assignments.map(a => [a.id, a]));
      const subs = db.submissions
        .filter(sub => sub.studentId === studentId && sub.classId === classId)
        .sort((a, b) => a.submittedAt - b.submittedAt)
        .map(sub => {
          const a = asgnById.get(sub.assignmentId);
          let audioStatus = 'none';
          if (sub.audioDeletedAt) audioStatus = 'deleted';
          else if (sub.audioAvailable) {
            audioStatus = (sub.audioExpiresAt && sub.audioExpiresAt <= now) ? 'expired' : 'available';
          }
          return {
            id: sub.id,
            assignmentId: sub.assignmentId,
            assignmentTitle: a?.title || '',
            assignmentType: a?.type || null,
            assignmentMode: a?.mode || null,
            attemptNum: sub.attemptNum,
            overallPct: sub.overallPct,
            rhythmPct: sub.rhythmPct,
            pitchPct: sub.pitchPct,
            teacherOverridePct: sub.teacherOverridePct,
            effectivePct: demoEffectiveScore(sub),
            teacherComment: sub.teacherComment || '',
            gradedAt: sub.gradedAt ?? null,
            submittedAt: sub.submittedAt,
            durationSec: Number(sub.durationSec || 0),
            expectedSec: sub.expectedSec ?? null,
            audio: {
              status: audioStatus,
              mime: sub.audioMime || null,
              bytes: Number(sub.audioBytes || 0),
              expiresAt: sub.audioExpiresAt ?? null,
              deletedAt: sub.audioDeletedAt ?? null,
            },
            resultsJson: clone(sub.resultsJson || null),
            integrityFlags: clone(sub.integrityFlags || []),
          };
        });

      return {
        ok: true,
        exportedAt: now,
        exportedAtIso: new Date(now).toISOString(),
        filename: `student-data-${safeSlug(stu.displayName, stu.id)}.json`,
        class: {
          id: cls.id,
          name: cls.name,
          joinCode: cls.joinCode,
          archivedAt: cls.archivedAt ?? null,
          createdAt: cls.createdAt,
        },
        student: {
          id: stu.id,
          displayName: stu.displayName,
          email: stu.email || null,
          part: stu.part || '',
          hasGoogle: !!stu.hasGoogle,
          hasCode: !!stu.hasCode,
          codeLocked: !!stu.codeLocked,
          archivedAt: stu.archivedAt ?? null,
          createdAt: stu.createdAt,
          updatedAt: stu.updatedAt,
        },
        submissions: subs,
      };
    },

    // Assignments & Score Upload
    async listAssignments(classId, includeArchived = false) {
      if (!isDemoMode()) {
        const qs = includeArchived ? '?includeArchived=1' : '';
        const res = await liveFetch(`/api/classes/${encodeURIComponent(classId)}/assignments${qs}`);
        if (res.ok) {
          const cache = loadCache();
          cache.assignmentsByClass[classId] = { assignments: res.assignments, updatedAt: Date.now() };
          saveCache(cache);
          return res;
        }
        if (res.networkError || res.offline) {
          const cache = loadCache();
          const entry = cache.assignmentsByClass[classId];
          if (entry) {
            const list = includeArchived ? entry.assignments : (entry.assignments || []).filter(a => !a.archivedAt);
            return { ok: true, fromCache: true, offline: true, assignments: clone(list) };
          }
        }
        return res;
      }

      const db = loadDemoDb();
      const auth = demoAuth(db);
      if (!auth) return demoErr(401, 'SESSION_INVALID', 'Session expired — please sign in again.');
      if (isOffline()) {
        const cache = loadCache();
        const entry = cache.assignmentsByClass[classId];
        if (entry) {
          const list = includeArchived ? entry.assignments : (entry.assignments || []).filter(a => !a.archivedAt);
          return { ok: true, fromCache: true, offline: true, assignments: clone(list) };
        }
      }
      const cls = db.classes.find(c => c.id === classId);
      if (!cls) return demoErr(404, 'CLASS_NOT_FOUND', 'Class not found.');
      const assignments = db.assignments
        .filter(a => a.classId === classId && (includeArchived || !a.archivedAt))
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(a => demoFormatAssignment(db, a, true));
      const cache = loadCache();
      cache.assignmentsByClass[classId] = {
        assignments: db.assignments.filter(a => a.classId === classId).map(a => demoFormatAssignment(db, a, true)),
        updatedAt: Date.now(),
      };
      saveCache(cache);
      return { ok: true, assignments };
    },

    async createAssignment(classId, body) {
      if (!isDemoMode()) {
        return liveFetch(`/api/classes/${encodeURIComponent(classId)}/assignments`, {
          method: 'POST',
          json: body || {},
        });
      }
      if (isOffline()) return offlineErr();
      const db = loadDemoDb();
      const auth = demoAuth(db);
      if (!auth) return demoErr(401, 'SESSION_INVALID', 'Session expired — please sign in again.');
      const blocked = assertDemoWritable(auth);
      if (blocked) return blocked;
      const cls = db.classes.find(c => c.id === classId && !c.archivedAt);
      if (!cls) return demoErr(404, 'CLASS_NOT_FOUND', 'Class not found or archived.');

      const d = body || {};
      const title = String(d.title || '').trim().slice(0, 200);
      if (!title) return demoErr(400, 'INVALID_TITLE', 'Assignment title is required.');
      const type = String(d.type || '').trim();
      if (!['sight', 'score', 'audio'].includes(type)) {
        return demoErr(400, 'INVALID_TYPE', 'Assignment type must be sight, score, or audio.');
      }
      let mode = d.mode ? String(d.mode).trim() : 'practice';
      if (!['practice', 'true_sight_read'].includes(mode)) {
        return demoErr(400, 'INVALID_MODE', 'Assignment mode must be practice or true_sight_read.');
      }
      if (type !== 'sight') mode = 'practice';

      const cfg = clone(d.config && typeof d.config === 'object' ? d.config : {});
      const rs = cfg.strictness && typeof cfg.strictness === 'object' ? cfg.strictness : {};
      cfg.strictness = {
        rhythm: Number.isFinite(Number(rs.rhythm)) ? Math.max(0, Math.min(100, Math.round(Number(rs.rhythm)))) : 50,
        pitch: Number.isFinite(Number(rs.pitch)) ? Math.max(0, Math.min(100, Math.round(Number(rs.pitch)))) : 50,
      };
      if (mode === 'true_sight_read') {
        const ss = Number(cfg.studySeconds);
        cfg.studySeconds = Number.isFinite(ss) ? Math.max(15, Math.min(60, Math.round(ss))) : 30;
      }

      const now = Date.now();
      const maxAttempts = d.maxAttempts !== undefined && d.maxAttempts !== null && d.maxAttempts !== ''
        ? Math.floor(Number(d.maxAttempts))
        : (mode === 'true_sight_read' ? 1 : null);
      const dueAt = d.dueAt ? Math.round(Number(d.dueAt)) : null;

      const row = {
        id: makeId('asgn'),
        classId,
        title,
        instructions: String(d.instructions || '').trim().slice(0, 4000),
        type,
        mode,
        config: cfg,
        hasScoreFile: false,
        scoreFilename: null,
        scoreBytes: 0,
        dueAt,
        maxAttempts,
        gradePolicy: d.gradePolicy === 'last' ? 'last' : 'best',
        published: d.published === undefined ? true : !!d.published,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      db.assignments.unshift(row);
      saveDemoDb();
      return { ok: true, assignment: demoFormatAssignment(db, row, false) };
    },

    async updateAssignment(assignmentId, patch) {
      if (!isDemoMode()) {
        return liveFetch(`/api/assignments/${encodeURIComponent(assignmentId)}`, {
          method: 'PATCH',
          json: patch || {},
        });
      }
      if (isOffline()) return offlineErr();
      const db = loadDemoDb();
      const auth = demoAuth(db);
      if (!auth) return demoErr(401, 'SESSION_INVALID', 'Session expired — please sign in again.');
      const row = db.assignments.find(a => a.id === assignmentId);
      if (!row) return demoErr(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment not found.');

      const p = patch || {};
      const nonArchiveKeys = Object.keys(p).filter(k => k !== 'archived');
      const isArchiveOnly = nonArchiveKeys.length === 0 && p.archived === true;
      if (!isArchiveOnly) {
        const blocked = assertDemoWritable(auth);
        if (blocked) return blocked;
      }

      const now = Date.now();
      if (p.title !== undefined) {
        const t = String(p.title || '').trim().slice(0, 200);
        if (!t) return demoErr(400, 'INVALID_TITLE', 'Assignment title cannot be empty.');
        row.title = t;
      }
      if (p.instructions !== undefined) row.instructions = String(p.instructions || '').trim().slice(0, 4000);
      if (p.mode !== undefined) {
        row.mode = row.type === 'sight' && p.mode === 'true_sight_read' ? 'true_sight_read' : 'practice';
      }
      if (p.config !== undefined) row.config = clone(p.config || {});
      if (p.dueAt !== undefined) row.dueAt = p.dueAt ? Math.round(Number(p.dueAt)) : null;
      if (p.maxAttempts !== undefined) {
        row.maxAttempts = (p.maxAttempts === null || p.maxAttempts === '') ? null : Math.floor(Number(p.maxAttempts));
      }
      if (p.gradePolicy !== undefined) row.gradePolicy = p.gradePolicy === 'last' ? 'last' : 'best';
      if (p.published !== undefined) row.published = !!p.published;
      if (p.archived !== undefined) row.archivedAt = p.archived ? (row.archivedAt || now) : null;
      row.updatedAt = now;
      saveDemoDb();
      return { ok: true, assignment: demoFormatAssignment(db, row, false) };
    },

    async deleteAssignment(assignmentId) {
      if (!isDemoMode()) {
        return liveFetch(`/api/assignments/${encodeURIComponent(assignmentId)}`, { method: 'DELETE' });
      }
      if (isOffline()) return offlineErr();
      const db = loadDemoDb();
      const auth = demoAuth(db);
      if (!auth) return demoErr(401, 'SESSION_INVALID', 'Session expired — please sign in again.');
      const idx = db.assignments.findIndex(a => a.id === assignmentId);
      if (idx < 0) return demoErr(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment not found.');
      db.assignments.splice(idx, 1);
      db.submissions = db.submissions.filter(s => s.assignmentId !== assignmentId);
      saveDemoDb();
      return { ok: true, deleted: true, id: assignmentId };
    },

    async uploadAssignmentScore(assignmentId, fileOrBlob, filename) {
      const rawName = String(filename || (fileOrBlob && fileOrBlob.name) || 'score.musicxml').trim();
      const baseName = (rawName.split(/[/\\]/).pop() || 'score.musicxml').trim();
      const lower = baseName.toLowerCase();

      if (lower.endsWith('.mscz') || lower.endsWith('.mscx')) {
        return demoErr(415, 'UNSUPPORTED_SCORE_FORMAT', MUSESCORE_UNSUPPORTED_MSG);
      }
      if (!lower.endsWith('.mxl') && !lower.endsWith('.musicxml') && !lower.endsWith('.xml')) {
        return demoErr(415, 'UNSUPPORTED_SCORE_FORMAT', 'Upload a MusicXML file (.mxl, .musicxml, or .xml).');
      }

      if (!fileOrBlob) {
        return demoErr(400, 'MISSING_FILE', 'Attach a MusicXML (.mxl or .musicxml) file.');
      }
      const blob = fileOrBlob instanceof Blob
        ? fileOrBlob
        : new Blob([fileOrBlob], { type: 'application/octet-stream' });

      if (blob.size <= 0) {
        return demoErr(400, 'EMPTY_FILE', 'Uploaded score file is empty.');
      }
      if (blob.size > MAX_SCORE_BYTES) {
        return demoErr(413, 'SCORE_TOO_LARGE', 'Score file is too large (10 MB maximum).');
      }

      if (!isDemoMode()) {
        // Use FormData with ONLY Authorization header (never manual Content-Type or X-Filename)
        const form = new FormData();
        form.append('file', blob, baseName);
        return liveFetch(`/api/assignments/${encodeURIComponent(assignmentId)}/score`, {
          method: 'PUT',
          formData: form,
        });
      }

      if (isOffline()) return offlineErr();
      const db = loadDemoDb();
      const auth = demoAuth(db);
      if (!auth) return demoErr(401, 'SESSION_INVALID', 'Session expired — please sign in again.');
      const blocked = assertDemoWritable(auth);
      if (blocked) return blocked;
      const row = db.assignments.find(a => a.id === assignmentId);
      if (!row) return demoErr(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment not found.');
      if (row.type !== 'score') {
        return demoErr(400, 'NOT_SCORE_ASSIGNMENT', 'Score files can only be uploaded to Score Practice assignments.');
      }
      const now = Date.now();
      const mime = lower.endsWith('.mxl') ? 'application/vnd.recordare.musicxml' : 'application/xml; charset=utf-8';
      row.hasScoreFile = true;
      row.scoreFilename = baseName;
      row.scoreBytes = blob.size;
      row.updatedAt = now;
      saveDemoDb();
      return {
        ok: true,
        assignmentId,
        scoreFilename: baseName,
        scoreBytes: blob.size,
        contentType: mime,
        updatedAt: now,
      };
    },

    async createAssignmentPreview(assignmentId) {
      if (!isDemoMode()) {
        if (isOffline()) {
          return offlineErr('Preview requires an internet connection.');
        }
        const res = await liveFetch(`/api/assignments/${encodeURIComponent(assignmentId)}/preview`, {
          method: 'POST',
          json: {},
        });
        if (!res.ok) return res;
        return {
          ...res,
          previewUrl: buildPreviewPortalUrl(res.previewToken, { demo: false }),
        };
      }

      const db = loadDemoDb();
      const auth = demoAuth(db);
      if (!auth) return demoErr(401, 'SESSION_INVALID', 'Session expired — please sign in again.');
      const row = db.assignments.find(a => a.id === assignmentId);
      if (!row) return demoErr(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment not found.');
      const cls = db.classes.find(c => c.id === row.classId) || { id: row.classId, name: 'Demo Class', joinCode: '' };
      const key = makeId('prv');
      const now = Date.now();
      let map = {};
      try {
        map = JSON.parse(localStorage.getItem(PREVIEW_DRAFT_KEY) || '{}') || {};
      } catch { map = {}; }
      // Prune entries older than 24 hours and keep at most 10 cached local previews
      const cutoff = now - DAY_MS;
      const freshEntries = Object.entries(map)
        .filter(([, v]) => v && Number(v.savedAt || 0) > cutoff)
        .sort((a, b) => Number(b[1].savedAt || 0) - Number(a[1].savedAt || 0))
        .slice(0, 9);
      const nextMap = Object.fromEntries(freshEntries);
      nextMap[key] = {
        savedAt: now,
        class: {
          id: cls.id,
          name: cls.name,
          joinCode: cls.joinCode,
          teacherName: db.teacher?.name || 'Teacher',
          acceptingSubmissions: true,
        },
        assignment: clone(row),
      };
      try {
        localStorage.setItem(PREVIEW_DRAFT_KEY, JSON.stringify(nextMap));
      } catch {
        return demoErr(500, 'PREVIEW_STORE_FAILED', 'Could not prepare local preview.');
      }
      const token = `demo:${key}`;
      return {
        ok: true,
        previewToken: token,
        expiresAt: now + 2 * 60 * 60 * 1000,
        assignmentId: row.id,
        previewUrl: buildPreviewPortalUrl(token, { demo: true }),
      };
    },

    exportRosterCsv(cls, students) {
      const list = Array.isArray(students) ? students : [];
      if (!cls || !list.length) return { ok: false, error: 'No students to export.' };
      const lines = [
        ['Class Name', 'Class Code', 'Student Name', 'Part', 'Email', 'Sign-In Method', 'Status']
          .map(csvCell).join(','),
      ];
      const joinFmt = formatCode(cls.joinCode);
      for (const st of list) {
        const methods = [];
        if (st.hasCode) methods.push('Student Code');
        if (st.hasGoogle) methods.push('Google');
        lines.push([
          cls.name || '',
          joinFmt,
          st.displayName || '',
          st.part || '',
          st.email || '',
          methods.join(' + ') || 'Not set',
          st.archivedAt ? 'Archived' : 'Active',
        ].map(csvCell).join(','));
      }
      const filename = `roster-${safeSlug(cls.name, 'class')}.csv`;
      triggerDownload(lines.join('\r\n'), filename, 'text/csv;charset=utf-8');
      return { ok: true, filename, count: list.length };
    },

    exportCodesCsv(codeAlert) {
      const items = Array.isArray(codeAlert?.items) ? codeAlert.items : [];
      if (!items.length) return { ok: false, error: 'No student codes to download.' };
      const portalUrl = getStudentPortalUrl(codeAlert.joinCode);
      const joinFmt = formatCode(codeAlert.joinCode);
      const lines = [
        ['Class Name', 'Class Code', 'Student Name', 'Part', 'Student Code', 'Student Portal Link']
          .map(csvCell).join(','),
      ];
      for (const it of items) {
        lines.push([
          codeAlert.className || '',
          joinFmt,
          it.displayName || '',
          it.part || '',
          formatCode(it.code),
          portalUrl,
        ].map(csvCell).join(','));
      }
      const filename = `student-codes-${safeSlug(codeAlert.className, 'class')}.csv`;
      triggerDownload(lines.join('\r\n'), filename, 'text/csv;charset=utf-8');
      return { ok: true, filename, count: items.length };
    },

    // Gradebook & Submissions
    async getGradebook(classId) {
      if (!isDemoMode()) {
        const res = await liveFetch(`/api/classes/${encodeURIComponent(classId)}/gradebook`);
        if (res.ok) {
          const cache = loadCache();
          cache.gradebookByClass[classId] = {
            class: res.class,
            assignments: res.assignments,
            students: res.students,
            updatedAt: Date.now(),
          };
          saveCache(cache);
          return res;
        }
        if (res.networkError || res.offline) {
          const cache = loadCache();
          const entry = cache.gradebookByClass[classId];
          if (entry) {
            return {
              ok: true,
              fromCache: true,
              offline: true,
              class: clone(entry.class),
              assignments: clone(entry.assignments),
              students: clone(entry.students),
            };
          }
        }
        return res;
      }

      const db = loadDemoDb();
      const auth = demoAuth(db);
      if (!auth) return demoErr(401, 'SESSION_INVALID', 'Session expired — please sign in again.');
      if (isOffline()) {
        const cache = loadCache();
        const entry = cache.gradebookByClass[classId];
        if (entry) {
          return {
            ok: true,
            fromCache: true,
            offline: true,
            class: clone(entry.class),
            assignments: clone(entry.assignments),
            students: clone(entry.students),
          };
        }
      }
      const gb = demoBuildGradebook(db, classId);
      if (!gb) return demoErr(404, 'CLASS_NOT_FOUND', 'Class not found.');
      const cache = loadCache();
      cache.gradebookByClass[classId] = {
        class: clone(gb.class),
        assignments: clone(gb.assignments),
        students: clone(gb.students),
        updatedAt: Date.now(),
      };
      saveCache(cache);
      return gb;
    },

    async downloadGradebookCsv(classId, assignmentId) {
      if (!isDemoMode() && !isOffline()) {
        const qs = assignmentId ? `?assignmentId=${encodeURIComponent(assignmentId)}` : '';
        const res = await liveFetch(`/api/classes/${encodeURIComponent(classId)}/gradebook.csv${qs}`, {
          responseType: 'text',
        });
        if (res.ok) {
          const fn = res.filename || 'gradebook.csv';
          triggerDownload(res.text, fn, 'text/csv;charset=utf-8');
          return { ok: true, filename: fn };
        }
        if (!res.networkError && !res.offline) return res;
      }

      // Serve from offline cache or Demo DB
      let gb = null;
      let subsForAsgn = null;
      if (isDemoMode()) {
        const db = loadDemoDb();
        const auth = demoAuth(db);
        if (!auth) return demoErr(401, 'SESSION_INVALID', 'Session expired — please sign in again.');
        if (isOffline()) {
          const cache = loadCache();
          gb = cache.gradebookByClass[classId] || demoBuildGradebook(db, classId);
          subsForAsgn = assignmentId ? cache.submissionsByAsgn[assignmentId]?.submissions : null;
        } else {
          gb = demoBuildGradebook(db, classId);
          subsForAsgn = assignmentId
            ? db.submissions.filter(s => s.assignmentId === assignmentId)
            : null;
        }
      } else {
        const cache = loadCache();
        gb = cache.gradebookByClass[classId] || null;
        subsForAsgn = assignmentId ? cache.submissionsByAsgn[assignmentId]?.submissions : null;
      }

      if (!gb) {
        return offlineErr('Gradebook is not cached for offline CSV export yet. Open the gradebook while online first.');
      }
      const built = buildGradebookCsvString(gb, assignmentId, subsForAsgn);
      if (!built) return demoErr(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment not found in gradebook.');
      triggerDownload(built.csv, built.filename, 'text/csv;charset=utf-8');
      return { ok: true, filename: built.filename, fromCache: isOffline() };
    },

    async listSubmissions(assignmentId) {
      if (!isDemoMode()) {
        const res = await liveFetch(`/api/assignments/${encodeURIComponent(assignmentId)}/submissions`);
        if (res.ok) {
          const cache = loadCache();
          cache.submissionsByAsgn[assignmentId] = {
            assignment: res.assignment,
            submissions: res.submissions,
            updatedAt: Date.now(),
          };
          saveCache(cache);
          return res;
        }
        if (res.networkError || res.offline) {
          const cache = loadCache();
          const entry = cache.submissionsByAsgn[assignmentId];
          if (entry) {
            return {
              ok: true,
              fromCache: true,
              offline: true,
              assignment: clone(entry.assignment),
              submissions: clone(entry.submissions),
            };
          }
        }
        return res;
      }

      const db = loadDemoDb();
      const auth = demoAuth(db);
      if (!auth) return demoErr(401, 'SESSION_INVALID', 'Session expired — please sign in again.');
      if (isOffline()) {
        const cache = loadCache();
        const entry = cache.submissionsByAsgn[assignmentId];
        if (entry) {
          return {
            ok: true,
            fromCache: true,
            offline: true,
            assignment: clone(entry.assignment),
            submissions: clone(entry.submissions),
          };
        }
      }
      const asgn = db.assignments.find(a => a.id === assignmentId);
      if (!asgn) return demoErr(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment not found.');

      const now = Date.now();
      const stuById = new Map(db.students.map(s => [s.id, s]));
      const rows = db.submissions
        .filter(s => s.assignmentId === assignmentId)
        .sort((a, b) => (b.submittedAt - a.submittedAt) || (b.attemptNum - a.attemptNum))
        .map(s => {
          const st = stuById.get(s.studentId);
          const audioAvailable = !!(
            s.audioAvailable &&
            !s.audioDeletedAt &&
            (!s.audioExpiresAt || s.audioExpiresAt > now)
          );
          return {
            id: s.id,
            assignmentId: s.assignmentId,
            classId: s.classId,
            studentId: s.studentId,
            studentName: st?.displayName || 'Student',
            studentEmail: st?.email || null,
            studentPart: st?.part || '',
            attemptNum: s.attemptNum,
            attemptStartId: s.attemptStartId || null,
            overallPct: s.overallPct,
            rhythmPct: s.rhythmPct,
            pitchPct: s.pitchPct,
            effectivePct: demoEffectiveScore(s),
            resultsJson: clone(s.resultsJson || null),
            integrityFlags: clone(s.integrityFlags || []),
            durationSec: s.durationSec,
            expectedSec: s.expectedSec,
            audioAvailable,
            audioMime: s.audioMime || null,
            audioBytes: s.audioBytes || 0,
            audioExpiresAt: s.audioExpiresAt || null,
            audioDeletedAt: s.audioDeletedAt || null,
            teacherOverridePct: s.teacherOverridePct,
            teacherComment: s.teacherComment || '',
            gradedAt: s.gradedAt || null,
            submittedAt: s.submittedAt,
          };
        });

      const assignmentSummary = {
        id: asgn.id,
        classId: asgn.classId,
        title: asgn.title,
        type: asgn.type,
        mode: asgn.mode,
        gradePolicy: asgn.gradePolicy,
      };
      const cache = loadCache();
      cache.submissionsByAsgn[assignmentId] = {
        assignment: assignmentSummary,
        submissions: rows,
        updatedAt: Date.now(),
      };
      saveCache(cache);
      return { ok: true, assignment: assignmentSummary, submissions: rows };
    },

    async gradeSubmission(submissionId, { teacherOverridePct, teacherComment } = {}) {
      if (!isDemoMode()) {
        const body = {};
        if (teacherOverridePct !== undefined) body.teacherOverridePct = teacherOverridePct;
        if (teacherComment !== undefined) body.teacherComment = teacherComment;
        return liveFetch(`/api/submissions/${encodeURIComponent(submissionId)}`, {
          method: 'PATCH',
          json: body,
        });
      }
      if (isOffline()) return offlineErr();
      const db = loadDemoDb();
      const auth = demoAuth(db);
      if (!auth) return demoErr(401, 'SESSION_INVALID', 'Session expired — please sign in again.');
      const blocked = assertDemoWritable(auth);
      if (blocked) return blocked;
      const sub = db.submissions.find(s => s.id === submissionId);
      if (!sub) return demoErr(404, 'SUBMISSION_NOT_FOUND', 'Submission not found.');

      let changed = false;
      if (teacherOverridePct !== undefined) {
        if (teacherOverridePct === null || teacherOverridePct === '') {
          sub.teacherOverridePct = null;
        } else {
          const num = Number(teacherOverridePct);
          if (!Number.isInteger(num) || num < 0 || num > 100) {
            return demoErr(400, 'INVALID_OVERRIDE', 'Grade override must be a whole number from 0 to 100.');
          }
          sub.teacherOverridePct = num;
        }
        changed = true;
      }
      if (teacherComment !== undefined) {
        sub.teacherComment = String(teacherComment == null ? '' : teacherComment).trim().slice(0, 2000);
        changed = true;
      }
      if (!changed) {
        return demoErr(400, 'NO_CHANGES', 'Provide teacherOverridePct and/or teacherComment to update.');
      }
      sub.gradedAt = Date.now();
      saveDemoDb();
      return {
        ok: true,
        submission: {
          id: sub.id,
          overallPct: sub.overallPct,
          rhythmPct: sub.rhythmPct,
          pitchPct: sub.pitchPct,
          teacherOverridePct: sub.teacherOverridePct,
          effectivePct: demoEffectiveScore(sub),
          teacherComment: sub.teacherComment || '',
          gradedAt: sub.gradedAt,
        },
      };
    },

    async deleteSubmissionAudio(submissionId) {
      if (!isDemoMode()) {
        return liveFetch(`/api/submissions/${encodeURIComponent(submissionId)}/audio`, { method: 'DELETE' });
      }
      if (isOffline()) return offlineErr();
      const db = loadDemoDb();
      const auth = demoAuth(db);
      if (!auth) return demoErr(401, 'SESSION_INVALID', 'Session expired — please sign in again.');
      const sub = db.submissions.find(s => s.id === submissionId);
      if (!sub) return demoErr(404, 'SUBMISSION_NOT_FOUND', 'Submission not found.');
      const now = Date.now();
      sub.audioAvailable = false;
      sub.audioDeletedAt = sub.audioDeletedAt || now;
      saveDemoDb();
      return {
        ok: true,
        submissionId: sub.id,
        audioDeleted: true,
        audioDeletedAt: sub.audioDeletedAt,
      };
    },

    async deleteSubmission(submissionId) {
      if (!isDemoMode()) {
        return liveFetch(`/api/submissions/${encodeURIComponent(submissionId)}`, { method: 'DELETE' });
      }
      if (isOffline()) return offlineErr();
      const db = loadDemoDb();
      const auth = demoAuth(db);
      if (!auth) return demoErr(401, 'SESSION_INVALID', 'Session expired — please sign in again.');
      const idx = db.submissions.findIndex(s => s.id === submissionId);
      if (idx < 0) return demoErr(404, 'SUBMISSION_NOT_FOUND', 'Submission not found.');
      db.submissions.splice(idx, 1);
      saveDemoDb();
      return { ok: true, deleted: true, submissionId };
    },

    async fetchSubmissionAudioUrl(submissionId) {
      if (!isDemoMode()) {
        if (isOffline()) {
          return offlineErr('Audio playback requires an internet connection.');
        }
        const res = await liveFetch(`/api/submissions/${encodeURIComponent(submissionId)}/audio`, {
          responseType: 'blob',
        });
        if (!res.ok) return res;
        const url = URL.createObjectURL(res.blob);
        return {
          ok: true,
          url,
          mime: res.mime,
          revoke: function () {
            try { URL.revokeObjectURL(url); } catch { }
          },
        };
      }

      const db = loadDemoDb();
      const auth = demoAuth(db);
      if (!auth) return demoErr(401, 'SESSION_INVALID', 'Session expired — please sign in again.');
      const sub = db.submissions.find(s => s.id === submissionId);
      if (!sub) return demoErr(404, 'SUBMISSION_NOT_FOUND', 'Submission not found.');
      const now = Date.now();
      if (!sub.audioAvailable || sub.audioDeletedAt || (sub.audioExpiresAt && sub.audioExpiresAt <= now)) {
        return demoErr(410, 'AUDIO_EXPIRED', 'This audio recording has expired or been deleted.');
      }
      const wavBlob = createScaleWavBlob();
      const url = URL.createObjectURL(wavBlob);
      return {
        ok: true,
        url,
        mime: 'audio/wav',
        revoke: function () {
          try { URL.revokeObjectURL(url); } catch { }
        },
      };
    },
  };

  if (typeof window !== 'undefined') {
    window.HW_TEACHER_API = HW_TEACHER_API;
  }
})();
