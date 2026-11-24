// WebCrypto utilities: PBKDF2-SHA256 student codes, SHA-256 sessions/email codes,
// HMAC-SHA256 lookups & Stripe webhooks, and Google JWKS RS256 ID-token verification.

import { isDevMode, nowMs } from './util.js';

// Excludes visually ambiguous characters: 0, O, 1, I
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const PBKDF2_ITERATIONS = 100000;

const enc = new TextEncoder();

export function bytesToHex(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

export function hexToBytes(hex) {
  if (typeof hex !== 'string' || hex.length % 2 !== 0) return new Uint8Array(0);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function randomBytes(len = 16) {
  const b = new Uint8Array(len);
  crypto.getRandomValues(b);
  return b;
}

export function randomHex(len = 16) {
  return bytesToHex(randomBytes(len));
}

export function timingSafeEqual(a, b) {
  const sa = String(a || '');
  const sb = String(b || '');
  const len = Math.max(sa.length, sb.length);
  let diff = sa.length ^ sb.length;
  for (let i = 0; i < len; i++) {
    diff |= (sa.charCodeAt(i) || 0) ^ (sb.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export async function sha256Hex(input) {
  const data = typeof input === 'string' ? enc.encode(input) : input;
  const buf = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(buf));
}

export async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(String(secret || '')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(String(message || '')));
  return bytesToHex(new Uint8Array(sig));
}

export function generateReadableCode(length = 6) {
  const chars = [];
  const limit = 256 - (256 % CODE_ALPHABET.length); // unbiased rejection sampling
  while (chars.length < length) {
    const buf = randomBytes(length * 2);
    for (let i = 0; i < buf.length && chars.length < length; i++) {
      if (buf[i] < limit) chars.push(CODE_ALPHABET[buf[i] % CODE_ALPHABET.length]);
    }
  }
  const raw = chars.join('');
  return length === 6 ? `${raw.slice(0, 3)}-${raw.slice(3)}` : raw;
}

export function normalizeCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function formatCode(raw) {
  const n = normalizeCode(raw);
  return n.length === 6 ? `${n.slice(0, 3)}-${n.slice(3)}` : n;
}

export function generateEmailDigits() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0] % 1000000).padStart(6, '0');
}

export function getPepper(env) {
  return String(env?.SESSION_PEPPER || 'rehearsal-hw-dev-pepper');
}

export function getPreviousPeppers(env) {
  const primary = getPepper(env);
  const raw = String(env?.PREVIOUS_SESSION_PEPPERS || '');
  if (!raw) return [];
  const seen = new Set([primary]);
  const out = [];
  for (const part of raw.split(',')) {
    const p = part.trim();
    if (p && !seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

export async function hashSessionToken(token, env) {
  return hmacSha256Hex(getPepper(env), `sess:${token}`);
}

export async function hashEmailCode(code, saltHex) {
  return sha256Hex(`emailcode:${saltHex}:${String(code || '').trim()}`);
}

// Keyed O(1) lookup index for personal student codes (never stores plaintext;
// verified against the per-student salted PBKDF2-SHA256 hash before issuing a session).
export async function studentCodeLookupKey(classId, rawCode, env) {
  const norm = normalizeCode(rawCode);
  return hmacSha256Hex(getPepper(env), `stucode:${classId}:${norm}`);
}

export async function studentCodeLookupKeys(classId, rawCode, env) {
  const norm = normalizeCode(rawCode);
  const peppers = [getPepper(env), ...getPreviousPeppers(env)];
  return Promise.all(peppers.map(p => hmacSha256Hex(p, `stucode:${classId}:${norm}`)));
}

// ---- Viewable student codes -------------------------------------------------
// Teachers can reveal a student's code in the roster, so the code is also kept
// encrypted (AES-256-GCM). The key is its own secret, CODE_ENC_KEY, never derived
// from SESSION_PEPPER, so rotating one cannot break the other. The student id is
// bound in as authenticated data, so a ciphertext copied to another student fails.
// With no CODE_ENC_KEY set (and not in dev mode) nothing is stored: the roster
// then simply shows "No code on file" and the teacher can generate a new code.
async function codeEncKey(env) {
  const secret = String(env?.CODE_ENC_KEY || '') || (isDevMode(env) ? 'rehearsal-hw-dev-code-enc-key' : '');
  if (!secret) return null;
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(`code-enc:${secret}`));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptStudentCode(env, studentId, rawCode) {
  const key = await codeEncKey(env);
  if (!key) return null;
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: enc.encode(String(studentId)) },
    key,
    enc.encode(formatCode(rawCode))
  );
  return `v1.${bytesToHex(iv)}.${bytesToHex(new Uint8Array(ct))}`;
}

export async function decryptStudentCode(env, studentId, stored) {
  try {
    const key = await codeEncKey(env);
    const parts = String(stored || '').split('.');
    if (!key || parts.length !== 3 || parts[0] !== 'v1') return null;
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: hexToBytes(parts[1]), additionalData: enc.encode(String(studentId)) },
      key,
      hexToBytes(parts[2])
    );
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

export async function hashStudentCode(rawCode, saltHex = null, iterations = PBKDF2_ITERATIONS) {
  const norm = normalizeCode(rawCode);
  const salt = saltHex || randomHex(16); // 16-byte random salt
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(norm),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: hexToBytes(salt),
      iterations,
    },
    keyMaterial,
    256
  );
  return { hash: bytesToHex(new Uint8Array(bits)), salt };
}

