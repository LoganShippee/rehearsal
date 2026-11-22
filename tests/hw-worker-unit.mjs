// Unit & ESM import test suite for tools/hw-worker/src/*.js.
// Runs directly under macOS JavaScriptCore (zero Node required):
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -m tests/hw-worker-unit.mjs
// Also compatible with Node.js 18+:
//   node tests/hw-worker-unit.mjs

// ============================================================================
// 1. Minimal Web-API & WebCrypto Polyfills for JavaScriptCore (jsc)
//    Must be installed BEFORE any dynamic import() because crypto.js calls
//    `new TextEncoder()` at module top level.
// ============================================================================

if (typeof globalThis.console === 'undefined') {
  const fmt = args => args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  globalThis.console = {
    log: (...args) => print(fmt(args)),
    warn: (...args) => print('[WARN]', fmt(args)),
    error: (...args) => print('[ERR]', fmt(args)),
  };
}

if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = class TextEncoder {
    encode(str = '') {
      const s = String(str);
      const out = [];
      for (let i = 0; i < s.length; i++) {
        let cp = s.charCodeAt(i);
        if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < s.length) {
          const lo = s.charCodeAt(++i);
          cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
        }
        if (cp < 0x80) {
          out.push(cp);
        } else if (cp < 0x800) {
          out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
        } else if (cp < 0x10000) {
          out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
        } else {
          out.push(
            0xf0 | (cp >> 18),
            0x80 | ((cp >> 12) & 0x3f),
            0x80 | ((cp >> 6) & 0x3f),
            0x80 | (cp & 0x3f)
          );
        }
      }
      return new Uint8Array(out);
    }
  };
}

if (typeof globalThis.TextDecoder === 'undefined') {
  globalThis.TextDecoder = class TextDecoder {
    decode(input = new Uint8Array(0)) {
      const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
      let out = '';
      for (let i = 0; i < bytes.length; ) {
        const b0 = bytes[i++];
        if (b0 < 0x80) {
          out += String.fromCharCode(b0);
        } else if ((b0 & 0xe0) === 0xc0) {
          const b1 = bytes[i++] & 0x3f;
          out += String.fromCharCode(((b0 & 0x1f) << 6) | b1);
        } else if ((b0 & 0xf0) === 0xe0) {
          const b1 = bytes[i++] & 0x3f;
          const b2 = bytes[i++] & 0x3f;
          out += String.fromCharCode(((b0 & 0x0f) << 12) | (b1 << 6) | b2);
        } else {
          const b1 = bytes[i++] & 0x3f;
          const b2 = bytes[i++] & 0x3f;
          const b3 = bytes[i++] & 0x3f;
          let cp = (((b0 & 0x07) << 18) | (b1 << 12) | (b2 << 6) | b3) - 0x10000;
          out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
        }
      }
      return out;
    }
  };
}

if (typeof globalThis.atob === 'undefined') {
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  globalThis.atob = function atob(input) {
    const str = String(input).replace(/[\t\n\f\r ]+/g, '').replace(/=+$/, '');
    let out = '';
    for (let i = 0; i < str.length; ) {
      const a = B64.indexOf(str[i++]);
      const b = B64.indexOf(str[i++]);
      const c = i < str.length ? B64.indexOf(str[i++]) : -1;
      const d = i < str.length ? B64.indexOf(str[i++]) : -1;
      out += String.fromCharCode((a << 2) | (b >> 4));
      if (c >= 0) out += String.fromCharCode(((b & 15) << 4) | (c >> 2));
      if (d >= 0) out += String.fromCharCode(((c & 3) << 6) | d);
    }
    return out;
  };
}

if (typeof globalThis.btoa === 'undefined') {
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  globalThis.btoa = function btoa(input) {
    const str = String(input);
    let out = '';
    for (let i = 0; i < str.length; i += 3) {
      const a = str.charCodeAt(i);
      const b = i + 1 < str.length ? str.charCodeAt(i + 1) : NaN;
      const c = i + 2 < str.length ? str.charCodeAt(i + 2) : NaN;
      out += B64[a >> 2];
      out += B64[((a & 3) << 4) | (isNaN(b) ? 0 : b >> 4)];
      out += isNaN(b) ? '=' : B64[((b & 15) << 2) | (isNaN(c) ? 0 : c >> 6)];
      out += isNaN(c) ? '=' : B64[c & 63];
    }
    return out;
  };
}

