# Rehearsal OMR Service (`tools/omr-service`)

Standalone HTTP wrapper service that powers Rehearsal's **Scan & Fix** feature.

## License & AGPL v3 Isolation

Audiveris 5.x is licensed under **AGPL v3**. To maintain a strict license boundary:

- This service **never** bundles, imports, or links any Audiveris or GPL/AGPL code.
- Audiveris 5.x is invoked **strictly as an external CLI subprocess**:
  ```bash
  audiveris -batch -export -output <out_dir> -- <input_file>
  ```
- This service uses only Python 3.9+ standard library modules (zero external dependencies).

## Quick Start (macOS / Linux)

1. Install **Audiveris 5.x** (requires Java 17+):
   - macOS: download the Audiveris 5.x installer and move `Audiveris.app` into `/Applications/` (or install `audiveris` onto `PATH`).
   - Linux: install Audiveris 5.x so `audiveris` is on `PATH`, or export `AUDIVERIS_BIN=/path/to/audiveris`.
2. Start the wrapper service:
   ```bash
   ./tools/omr-service/run.sh
   ```
   By default it listens on `http://127.0.0.1:8788` and stores job artifacts and SQLite state in `tools/omr-service/data/` (ignored by git or kept local).
3. Open Rehearsal, open **Scan & Fix**, and upload a PDF or image of a concert band part.

### Lyric & Text OCR (`eng.traineddata`)

Audiveris uses Tesseract OCR to read **lyrics, titles, tempo markings, dynamics, and part names**. The wrapper automatically searches `TESSDATA_PREFIX`, `~/Library/Application Support/AudiverisLtd/audiveris/tessdata`, `/opt/homebrew/share/tessdata`, `/usr/local/share/tessdata`, and `/usr/share/tessdata` (and `/usr/share/tesseract-ocr/{5,4.00}/tessdata`) and passes `TESSDATA_PREFIX` to Audiveris when found. If `/health` reports `ocrAvailable: false`, download `eng.traineddata` (or install `tesseract` via Homebrew) and set `TESSDATA_PREFIX` to that folder.

## Configuration (Environment Variables)

By default, the service runs with cost-effective local settings: Audiveris runs locally as a subprocess (free/offline), `OMR_MULTI_RUN=off`, and AI measure verification (`POST /api/scan/jobs/<jobId>/verify-measures`) is completely opt-in and defaults to `gemini-3.5-flash-lite` (capped at 12 measures per request).

| Variable | Default | Description |
|---|---|---|
| `OMR_HOST` | `127.0.0.1` | Bind host |
| `OMR_PORT` | `8788` | Bind port |
| `OMR_DATA_DIR` | `tools/omr-service/data` | SQLite database + per-job artifact directory |
| `OMR_ENGINE` | `audiveris` | Active OMR engine adapter: `audiveris`, `homr`, `oemer`, `api`, `flat`, or `newzik` |
| `AUDIVERIS_BIN` | auto-detect | Path to Audiveris 5.x CLI executable (`audiveris` or `/Applications/Audiveris.app/Contents/MacOS/Audiveris`) |
| `TESSDATA_PREFIX` | auto-detect | Directory containing Tesseract `*.traineddata` (e.g. `eng.traineddata`) so Audiveris OCR reads lyrics, titles, tempo words, and dynamics |
| `OMR_ENGINE_CMD` | *(unset)* | Optional override command prefix for testing or pluggable CLI engines (`CustomCmdAdapter`) |
| `OMR_API_URL` | *(unset)* | Endpoint URL when `OMR_ENGINE` is `api`, `flat`, or `newzik` (`HttpApiEngineAdapter`) |
| `OMR_API_KEY` | *(unset)* | Bearer API key for commercial/hosted OMR REST APIs (`HttpApiEngineAdapter`) |
| `OMR_API_PROVIDER` | `generic` | Provider identifier (`generic`, `flat`, `newzik`) when `OMR_ENGINE=api` |
| `GEMINI_API_KEY` | *(unset)* | Optional Google Gemini API key enabling `POST /api/scan/jobs/<jobId>/verify-measures` (defaults to `gemini-3.5-flash-lite`; `GOOGLE_API_KEY` also accepted) |
| `OMR_PREPROCESS` | `auto` | `auto` compiles `preprocess.swift` on macOS (or uses `pdftoppm`) for image contrast/deskew cleanup, PDF text extraction (`text`), and 400 DPI per-page retry; `off` disables preprocessing |
| `OMR_MULTI_RUN` | `off` | `off` (default), `all`, or `flagged` — runs preprocessing variants (`v300`, `v400`, `v350c`) in parallel and attaches `alternateRuns` for consensus checking |
| `OMR_RETENTION_HOURS` | `24` | Automatically deletes completed/failed scan jobs and uploaded files older than this many hours (`0` disables cleanup) |
| `OMR_JOB_TIMEOUT` | `55` | Subprocess timeout in seconds (keeps single-page scans under 60s) |
| `OMR_WORKERS` | `2` | Background worker thread count |
| `OMR_MAX_UPLOAD_BYTES` | `20971520` (20 MB) | Maximum upload size in bytes |
| `OMR_AUTH_MODE` | `optional` | `optional` for local development; `required` for production (verifies Rehearsal member tokens) |
| `REHEARSAL_AUTH_API` | `https://api.rehearsalmusic.com` | Rehearsal auth API base URL (`/api/auth/teacher/me`, `/api/auth/student/me`) |
| `OMR_CORS_ORIGINS` | `*` | Allowed CORS origins (`*` or comma-separated list) |

