# Rehearsal Online Homework — IT Admin Google Workspace & Network Whitelisting Guide

Printable web version: [`web/it-whitelisting.html`](../web/it-whitelisting.html)

---

## Day-1 Zero-IT-Approval Option

Teachers do **not** need Google Workspace OAuth whitelisting to start using Rehearsal Online Homework:
- **Teachers** can sign in with a **6-digit email verification code**.
- **Students** can sign in with their **Class Join Code + Personal 6-Character Code** (requires zero student email addresses and zero Google sign-ins).

---

## Google Admin Console Whitelisting (For School Google SSO)

1. Sign in to **admin.google.com** as a Super Administrator.
2. Go to **Security → Access and data control → API controls → Manage Third-Party App Access**.
3. Click **Add app → OAuth App Name Or Client ID** and enter your deployment's Google OAuth Client ID (`<YOUR_GOOGLE_CLIENT_ID>.apps.googleusercontent.com`).
4. Set access to **Trusted** (or **Limited** for specific music/student OUs).

### Requested OAuth Scopes (Minimal Identity Only)
- `openid`
- `email`
- `profile`

Rehearsal Online Homework requests **no** Google Drive, Gmail, Contacts, or Google Classroom scopes.

---

## Network, Firewall & Email Allowlist

| Host / Origin | Port / Protocol | Purpose |
| --- | --- | --- |
| `https://loganshippee.github.io/rehearsal/` (or custom school domain) | TCP 443 (HTTPS) | Rehearsal Web App & Student Homework Portal (`hw.html`) |
| Deployed Cloudflare Worker URL (`https://<your-worker>.workers.dev`) | TCP 443 (HTTPS) | Online Homework API & R2 media uploads/streaming |
| `https://accounts.google.com`, `https://apis.google.com` | TCP 443 (HTTPS) | Optional Google Identity Services Sign-In |
| Email sender: `noreply@rehearsalapp.com` (or configured `FROM_EMAIL`) | Email allowlist | Delivers 6-digit teacher sign-in codes |

---

## Classroom Device Notes

- **Chromebooks & iPads:** Student Portal uses standard browser microphone capture (`getUserMedia`) over HTTPS and queues failed uploads in IndexedDB during temporary Wi-Fi drops.
- **Mac & Windows Desktop App:** Teacher Google Sign-In launches the user's system default browser using a 60-second one-time handoff poll (`oauth_handoffs`), avoiding embedded WebView login blocks on school IdPs.
