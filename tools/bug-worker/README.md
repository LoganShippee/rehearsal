# Rehearsal Private GitHub Bug Inbox (Cloudflare Worker)

Teachers click **Send Report** inside Rehearsal without ever leaving the app or signing in. Reports and screenshots are saved privately as GitHub Issues in your private repo, and GitHub emails you automatically when a new issue arrives.

## 3-Minute One-Time Setup

1. **Create a Private GitHub Repo**
   - On GitHub, create a new **Private** repository named `Rehearsal-Bugs` (check **Add a README file** so the `main` branch exists).

2. **Create a Fine-Grained GitHub Token**
   - Go to **GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
   - Under **Repository access**, select **Only select repositories → `Rehearsal-Bugs`**.
   - Under **Repository permissions**, grant:
     - **Contents**: Read and write (for uploading `screenshots/*.jpg`)
     - **Issues**: Read and write (for creating the issue)
   - Copy the generated token.

3. **Deploy the Free Cloudflare Worker**
   - Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages → Create → Create Worker** (name it `rehearsal-bugs`).
   - Click **Edit code**, paste the contents of `worker.js`, and click **Deploy**.
   - Go to the Worker's **Settings → Variables and Secrets** and add:
     - `GITHUB_REPO` (Text): `loganshippee/Rehearsal-Bugs`
     - `GITHUB_TOKEN` (Secret): paste your fine-grained token
   - Copy your Worker URL (e.g. `https://rehearsal-bugs.<your-subdomain>.workers.dev`).

4. **Point Rehearsal to Your Worker URL**
   - Set `BUG_REPORT_ENDPOINT` in `web/app.js` (and the default fallback in `native/main.swift` and `windows/MainForm.cs`) to your Worker URL.
   - To receive email alerts at `RehearsalApp@pm.me`, add `RehearsalApp@pm.me` in GitHub → Settings → Emails / Notifications (or watch the `Rehearsal-Bugs` repo).