## HTTP API Endpoints

- `GET /health` — service health, active `engine` / `engineAdapter`, `availableEngines`, `aiVerifyAvailable`, OCR (`ocrAvailable`) & preprocessing (`preprocessAvailable`) availability, queue depth, active job count, auth mode.
- `POST /api/scan/jobs` — enqueue an async scan job (`multipart/form-data` with `file`, optional `instrument`, `title`, `skipCache`; or raw binary body with `X-Filename`, `Content-Type`, `X-Instrument`, `X-Title`). Returns `202` with `jobId`, `status`, `cacheHit`, and `uploadHash`. Returns an instant `completed` job with `cacheHit: true` when an identical file hash already has a verified scan in `verified_cache`.
- `GET /api/scan/jobs/<jobId>` — poll job status, progress (`0..100`), `stage`, `stageDetail`, `currentPage`, `totalPages`, `skippedPages`, `warning`, `detectedSpokenCues`, `pdfTextMeta` (`isVectorPdf`, `spokenCues`, `dynamics`, `tempoMarkings`, `lyricVocabulary`), `alternateRuns` (including `pending` placeholders while background variants finish), error/errorCode, `rawMusicxml`, `correctedMusicxml`, `flaggedLog`, and artifact URLs.
- `POST /api/scan/jobs/<jobId>/verify-measures` — opt-in on-demand AI visual verification for specific 0-based `measures` (capped at 12 per request, defaults to `gemini-3.5-flash-lite`). Crops only the requested measures from `original.pdf` and returns `{"ok": true, "checked": N, "results": [...], "patches": [...]}` (or `503 AI_VERIFY_UNAVAILABLE` if `GEMINI_API_KEY` is unset).

## Pluggable Engine Adapter & Preprocessing

- **EngineAdapter (`AudiverisAdapter` / `HomrAdapter` / `OemerAdapter` / `HttpApiEngineAdapter` / `CustomCmdAdapter`)**: `server.py` isolates engine invocation and output discovery behind `EngineAdapter`, allowing selection via `OMR_ENGINE` (`audiveris`, `homr`, `oemer`, `api`, `flat`, `newzik`) or `OMR_ENGINE_CMD` without touching the HTTP/queue/cache layer.
- **Image Preprocessing, PDF Text & Adaptive Retry (`preprocess.swift`)**: On macOS, `preprocess.swift` (using built-in `PDFKit`, `CoreGraphics`, and `CoreImage`) is compiled on demand to `<data_dir>/rehearsal-omr-prep` to deskew and normalize photo contrast before scanning, extract embedded vector PDF text (`text`), and re-render failed PDF pages at 400 DPI for an automatic single-page retry.
- `GET /api/scan/jobs/<jobId>/original` — download original uploaded image or PDF.
- `GET /api/scan/jobs/<jobId>/raw` — download raw `.mxl` or `.musicxml` exported by Audiveris.
- `GET /api/scan/jobs/<jobId>/corrected.mxl` — download the verified `.mxl` archive (`404` until confirmed).
- `POST /api/scan/jobs/<jobId>/confirm` — verify member auth (when required or token provided), enforce the server-side save gate (every flagged measure must have `visited: true` and `status` of `"confirmed"` or `"fixed"`), persist `corrected.mxl`, `corrected.musicxml`, and `flagged-log.json`, mark `verified = 1`, and update `verified_cache`.
- `GET /api/scan/library` — list verified scans only (scoped to authenticated member when auth is active). Unverified scans never appear here.
- `GET /api/scan/cache/<uploadHash>` — inspect whether a SHA-256 upload hash already has a verified scan.

## Running Tests

```bash
/usr/bin/python3 tests/omr-service-test.py
```

The test suite exercises the real HTTP server, SQLite persistence, async worker queue, subprocess boundary (via a fake CLI script), all failure modes, unverified scan isolation, teacher + student member auth, server-side save gate enforcement, and SHA-256 verified cache hits using ephemeral localhost ports and temporary directories.

## Running Locally with Docker

```bash
docker build -t rehearsal-omr tools/omr-service
docker run --rm -p 8788:8788 rehearsal-omr
```

(On Apple Silicon Macs, pass `--platform linux/amd64` to `docker build` / `docker run` to run the official x86_64 Audiveris `.deb` release.)

Then open Rehearsal with `?omrApi=http://127.0.0.1:8788` (or set it in Scan & Fix's Server URL box).

## Credits & Attribution

- **Audiveris (AGPL v3)**: Optical Music Recognition is powered by [Audiveris](https://github.com/Audiveris/audiveris), invoked strictly as an external CLI subprocess (`audiveris -batch ...`) with zero GPL/AGPL code linked or bundled into Rehearsal.
