# Deploying `rehearsalmusic.com` on Cloudflare Pages

Rehearsal's web presence is split cleanly across three Cloudflare services under `rehearsalmusic.com`:
- **`rehearsal-site` (Cloudflare Pages):** `rehearsalmusic.com` (and `www.rehearsalmusic.com` → 301 redirect) — this marketing, demo, download, and compliance site (`site/dist/`).
- **`rehearsal-app` (Cloudflare Pages):** `app.rehearsalmusic.com` — the live Rehearsal Web App / PWA and Student Homework Portal (`web/`, deployed automatically by `./release.sh`).
- **`rehearsal-hw` (Cloudflare Worker):** `api.rehearsalmusic.com` — the Online Homework API (D1 + R2 + Resend + Stripe).

---

## 1. Quick Deploy Command (`rehearsal-site`)

```bash
bash site/build-pages.sh
~/.local/bin/node tools/hw-worker/node_modules/wrangler/bin/wrangler.js pages deploy site/dist --project-name=rehearsal-site --branch=main
```

If connecting Git-based auto-deploys in the Cloudflare Dashboard → **Workers & Pages** → `rehearsal-site`:
- **Root directory:** `/`
- **Build command:** `bash site/build-pages.sh`
- **Build output directory:** `site/dist`
- **Build watch paths:** `site/**`

---

## 2. Optional Edge Bindings for `site/_worker.js`

In Cloudflare Pages → `rehearsal-site` → **Settings → Environment variables / Bindings**:

### Demo & School Purchase Order Inquiry Form (`POST /api/inquiry`)
- `RESEND_API_KEY` *(Secret)* — Your Resend API key
- `FROM_EMAIL` *(Text, optional)* — Defaults to `Rehearsal <noreply@rehearsalmusic.com>`
- `INQUIRY_TO_EMAIL` *(Text, optional)* — Defaults to `privacy@rehearsalmusic.com`

### Optional R2 Mirror for Installers (`RELEASES_BUCKET`)
By default, `/dl/<file>` edge-caches and proxies `Rehearsal.zip`, `Rehearsal-Setup.exe`, `Rehearsal-Windows.zip`, `latest.json`, and `latest.json.sig` from GitHub Releases directly from `rehearsalmusic.com` so school networks blocking `github.com` can still download installers. You can optionally bind an R2 bucket named `RELEASES_BUCKET` with objects under `latest/<file>`.

---

## 3. K-12 Web Filter Categorization Checklist (Run After Launch)

Newly launched `.com` domains are often temporarily marked **"Newly Observed Domain"** or **"Uncategorized"** by K-12 content filters. Submit `rehearsalmusic.com` (covering `*.rehearsalmusic.com`) to these major school filter vendors as **Education**:

1. **FortiGuard (Fortinet):** https://www.fortiguard.com/faq/wfratingsubmit (Category: *Education*)
2. **Palo Alto Networks (PAN-DB):** https://urlfiltering.paloaltonetworks.com/ (Category: *educational-institutions*)
3. **Cisco Talos:** https://talosintelligence.com/reputation_center (Category: *Education*)
4. **BrightCloud / Webroot:** https://www.brightcloud.com/tools/url-ip-lookup.php (Category: *Educational Institutions*)
5. **Lightspeed Systems:** https://archive.lightspeedsystems.com/ (Category: *Education*)
6. **Securly:** Email `support@securly.com` or submit via a school admin portal as *Education*
7. **ContentKeeper / Impero:** Submit via vendor URL review / school admin ticket as *Education*
