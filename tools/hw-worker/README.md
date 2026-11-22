# Rehearsal Online Homework Backend (`rehearsal-hw`)

Cloudflare Workers + D1 (SQLite) + R2 backend for Rehearsal's Online Homework portal. Zero runtime npm dependencies.

## Prerequisites

- Cloudflare account with Workers, D1, and R2 enabled
- Node.js 18+ (for `wrangler` CLI and live API integration tests)
- `npx wrangler login`

## 1. Create D1 Database & Apply Schema

```bash
cd tools/hw-worker
npx wrangler d1 create rehearsal-hw
```

Copy the returned `database_id` into `wrangler.toml` under `[[d1_databases]]`, then apply the schema:

```bash
# Local dev database
npx wrangler d1 execute rehearsal-hw --local --file=./schema.sql

# Production remote database
npx wrangler d1 execute rehearsal-hw --remote --file=./schema.sql
```

## 2. Create R2 Bucket & 90-Day Audio Lifecycle Rule

```bash
npx wrangler r2 bucket create rehearsal-hw-media
```

In the Cloudflare Dashboard → **R2** → `rehearsal-hw-media` → **Settings** → **Object lifecycle rules**, add a rule:
- **Prefix:** `audio/`
- **Action:** Delete objects after **90 days**

The daily cron trigger (`0 7 * * *`, `src/cron.js`) also deletes expired R2 audio objects and clears `audio_r2_key` in D1 while preserving student grades and `results_json`.

## 3. Configure Secrets

Set secrets with `npx wrangler secret put <NAME>`:

| Secret | Required | Purpose |
| --- | --- | --- |
| `SESSION_PEPPER` | Prod | 32+ random bytes hex (`openssl rand -hex 32`) used for HMAC session hashes and student code lookup keys |
| `RESEND_API_KEY` | Prod | Resend API key for teacher 6-digit email sign-in codes |
| `GOOGLE_CLIENT_ID` | Optional | Google OAuth Web Client ID (`openid email profile`) for teacher & student Google Sign-In |
| `GOOGLE_CLIENT_SECRET` | Optional | Only needed if exchanging OAuth auth codes server-side |
| `STRIPE_SECRET_KEY` | Billing | Stripe secret key for Checkout & Customer Portal |
| `STRIPE_WEBHOOK_SECRET` | Billing | Stripe webhook signing secret (`whsec_...`) |
| `ADMIN_SECRET` | PO Grants | Shared bearer secret for school/district Purchase Order license grants |

Update `wrangler.toml` `[vars]` for production:
- `APP_ORIGINS` — comma-separated allowed frontend origins
- `FROM_EMAIL` — verified Resend sender address
- `STRIPE_PRICE_ID_MONTHLY` / `STRIPE_PRICE_ID_ANNUAL` — Stripe Price IDs
- `PRIVACY_URL` — public privacy policy redirect target for `GET /privacy`

## 4. Resend & Stripe Setup

- **Resend:** Verify your sending domain in Resend, set `FROM_EMAIL` in `wrangler.toml`, and put `RESEND_API_KEY`. In `DEV_MODE="true"`, 6-digit codes are logged to the Worker console and returned as `devCode` instead of calling Resend.
- **Stripe Webhooks:** Point a Stripe webhook endpoint at `https://<your-worker>/api/billing/webhook` subscribed to:
  - `checkout.session.completed`
  - `invoice.paid`
  - `invoice.payment_failed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`

## 5. School / District Purchase Order (PO) Grant Example

```bash
curl -X POST https://<your-worker>/api/admin/po-grant \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "director@lincolnhigh.edu",
    "name": "Ms. Rivera",
    "poReference": "PO-2026-4412",
    "durationDays": 365,
    "studentSoftCap": 600
  }'
```

## 6. Local Development

```bash
cd tools/hw-worker
npx wrangler d1 execute rehearsal-hw --local --file=./schema.sql
npx wrangler dev --env dev --local
```

In `dev` mode (`DEV_MODE="true"`):
- `POST /api/auth/teacher/email/start` returns `devCode` in JSON.
- `POST /api/auth/teacher/google` and `POST /api/auth/student/google` accept `dev-google:<sub_id>|<email>|<Display Name>` tokens.
- For testing Stripe webhooks and PO grants locally, place `STRIPE_WEBHOOK_SECRET` and `ADMIN_SECRET` in `tools/hw-worker/.dev.vars`.

## 7. Running Tests

From the repository root:

```bash
# 1. D1 / SQLite schema, UNIQUE, CHECK, and ON DELETE CASCADE tests (Python 3 stdlib)
/usr/bin/python3 tests/hw-schema-test.py

# 2. Worker unit & ESM import tests (macOS JavaScriptCore — zero Node required)
/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -m tests/hw-worker-unit.mjs

# 3. Full live HTTP integration test suite (requires `wrangler dev --env dev --local` running)
HW_API_URL=http://127.0.0.1:8787 \
STRIPE_WEBHOOK_SECRET=whsec_test_secret \
ADMIN_SECRET=test_admin_secret \
node tests/hw-api-test.mjs
```

## 8. Deploy

```bash
cd tools/hw-worker
npx wrangler deploy
```