if (typeof globalThis.URLSearchParams === 'undefined') {
  globalThis.URLSearchParams = class URLSearchParams {
    constructor(init = '') {
      this._entries = [];
      if (typeof init === 'string') {
        const s = init.startsWith('?') ? init.slice(1) : init;
        if (s) {
          for (const part of s.split('&')) {
            if (!part) continue;
            const eq = part.indexOf('=');
            const k = decodeURIComponent((eq >= 0 ? part.slice(0, eq) : part).replace(/\+/g, ' '));
            const v = eq >= 0 ? decodeURIComponent(part.slice(eq + 1).replace(/\+/g, ' ')) : '';
            this._entries.push([k, v]);
          }
        }
      }
    }
    get(key) {
      const found = this._entries.find(([k]) => k === key);
      return found ? found[1] : null;
    }
    set(key, value) {
      const idx = this._entries.findIndex(([k]) => k === key);
      if (idx >= 0) this._entries[idx][1] = String(value);
      else this._entries.push([String(key), String(value)]);
    }
    append(key, value) { this._entries.push([String(key), String(value)]); }
    has(key) { return this._entries.some(([k]) => k === key); }
    toString() {
      return this._entries
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');
    }
    [Symbol.iterator]() { return this._entries[Symbol.iterator](); }
  };
}

if (typeof globalThis.URL === 'undefined') {
  globalThis.URL = class URL {
    constructor(raw) {
      const m = String(raw).match(/^([a-zA-Z][a-zA-Z0-9+.-]*:)\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/);
      if (!m) throw new TypeError(`Invalid URL: ${raw}`);
      this.protocol = m[1];
      this.host = m[2];
      this.origin = `${m[1]}//${m[2]}`;
      this.pathname = m[3] || '/';
      this.search = m[4] || '';
      this.hash = m[5] || '';
      this.searchParams = new globalThis.URLSearchParams(this.search);
      this.href = String(raw);
    }
    toString() { return this.href; }
  };
}

if (typeof globalThis.Headers === 'undefined') {
  globalThis.Headers = class Headers {
    constructor(init = {}) {
      this._map = new Map();
      if (init instanceof Headers) {
        for (const [k, v] of init.entries()) this.set(k, v);
      } else if (init && typeof init === 'object') {
        for (const [k, v] of Object.entries(init)) this.set(k, v);
      }
    }
    get(k) { return this._map.get(String(k).toLowerCase()) ?? null; }
    set(k, v) { this._map.set(String(k).toLowerCase(), String(v)); }
    has(k) { return this._map.has(String(k).toLowerCase()); }
    delete(k) { this._map.delete(String(k).toLowerCase()); }
    entries() { return this._map.entries(); }
    forEach(cb) { for (const [k, v] of this._map.entries()) cb(v, k, this); }
    [Symbol.iterator]() { return this._map.entries(); }
  };
}

if (typeof globalThis.Response === 'undefined') {
  globalThis.Response = class Response {
    constructor(body = null, init = {}) {
      this._body = body;
      this.status = init.status ?? 200;
      this.ok = this.status >= 200 && this.status < 300;
      this.headers = new globalThis.Headers(init.headers || {});
    }
    async text() {
      if (this._body == null) return '';
      if (typeof this._body === 'string') return this._body;
      if (this._body instanceof Uint8Array) return new globalThis.TextDecoder().decode(this._body);
      if (this._body instanceof ArrayBuffer) return new globalThis.TextDecoder().decode(new Uint8Array(this._body));
      return String(this._body);
    }
    async json() { return JSON.parse(await this.text()); }
    async arrayBuffer() {
      if (this._body instanceof ArrayBuffer) return this._body;
      if (this._body instanceof Uint8Array) return this._body.buffer.slice(this._body.byteOffset, this._body.byteOffset + this._body.byteLength);
      const enc = new globalThis.TextEncoder().encode(await this.text());
      return enc.buffer;
    }
    static redirect(url, status = 302) {
      return new Response(null, { status, headers: { Location: String(url) } });
    }
  };
}

if (typeof globalThis.Request === 'undefined') {
  globalThis.Request = class Request {
    constructor(url, init = {}) {
      this.url = String(url);
      this.method = (init.method || 'GET').toUpperCase();
      this.headers = new globalThis.Headers(init.headers || {});
      this._body = init.body ?? null;
    }
    async text() {
      if (this._body == null) return '';
      if (typeof this._body === 'string') return this._body;
      if (this._body instanceof Uint8Array) return new globalThis.TextDecoder().decode(this._body);
      return String(this._body);
    }
    async json() { return JSON.parse(await this.text()); }
    async arrayBuffer() {
      if (this._body instanceof ArrayBuffer) return this._body;
      if (this._body instanceof Uint8Array) return this._body.buffer.slice(this._body.byteOffset, this._body.byteOffset + this._body.byteLength);
      return new globalThis.TextEncoder().encode(await this.text()).buffer;
    }
  };
}

