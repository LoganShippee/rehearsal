'use strict';
/* Rehearsal Online Homework — Teacher API Client & Offline Gradebook Cache.
   Connects Rehearsal Setup (web/hw-teacher.js & web/hw-teacher-drawer.js) to tools/hw-worker.
   Local Preview / Demo Mode lives in web/hw-teacher-demo.js (window.HW_TEACHER_DEMO).
   Never touches localStorage['rehearsal'] or IndexedDB 'rehearsal-files'. */

(function () {
  const LOCAL_API_KEY = 'rehearsal-hw-api';
  const LEGACY_WORKERS_BASE = 'https://rehearsal-hw.logan-shippee.workers.dev';
  const DEFAULT_API_BASE = 'https://api.rehearsalmusic.com';
  const DEMO_SENTINEL = 'demo';
  const TOKEN_KEY = 'rehearsal-hw-teacher-token';
  const CACHE_KEY = 'rehearsal-hw-teacher-cache-v1';
  const PREVIEW_DRAFT_KEY = 'rehearsal-hw-preview-draft-v1';

  const DAY_MS = 24 * 60 * 60 * 1000;
  const capsByBase = new Map();
  const MAX_SCORE_BYTES = 10 * 1024 * 1024;
  const DEFAULT_SOFT_CAP = 300;
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

  function apiErr(status, code, error, extra) {
    return { ok: false, status, code, error, ...(extra || {}) };
  }

  // ---------- Config / Mode
  function getApiBase() {
    try {
      if (typeof location !== 'undefined' && location.search) {
        const qs = new URLSearchParams(location.search);
        if (qs.get('demo') === '1') return '';
        // A link must not point a signed-in teacher at another server (it would receive their session token).
        const h = String(location.hostname || '').toLowerCase();
        const mayOverride = h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1' || h.endsWith('.localhost') || h.endsWith('.test') || h === 'rehearsal-staging.pages.dev';
        const overrideKey = mayOverride ? (qs.has('hwApi') ? 'hwApi' : (qs.has('api') ? 'api' : '')) : '';
        if (overrideKey) {
          const v = (qs.get(overrideKey) || '').trim().replace(/\/+$/, '');
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

  function isOffline() {
    if (demo && demo.getDemoOffline()) return true;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
    return false;
  }

  const PUBLIC_SITE_BASE = 'https://app.rehearsalmusic.com/';

  function resolvePageBase(relPath, remoteOverride) {
    const clean = String(relPath || '').replace(/^\/+/, '');
    try {
      const apiBase = getApiBase();
      const locHref = (typeof location !== 'undefined' && location.href) ? location.href : '';
      const isLoopback = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(locHref);
      if (!isDemoMode() && isLoopback && apiBase && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/i.test(apiBase)) {
        return remoteOverride || new URL(clean, PUBLIC_SITE_BASE).href;
      }
      if (locHref) return new URL(clean, locHref).href;
    } catch { }
    return new URL(clean, PUBLIC_SITE_BASE).href;
  }

  function getPublicDocUrl(relPath) {
    const clean = String(relPath || '').replace(/^\/+/, '');
    if (!clean) return PUBLIC_SITE_BASE;
    return resolvePageBase(clean);
  }

  function getStudentPortalUrl(joinCode) {
    const base = resolvePageBase(
      'hw.html',
      (typeof window !== 'undefined' && window.HW_STUDENT_PORTAL_URL) || 'https://app.rehearsalmusic.com/hw.html'
    );
    if (joinCode) {
      const code = formatCode(joinCode) || String(joinCode).trim();
      if (code) {
        const sep = base.includes('?') ? '&' : '?';
        return `${base}${sep}code=${encodeURIComponent(code)}`;
      }
    }
    return base;
  }

  function buildPreviewPortalUrl(previewToken, { demo: isDemo = false } = {}) {
    const base = getStudentPortalUrl('');
    try {
      const u = new URL(base, (typeof location !== 'undefined' && location.href) ? location.href : PUBLIC_SITE_BASE);
      u.searchParams.set('preview', String(previewToken || ''));
      if (isDemo) {
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
      return `${base}${sep}preview=${encodeURIComponent(String(previewToken || ''))}${isDemo ? '&demo=1' : ''}`;
    }
  }

  function triggerDownload(content, filename, mimeType) {
    try {
      // The Mac and Windows apps can't handle a browser-style download (it fails or closes the app);
      // ask the app to show its own Save dialog instead.
      if (typeof content === 'string' && typeof native === 'function' && native('saveText', { name: filename || 'download.csv', text: content })) return true;
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

  function validateScoreUpload(fileOrBlob, filename, defaultName) {
    const rawName = String(filename || (fileOrBlob && fileOrBlob.name) || defaultName).trim();
    const baseName = (rawName.split(/[/\\]/).pop() || defaultName).trim();
    const lower = baseName.toLowerCase();

    if (lower.endsWith('.mscz') || lower.endsWith('.mscx')) {
      return { err: apiErr(415, 'UNSUPPORTED_SCORE_FORMAT', MUSESCORE_UNSUPPORTED_MSG) };
    }
    if (!lower.endsWith('.mxl') && !lower.endsWith('.musicxml') && !lower.endsWith('.xml')) {
      return { err: apiErr(415, 'UNSUPPORTED_SCORE_FORMAT', 'Upload a MusicXML file (.mxl, .musicxml, or .xml).') };
    }
    if (!fileOrBlob) {
      return { err: apiErr(400, 'MISSING_FILE', 'Attach a MusicXML (.mxl or .musicxml) file.') };
    }
    const blob = fileOrBlob instanceof Blob
      ? fileOrBlob
      : new Blob([fileOrBlob], { type: 'application/octet-stream' });
    if (blob.size <= 0) {
      return { err: apiErr(400, 'EMPTY_FILE', 'Uploaded score file is empty.') };
    }
    if (blob.size > MAX_SCORE_BYTES) {
      return { err: apiErr(413, 'SCORE_TOO_LARGE', 'Score file is too large (10 MB maximum).') };
    }
    return { blob, baseName, lower };
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
        ...data,
        ok: false,
        status: res.status,
        code: data.code || 'HTTP_ERROR',
        error: data.error || `Request failed (${res.status})`,
      };
    }
    return { ok: true, status: res.status, ...data };
  }

  function getOAuthHandoffUrl({ state, googleClientId = '' } = {}) {
    const base = resolvePageBase(
      'hw-oauth.html',
      (typeof window !== 'undefined' && window.HW_OAUTH_PAGE_URL) || 'https://app.rehearsalmusic.com/hw-oauth.html'
    );
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

  const demo = (typeof window !== 'undefined' && window.HW_TEACHER_DEMO)
    ? window.HW_TEACHER_DEMO.create({
        getToken,
        isEphemeral,
        setSession,
        clearSession,
        isOffline,
        offlineErr,
        loadCache,
        saveCache,
        clearCache,
        buildPreviewPortalUrl,
        triggerDownload,
        buildGradebookCsvString,
        clone,
        generateCode6,
        normalizeEmail,
        makeId,
        randomHandoffHex,
        DAY_MS,
        DEFAULT_SOFT_CAP,
        PREVIEW_DRAFT_KEY,
      })
    : null;

  // ---------- Public API Object
  const HW_TEACHER_API = {
    INTEGRITY_FLAG_INFO,

    // Config & Mode
    getApiBase,
    setApiBase,
    isDemoMode,
    liveFetch,
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
    isOffline,
    getDemoOffline: () => (demo ? demo.getDemoOffline() : false),
    setDemoOffline: flag => (demo ? demo.setDemoOffline(flag) : false),
    setDemoPlan: status => (demo ? demo.setDemoPlan(status) : apiErr(501, 'DEMO_UNAVAILABLE', 'Demo mode is not loaded.')),
    resetDemoData: () => (demo ? demo.resetDemoData() : apiErr(501, 'DEMO_UNAVAILABLE', 'Demo mode is not loaded.')),
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
      if (isDemoMode()) return demo.emailStart({ email });
      return liveFetch('/api/auth/teacher/email/start', { method: 'POST', auth: false, json: { email } });
    },

    async emailVerify({ email, code, ephemeral = false, name = '', syncOnly = false }) {
      if (isDemoMode()) return demo.emailVerify({ email, code, ephemeral, name });
      const res = await liveFetch('/api/auth/teacher/email/verify', {
        method: 'POST',
        auth: false,
        json: { email, code, ephemeral: !!ephemeral, name, ...(syncOnly ? { syncOnly: true } : {}) },
      });
      if (res.ok && res.token) setSession(res.token, !!ephemeral);
      return res;
    },

    async oauthHandoffStart({ ephemeral = false, syncOnly = false } = {}) {
      if (isDemoMode()) return demo.oauthHandoffStart({ ephemeral });
      return liveFetch('/api/auth/teacher/oauth/start', {
        method: 'POST',
        auth: false,
        json: { ephemeral: !!ephemeral, ...(syncOnly ? { syncOnly: true } : {}) },
      });
    },

    async oauthHandoffPoll({ state, pollSecret, ephemeral = false } = {}) {
      if (isDemoMode()) return demo.oauthHandoffPoll({ state, pollSecret, ephemeral });
      const res = await liveFetch('/api/auth/teacher/oauth/poll', {
        method: 'POST',
        auth: false,
        json: { state, pollSecret },
      });
      if (res.ok && res.status === 'complete' && res.token) {
        setSession(res.token, !!ephemeral);
      }
      return res;
    },

    async googleAuth({ idToken, ephemeral = false, syncOnly = false }) {
      if (isDemoMode()) return demo.googleAuth({ ephemeral });
      const res = await liveFetch('/api/auth/teacher/google', {
        method: 'POST',
        auth: false,
        json: { idToken, ephemeral: !!ephemeral, ...(syncOnly ? { syncOnly: true } : {}) },
      });
      if (res.ok && res.token) setSession(res.token, !!ephemeral);
      return res;
    },

    async getMe() {
      if (isDemoMode()) return demo.getMe();
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
    },

    async logout() {
      if (isDemoMode()) return demo.logout();
      const res = await liveFetch('/api/auth/teacher/logout', { method: 'POST', json: {} }).catch(() => ({ ok: true }));
      clearSession();
      clearCache();
      return res.ok ? res : { ok: true };
    },

    async logoutAll() {
      if (isDemoMode()) return demo.logoutAll();
      const res = await liveFetch('/api/auth/teacher/logout-all', { method: 'POST', json: {} });
      if (res.ok) {
        clearSession();
        clearCache();
      }
      return res;
    },

    // Billing
    async billingCheckout(interval) {
      if (isDemoMode()) return demo.billingCheckout();
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
    },

    async billingPortal() {
      if (isDemoMode()) return demo.billingPortal();
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
    },

    // Starts the 30-day trial for an account that signed in only for backup. Nothing starts until this is called.
    async startTrial() {
      if (isDemoMode()) return demo.startTrial();
      return liveFetch('/api/teacher/start-trial', { method: 'POST', json: {} });
    },

    // Beta access code: gives the teacher a free Purchase Order plan for a set time.
    async redeemBeta(code) {
      if (isDemoMode()) return demo.redeemBeta(code);
      return liveFetch('/api/teacher/redeem-beta', { method: 'POST', json: { code } });
    },

    // Classes
    async listClasses(includeArchived = false) {
      if (isDemoMode()) return demo.listClasses(includeArchived);
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
    },

    async createClass({ name, locked = false }) {
      if (isDemoMode()) return demo.createClass({ name, locked });
      return liveFetch('/api/classes', { method: 'POST', json: { name, locked: !!locked } });
    },

    async updateClass(classId, patch) {
      if (isDemoMode()) return demo.updateClass(classId, patch);
      return liveFetch(`/api/classes/${encodeURIComponent(classId)}`, { method: 'PATCH', json: patch || {} });
    },

    async deleteClass(classId) {
      if (isDemoMode()) return demo.deleteClass(classId);
      return liveFetch(`/api/classes/${encodeURIComponent(classId)}`, { method: 'DELETE' });
    },

    // Test student: a sign-in for the teacher to try the student side. Demo just returns a fixed token.
    async openTestStudent(classId) {
      if (isDemoMode()) return demo.openTestStudent();
      return liveFetch(`/api/classes/${encodeURIComponent(classId)}/test-student/open`, { method: 'POST', json: {} });
    },

    // Students
    async listStudents(classId, includeArchived = false) {
      if (isDemoMode()) return demo.listStudents(classId, includeArchived);
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
    },

    async addStudents(classId, students, generateCode = true) {
      const list = Array.isArray(students) ? students : [students];
      if (isDemoMode()) return demo.addStudents(classId, list, generateCode);
      return liveFetch(`/api/classes/${encodeURIComponent(classId)}/students`, {
        method: 'POST',
        json: { students: list, generateCode: generateCode !== false },
      });
    },

    async updateStudent(classId, studentId, patch) {
      if (isDemoMode()) return demo.updateStudent(classId, studentId, patch);
      return liveFetch(
        `/api/classes/${encodeURIComponent(classId)}/students/${encodeURIComponent(studentId)}`,
        { method: 'PATCH', json: patch || {} }
      );
    },

    async deleteStudent(classId, studentId) {
      if (isDemoMode()) return demo.deleteStudent(classId, studentId);
      return liveFetch(
        `/api/classes/${encodeURIComponent(classId)}/students/${encodeURIComponent(studentId)}`,
        { method: 'DELETE' }
      );
    },

    // Student codes for the roster's "Show codes" toggle: { studentId: 'ABC-123' | null }.
    // Never cached: codes are only held in memory while the toggle is on.
    async listStudentCodes(classId) {
      if (isDemoMode()) return demo.listStudentCodes();
      return liveFetch(`/api/classes/${encodeURIComponent(classId)}/students/codes`);
    },

    async regenerateStudentCode(classId, studentId, revokeSessions = true) {
      if (isDemoMode()) return demo.regenerateStudentCode(classId, studentId, revokeSessions);
      return liveFetch(
        `/api/classes/${encodeURIComponent(classId)}/students/${encodeURIComponent(studentId)}/regenerate-code`,
        { method: 'POST', json: { revokeSessions: revokeSessions !== false } }
      );
    },

    async regenerateClassCodes(classId, opts = {}) {
      if (isDemoMode()) return demo.regenerateClassCodes(classId, opts);
      return liveFetch(
        `/api/classes/${encodeURIComponent(classId)}/regenerate-codes`,
        { method: 'POST', json: opts || {} }
      );
    },

    async revokeStudentSessions(classId, studentId) {
      if (isDemoMode()) return demo.revokeStudentSessions(classId, studentId);
      return liveFetch(
        `/api/classes/${encodeURIComponent(classId)}/students/${encodeURIComponent(studentId)}/revoke-sessions`,
        { method: 'POST', json: {} }
      );
    },

    async revokeClassSessions(classId) {
      if (isDemoMode()) return demo.revokeClassSessions(classId);
      return liveFetch(
        `/api/classes/${encodeURIComponent(classId)}/revoke-sessions`,
        { method: 'POST', json: {} }
      );
    },

    // Assignments & Score Upload
    async listAssignments(classId, includeArchived = false) {
      if (isDemoMode()) return demo.listAssignments(classId, includeArchived);
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
    },

    async createAssignment(classId, body) {
      if (isDemoMode()) return demo.createAssignment(classId, body);
      return liveFetch(`/api/classes/${encodeURIComponent(classId)}/assignments`, {
        method: 'POST',
        json: body || {},
      });
    },

    async updateAssignment(assignmentId, patch) {
      if (isDemoMode()) return demo.updateAssignment(assignmentId, patch);
      return liveFetch(`/api/assignments/${encodeURIComponent(assignmentId)}`, {
        method: 'PATCH',
        json: patch || {},
      });
    },

    async deleteAssignment(assignmentId) {
      if (isDemoMode()) return demo.deleteAssignment(assignmentId);
      return liveFetch(`/api/assignments/${encodeURIComponent(assignmentId)}`, { method: 'DELETE' });
    },

    async uploadAssignmentScore(assignmentId, fileOrBlob, filename) {
      const checked = validateScoreUpload(fileOrBlob, filename, 'score.musicxml');
      if (checked.err) return checked.err;
      if (isDemoMode()) return demo.uploadAssignmentScore(assignmentId, checked);
      // Use FormData with ONLY Authorization header (never manual Content-Type or X-Filename)
      const form = new FormData();
      form.append('file', checked.blob, checked.baseName);
      return liveFetch(`/api/assignments/${encodeURIComponent(assignmentId)}/score`, {
        method: 'PUT',
        formData: form,
      });
    },

    // ---------- Practice tracks: free-practice files shared with a whole class (not graded)
    async listPracticeTracks(classId, includeArchived = false) {
      if (isDemoMode()) return demo.listPracticeTracks(classId, includeArchived);
      return liveFetch(`/api/classes/${encodeURIComponent(classId)}/practice-tracks${includeArchived ? '?includeArchived=1' : ''}`);
    },

    async uploadPracticeTrack(classId, fileOrBlob, filename, title) {
      const checked = validateScoreUpload(fileOrBlob, filename, 'track.musicxml');
      if (checked.err) return checked.err;
      const cleanTitle = String(title || '').trim().slice(0, 120) || checked.baseName.replace(/\.[^.]+$/, '');
      if (isDemoMode()) return demo.uploadPracticeTrack(classId, checked, cleanTitle);
      // FormData with ONLY the Authorization header, so the browser sets the multipart boundary
      const form = new FormData();
      form.append('file', checked.blob, checked.baseName);
      form.append('title', cleanTitle);
      return liveFetch(`/api/classes/${encodeURIComponent(classId)}/practice-tracks`, {
        method: 'POST',
        formData: form,
      });
    },

    async updatePracticeTrack(trackId, patch) {
      if (isDemoMode()) return demo.updatePracticeTrack(trackId, patch);
      return liveFetch(`/api/practice-tracks/${encodeURIComponent(trackId)}`, {
        method: 'PATCH',
        json: patch || {},
      });
    },

    async deletePracticeTrack(trackId) {
      if (isDemoMode()) return demo.deletePracticeTrack(trackId);
      return liveFetch(`/api/practice-tracks/${encodeURIComponent(trackId)}`, { method: 'DELETE' });
    },

    // The assignment's score file, so the submission review can show the graded notes on the real music.
    async downloadAssignmentScore(assignmentId) {
      if (isDemoMode()) return demo.downloadAssignmentScore(assignmentId);
      if (isOffline()) return offlineErr('Showing the score needs an internet connection.');
      return liveFetch(`/api/assignments/${encodeURIComponent(assignmentId)}/score`, { responseType: 'blob' });
    },

    async createAssignmentPreview(assignmentId) {
      if (isDemoMode()) return demo.createAssignmentPreview(assignmentId);
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
      if (isDemoMode()) return demo.getGradebook(classId);
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
    },

    async downloadGradebookCsv(classId, assignmentId) {
      if (isDemoMode()) return demo.downloadGradebookCsv(classId, assignmentId);
      if (!isOffline()) {
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

      const cache = loadCache();
      const gb = cache.gradebookByClass[classId] || null;
      const subsForAsgn = assignmentId ? cache.submissionsByAsgn[assignmentId]?.submissions : null;
      if (!gb) {
        return offlineErr('Gradebook is not cached for offline CSV export yet. Open the gradebook while online first.');
      }
      const built = buildGradebookCsvString(gb, assignmentId, subsForAsgn);
      if (!built) return apiErr(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment not found in gradebook.');
      triggerDownload(built.csv, built.filename, 'text/csv;charset=utf-8');
      return { ok: true, filename: built.filename, fromCache: isOffline() };
    },

    async listSubmissions(assignmentId) {
      if (isDemoMode()) return demo.listSubmissions(assignmentId);
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
    },

    async gradeSubmission(submissionId, { teacherOverridePct, teacherComment } = {}) {
      if (isDemoMode()) return demo.gradeSubmission(submissionId, { teacherOverridePct, teacherComment });
      const body = {};
      if (teacherOverridePct !== undefined) body.teacherOverridePct = teacherOverridePct;
      if (teacherComment !== undefined) body.teacherComment = teacherComment;
      return liveFetch(`/api/submissions/${encodeURIComponent(submissionId)}`, {
        method: 'PATCH',
        json: body,
      });
    },

    async deleteSubmissionAudio(submissionId) {
      if (isDemoMode()) return demo.deleteSubmissionAudio(submissionId);
      return liveFetch(`/api/submissions/${encodeURIComponent(submissionId)}/audio`, { method: 'DELETE' });
    },

    async deleteSubmission(submissionId) {
      if (isDemoMode()) return demo.deleteSubmission(submissionId);
      return liveFetch(`/api/submissions/${encodeURIComponent(submissionId)}`, { method: 'DELETE' });
    },

    async fetchSubmissionAudioUrl(submissionId) {
      if (isDemoMode()) return demo.fetchSubmissionAudioUrl(submissionId);
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
    },
  };

  if (typeof window !== 'undefined') {
    window.HW_TEACHER_API = HW_TEACHER_API;
  }
})();
