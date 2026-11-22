// D1-backed fixed-window rate limiter with optional cooldown blocks.

import { nowMs } from './util.js';

export async function checkRateLimit(env, key, maxAttempts, windowMs, { increment = true } = {}) {
  const now = nowMs(env);
  const row = await env.DB.prepare(
    'SELECT key, count, window_start, blocked_until FROM rate_limits WHERE key = ?'
  ).bind(key).first();

  if (row && row.blocked_until && row.blocked_until > now) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((row.blocked_until - now) / 1000)),
      count: row.count,
    };
  }

  let count = 0;
  let windowStart = now;
  if (row && now - row.window_start < windowMs) {
    count = row.count;
    windowStart = row.window_start;
  }

  if (count >= maxAttempts) {
    const retryAfterSec = Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000));
    return { allowed: false, remaining: 0, retryAfterSec, count };
  }

  if (increment) {
    const nextCount = count + 1;
    await env.DB.prepare(
      `INSERT INTO rate_limits (key, count, window_start, blocked_until)
       VALUES (?, ?, ?, NULL)
       ON CONFLICT(key) DO UPDATE SET
         count = excluded.count,
         window_start = excluded.window_start,
         blocked_until = NULL`
    ).bind(key, nextCount, windowStart).run();
    return {
      allowed: true,
      remaining: Math.max(0, maxAttempts - nextCount),
      retryAfterSec: 0,
      count: nextCount,
    };
  }

  return {
    allowed: true,
    remaining: Math.max(0, maxAttempts - count),
    retryAfterSec: 0,
    count,
  };
}

export async function recordRateFailure(env, key, windowMs, cooldownThreshold = 5, cooldownMs = 15 * 60 * 1000, hardThreshold = 10, hardMs = 60 * 60 * 1000) {
  const now = nowMs(env);
  const row = await env.DB.prepare(
    'SELECT count, window_start, blocked_until FROM rate_limits WHERE key = ?'
  ).bind(key).first();

  let count = 1;
  let windowStart = now;
  if (row && now - row.window_start < windowMs) {
    count = row.count + 1;
    windowStart = row.window_start;
  }

  let blockedUntil = null;
  if (count >= hardThreshold) blockedUntil = now + hardMs;
  else if (count >= cooldownThreshold) blockedUntil = now + cooldownMs;

  await env.DB.prepare(
    `INSERT INTO rate_limits (key, count, window_start, blocked_until)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       count = excluded.count,
       window_start = excluded.window_start,
       blocked_until = excluded.blocked_until`
  ).bind(key, count, windowStart, blockedUntil).run();

  return { count, blockedUntil };
}

export async function clearRateLimit(env, key) {
  await env.DB.prepare('DELETE FROM rate_limits WHERE key = ?').bind(key).run();
}
