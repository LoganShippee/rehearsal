# Rehearsal Online Homework — Production Deploy & Classroom Pilot Guide

This checklist deploys the **Rehearsal Online Homework** backend (`rehearsal-hw`) to Cloudflare Workers + D1 + R2 and walks through the 5-device pre-launch classroom pilot.

---

## 1. Create Cloudflare D1 Database & Apply Schema

```bash
cd tools/hw-worker
npx wrangler login
npx wrangler d1 create rehearsal-hw
```

1. Copy the returned `database_id` into [`wrangler.toml`](./wrangler.toml) under `[[d1_databases]]`.
2. Apply the schema remotely:

```bash
npx wrangler d1 execute rehearsal-hw --remote --file=./schema.sql
```

---

## 2. Create R2 Bucket & 90-Day Audio Expiration Lifecycle Rule

```bash
npx wrangler r2 bucket create rehearsal-hw-media
```

In the Cloudflare Dashboard → **R2** → `rehearsal-hw-media` → **Settings** → **Object lifecycle rules**:
- Add rule for prefix `audio/` → **Delete object after 90 days**.
- The daily Worker cron (`0 7 * * *` in `src/cron.js`) also sweeps expired `audio_r2_key` references in D1 while preserving student numeric scores and feedback.

---

## 3. Configure Secrets (`wrangler secret put`)

Generate a strong 32-byte `SESSION_PEPPER`:

```bash
openssl rand -hex 32
```

Upload required & feature secrets from `tools/hw-worker/`:

```bash
npx wrangler secret put SESSION_PEPPER         # Required in production (from openssl rand -hex 32)
npx wrangler secret put RESEND_API_KEY         # Teacher 6-digit login code emails
npx wrangler secret put GOOGLE_CLIENT_ID       # Optional Google SSO (scopes: openid email profile)
npx wrangler secret put STRIPE_SECRET_KEY      # Teacher billing Checkout & Customer Portal
npx wrangler secret put STRIPE_WEBHOOK_SECRET  # Stripe webhook signing secret (whsec_...)
npx wrangler secret put ADMIN_SECRET           # Shared secret for School PO license grants
```

---

## 4. Configure Google OAuth, Resend & Stripe

### Google Cloud Console (Optional SSO)
1. Create an **OAuth 2.0 Web Client ID** requesting **only** `openid`, `email`, and `profile`.
2. Under **Authorized JavaScript origins**, add:
   - `https://loganshippee.github.io` (and any custom production domain)
3. Set `GOOGLE_CLIENT_ID` via `wrangler secret put` and configure the matching `HW_GOOGLE_CLIENT_ID` on the frontend if Google Sign-In is enabled.

### Resend
1. Verify your sending domain in Resend (e.g. `rehearsalapp.com`).
2. Set `FROM_EMAIL = "Rehearsal <noreply@rehearsalapp.com>"` in [`wrangler.toml`](./wrangler.toml).

### Stripe Billing
1. Create recurring Monthly (`$5/mo`) and Annual (`$49/yr`) Prices in Stripe and copy their `price_...` IDs into [`wrangler.toml`](./wrangler.toml) (`STRIPE_PRICE_ID_MONTHLY`, `STRIPE_PRICE_ID_ANNUAL`).
2. Enable Stripe **Customer Portal** in the Stripe Dashboard (allow plan changes, payment method updates, cancellation).
3. Add a Stripe Webhook endpoint pointing to `https://<your-worker>.workers.dev/api/billing/webhook` subscribed to:
   - `checkout.session.completed`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`

---

## 5. Deploy Worker & Smoke-Check

Update `[vars]` in [`wrangler.toml`](./wrangler.toml):
- `DEV_MODE = "false"`
- `APP_ORIGINS = "https://loganshippee.github.io"` (plus any custom school host)
- `PRIVACY_URL = "https://loganshippee.github.io/rehearsal/privacy.html"`

Deploy:

```bash
cd tools/hw-worker
npx wrangler deploy
```

Verify deployed endpoints:

```bash
curl -sS https://<your-worker>.workers.dev/api/health
curl -sSI https://<your-worker>.workers.dev/privacy
```

Run automated test suites locally from the repo root:

```bash
/usr/bin/python3 tests/hw-schema-test.py
/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -m tests/hw-worker-unit.mjs
```

---

## 6. Cross-Device Classroom Pilot Checklist

Verify all 5 target environments end-to-end against staging/production before district rollout:

| Device / Client | Must Verify |
| --- | --- |
| **Mac Desktop App** | Email 6-digit login, Desktop Google OAuth system-browser polling (`hw-oauth.html`), Assign from Sight Reading & Score Practice, printable cut-out Student Code Sheet, Gradebook audio playback |
| **Windows Desktop App** | Email 6-digit login, Desktop Google OAuth system-browser polling (`hw-oauth.html`), Class creation & CSV export |
| **School Chromebook** | Student Portal (`hw.html?code=...`), Personal 6-char Code login, mic capture + 8-tap Audio Sync Check, True Sight-Read study timer lock, IndexedDB offline queue + Retry Upload after toggling Wi-Fi |
| **iPad Safari** | Touch Tap Pad rhythm grading, microphone recording playback, Audio Sync Check calibration |
| **iPhone / Android Phone** | Responsive Student Portal layout, code input formatting, Audio-Only recording submission & status refresh |

---

## 7. Issuing a School Purchase Order (PO) License

```bash
curl -X POST https://<your-worker>.workers.dev/api/admin/po-grant \
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
