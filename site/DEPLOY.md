# Deploying `rehearsalmusic.com` on Cloudflare Pages

This folder builds a **single-domain** website (`rehearsalmusic.com`) for music teachers, students, and school IT departments:
- `/` — Marketing, interactive preview, and feature overview
- `/app/` — The full live Rehearsal Web App / PWA (copied from `web/` by `site/build-pages.sh`)
- `/hw` — Short URL redirect to `/app/hw.html` (Student Homework Portal; `/hw/demo` opens `?demo=1`)
- `/dl/<file>` — Edge-proxied Mac & Windows downloads (`Rehearsal.zip`, `Rehearsal-Setup.exe`, `Rehearsal-Windows.zip`) so school networks that block `github.com` still download cleanly from `rehearsalmusic.com`

---

## 1. Connect This Repository to Cloudflare Pages

1. Open the Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Select `LoganShippee/rehearsal` (branch: `main`).
3. Configure build settings:
   - **Root directory:** `/` (leave empty / repo root, because `site/build-pages.sh` reads `web/` and `release/`)
   - **Build command:** `bash site/build-pages.sh`
   - **Build output directory:** `site/dist`
4. Optional (recommended): under **Settings → Builds & deployments → Build watch paths**, include `site/**` and `web/**` so unrelated commits don't trigger extra Pages builds.
5. Under **Custom domains**, add:
   - `rehearsalmusic.com`
   - `www.rehearsalmusic.com` (optional redirect to `rehearsalmusic.com`)

---

## 2. Configure Edge Features (`_worker.js` Environment Variables & Bindings)

In Cloudflare Pages → **Settings → Functions / Environment variables** (Production):

### Demo & School Purchase Order Inquiry Form (`POST /api/inquiry`)
Add these variables/secrets so requests on `/demo.html#request` email you via your existing Resend account:
- `RESEND_API_KEY` *(Secret)* — Your Resend API key
- `FROM_EMAIL` *(Text, optional)* — Defaults to `Rehearsal <noreply@rehearsalmusic.com>`
- `INQUIRY_TO_EMAIL` *(Text, optional)* — Defaults to `privacy@rehearsalmusic.com`

### Optional R2 Cache for Installers (`RELEASES_BUCKET`)
By default, `/dl/<file>` streams and edge-caches the latest release installers from GitHub Releases (`github.com/LoganShippee/rehearsal/releases/latest/download/...`). If you also want an R2 backup mirror:
- Create/bind an R2 bucket named `RELEASES_BUCKET` in Pages Settings → **Functions → R2 bucket bindings**, storing files under `latest/Rehearsal.zip`, `latest/Rehearsal-Setup.exe`, `latest/Rehearsal-Windows.zip`, `latest/latest.json`, and `latest/latest.json.sig`.

---

## 3. Map `api.rehearsalmusic.com` to `rehearsal-hw` (Recommended for Schools)

Many K-12 firewalls block `*.workers.dev` by default. Adding a custom domain to your existing Homework Worker keeps 100% of teacher/student traffic on `rehearsalmusic.com`:
1. In Cloudflare Dashboard → **Workers & Pages** → `rehearsal-hw` → **Settings → Domains & Routes** → **Add → Custom Domain**.
2. Enter `api.rehearsalmusic.com`.
3. Update `DEFAULT_API_BASE` in `web/hw-api.js` and `web/hw-teacher-api.js` when you're ready to switch clients from `rehearsal-hw.logan-shippee.workers.dev` to `https://api.rehearsalmusic.com` (keep `rehearsalmusic.com` in `APP_ORIGINS` in `tools/hw-worker/wrangler.toml`, which is already configured).

---

## 4. K-12 Web Filter Categorization Checklist (Run Immediately After Launch)

Newly registered `.com` domains are often temporarily flagged as **"Newly Observed Domain"** or **"Uncategorized"** by school content filters for the first 2–4 weeks. Submit `rehearsalmusic.com` to these major K-12 filter vendors as **Education / Music Education** right after deploying:

1. **FortiGuard (Fortinet):** https://www.fortiguard.com/faq/wfratingsubmit (Category: *Education*)
2. **Palo Alto Networks (PAN-DB):** https://urlfiltering.paloaltonetworks.com/ (Category: *educational-institutions* / *education*)
3. **Cisco Talos:** https://talosintelligence.com/reputation_center (Category: *Education*)
4. **BrightCloud / Webroot:** https://www.brightcloud.com/tools/url-ip-lookup.php (Request category: *Educational Institutions*)
5. **Lightspeed Systems:** https://archive.lightspeedsystems.com/ (Submit `rehearsalmusic.com` for review under *Education*)
6. **Securly:** Email `support@securly.com` or submit via a partner school admin portal as *Education*
7. **ContentKeeper / Impero:** Submit via vendor URL review / school admin ticket as *Education*

### Why `rehearsalmusic.com` passes school filters cleanly
- **100% First-Party Assets:** Zero Google Fonts, zero external CDNs, zero YouTube embeds, and zero ad/analytics trackers.
- **No `github.com` or `github.io` dependency for end users:** Teachers launch `/app/`, students launch `/hw`, and Mac/Windows installers download from `/dl/...` directly on `rehearsalmusic.com`.
- **Turnkey IT & Privacy Packet:** `/schools`, `/privacy`, `/sdpc`, and `/it` give district IT admins everything needed to approve the domain in minutes.
