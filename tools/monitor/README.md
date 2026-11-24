# Rehearsal Monitor

A local dashboard showing whether the homework server is healthy and how it is being used, for the live site and an optional staging copy.

To run it, use `tools/monitor/run.sh` (first time only: `chmod +x tools/monitor/run.sh`). It starts on http://127.0.0.1:8790 and opens in your browser. Press Ctrl+C in the terminal to stop it.

It is read-only. It checks the health and version pages, asks the database for counts with SELECT queries, and reads GitHub download counts and Cloudflare request numbers. It never writes to any database or server.

Everything stays on this computer. The server only listens on 127.0.0.1, and it refuses requests with any other host name. The page shows counts and totals only, never student or teacher names, emails or codes.

Optional: copy `config.json` next to `server.py` with `stagingApi` and `stagingSite` set to your staging addresses (both start with https://). Without it, the staging sections say they are not set up.

Optional Cloudflare numbers: set `CLOUDFLARE_API_TOKEN` (with Analytics: Read permission) and `CLOUDFLARE_ACCOUNT_ID` in your terminal before running `run.sh`.

Download counts need the GitHub CLI (`gh`) to be signed in. Database counts need `npx wrangler` to be logged in.
