// Plan lifecycle, read-only grace enforcement, Stripe Billing, and PO license grants.
//
// Plan states:
//   trialing  : auto 30 days on first teacher sign-in, no card required, soft cap 200 students
//   active    : active Stripe subscription
//   po_active : school/district Purchase Order license granted via ADMIN_SECRET
//   past_due  : 7-day grace window (amber banner linking to Stripe Customer Portal)
//   canceled  : graceful Read-Only Mode (view grades, play non-expired audio, export CSV/JSON, delete data)
//   expired   : graceful Read-Only Mode (trial or grace ended)

import { DAY_MS, cleanText, errResponse, getBearerToken, jsonResponse, normalizeEmail, nowMs, readJsonBody } from './util.js';
import { timingSafeEqual, verifyStripeSignature } from './crypto.js';

export const TRIAL_DAYS = 30;
export const GRACE_DAYS = 7;
export const DEFAULT_STUDENT_SOFT_CAP = 200;

export function computePlanState(teacher, now = Date.now()) {
  if (!teacher) {
    return { status: 'expired', canWrite: false, readOnly: true, inGrace: false, daysLeft: 0 };
  }
  const raw = teacher.plan_status || 'trialing';
  const softCap = Number(teacher.student_soft_cap || DEFAULT_STUDENT_SOFT_CAP);

  if (raw === 'trialing') {
    const endsAt = Number(teacher.trial_ends_at || 0);
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

  if (raw === 'active' || raw === 'po_active') {
    const endsAt = teacher.plan_ends_at ? Number(teacher.plan_ends_at) : null;
    if (!endsAt || endsAt > now) {
      return {
        status: raw,
        canWrite: true,
        readOnly: false,
        inGrace: false,
        planEndsAt: endsAt,
        poReference: teacher.po_reference || null,
        daysLeft: endsAt ? Math.max(1, Math.ceil((endsAt - now) / DAY_MS)) : null,
        studentSoftCap: softCap,
      };
    }
    return {
      status: 'expired',
      canWrite: false,
      readOnly: true,
      inGrace: false,
      planEndsAt: endsAt,
      daysLeft: 0,
      studentSoftCap: softCap,
      reason: 'Your license has expired. Your gradebook is in read-only mode until renewed.',
    };
  }

  if (raw === 'past_due') {
    const graceEnds = Number(teacher.grace_ends_at || 0);
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
    status: raw === 'canceled' ? 'canceled' : 'expired',
    canWrite: false,
    readOnly: true,
    inGrace: false,
    daysLeft: 0,
    studentSoftCap: softCap,
    reason: 'Your plan is inactive. You can still view grades, play saved audio, export CSVs, and delete data.',
  };
}

export function assertTeacherWritable(teacher, request, env) {
  const plan = computePlanState(teacher, nowMs(env));
  if (plan.canWrite) return null;
  return errResponse(
    plan.reason || 'Your Online Homework plan is in read-only mode.',
    402,
    'PLAN_READ_ONLY',
    request,
    env,
    { plan }
  );
}

export async function assertClassTeacherWritable(classId, request, env) {
  const teacher = await env.DB.prepare(
    `SELECT t.* FROM teachers t
     JOIN classes c ON c.teacher_id = t.id
     WHERE c.id = ?`
  ).bind(classId).first();
  if (!teacher) {
    return { error: errResponse('Class not found', 404, 'CLASS_NOT_FOUND', request, env), teacher: null };
  }
  const plan = computePlanState(teacher, nowMs(env));
  if (!plan.canWrite) {
    return {
      error: errResponse(
        'This class is not accepting new submissions right now. Let your teacher know.',
        402,
        'CLASS_READ_ONLY',
        request,
        env
      ),
      teacher,
    };
  }
  return { error: null, teacher, plan };
}

function formEncode(obj) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  return params.toString();
}

async function stripeRequest(env, path, params) {
  const key = String(env?.STRIPE_SECRET_KEY || '').trim();
  if (!key) return { ok: false, status: 503, error: 'Stripe billing is not configured yet.' };
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formEncode(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, status: 502, error: data?.error?.message || `Stripe error (${res.status})` };
  }
  return { ok: true, data };
}

