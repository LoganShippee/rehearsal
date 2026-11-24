#!/usr/bin/env python3
"""Rehearsal Monitor: a read-only local dashboard for the homework server.

Binds to 127.0.0.1:8790 only. It only reads: HTTP health checks, public
version files, GitHub download counts, Cloudflare analytics, and SELECT
counts from the D1 databases through wrangler. It never writes anywhere.
Standard library only.
"""

import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "127.0.0.1"
PORT = 8790
ALLOWED_HOSTS = {"127.0.0.1:8790", "localhost:8790"}

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
HW_DIR = os.path.join(REPO_ROOT, "tools", "hw-worker")
RELEASE_CONFIG = os.path.join(REPO_ROOT, "release", "config")
CONFIG_PATH = os.path.join(HERE, "config.json")
INDEX_PATH = os.path.join(HERE, "index.html")

LIVE_API = "https://api.rehearsalmusic.com"
LIVE_SITE = "https://app.rehearsalmusic.com"
LIVE_DB = "rehearsal-hw"
STAGING_DB = "rehearsal-hw-staging"

HTTP_TIMEOUT = 8
CMD_TIMEOUT = 40
CACHE_SECONDS = 60
DAY_MS = 86400000


# ---------- helpers ----------

def describe(exc):
    """Turn an exception into a short, plain message for the page."""
    if isinstance(exc, subprocess.TimeoutExpired):
        return "Timed out"
    if isinstance(exc, FileNotFoundError):
        return "A required program (npx or gh) was not found"
    reason = getattr(exc, "reason", None)
    msg = str(reason if reason is not None else exc) or type(exc).__name__
    return msg[:300]


def safe(fn, *args):
    """Run one section; a failure becomes {"error": ...} so others still work."""
    try:
        return fn(*args)
    except Exception as exc:  # one section must never break the rest
        return {"error": describe(exc)}


def load_config():
    cfg = {"stagingApi": "", "stagingSite": ""}
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            raw = json.load(f)
        if isinstance(raw, dict):
            for key in cfg:
                value = raw.get(key, "")
                if isinstance(value, str) and value.strip().startswith("https://"):
                    cfg[key] = value.strip().rstrip("/")
    except (OSError, ValueError):
        pass  # missing or unreadable config means staging is not set up
    return cfg


def http_get(url, timeout=HTTP_TIMEOUT, headers=None, body=None, method="GET"):
    req = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    req.add_header("User-Agent", "rehearsal-monitor")
    start = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            status = resp.status
            data = resp.read(2_000_000)
    except urllib.error.HTTPError as err:
        status = err.code
        data = err.read(200_000)
    ms = round((time.monotonic() - start) * 1000)
    return status, data, ms


def run_cmd(args, cwd):
    env = os.environ.copy()
    env["PATH"] = os.path.join(os.path.expanduser("~"), ".local", "bin") + os.pathsep + env.get("PATH", "/usr/bin:/bin")
    env["CI"] = "1"
    proc = subprocess.run(
        args, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
        capture_output=True, text=True, timeout=CMD_TIMEOUT,
    )
    if proc.returncode != 0:
        tail = (proc.stderr or "").strip().splitlines()
        detail = tail[-1][:200] if tail else "no details"
        raise RuntimeError("Command failed: " + detail)
    return proc.stdout


def parse_json_output(text):
    """wrangler can print warnings before the JSON, so start at the first JSON line."""
    lines = text.splitlines(keepends=True)
    for i, line in enumerate(lines):
        if line[:1] in ("[", "{"):
            try:
                return json.loads("".join(lines[i:]))
            except ValueError:
                continue
    raise RuntimeError("No JSON in command output")


def find_number(obj, names):
    if isinstance(obj, dict):
        for key, value in obj.items():
            if key in names and isinstance(value, (int, float)) and not isinstance(value, bool):
                return value
        for value in obj.values():
            found = find_number(value, names)
            if found is not None:
                return found
    elif isinstance(obj, list):
        for value in obj:
            found = find_number(value, names)
            if found is not None:
                return found
    return None


# ---------- sections ----------

def health_for(base):
    status, data, ms = http_get(base + "/api/health")
    try:
        body = json.loads(data.decode("utf-8"))
    except ValueError:
        return {"ok": False, "httpStatus": status, "ms": ms,
                "error": "The health check did not return the expected data"}
    if not isinstance(body, dict):
        body = {}
    return {
        "ok": status == 200 and body.get("ok") is True,
        "httpStatus": status,
        "ms": ms,
        "googleSignInEnabled": body.get("googleSignInEnabled"),
        "devMode": body.get("devMode"),
        "billingEnabled": body.get("billingEnabled"),
    }


def site_for(base):
    status, data, ms = http_get(base + "/version.json")
    version = None
    if status == 200:
        try:
            parsed = json.loads(data.decode("utf-8"))
            if isinstance(parsed, dict):
                version = parsed.get("version")
        except ValueError:
            version = None
    return {"httpStatus": status, "ms": ms, "version": version}


