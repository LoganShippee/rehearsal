# Rehearsal Online Homework — 1-Page SDPC Student Data Privacy Summary

- **Effective Date:** November 22, 2026
- **Public Policy URL:** `https://loganshippee.github.io/rehearsal/privacy.html` (Worker redirect: `GET /privacy`)
- **Printable 1-Page Sheet:** [`web/privacy-sdpc.html`](../web/privacy-sdpc.html)
- **Compliance Alignment:** FERPA (School Official, 34 CFR § 99.31(a)(1)), COPPA, SOPIPA, and NY Ed Law 2-d

---

## 1. Local App vs. Optional Online Homework

- **Rehearsal Local Classroom App (Mac, Windows, Web):** 100% free, offline-first, and collects **zero** cloud student data. Classes, schedules, rosters, MusicXML scores, and classroom recordings remain on the teacher's device.
- **Rehearsal Online Homework (Optional Teacher Add-On):** Stores only the data needed to deliver sight-reading, score practice, and vocal/instrumental recording assignments and return grades to the classroom teacher.

---

## 2. Student Data Inventory & Retention

| Data Element | What Is Stored | Retention & Deletion |
| --- | --- | --- |
| **Student Identity** | Display name (or alias/initials), optional voice part, optional school email (only if Google Sign-In is used) | Deleted immediately when the teacher deletes the student or class (allowed even in Read-Only Mode). |
| **Personal 6-Char Codes** | Salted 100k-iteration PBKDF2-SHA256 hash & HMAC lookup key (plaintext is never stored) | Overwritten immediately on code regeneration; allows **zero-email student sign-in**. |
| **Submissions & Grades** | Overall %, rhythm %, pitch %, note breakdown JSON, teacher overrides & comments | Exportable anytime as Gradebook CSV or FERPA Student Data JSON; deleted on cascade. |
| **Audio Recordings** | Student submission audio in Cloudflare R2 (`audio/` prefix) | **Auto-deleted after 90 days** (R2 Object Lifecycle Rule + daily 07:00 UTC cron) or immediately via **Delete Audio Now**. |
| **Abuse Prevention** | Short-lived SHA-256 IP rate-limit counters (15-min window) | Auto-expires; prevents code guessing (20/15m IP cap, 5-fail cooldown, 10-fail lock). |

### Never Collected or Sold
- No targeted advertising, third-party ad/analytics cookies, or cross-site tracking.
- No sale, rental, or commercial profiling of student records.
- No biometric voiceprints or AI model training on student audio.
- No access to Google Drive, Gmail, Contacts, or Google Classroom rosters.
- No student-to-student chat or public student directories (no roster dropdown on sign-in).

---

## 3. Minimal Sub-Processors

| Sub-Processor | Purpose | Student Data Access |
| --- | --- | --- |
| **Cloudflare, Inc.** (Workers, D1, R2) | Serverless API, encrypted D1 database, encrypted R2 audio storage | Hosts Online Homework data & 90-day audio under Cloudflare DPA |
| **Resend, Inc.** | Delivers 6-digit teacher login email codes | **None** (teacher email addresses only) |
| **Stripe, Inc.** | Teacher subscription billing & Customer Portal | **None** (teacher billing info only) |
| **Google LLC** (Optional OAuth) | Verifies optional Sign in with Google tokens (`openid email profile` only) | Only if Google Sign-In is enabled by the teacher/school |

---

## 4. Security & Breach Notification

- HTTPS/TLS 1.2+ in transit; encrypted storage at rest in Cloudflare D1 and R2.
- Shared-Chromebook safety: 24-hour student session expiration and no auto-remembered student login; teachers can enable ephemeral browser-close sign-out on shared computers.
- True Sight-Read integrity: excerpts stay stripped until the server-timed attempt starts; numeric scores are recomputed server-side.
- **Breach Notice:** Rehearsal notifies affected teachers and district privacy contacts within **72 hours** of confirming any unauthorized disclosure of student records.