export async function handleBillingCheckout(request, env, teacher) {
  const body = await readJsonBody(request);
  if (!body.ok) return errResponse(body.error, body.status, 'BAD_REQUEST', request, env);
  const interval = body.data.interval === 'annual' ? 'annual' : 'monthly';
  const priceId = interval === 'annual'
    ? String(env?.STRIPE_PRICE_ID_ANNUAL || '').trim()
    : String(env?.STRIPE_PRICE_ID_MONTHLY || '').trim();
  if (!priceId) return errResponse('Billing plan price is not configured yet.', 503, 'BILLING_UNCONFIGURED', request, env);

  const successUrl = cleanText(body.data.successUrl, 500) || 'https://loganshippee.github.io/rehearsal/?billing=success';
  const cancelUrl = cleanText(body.data.cancelUrl, 500) || 'https://loganshippee.github.io/rehearsal/?billing=canceled';

  const params = {
    mode: 'subscription',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: teacher.id,
    'metadata[teacher_id]': teacher.id,
    'subscription_data[metadata][teacher_id]': teacher.id,
  };
  if (teacher.stripe_customer_id) params.customer = teacher.stripe_customer_id;
  else params.customer_email = teacher.email;

  const out = await stripeRequest(env, '/checkout/sessions', params);
  if (!out.ok) return errResponse(out.error, out.status, 'STRIPE_ERROR', request, env);
  return jsonResponse({ ok: true, url: out.data.url, sessionId: out.data.id }, 200, request, env);
}

export async function handleBillingPortal(request, env, teacher) {
  if (!teacher.stripe_customer_id) {
    return errResponse('No active Stripe billing profile yet. Start a subscription first.', 400, 'NO_STRIPE_CUSTOMER', request, env);
  }
  const body = await readJsonBody(request);
  if (!body.ok) return errResponse(body.error, body.status, 'BAD_REQUEST', request, env);
  const returnUrl = cleanText(body.data.returnUrl, 500) || 'https://loganshippee.github.io/rehearsal/';

  const out = await stripeRequest(env, '/billing_portal/sessions', {
    customer: teacher.stripe_customer_id,
    return_url: returnUrl,
  });
  if (!out.ok) return errResponse(out.error, out.status, 'STRIPE_ERROR', request, env);
  return jsonResponse({ ok: true, url: out.data.url }, 200, request, env);
}

export async function handleStripeWebhook(request, env) {
  const secret = String(env?.STRIPE_WEBHOOK_SECRET || '').trim();
  if (!secret) return errResponse('Stripe webhook secret is not configured', 503, 'WEBHOOK_UNCONFIGURED', request, env);

  const rawBody = await request.text();
  const sig = request.headers.get('stripe-signature') || '';
  const now = nowMs(env);
  const valid = await verifyStripeSignature(rawBody, sig, secret, now);
  if (!valid) return errResponse('Invalid webhook signature', 400, 'INVALID_SIGNATURE', request, env);

  let event;
  try { event = JSON.parse(rawBody); } catch { return errResponse('Malformed JSON', 400, 'BAD_JSON', request, env); }
  const type = event?.type || '';
  const obj = event?.data?.object || {};

  async function findTeacherForStripeObj() {
    const teacherId = obj?.metadata?.teacher_id || obj?.client_reference_id || null;
    if (teacherId) {
      const row = await env.DB.prepare('SELECT * FROM teachers WHERE id = ?').bind(teacherId).first();
      if (row) return row;
    }
    if (obj.customer) {
      const row = await env.DB.prepare('SELECT * FROM teachers WHERE stripe_customer_id = ?').bind(String(obj.customer)).first();
      if (row) return row;
    }
    if (obj.subscription) {
      const row = await env.DB.prepare('SELECT * FROM teachers WHERE stripe_subscription_id = ?').bind(String(obj.subscription)).first();
      if (row) return row;
    }
    const email = normalizeEmail(obj.customer_email || obj.customer_details?.email || '');
    if (email) {
      return await env.DB.prepare('SELECT * FROM teachers WHERE email = ?').bind(email).first();
    }
    return null;
  }

  const teacher = await findTeacherForStripeObj();
  if (!teacher) {
    return jsonResponse({ ok: true, ignored: true, reason: 'teacher_not_found' }, 200, request, env);
  }

  if (type === 'checkout.session.completed') {
    const customerId = obj.customer ? String(obj.customer) : teacher.stripe_customer_id;
    const subId = obj.subscription ? String(obj.subscription) : teacher.stripe_subscription_id;
    await env.DB.prepare(
      `UPDATE teachers
       SET plan_status = 'active', stripe_customer_id = ?, stripe_subscription_id = ?,
           grace_ends_at = NULL, plan_ends_at = NULL, updated_at = ?
       WHERE id = ?`
    ).bind(customerId, subId, now, teacher.id).run();
  } else if (type === 'invoice.paid') {
    const periodEndMs = obj?.lines?.data?.[0]?.period?.end
      ? Number(obj.lines.data[0].period.end) * 1000
      : null;
    await env.DB.prepare(
      `UPDATE teachers
       SET plan_status = 'active', grace_ends_at = NULL,
           plan_ends_at = COALESCE(?, plan_ends_at), updated_at = ?
       WHERE id = ?`
    ).bind(periodEndMs, now, teacher.id).run();
  } else if (type === 'invoice.payment_failed') {
    // 7-day grace window starting from first failed invoice (don't extend an existing grace window forever)
    const graceEnds = teacher.plan_status === 'past_due' && teacher.grace_ends_at
      ? teacher.grace_ends_at
      : now + GRACE_DAYS * DAY_MS;
    await env.DB.prepare(
      `UPDATE teachers
       SET plan_status = 'past_due', grace_ends_at = ?, updated_at = ?
       WHERE id = ?`
    ).bind(graceEnds, now, teacher.id).run();
  } else if (type === 'customer.subscription.updated') {
    const st = obj.status;
    const periodEndMs = obj.current_period_end ? Number(obj.current_period_end) * 1000 : null;
    let nextStatus = teacher.plan_status;
    let graceEnds = teacher.grace_ends_at;
    if (st === 'active' || st === 'trialing') {
      nextStatus = 'active';
      graceEnds = null;
    } else if (st === 'past_due' || st === 'unpaid') {
      nextStatus = 'past_due';
      if (!graceEnds) graceEnds = now + GRACE_DAYS * DAY_MS;
    } else if (st === 'canceled' || st === 'incomplete_expired') {
      nextStatus = 'canceled';
      graceEnds = null;
    }
    await env.DB.prepare(
      `UPDATE teachers
       SET plan_status = ?, plan_ends_at = ?, grace_ends_at = ?,
           stripe_subscription_id = COALESCE(?, stripe_subscription_id), updated_at = ?
       WHERE id = ?`
    ).bind(nextStatus, periodEndMs, graceEnds, obj.id ? String(obj.id) : null, now, teacher.id).run();
  } else if (type === 'customer.subscription.deleted') {
    await env.DB.prepare(
      `UPDATE teachers
       SET plan_status = 'canceled', grace_ends_at = NULL, updated_at = ?
       WHERE id = ?`
    ).bind(now, teacher.id).run();
  }

  return jsonResponse({ ok: true, handled: type }, 200, request, env);
}