export async function verifyStudentCode(rawCode, saltHex, expectedHashHex, iterations = PBKDF2_ITERATIONS) {
  if (!rawCode || !saltHex || !expectedHashHex) return false;
  const { hash } = await hashStudentCode(rawCode, saltHex, iterations);
  return timingSafeEqual(hash, expectedHashHex);
}

// ---------- Stripe webhook signature verification (t=...,v1=...)
export async function verifyStripeSignature(rawBody, sigHeader, secret, now = Date.now(), toleranceSec = 300) {
  if (!sigHeader || !secret) return false;
  const parts = String(sigHeader).split(',').map(p => p.trim());
  let timestamp = null;
  const sigs = [];
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    const k = p.slice(0, eq).trim();
    const v = p.slice(eq + 1).trim();
    if (k === 't') timestamp = Number(v);
    else if (k === 'v1' && v) sigs.push(v);
  }
  if (!Number.isFinite(timestamp) || !sigs.length) return false;
  const nowSec = Math.floor(now / 1000);
  if (Math.abs(nowSec - timestamp) > toleranceSec) return false;
  const expected = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
  return sigs.some(s => timingSafeEqual(s, expected));
}

// ---------- Google ID Token JWKS verification (edge-cached, RS256)
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
let jwksCache = { keys: null, fetchedAt: 0 };

function base64UrlToBytes(b64u) {
  const padLen = (4 - (b64u.length % 4)) % 4;
  const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLen);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function base64UrlToJson(b64u) {
  const bytes = base64UrlToBytes(b64u);
  const text = new TextDecoder().decode(bytes);
  return JSON.parse(text);
}

async function fetchGoogleJwks(env, forceRefresh = false) {
  const now = nowMs(env);
  if (!forceRefresh && jwksCache.keys && now - jwksCache.fetchedAt < 60 * 60 * 1000) {
    return jwksCache.keys;
  }
  if (env && typeof env.__jwks === 'function') {
    const keys = await env.__jwks();
    jwksCache = { keys, fetchedAt: now };
    return keys;
  }
  const res = await fetch(GOOGLE_JWKS_URL, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!res.ok) throw new Error(`Failed fetching Google JWKS (${res.status})`);
  const data = await res.json();
  jwksCache = { keys: data.keys || [], fetchedAt: now };
  return jwksCache.keys;
}