def usage_sql(now_ms):
    d7 = now_ms - 7 * DAY_MS
    d30 = now_ms - 30 * DAY_MS
    return f"""SELECT
 (SELECT COUNT(*) FROM teachers) AS teachers_total,
 (SELECT COUNT(DISTINCT teacher_id) FROM teacher_sessions WHERE last_seen_at >= {d7}) AS teachers_7d,
 (SELECT COUNT(DISTINCT teacher_id) FROM teacher_sessions WHERE last_seen_at >= {d30}) AS teachers_30d,
 (SELECT COUNT(*) FROM teachers WHERE beta_code IS NOT NULL) AS teachers_beta,
 (SELECT COUNT(*) FROM classes) AS classes_total,
 (SELECT COUNT(*) FROM students WHERE is_test = 0 AND archived_at IS NULL) AS students_total,
 (SELECT COUNT(DISTINCT ss.student_id) FROM student_sessions ss JOIN students st ON st.id = ss.student_id WHERE st.is_test = 0 AND ss.last_seen_at >= {d7}) AS students_7d,
 (SELECT COUNT(DISTINCT ss.student_id) FROM student_sessions ss JOIN students st ON st.id = ss.student_id WHERE st.is_test = 0 AND ss.last_seen_at >= {d30}) AS students_30d,
 (SELECT COUNT(*) FROM submissions) AS submissions_total,
 (SELECT COUNT(*) FROM submissions WHERE submitted_at >= {d30}) AS submissions_30d,
 (SELECT MAX(submitted_at) FROM submissions) AS last_submission_at,
 (SELECT COUNT(*) FROM beta_codes) AS beta_codes_total,
 (SELECT COALESCE(SUM(uses), 0) FROM beta_codes) AS beta_codes_used,
 (SELECT COALESCE(SUM(max_uses), 0) FROM beta_codes) AS beta_uses_allowed,
 (SELECT COUNT(*) FROM submissions WHERE audio_r2_key IS NOT NULL AND audio_deleted_at IS NULL) AS audio_stored"""


def db_section(db_name, extra):
    now_ms = int(time.time() * 1000)
    out = run_cmd(
        ["npx", "wrangler", "d1", "execute", db_name, "--remote", "--json",
         "--command", usage_sql(now_ms)] + extra,
        HW_DIR,
    )
    payload = parse_json_output(out)
    if not isinstance(payload, list) or not payload or not payload[0].get("success", True):
        raise RuntimeError("The database did not answer the usage query")
    results = payload[0].get("results") or []
    if not results:
        raise RuntimeError("The database returned no usage row")
    stats = dict(results[0])

    # Database size is optional; a failure here should not hide the counts.
    try:
        info_out = run_cmd(["npx", "wrangler", "d1", "info", db_name, "--json"] + extra, HW_DIR)
        stats["dbSizeBytes"] = find_number(parse_json_output(info_out), ("database_size", "file_size", "size"))
    except Exception:
        stats["dbSizeBytes"] = None
    return stats


def read_repo():
    with open(RELEASE_CONFIG, encoding="utf-8") as f:
        text = f.read()
    match = re.search(r'^\s*REPO\s*=\s*"?([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)"?', text, re.M)
    if not match:
        raise RuntimeError("No REPO setting found in release/config")
    return match.group(1)


def downloads_section():
    repo = read_repo()
    out = run_cmd(["gh", "api", f"repos/{repo}/releases?per_page=30"], REPO_ROOT)
    releases = json.loads(out)
    rows = []
    total_mac = total_win = 0
    for rel in releases:
        if not isinstance(rel, dict) or rel.get("draft"):
            continue
        mac = win = 0
        for asset in rel.get("assets") or []:
            name = (asset.get("name") or "").lower()
            count = int(asset.get("download_count") or 0)
            if name.endswith(".exe") or "windows" in name:
                win += count
            elif name.endswith(".zip") and "web" not in name:
                mac += count
        total_mac += mac
        total_win += win
        rows.append({"tag": rel.get("tag_name"), "published_at": rel.get("published_at"),
                     "mac": mac, "windows": win})
    return {"releases": rows, "totals": {"mac": total_mac, "windows": total_win}}


