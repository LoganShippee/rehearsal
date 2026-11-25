'use strict';
/* Rehearsal Scan & Fix — OMR HTTP client, SHA-256 hashing, member auth helper,
   and local browser cache of verified scans.
   Communicates with the standalone Audiveris CLI wrapper service (tools/omr-service/)
   over HTTP/JSON/multipart so zero AGPL code ever enters Rehearsal's frontend. */

(function () {
  const DEFAULT_BASE = 'http://127.0.0.1:8788';
  const BASE_STORAGE_KEY = 'rehearsal-omr-api';
  const CACHE_STORAGE_KEY = 'rehearsal-scan-cache-v1';
  const MAX_CACHE_ENTRIES = 20;

  function cleanBase(raw) {
    if (!raw || typeof raw !== 'string') return '';
    return raw.trim().replace(/\/+$/, '');
  }

  function getQueryParam(name) {
    try {
      if (typeof location === 'undefined' || !location.search) return '';
      return new URLSearchParams(location.search).get(name) || '';
    } catch { return ''; }
  }

  function getBaseUrl() {
    const qp = cleanBase(getQueryParam('omrApi'));
    if (qp) return qp;
    if (typeof window !== 'undefined' && typeof window.REHEARSAL_OMR_API === 'string') {
      const w = cleanBase(window.REHEARSAL_OMR_API);
      if (w) return w;
    }
    try {
      const saved = cleanBase(localStorage.getItem(BASE_STORAGE_KEY));
      if (saved) return saved;
    } catch { }
    return DEFAULT_BASE;
  }

  function setBaseUrl(url) {
    const clean = cleanBase(url);
    try {
      if (clean) localStorage.setItem(BASE_STORAGE_KEY, clean);
      else localStorage.removeItem(BASE_STORAGE_KEY);
    } catch { }
    return getBaseUrl();
  }

  function resetBaseUrl() {
    try { localStorage.removeItem(BASE_STORAGE_KEY); } catch { }
    return getBaseUrl();
  }

  // ---------- member authentication (matches Rehearsal's existing teacher + student auth)
  function getMemberAuth() {
    try {
      const tApi = typeof window !== 'undefined' ? window.HW_TEACHER_API : null;
      const tTok = tApi && typeof tApi.getToken === 'function' ? tApi.getToken() : '';
      if (tTok) return { token: String(tTok), role: 'teacher' };
    } catch { }
    try {
      const sApi = typeof window !== 'undefined' ? window.HW_API : null;
      const sTok = sApi && typeof sApi.getToken === 'function' ? sApi.getToken() : '';
      if (sTok) return { token: String(sTok), role: 'student' };
    } catch { }
    return { token: '', role: null };
  }

  function isMemberSignInRequired(serverHealth) {
    if (serverHealth && serverHealth.authMode === 'required') return true;
    try {
      if (typeof location === 'undefined') return false;
      const qs = new URLSearchParams(location.search);
      if (qs.get('demo') === '1') return false;
      const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
      const isNative = !!(typeof window !== 'undefined' && window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.native);
      const hasServer = isLocal && location.protocol.startsWith('http') && !!qs.get('t');
      if (isNative || hasServer) return false;
      return !isLocal || qs.get('gate') === '1';
    } catch { return false; }
  }

  // ---------- SHA-256 upload hashing (Web Crypto primary, pure-JS fallback for non-HTTPS LAN)
  function sha256Fallback(bytes) {
    const K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    const len = bytes.length;
    const bitLenHi = Math.floor((len * 8) / 0x100000000);
    const bitLenLo = (len * 8) >>> 0;
    const padLen = ((len + 9 + 63) & ~63);
    const buf = new Uint8Array(padLen);
    buf.set(bytes);
    buf[len] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(padLen - 8, bitLenHi, false);
    dv.setUint32(padLen - 4, bitLenLo, false);
    const w = new Uint32Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let off = 0; off < padLen; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ ((~e) & g);
        const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0;
        d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
    }
    return [h0, h1, h2, h3, h4, h5, h6, h7].map(x => x.toString(16).padStart(8, '0')).join('');
  }

  async function hashBytes(input) {
    let ab;
    if (input instanceof ArrayBuffer) ab = input;
    else if (input instanceof Uint8Array) ab = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
    else if (input && typeof input.arrayBuffer === 'function') ab = await input.arrayBuffer();
    else return '';
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
      try {
        const digest = await crypto.subtle.digest('SHA-256', ab);
        return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
      } catch { }
    }
    return sha256Fallback(new Uint8Array(ab));
  }

  // ---------- local verified-scan cache (never stores unverified scans)
  function readLocalCacheMap() {
    try {
      const raw = localStorage.getItem(CACHE_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch { return {}; }
  }

  function writeLocalCacheMap(map) {
    try {
      const entries = Object.entries(map);
      if (entries.length > MAX_CACHE_ENTRIES) {
        entries.sort((a, b) => (Date.parse(b[1]?.confirmedAt || 0) || 0) - (Date.parse(a[1]?.confirmedAt || 0) || 0));
        const trimmed = {};
        for (const [k, v] of entries.slice(0, MAX_CACHE_ENTRIES)) trimmed[k] = v;
        localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(trimmed));
      } else {
        localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(map));
      }
    } catch { }
  }

  function getLocalCache(uploadHash) {
    if (!uploadHash) return null;
    const map = readLocalCacheMap();
    const hit = map[uploadHash];
    if (!hit || !hit.verified || !hit.musicxml) return null;
    return hit;
  }

  function setLocalCache(uploadHash, entry) {
    if (!uploadHash || !entry || !entry.musicxml) return false;
    const map = readLocalCacheMap();
    map[uploadHash] = {
      uploadHash,
      verified: true,
      title: entry.title || '',
      instrument: entry.instrument || 'auto',
      musicxml: entry.musicxml,
      confirmedAt: entry.confirmedAt || new Date().toISOString()
    };
    writeLocalCacheMap(map);
    return true;
  }

  function clearLocalCache() {
    try { localStorage.removeItem(CACHE_STORAGE_KEY); } catch { }
  }

  function uint8ToBase64(u8) {
    const bytes = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8);
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  // ---------- fetch helper with timeout
  async function fetchJson(url, opts = {}, timeoutMs = 15000) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timer = null;
    const onExternalAbort = () => ctrl && ctrl.abort();
    if (opts.signal && ctrl) {
      if (opts.signal.aborted) ctrl.abort();
      else opts.signal.addEventListener('abort', onExternalAbort, { once: true });
    }
    if (ctrl && timeoutMs > 0) timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const fetchOpts = Object.assign({}, opts);
      if (ctrl) fetchOpts.signal = ctrl.signal;
      const res = await fetch(url, fetchOpts);
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok && data.ok !== false, status: res.status, data };
    } catch (err) {
      const userAborted = !!(opts.signal && opts.signal.aborted);
      const timedOut = !userAborted && !!(err && err.name === 'AbortError');
      return {
        ok: false,
        status: 0,
        aborted: userAborted,
        timedOut,
        unreachable: !userAborted,
        error: userAborted
          ? 'Request cancelled.'
          : (timedOut ? 'Scan server took too long to respond.' : 'Could not reach the scan server.')
      };
    } finally {
      if (timer) clearTimeout(timer);
      if (opts.signal) opts.signal.removeEventListener('abort', onExternalAbort);
    }
  }

  // ---------- OMR service HTTP endpoints
  async function checkHealth(timeoutMs = 3500) {
    const base = getBaseUrl();
    const r = await fetchJson(base + '/health', { method: 'GET' }, timeoutMs);
    if (!r.ok) {
      return {
        ok: false,
        base,
        unreachable: !!r.unreachable,
        engine: 'audiveris',
        engineAvailable: false,
        queueDepth: 0,
        activeJobs: 0,
        authMode: 'optional',
        error: r.data?.error || r.error || 'Scan server is not running.'
      };
    }
    return Object.assign({ ok: true, base }, r.data);
  }

  async function checkRemoteCache(uploadHash) {
    if (!uploadHash) return { ok: false, hit: false };
    const base = getBaseUrl();
    const r = await fetchJson(base + '/api/scan/cache/' + encodeURIComponent(uploadHash), { method: 'GET' }, 5000);
    if (!r.ok) return { ok: false, hit: false };
    return Object.assign({ ok: true }, r.data, {
      alternateRuns: Array.isArray(r.data?.alternateRuns) ? r.data.alternateRuns : [],
      multiRun: r.data?.multiRun || 'off'
    });
  }

  async function createJob(file, opts = {}) {
    const base = getBaseUrl();
    const fd = new FormData();
    fd.append('file', file, file.name || 'scan.png');
    if (opts.instrument) fd.append('instrument', String(opts.instrument));
    if (opts.title) fd.append('title', String(opts.title));
    if (opts.scanMode) fd.append('scanMode', String(opts.scanMode));
    if (opts.multiRun != null) fd.append('multiRun', String(opts.multiRun));
    if (opts.skipCache) fd.append('skipCache', '1');
    const auth = getMemberAuth();
    const headers = {};
    if (auth.token) headers.Authorization = 'Bearer ' + auth.token;
    const r = await fetchJson(base + '/api/scan/jobs', {
      method: 'POST',
      headers,
      body: fd,
      signal: opts.signal
    }, 30000);
    if (!r.ok) {
      return {
        ok: false,
        status: r.status,
        unreachable: !!r.unreachable,
        error: r.data?.error || r.error || 'Could not start the scan.',
        errorCode: r.data?.errorCode || (r.unreachable ? 'SERVER_UNREACHABLE' : 'UPLOAD_FAILED')
      };
    }
    return Object.assign({ ok: true, httpStatus: r.status }, r.data);
  }

  async function getJob(jobId, signal) {
    const base = getBaseUrl();
    const auth = getMemberAuth();
    const headers = {};
    if (auth.token) headers.Authorization = 'Bearer ' + auth.token;
    const r = await fetchJson(base + '/api/scan/jobs/' + encodeURIComponent(jobId), {
      method: 'GET',
      headers,
      signal
    }, 15000);
    if (!r.ok) {
      return {
        ok: false,
        status: r.status,
        unreachable: !!r.unreachable,
        aborted: !!r.aborted,
        error: r.data?.error || r.error || 'Could not check scan status.',
        errorCode: r.data?.errorCode || 'POLL_FAILED'
      };
    }
    return Object.assign({ ok: true }, r.data, {
      alternateRuns: Array.isArray(r.data?.alternateRuns) ? r.data.alternateRuns : [],
      multiRun: r.data?.multiRun || 'off'
    });
  }

  async function pollJob(jobId, opts = {}) {
    const intervalMs = opts.intervalMs || 850;
    const timeoutMs = opts.timeoutMs || 600000;
    const started = Date.now();
    let consecutiveErrors = 0;
    while (true) {
      if (opts.signal && opts.signal.aborted) {
        return { ok: false, aborted: true, error: 'Scan cancelled.', errorCode: 'CANCELLED' };
      }
      const job = await getJob(jobId, opts.signal);
      if (!job.ok) {
        if (!job.aborted && (job.timedOut || job.unreachable) && consecutiveErrors < 5) {
          consecutiveErrors += 1;
          await new Promise((resolve) => {
            const t = setTimeout(resolve, intervalMs);
            if (opts.signal) {
              opts.signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
            }
          });
          continue;
        }
        return job;
      }
      consecutiveErrors = 0;
      if (typeof opts.onProgress === 'function') opts.onProgress(job, Date.now() - started);
      if (job.status === 'completed' || job.status === 'failed') return job;
      if (Date.now() - started > timeoutMs) {
        return {
          ok: false,
          status: 'failed',
          error: 'This scan took too long to finish. Try a single cleaner page or a sharper photo.',
          errorCode: 'POLL_TIMEOUT'
        };
      }
      await new Promise((resolve) => {
        const t = setTimeout(resolve, intervalMs);
        if (opts.signal) {
          opts.signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
        }
      });
    }
  }

  async function confirmJob(jobId, payload) {
    const base = getBaseUrl();
    const auth = getMemberAuth();
    const headers = { 'Content-Type': 'application/json' };
    if (auth.token) headers.Authorization = 'Bearer ' + auth.token;
    const r = await fetchJson(base + '/api/scan/jobs/' + encodeURIComponent(jobId) + '/confirm', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    }, 20000);
    if (!r.ok) {
      return {
        ok: false,
        status: r.status,
        unreachable: !!r.unreachable,
        error: r.data?.error || r.error || 'Could not save verified scan.',
        errorCode: r.data?.errorCode || (r.status === 401 ? 'UNAUTHORIZED' : 'CONFIRM_FAILED')
      };
    }
    return Object.assign({ ok: true }, r.data, {
      alternateRuns: Array.isArray(r.data?.alternateRuns) ? r.data.alternateRuns : [],
      multiRun: r.data?.multiRun || 'off'
    });
  }

  function originalUrl(jobId) {
    return getBaseUrl() + '/api/scan/jobs/' + encodeURIComponent(jobId) + '/original';
  }
  function rawUrl(jobId) {
    return getBaseUrl() + '/api/scan/jobs/' + encodeURIComponent(jobId) + '/raw';
  }
  function correctedMxlUrl(jobId) {
    return getBaseUrl() + '/api/scan/jobs/' + encodeURIComponent(jobId) + '/corrected.mxl';
  }

  const SCAN_CLIENT = {
    DEFAULT_BASE,
    getBaseUrl,
    setBaseUrl,
    resetBaseUrl,
    getMemberAuth,
    isMemberSignInRequired,
    hashBytes,
    getLocalCache,
    setLocalCache,
    clearLocalCache,
    uint8ToBase64,
    checkHealth,
    checkRemoteCache,
    createJob,
    getJob,
    pollJob,
    confirmJob,
    originalUrl,
    rawUrl,
    correctedMxlUrl
  };

  if (typeof window !== 'undefined') window.SCAN_CLIENT = SCAN_CLIENT;
  else if (typeof globalThis !== 'undefined') globalThis.SCAN_CLIENT = SCAN_CLIENT;
})();