// School / District Purchase Order license grant (requires ADMIN_SECRET Bearer token)
export async function handleAdminPoGrant(request, env) {
  const adminSecret = String(env?.ADMIN_SECRET || '').trim();
  if (!adminSecret) return errResponse('Admin PO endpoint not configured', 503, 'ADMIN_UNCONFIGURED', request, env);

  const token = getBearerToken(request);
  if (!token || !timingSafeEqual(token, adminSecret)) {
    return errResponse('Unauthorized', 401, 'UNAUTHORIZED', request, env);
  }

  const body = await readJsonBody(request);
  if (!body.ok) return errResponse(body.error, body.status, 'BAD_REQUEST', request, env);
  const email = normalizeEmail(body.data.email);
  if (!email) return errResponse('Valid teacher email is required', 400, 'INVALID_EMAIL', request, env);

  const now = nowMs(env);
  const days = Number(body.data.durationDays || 365);
  const planEndsAt = body.data.expiresAt
    ? Number(body.data.expiresAt)
    : now + Math.max(1, Math.min(3650, days)) * DAY_MS;
  const softCap = Math.max(50, Math.min(10000, Number(body.data.studentSoftCap || 500)));
  const poRef = cleanText(body.data.poReference || 'PO', 120);

  let teacher = await env.DB.prepare('SELECT * FROM teachers WHERE email = ?').bind(email).first();
  if (!teacher) {
    const id = `tch_${now.toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const name = cleanText(body.data.name || email.split('@')[0], 120);
    await env.DB.prepare(
      `INSERT INTO teachers (id, email, name, plan_status, trial_ends_at, plan_ends_at, student_soft_cap, po_reference, created_at, updated_at)
       VALUES (?, ?, ?, 'po_active', ?, ?, ?, ?, ?, ?)`
    ).bind(id, email, name, now + TRIAL_DAYS * DAY_MS, planEndsAt, softCap, poRef, now, now).run();
    teacher = await env.DB.prepare('SELECT * FROM teachers WHERE id = ?').bind(id).first();
  } else {
    await env.DB.prepare(
      `UPDATE teachers
       SET plan_status = 'po_active', plan_ends_at = ?, grace_ends_at = NULL,
           student_soft_cap = ?, po_reference = ?, updated_at = ?
       WHERE id = ?`
    ).bind(planEndsAt, softCap, poRef, now, teacher.id).run();
    teacher = await env.DB.prepare('SELECT * FROM teachers WHERE id = ?').bind(teacher.id).first();
  }

  return jsonResponse({
    ok: true,
    teacher: {
      id: teacher.id,
      email: teacher.email,
      name: teacher.name,
      plan: computePlanState(teacher, now),
    },
  }, 200, request, env);
}