// Pure-JS FIPS 180-4 SHA-256, RFC 2104 HMAC-SHA256, RFC 2898 PBKDF2-SHA256
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.subtle) {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const W = new Uint32Array(64);

  function toU8(data) {
    if (data instanceof Uint8Array) return data;
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    return new globalThis.TextEncoder().encode(String(data));
  }

  function sha256Compress(state, block, offset) {
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      W[i] = ((block[j] << 24) | (block[j + 1] << 16) | (block[j + 2] << 8) | block[j + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const w15 = W[i - 15];
      const w2 = W[i - 2];
      const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
      const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let a = state[0], b = state[1], c = state[2], d = state[3];
    let e = state[4], f = state[5], g = state[6], h = state[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }

  function sha256Raw(msg, out = new Uint8Array(32)) {
    const len = msg.length;
    const totalLen = ((len + 9 + 63) >> 6) << 6;
    const padded = new Uint8Array(totalLen);
    padded.set(msg, 0);
    padded[len] = 0x80;
    const bitLenHi = Math.floor(len / 0x20000000);
    const bitLenLo = (len << 3) >>> 0;
    padded[totalLen - 8] = (bitLenHi >>> 24) & 0xff;
    padded[totalLen - 7] = (bitLenHi >>> 16) & 0xff;
    padded[totalLen - 6] = (bitLenHi >>> 8) & 0xff;
    padded[totalLen - 5] = bitLenHi & 0xff;
    padded[totalLen - 4] = (bitLenLo >>> 24) & 0xff;
    padded[totalLen - 3] = (bitLenLo >>> 16) & 0xff;
    padded[totalLen - 2] = (bitLenLo >>> 8) & 0xff;
    padded[totalLen - 1] = bitLenLo & 0xff;

    const state = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
    for (let off = 0; off < totalLen; off += 64) {
      sha256Compress(state, padded, off);
    }
    for (let i = 0; i < 8; i++) {
      out[i * 4] = (state[i] >>> 24) & 0xff;
      out[i * 4 + 1] = (state[i] >>> 16) & 0xff;
      out[i * 4 + 2] = (state[i] >>> 8) & 0xff;
      out[i * 4 + 3] = state[i] & 0xff;
    }
    return out;
  }

  function makeHmacSha256(keyBytes) {
    let k = keyBytes;
    if (k.length > 64) k = sha256Raw(k);
    const ipad = new Uint8Array(64);
    const opad = new Uint8Array(64);
    for (let i = 0; i < 64; i++) {
      const kb = i < k.length ? k[i] : 0;
      ipad[i] = kb ^ 0x36;
      opad[i] = kb ^ 0x5c;
    }
    // Precompute inner and outer first-block SHA-256 states for fast PBKDF2
    const initState = [
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ];
    const innerBase = new Uint32Array(initState);
    sha256Compress(innerBase, ipad, 0);
    const outerBase = new Uint32Array(initState);
    sha256Compress(outerBase, opad, 0);

    const outerBlock = new Uint8Array(64);
    outerBlock[32] = 0x80;
    outerBlock[62] = 0x03; // (64 + 32) * 8 = 768 = 0x300
    outerBlock[63] = 0x00;

    const tmpState = new Uint32Array(8);
    const innerOut = new Uint8Array(32);

    return function hmac(msg, out = new Uint8Array(32)) {
      const totalInnerLen = 64 + msg.length;
      const remLen = ((msg.length + 9 + 63) >> 6) << 6;
      const buf = new Uint8Array(remLen);
      buf.set(msg, 0);
      buf[msg.length] = 0x80;
      const bitHi = Math.floor(totalInnerLen / 0x20000000);
      const bitLo = (totalInnerLen << 3) >>> 0;
      buf[remLen - 8] = (bitHi >>> 24) & 0xff;
      buf[remLen - 7] = (bitHi >>> 16) & 0xff;
      buf[remLen - 6] = (bitHi >>> 8) & 0xff;
      buf[remLen - 5] = bitHi & 0xff;
      buf[remLen - 4] = (bitLo >>> 24) & 0xff;
      buf[remLen - 3] = (bitLo >>> 16) & 0xff;
      buf[remLen - 2] = (bitLo >>> 8) & 0xff;
      buf[remLen - 1] = bitLo & 0xff;

      tmpState.set(innerBase);
      for (let off = 0; off < remLen; off += 64) sha256Compress(tmpState, buf, off);
      for (let i = 0; i < 8; i++) {
        outerBlock[i * 4] = (tmpState[i] >>> 24) & 0xff;
        outerBlock[i * 4 + 1] = (tmpState[i] >>> 16) & 0xff;
        outerBlock[i * 4 + 2] = (tmpState[i] >>> 8) & 0xff;
        outerBlock[i * 4 + 3] = tmpState[i] & 0xff;
      }

      tmpState.set(outerBase);
      sha256Compress(tmpState, outerBlock, 0);
      for (let i = 0; i < 8; i++) {
        out[i * 4] = (tmpState[i] >>> 24) & 0xff;
        out[i * 4 + 1] = (tmpState[i] >>> 16) & 0xff;
        out[i * 4 + 2] = (tmpState[i] >>> 8) & 0xff;
        out[i * 4 + 3] = tmpState[i] & 0xff;
      }
      return out;
    };
  }

  function pbkdf2Sha256(passwordBytes, saltBytes, iterations, dkLenBytes) {
    const hmac = makeHmacSha256(passwordBytes);
    const numBlocks = Math.ceil(dkLenBytes / 32);
    const dk = new Uint8Array(numBlocks * 32);
    const u = new Uint8Array(32);
    const t = new Uint8Array(32);
    const saltBlock = new Uint8Array(saltBytes.length + 4);
    saltBlock.set(saltBytes, 0);

    for (let blockIdx = 1; blockIdx <= numBlocks; blockIdx++) {
      saltBlock[saltBytes.length] = (blockIdx >>> 24) & 0xff;
      saltBlock[saltBytes.length + 1] = (blockIdx >>> 16) & 0xff;
      saltBlock[saltBytes.length + 2] = (blockIdx >>> 8) & 0xff;
      saltBlock[saltBytes.length + 3] = blockIdx & 0xff;
      hmac(saltBlock, u);
      t.set(u);
      for (let iter = 1; iter < iterations; iter++) {
        hmac(u, u);
        for (let k = 0; k < 32; k++) t[k] ^= u[k];
      }
      dk.set(t, (blockIdx - 1) * 32);
    }
    return dk.slice(0, dkLenBytes);
  }

  let prngState = (Date.now() ^ 0x9e3779b9) >>> 0;
  function nextByte() {
    // xorshift32 mixed with Math.random for varied test randomness
    prngState ^= prngState << 13;
    prngState ^= prngState >>> 17;
    prngState ^= prngState << 5;
    return ((prngState >>> 0) ^ Math.floor(Math.random() * 256)) & 0xff;
  }

  globalThis.crypto = {
    getRandomValues(arr) {
      const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
      for (let i = 0; i < bytes.length; i++) bytes[i] = nextByte();
      return arr;
    },
    subtle: {
      async digest(algo, data) {
        const name = typeof algo === 'string' ? algo : algo?.name;
        if (String(name).toUpperCase() !== 'SHA-256') throw new Error(`Unsupported digest: ${name}`);
        return sha256Raw(toU8(data)).buffer;
      },
      async importKey(format, keyData, algo) {
        if (format !== 'raw') throw new Error(`Unsupported importKey format: ${format}`);
        return { algo, keyBytes: new Uint8Array(toU8(keyData)) };
      },
      async sign(algo, key, data) {
        const name = typeof algo === 'string' ? algo : algo?.name;
        if (String(name).toUpperCase() !== 'HMAC') throw new Error(`Unsupported sign: ${name}`);
        const hmac = makeHmacSha256(key.keyBytes);
        return hmac(toU8(data)).buffer;
      },
      async deriveBits(params, key, bitLen) {
        if (String(params?.name).toUpperCase() !== 'PBKDF2') throw new Error(`Unsupported KDF: ${params?.name}`);
        const dk = pbkdf2Sha256(key.keyBytes, toU8(params.salt), params.iterations, bitLen / 8);
        return dk.buffer;
      },
    },
  };
}

// ============================================================================
// 2. Assertion harness
// ============================================================================

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${msg}`);
    throw new Error(`Assertion failed: ${msg}`);
  }
  passed++;
}

function assertEq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failed++;
    console.error(`FAIL: ${msg} (expected ${e}, got ${a})`);
    throw new Error(`Assertion failed: ${msg} (expected ${e}, got ${a})`);
  }
  passed++;
}

// ============================================================================
// 3. Dynamic import of ALL worker modules & unit test suite
// ============================================================================

async function main() {
  const [
    utilMod,
    cryptoMod,
    rateLimitMod,
    billingMod,
    authMod,
    classesMod,
    assignmentsMod,
    submissionsMod,
    cronMod,
    indexMod,
  ] = await Promise.all([
    import('../tools/hw-worker/src/util.js'),
    import('../tools/hw-worker/src/crypto.js'),
    import('../tools/hw-worker/src/rate-limit.js'),
    import('../tools/hw-worker/src/billing.js'),
    import('../tools/hw-worker/src/auth.js'),
    import('../tools/hw-worker/src/classes.js'),
    import('../tools/hw-worker/src/assignments.js'),
    import('../tools/hw-worker/src/submissions.js'),
    import('../tools/hw-worker/src/cron.js'),
    import('../tools/hw-worker/src/index.js'),
  ]);

  // --- Module & Router export verification
  assert(typeof indexMod.default?.fetch === 'function', 'index.js default.fetch is a function');
  assert(typeof indexMod.default?.scheduled === 'function', 'index.js default.scheduled is a function');
  assert(typeof rateLimitMod.checkRateLimit === 'function', 'rate-limit.js exports checkRateLimit');
  assert(typeof authMod.requireTeacher === 'function', 'auth.js exports requireTeacher');
  assert(typeof authMod.requireStudent === 'function', 'auth.js exports requireStudent');
  assert(typeof classesMod.handleListClasses === 'function', 'classes.js exports handleListClasses');
  assert(typeof assignmentsMod.stripTrueSightReadExcerpt === 'function', 'assignments.js exports stripTrueSightReadExcerpt');
  assert(typeof submissionsMod.validateAndRecomputeSubmission === 'function', 'submissions.js exports validateAndRecomputeSubmission');
  assert(typeof cronMod.runDailyCleanup === 'function', 'cron.js exports runDailyCleanup');

  // --- Router smoke test: GET /api/health, OPTIONS, GET /privacy
  {
    const healthRes = await indexMod.default.fetch(
      new Request('https://hw.example.com/api/health', { method: 'GET' }),
      { DEV_MODE: 'true', APP_ORIGINS: '*' },
      {}
    );
    assertEq(healthRes.status, 200, 'GET /api/health returns 200');
    const healthBody = await healthRes.json();
    assertEq(healthBody.ok, true, 'health ok=true');
    assertEq(healthBody.service, 'rehearsal-hw', 'health service name');
    assertEq(healthBody.devMode, true, 'health devMode=true');

    const optRes = await indexMod.default.fetch(
      new Request('https://hw.example.com/api/classes', {
        method: 'OPTIONS',
        headers: { origin: 'https://loganshippee.github.io' },
      }),
      { APP_ORIGINS: 'https://loganshippee.github.io' },
      {}
    );
    assertEq(optRes.status, 204, 'OPTIONS returns 204');
    assertEq(optRes.headers.get('access-control-allow-origin'), 'https://loganshippee.github.io', 'CORS allows configured origin');

    const privRes = await indexMod.default.fetch(
      new Request('https://hw.example.com/privacy', { method: 'GET' }),
      { PRIVACY_URL: 'https://loganshippee.github.io/Rehearsal/privacy.html' },
      {}
    );
    assertEq(privRes.status, 302, 'GET /privacy returns 302');
    assertEq(privRes.headers.get('location'), 'https://loganshippee.github.io/Rehearsal/privacy.html', 'GET /privacy redirects to PRIVACY_URL');
  }

  // --- SHA-256 & HMAC-SHA256 RFC vector sanity check (verifies polyfill accuracy)
  {
    const shaAbc = await cryptoMod.sha256Hex('abc');
    assertEq(
      shaAbc,
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      'SHA-256("abc") matches FIPS 180-4 test vector'
    );
    const hmacVec = await cryptoMod.hmacSha256Hex('key', 'The quick brown fox jumps over the lazy dog');
    assertEq(
      hmacVec,
      'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
      'HMAC-SHA256 matches RFC test vector'
    );
  }

  // --- generateReadableCode: never emits 0, O, 1, I
  {
    for (let i = 0; i < 200; i++) {
      const code = cryptoMod.generateReadableCode(6);
      assert(/^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/.test(code), `generateReadableCode format & alphabet (${code})`);
      assert(!/[0O1I]/.test(code), `generateReadableCode excludes 0/O/1/I (${code})`);
    }
  }

  // --- hashStudentCode & verifyStudentCode (PBKDF2-SHA256 + 16-byte random salt)
  {
    const code = cryptoMod.generateReadableCode(6);
    const { hash, salt } = await cryptoMod.hashStudentCode(code);
    assertEq(salt.length, 32, 'hashStudentCode generates 16-byte (32-hex) salt');
    assertEq(hash.length, 64, 'hashStudentCode generates 256-bit (64-hex) hash');

    const okExact = await cryptoMod.verifyStudentCode(code, salt, hash);
    assertEq(okExact, true, 'verifyStudentCode accepts exact code');

    const okNorm = await cryptoMod.verifyStudentCode(code.toLowerCase().replace('-', ''), salt, hash);
    assertEq(okNorm, true, 'verifyStudentCode normalizes case & hyphen');

    const badCode = await cryptoMod.verifyStudentCode('ZZZ-999' === code ? 'AAA-222' : 'ZZZ-999', salt, hash);
    assertEq(badCode, false, 'verifyStudentCode rejects wrong code');

    const second = await cryptoMod.hashStudentCode(code);
    assert(second.salt !== salt, 'hashStudentCode uses fresh random salt each time');
    assert(second.hash !== hash, 'hashStudentCode produces distinct hash with distinct salt');
  }

  // --- verifyStripeSignature (valid, tampered body, tampered sig, expired)
  {
    const secret = 'whsec_test_unit_secret';
    const rawBody = JSON.stringify({ type: 'invoice.paid', data: { object: { customer: 'cus_123' } } });
    const now = 1_700_000_000_000;
    const ts = Math.floor(now / 1000);
    const validSigHex = await cryptoMod.hmacSha256Hex(secret, `${ts}.${rawBody}`);
    const sigHeader = `t=${ts},v1=${validSigHex}`;

    assertEq(
      await cryptoMod.verifyStripeSignature(rawBody, sigHeader, secret, now),
      true,
      'verifyStripeSignature accepts valid signature'
    );
    assertEq(
      await cryptoMod.verifyStripeSignature(rawBody + ' ', sigHeader, secret, now),
      false,
      'verifyStripeSignature rejects tampered body'
    );
    assertEq(
      await cryptoMod.verifyStripeSignature(rawBody, `t=${ts},v1=${'0'.repeat(64)}`, secret, now),
      false,
      'verifyStripeSignature rejects tampered signature'
    );
    const oldTs = ts - 400; // > 300s default tolerance
    const oldSigHex = await cryptoMod.hmacSha256Hex(secret, `${oldTs}.${rawBody}`);
    assertEq(
      await cryptoMod.verifyStripeSignature(rawBody, `t=${oldTs},v1=${oldSigHex}`, secret, now),
      false,
      'verifyStripeSignature rejects expired timestamp'
    );
  }

  // --- computePlanState (all 6 states + grace/trial expiry)
  {
    const DAY = utilMod.DAY_MS;
    const now = 1_700_000_000_000;

    // 1. trialing (active)
    const sTrial = billingMod.computePlanState({ plan_status: 'trialing', trial_ends_at: now + 10 * DAY }, now);
    assertEq(sTrial.status, 'trialing', 'plan trialing active status');
    assertEq(sTrial.canWrite, true, 'plan trialing active canWrite');
    assertEq(sTrial.readOnly, false, 'plan trialing active readOnly=false');

    // 1b. trialing (expired -> expired read-only)
    const sTrialExp = billingMod.computePlanState({ plan_status: 'trialing', trial_ends_at: now - 1000 }, now);
    assertEq(sTrialExp.status, 'expired', 'plan expired trial transitions to expired');
    assertEq(sTrialExp.canWrite, false, 'plan expired trial canWrite=false');
    assertEq(sTrialExp.readOnly, true, 'plan expired trial readOnly=true');

    // 2. active
    const sActive = billingMod.computePlanState({ plan_status: 'active', plan_ends_at: now + 30 * DAY }, now);
    assertEq(sActive.status, 'active', 'plan active status');
    assertEq(sActive.canWrite, true, 'plan active canWrite=true');

    // 3. po_active (active & expired)
    const sPo = billingMod.computePlanState({ plan_status: 'po_active', plan_ends_at: now + 200 * DAY, po_reference: 'PO-1' }, now);
    assertEq(sPo.status, 'po_active', 'plan po_active status');
    assertEq(sPo.canWrite, true, 'plan po_active canWrite=true');
    const sPoExp = billingMod.computePlanState({ plan_status: 'po_active', plan_ends_at: now - 1000 }, now);
    assertEq(sPoExp.status, 'expired', 'plan expired PO transitions to expired');
    assertEq(sPoExp.canWrite, false, 'plan expired PO canWrite=false');

    // 4. past_due (in 7-day grace & grace expired)
    const sGrace = billingMod.computePlanState({ plan_status: 'past_due', grace_ends_at: now + 3 * DAY }, now);
    assertEq(sGrace.status, 'past_due', 'plan past_due in grace status');
    assertEq(sGrace.canWrite, true, 'plan past_due in grace canWrite=true');
    assertEq(sGrace.inGrace, true, 'plan past_due in grace inGrace=true');

    const sGraceExp = billingMod.computePlanState({ plan_status: 'past_due', grace_ends_at: now - 1000 }, now);
    assertEq(sGraceExp.status, 'expired', 'plan past_due expired grace -> expired');
    assertEq(sGraceExp.canWrite, false, 'plan past_due expired grace canWrite=false');
    assertEq(sGraceExp.readOnly, true, 'plan past_due expired grace readOnly=true');

    // 5. canceled
    const sCanceled = billingMod.computePlanState({ plan_status: 'canceled' }, now);
    assertEq(sCanceled.status, 'canceled', 'plan canceled status');
    assertEq(sCanceled.canWrite, false, 'plan canceled canWrite=false');
    assertEq(sCanceled.readOnly, true, 'plan canceled readOnly=true');

    // 6. expired
    const sExpired = billingMod.computePlanState({ plan_status: 'expired' }, now);
    assertEq(sExpired.status, 'expired', 'plan expired status');
    assertEq(sExpired.canWrite, false, 'plan expired canWrite=false');
    assertEq(sExpired.readOnly, true, 'plan expired readOnly=true');
  }

  // --- validateAndRecomputeSubmission (recomputation + all integrity flags)
  {
    const { validateAndRecomputeSubmission } = submissionsMod;
    const now = 1_700_000_000_000;

    // 1. Pitch + rhythm exact formula:
    // 4 notes: ok, ok, timing (pitch ok), pitch (wrong pitch, ok rhythm)
    // rOk = 3 (ok, ok, pitch), rHalf = 1 (timing) => (3 + 0.5)/4 = 87.5 -> 88
    // pOk = 3 (ok, ok, timing+pitch ok) => 3/4 = 75
    // overall = round((88 + 75)/2) = round(81.5) = 82
    const pr = validateAndRecomputeSubmission({
      assignment: { type: 'sight', mode: 'practice' },
      config: { mode: 'melodic' },
      payload: {
        durationSec: 12,
        expectedSec: 12,
        results: {
          inputMode: 'mic',
          rmsPeak: 0.12,
          notes: [
            { status: 'ok' },
            { status: 'ok' },
            { status: 'timing', pitch: 'ok' },
            { status: 'pitch' },
          ],
        },
      },
      audioBytes: 24000,
      attemptStart: null,
      submittedAt: now,
    });
    assertEq(pr.ok, true, 'pitch+rhythm valid submission ok=true');
    assertEq(pr.rhythmPct, 88, 'pitch+rhythm rhythmPct exact');
    assertEq(pr.pitchPct, 75, 'pitch+rhythm pitchPct exact');
    assertEq(pr.overallPct, 82, 'pitch+rhythm overallPct exact');
    assertEq(pr.integrityFlags.length, 0, 'clean submission has 0 integrityFlags');

    // 2. Rhythm-only recomputation (pitchPct === null, overallPct === rhythmPct)
    const ro = validateAndRecomputeSubmission({
      assignment: { type: 'sight', mode: 'practice' },
      config: { mode: 'rhythm' },
      payload: {
        durationSec: 10,
        expectedSec: 10,
        results: {
          inputMode: 'tap',
          notes: [
            { status: 'ok' },
            { status: 'timing' },
            { status: 'missed' },
            { status: 'ok' },
          ],
        },
      },
      audioBytes: 0,
      attemptStart: null,
      submittedAt: now,
    });
    // rOk = 2, rHalf = 1 => (2.5 / 4) * 100 = 62.5 -> 63
    assertEq(ro.ok, true, 'rhythm-only valid submission ok=true');
    assertEq(ro.rhythmPct, 63, 'rhythm-only rhythmPct exact');
    assertEq(ro.pitchPct, null, 'rhythm-only pitchPct is null');
    assertEq(ro.overallPct, 63, 'rhythm-only overallPct equals rhythmPct');
    assertEq(ro.integrityFlags.length, 0, 'rhythm tap with 0 audioBytes has no missing_audio flag');

    // 3. Tamper detection: score_mismatch, low_rms_high_score, duration_too_short, missing_audio
    const tamper = validateAndRecomputeSubmission({
      assignment: { type: 'sight', mode: 'practice' },
      config: { mode: 'melodic' },
      payload: {
        claimedOverallPct: 100,
        durationSec: 2,
        expectedSec: 12,
        results: {
          inputMode: 'mic',
          rmsPeak: 0.001,
          notes: [
            { status: 'ok' },
            { status: 'ok' },
            { status: 'wrong' },
            { status: 'missed' },
          ],
        },
      },
      audioBytes: 0,
      attemptStart: null,
      submittedAt: now,
    });
    assertEq(tamper.ok, true, 'tampered submission still accepted with server-recomputed score');
    assertEq(tamper.overallPct, 50, 'server stores recomputed 50% instead of claimed 100%');
    assert(tamper.integrityFlags.includes('score_mismatch'), 'flags score_mismatch');
    assert(tamper.integrityFlags.includes('low_rms_high_score'), 'flags low_rms_high_score');
    assert(tamper.integrityFlags.includes('duration_too_short'), 'flags duration_too_short');
    assert(tamper.integrityFlags.includes('missing_audio'), 'flags missing_audio');

    // 4. unexpected_input_mode (tap on pitch-expected assignment)
    const tapPitch = validateAndRecomputeSubmission({
      assignment: { type: 'score', mode: 'practice' },
      config: { gradeMode: 'mic' },
      payload: {
        durationSec: 10,
        expectedSec: 10,
        results: {
          inputMode: 'tap',
          notes: [{ status: 'ok' }, { status: 'ok' }],
        },
      },
      audioBytes: 0,
      attemptStart: null,
      submittedAt: now,
    });
    assert(tapPitch.integrityFlags.includes('unexpected_input_mode'), 'flags unexpected_input_mode');

    // 5. true_sight_read_no_start
    const noStart = validateAndRecomputeSubmission({
      assignment: { type: 'sight', mode: 'true_sight_read' },
      config: { mode: 'melodic' },
      payload: {
        durationSec: 12,
        expectedSec: 12,
        results: { inputMode: 'mic', rmsPeak: 0.1, notes: [{ status: 'ok' }] },
      },
      audioBytes: 5000,
      attemptStart: null,
      submittedAt: now,
    });
    assert(noStart.integrityFlags.includes('true_sight_read_no_start'), 'flags true_sight_read_no_start');

    // 6. true_sight_read_overtime
    const overtime = validateAndRecomputeSubmission({
      assignment: { type: 'sight', mode: 'true_sight_read' },
      config: { mode: 'melodic' },
      payload: {
        durationSec: 15,
        expectedSec: 15,
        results: { inputMode: 'mic', rmsPeak: 0.1, notes: [{ status: 'ok' }] },
      },
      audioBytes: 5000,
      attemptStart: { started_at: now - 300_000, study_seconds: 30, expected_sec: 15 },
      submittedAt: now,
    });
    assert(overtime.integrityFlags.includes('true_sight_read_overtime'), 'flags true_sight_read_overtime');

    // 7. audio-only assignment
    const audioMiss = validateAndRecomputeSubmission({
      assignment: { type: 'audio', mode: 'practice' },
      config: {},
      payload: { durationSec: 10 },
      audioBytes: 0,
      attemptStart: null,
      submittedAt: now,
    });
    assertEq(audioMiss.overallPct, null, 'audio assignment overallPct is null');
    assert(audioMiss.integrityFlags.includes('missing_audio'), 'audio assignment flags missing_audio');

    // 8. invalid note status rejected
    const badNote = validateAndRecomputeSubmission({
      assignment: { type: 'sight', mode: 'practice' },
      config: {},
      payload: { results: { notes: [{ status: 'hacked' }] } },
      audioBytes: 1000,
      attemptStart: null,
      submittedAt: now,
    });
    assertEq(badNote.ok, false, 'invalid note status returns ok=false');
  }

  // --- stripTrueSightReadExcerpt
  {
    const original = {
      studySeconds: 30,
      strictness: { rhythm: 50, pitch: 50 },
      ex: { notes: [{ midi: 60 }] },
      build: { kind: 'melodic', notes: [{ midi: 62 }] },
      srState: {
        mode: 'melodic',
        tempo: 88,
        ex: { notes: [{ midi: 64 }] },
        build: { kind: 'melodic', notes: [{ midi: 65 }] },
      },
    };
    const stripped = assignmentsMod.stripTrueSightReadExcerpt(original);
    assertEq(stripped.ex, undefined, 'stripTrueSightReadExcerpt removes top-level ex');
    assertEq(stripped.build.notes, undefined, 'stripTrueSightReadExcerpt removes build.notes');
    assertEq(stripped.srState.ex, undefined, 'stripTrueSightReadExcerpt removes srState.ex');
    assertEq(stripped.srState.build.notes, undefined, 'stripTrueSightReadExcerpt removes srState.build.notes');
    assertEq(stripped.studySeconds, 30, 'stripTrueSightReadExcerpt keeps studySeconds');
    assertEq(stripped.srState.tempo, 88, 'stripTrueSightReadExcerpt keeps srState.tempo');
    // Verify original was not mutated
    assertEq(original.ex.notes[0].midi, 60, 'stripTrueSightReadExcerpt does not mutate original');
    assertEq(original.srState.ex.notes[0].midi, 64, 'stripTrueSightReadExcerpt does not mutate nested original');
  }

  // --- parseRangeHeader
  {
    assertEq(utilMod.parseRangeHeader(null, 1000), null, 'parseRangeHeader null returns null');
    assertEq(utilMod.parseRangeHeader('bytes=0-99', 1000), { start: 0, end: 99, length: 100 }, 'parseRangeHeader explicit range');
    assertEq(utilMod.parseRangeHeader('bytes=500-', 1000), { start: 500, end: 999, length: 500 }, 'parseRangeHeader open-ended range');
    assertEq(utilMod.parseRangeHeader('bytes=-250', 1000), { start: 750, end: 999, length: 250 }, 'parseRangeHeader suffix range');
    assertEq(utilMod.parseRangeHeader('bytes=0-5000', 1000), { start: 0, end: 999, length: 1000 }, 'parseRangeHeader clamps end to totalSize-1');
    assertEq(utilMod.parseRangeHeader('bytes=1200-1300', 1000).invalid, true, 'parseRangeHeader rejects out-of-bounds start');
    assertEq(utilMod.parseRangeHeader('bytes=500-100', 1000).invalid, true, 'parseRangeHeader rejects start > end');
    assertEq(utilMod.parseRangeHeader('items=0-5', 1000).invalid, true, 'parseRangeHeader rejects non-bytes unit');
  }

  // --- csvCell (RFC 4180 + formula-injection neutralization)
  {
    assertEq(utilMod.csvCell('Alex Rivera'), 'Alex Rivera', 'csvCell plain text');
    assertEq(utilMod.csvCell('Rivera, "Alex"'), '"Rivera, ""Alex"""', 'csvCell RFC 4180 comma & quote escaping');
    assertEq(utilMod.csvCell('=SUM(A1:A5)'), "'=SUM(A1:A5)", 'csvCell neutralizes leading =');
    assertEq(utilMod.csvCell('+cmd|calc'), "'+cmd|calc", 'csvCell neutralizes leading +');
    assertEq(utilMod.csvCell('-2+3'), "'-2+3", 'csvCell neutralizes leading -');
    assertEq(utilMod.csvCell('@SUM(A1)'), "'@SUM(A1)", 'csvCell neutralizes leading @');
    assertEq(utilMod.csvCell('@SUM(1,2)'), `"'@SUM(1,2)"`, 'csvCell neutralizes leading @ and quotes comma');
    assertEq(utilMod.csvCell('\t=1+1'), "'\t=1+1", 'csvCell neutralizes leading tab');
    assertEq(utilMod.csvCell('=1,2'), `"'=1,2"`, 'csvCell neutralizes formula and quotes comma');
  }

  console.log(`hw-worker-unit: ALL ${passed} assertions passed (${failed} failed)`);
}

await main();