def cloudflare_section(staging_configured):
    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    account = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
    if not token or not account:
        return {"configured": False,
                "hint": "Set CLOUDFLARE_API_TOKEN (Analytics: Read) and CLOUDFLARE_ACCOUNT_ID to see request and error counts."}

    now = datetime.now(timezone.utc)
    start = now - timedelta(hours=24)
    scripts = {"live": "rehearsal-hw"}
    if staging_configured:
        scripts["staging"] = "rehearsal-hw-staging"
    fields = []
    for key, script in scripts.items():
        fields.append(
            f"{key}: workersInvocationsAdaptive(limit: 1000, filter: "
            f"{{datetime_geq: $start, datetime_leq: $end, scriptName: {json.dumps(script)}}}) "
            f"{{ sum {{ requests errors }} quantiles {{ cpuTimeP50 cpuTimeP99 }} }}"
        )
    query = ("query($accountTag: string!, $start: Time!, $end: Time!) { viewer { accounts(filter: {accountTag: $accountTag}) { "
             + " ".join(fields) + " } } }")
    body = json.dumps({
        "query": query,
        "variables": {
            "accountTag": account,
            "start": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "end": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
    }).encode("utf-8")
    status, data, _ms = http_get(
        "https://api.cloudflare.com/client/v4/graphql",
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
        body=body, method="POST",
    )
    try:
        parsed = json.loads(data.decode("utf-8"))
    except ValueError:
        raise RuntimeError(f"Cloudflare answered HTTP {status} without usable data")
    if parsed.get("errors") and not parsed.get("data"):
        msg = parsed["errors"][0].get("message", "query rejected") if isinstance(parsed["errors"], list) and parsed["errors"] else "query rejected"
        raise RuntimeError("Cloudflare: " + str(msg)[:200])
    accounts = (((parsed.get("data") or {}).get("viewer") or {}).get("accounts")) or [{}]
    account_data = accounts[0] if accounts else {}

    result = {"windowHours": 24}
    for key in scripts:
        rows = account_data.get(key) or []
        requests_total = errors_total = 0
        p50 = p99 = None
        for row in rows:
            s = row.get("sum") or {}
            requests_total += int(s.get("requests") or 0)
            errors_total += int(s.get("errors") or 0)
            q = row.get("quantiles") or {}
            if isinstance(q.get("cpuTimeP50"), (int, float)):
                p50 = max(p50 or 0, q["cpuTimeP50"])
            if isinstance(q.get("cpuTimeP99"), (int, float)):
                p99 = max(p99 or 0, q["cpuTimeP99"])
        result[key] = {
            "requests": requests_total,
            "errors": errors_total,
            # Cloudflare reports CPU time in microseconds; the largest value across rows is shown.
            "cpuP50Ms": round(p50 / 1000, 2) if p50 is not None else None,
            "cpuP99Ms": round(p99 / 1000, 2) if p99 is not None else None,
        }
    return result


# ---------- gather and cache ----------

_cache = {"at": 0.0, "data": None}
_cache_lock = threading.Lock()


def gather():
    cfg = load_config()
    staging_api = cfg["stagingApi"]
    staging_site = cfg["stagingSite"]

    jobs = {
        "health.live": (safe, health_for, LIVE_API),
        "sites.live": (safe, site_for, LIVE_SITE),
        "db.live": (safe, db_section, LIVE_DB, []),
        "downloads": (safe, downloads_section),
        "cloudflare": (safe, cloudflare_section, bool(staging_api)),
    }
    if staging_api:
        jobs["health.staging"] = (safe, health_for, staging_api)
        jobs["db.staging"] = (safe, db_section, STAGING_DB, ["-c", "wrangler.staging.toml"])
    if staging_site:
        jobs["sites.staging"] = (safe, site_for, staging_site)

    with ThreadPoolExecutor(max_workers=len(jobs)) as pool:
        futures = {key: pool.submit(*spec) for key, spec in jobs.items()}
        res = {key: fut.result() for key, fut in futures.items()}

    not_set = {"configured": False}
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "health": {"live": res["health.live"], "staging": res.get("health.staging", not_set)},
        "sites": {"live": res["sites.live"], "staging": res.get("sites.staging", not_set)},
        "db": {"live": res["db.live"], "staging": res.get("db.staging", not_set)},
        "downloads": res["downloads"],
        "cloudflare": res["cloudflare"],
    }


def get_status(refresh):
    with _cache_lock:
        now = time.monotonic()
        fresh = _cache["data"] is not None and now - _cache["at"] < CACHE_SECONDS
        if fresh and not refresh:
            return _cache["data"]
        data = gather()
        _cache["at"] = now
        _cache["data"] = data
        return data


# ---------- web server ----------

class Handler(BaseHTTPRequestHandler):
    server_version = "RehearsalMonitor"
    sys_version = ""

    def _send(self, code, body, content_type):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        # Block DNS rebinding: only the exact local names are accepted.
        if self.headers.get("Host", "") not in ALLOWED_HOSTS:
            self._send(403, b"Forbidden", "text/plain; charset=utf-8")
            return

        parts = urllib.parse.urlsplit(self.path)
        if parts.path == "/":
            with open(INDEX_PATH, "rb") as f:
                self._send(200, f.read(), "text/html; charset=utf-8")
            return
        if parts.path == "/api/status":
            query = urllib.parse.parse_qs(parts.query)
            refresh = query.get("refresh", [""])[0] == "1"
            body = json.dumps(get_status(refresh), indent=2).encode("utf-8")
            self._send(200, body, "application/json; charset=utf-8")
            return
        self._send(404, b"Not found", "text/plain; charset=utf-8")


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Rehearsal Monitor running at http://127.0.0.1:{PORT}  (Ctrl+C to stop)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    sys.exit(main())