export async function verifyGoogleIdToken(idToken, env) {
  const raw = String(idToken || '').trim();
  if (!raw) return { ok: false, error: 'Missing Google ID token' };

  // Local dev/test shortcut (ONLY active when DEV_MODE="true"):
  // token format: "dev-google:<sub_id>|<email>|<Display Name>"
  if (isDevMode(env) && raw.startsWith('dev-google:')) {
    const parts = raw.slice('dev-google:'.length).split('|');
    const sub = (parts[0] || '').trim();
    const email = (parts[1] || '').trim().toLowerCase();
    const name = (parts[2] || email.split('@')[0] || 'User').trim();
    if (!sub || !email) return { ok: false, error: 'Invalid dev-google token format' };
    return { ok: true, sub, email, name, emailVerified: true };
  }

  const clientId = String(env?.GOOGLE_CLIENT_ID || '').trim();
  if (!clientId) return { ok: false, error: 'Google Sign-In is not configured on this server' };

  const segments = raw.split('.');
  if (segments.length !== 3) return { ok: false, error: 'Malformed Google ID token' };

  let header, payload;
  try {
    header = base64UrlToJson(segments[0]);
    payload = base64UrlToJson(segments[1]);
  } catch {
    return { ok: false, error: 'Unreadable Google ID token' };
  }

  if (header.alg !== 'RS256' || !header.kid) {
    return { ok: false, error: 'Unsupported Google token algorithm' };
  }
  const validIss = payload.iss === 'https://accounts.google.com' || payload.iss === 'accounts.google.com';
  if (!validIss) return { ok: false, error: 'Invalid Google token issuer' };
  if (payload.aud !== clientId) return { ok: false, error: 'Google token audience mismatch' };

  const nowSec = Math.floor(nowMs(env) / 1000);
  if (!payload.exp || payload.exp < nowSec - 30) {
    return { ok: false, error: 'Google token expired' };
  }
  if (!payload.sub || !payload.email) {
    return { ok: false, error: 'Google token missing identity fields' };
  }
  if (payload.email_verified === false) {
    return { ok: false, error: 'Google email is not verified' };
  }

  let keys = await fetchGoogleJwks(env, false);
  let jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) {
    keys = await fetchGoogleJwks(env, true);
    jwk = keys.find(k => k.kid === header.kid);
  }
  if (!jwk) return { ok: false, error: 'Unknown Google signing key' };

  try {
    const pubKey = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const sigBytes = base64UrlToBytes(segments[2]);
    const signedData = enc.encode(`${segments[0]}.${segments[1]}`);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', pubKey, sigBytes, signedData);
    if (!valid) return { ok: false, error: 'Invalid Google token signature' };
  } catch {
    return { ok: false, error: 'Google token verification failed' };
  }

  return {
    ok: true,
    sub: String(payload.sub),
    email: String(payload.email).toLowerCase(),
    name: String(payload.name || payload.given_name || payload.email.split('@')[0] || '').trim(),
    emailVerified: true,
  };
}

// ---------- Stateless Teacher Preview Sandbox Tokens (2-hour TTL)
export const PREVIEW_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

export function bytesToBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function signPreviewToken({ assignmentId, teacherId, expiresAt }, env) {
  const payload = {
    aid: String(assignmentId || ''),
    tid: String(teacherId || ''),
    exp: Number(expiresAt || 0),
  };
  const body = bytesToBase64Url(enc.encode(JSON.stringify(payload)));
  const sig = await hmacSha256Hex(getPepper(env), `hw-preview:${body}`);
  return `${body}.${sig}`;
}

export async function verifyPreviewToken(token, env, now = nowMs(env)) {
  const raw = String(token || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, code: 'PREVIEW_INVALID', error: 'Invalid preview link.' };
  }
  const [body, sig] = parts;
  const expected = await hmacSha256Hex(getPepper(env), `hw-preview:${body}`);
  if (!timingSafeEqual(sig, expected)) {
    return { ok: false, code: 'PREVIEW_INVALID', error: 'Invalid preview link.' };
  }
  let data;
  try {
    data = base64UrlToJson(body);
  } catch {
    return { ok: false, code: 'PREVIEW_INVALID', error: 'Invalid preview link.' };
  }
  if (!data || typeof data.aid !== 'string' || !data.aid || typeof data.tid !== 'string' || !data.tid || !Number.isFinite(data.exp)) {
    return { ok: false, code: 'PREVIEW_INVALID', error: 'Invalid preview link.' };
  }
  if (data.exp <= now) {
    return { ok: false, code: 'PREVIEW_EXPIRED', error: 'This preview link has expired. Open a fresh preview from Rehearsal.' };
  }
  return { ok: true, assignmentId: data.aid, teacherId: data.tid, expiresAt: data.exp };
}
