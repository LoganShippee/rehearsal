# OMR Baseline Grading & Continuous Improvement Process

Rehearsal improves Scan & Fix accuracy using the same baseline-locked loop that protects the singing/rhythm grader (`grader-takes-test`): every change is measured against fixed gold-standard scores, specific error categories are ranked by frequency, and regressions beyond 2 points fail `tests/run.sh`.

---

## Where Benchmark Scores Live

- **Public-domain repo fixtures (`tests/fixtures/omr-bench/`)**: Degraded raw OMR fixtures paired with gold MusicXML files and `tests/fixtures/omr-bench/baseline.json`. Checked by `tests/omr-bench-test.py` on every `tests/run.sh` run.
- **Private real-world scores (`~/Rehearsal-Backups/omr-bench/`)**: Real choir, band, and orchestra scores captured from Scan & Fix jobs. **Strictly outside git** so copyrighted sheet music never enters the repository.

---

## The 5-Step Improvement Loop

### 1. Capture
Whenever you finish fixing a real scan in Scan & Fix, capture the job into your private local benchmark folder:

```bash
python3 tools/omr-bench/grade.py --capture-job <jobId>
```

This copies `original.*`, `raw.mxl`, and `corrected.mxl` (saved as `gold.mxl`) from `tools/omr-service/data/jobs/<jobId>/` into `~/Rehearsal-Backups/omr-bench/<slug>/`.

### 2. Grade Against Baseline
Run the grader on the repo fixtures or your private benchmark directory:

```bash
# Grade repo fixtures against tests/fixtures/omr-bench/baseline.json
python3 tools/omr-bench/grade.py

# Grade raw vs. post-processed MusicXML (via web/scan-model.js + web/scan-flags.js)
python3 tools/omr-bench/grade.py --postprocess

# Grade private real-world scores (add --run-omr to re-run preprocessing + Audiveris live)
python3 tools/omr-bench/grade.py --dir ~/Rehearsal-Backups/omr-bench --run-omr --report /tmp/omr-report.md
```

Output includes a per-piece table (`piece | overall | struct | pitch | rhythm | ties | text | flag-recall | delta`) and a ranked list of issues.

### 3. Identify Top Issues
Read the ranked issue breakdown to pick the highest-impact fix rather than guessing. Each issue category reports exact `(part, measure, expected, actual)` examples:

| Issue Category | What It Means |
|---|---|
| `duplicated_part` | Audiveris split or duplicated a staff/part (`sfMergeSplitParts` / structure) |
| `wrong_pitch` | Notehead step or accidental differs from gold |
| `octave_error` | Right pitch letter, wrong octave (clef or octave-transposition drift) |
| `missing_dot` | Dotted duration read without its dot (or vice versa) |
| `missed_tie` | Tied note in gold missing its tie in candidate OMR |
| `lyric_ocr_typo` | OCR syllable/word mismatch (targeted by `sfCleanOcrLyrics`) |
| `unparsed_dynamic` | Dynamic marking dropped or left as raw text |
| `missed_spoken` | Spoken cue / stage direction missing from candidate |

### 4. Implement & Verify Delta
Make **one focused change** at a time—in preprocessing (`tools/omr-service/preprocess.swift`), Audiveris/adapter settings (`tools/omr-service/server.py`), or MusicXML post-processing (`web/scan-model.js`, `web/scan-flags.js`).

Re-run `grade.py` (with `--postprocess` or `--run-omr` as appropriate) and confirm:
1. The targeted issue count drops and the overall score moves **up**.
2. No other piece regresses. Rehearsal enforces a **two-tier regression gate**:
   - **Any change at all (`±1` pt)** is printed as a warning so small drifts stay visible.
   - **Any drop `> 2.0` points** fails the gate (and fails `tests/run.sh`; pass `--strict` to also gate individual core dimensions).

### 5. Approve New Baseline
`baseline.json` is never overwritten automatically. Only after reviewing the diff and confirming the improvement is genuine, lock in the new baseline:

```bash
python3 tools/omr-bench/grade.py --update-baseline
```

---

## Scoring Rubric (7 Dimensions)

| Dimension | What It Measures |
|---|---|
| `structure` | Part count, measure count, and time/key signature match per measure |
| `pitch` | Notehead pitch letter, octave, and non-rest alignment against gold |
| `rhythm` | Note/rest durations and dot accuracy per measure |
| `ties` | Tie start/stop preservation compared to gold |
| `accidentals` | Written sharp/flat/natural accuracy |
| `text` | Lyrics, dynamics, tempo markings, and spoken cues |
| `flags` | Precision & recall of `scan-flags.js` suspicious-measure flags against actual OMR errors |

---

## Choir Benchmark Progress

Measured on the 9 CPDL + simulated-photo choir fixtures (`tests/fixtures/omr-bench/choir/`):

| Step | Note Acc | Rhythm Acc | Lyric Acc | Flag Catch | Flag Precision | Sec/Page | Notes |
|---|---|---|---|---|---|---|---|
| Baseline (Step 1) | 52.5% | 63.7% | 78.0% | 26.3% | 100.0% | 14.5s | 6 CPDL pieces + 3 degraded photo variants; postprocess via baseline `scan-model.js` + `scan-flags.js` |
| Step 2 (Lyrics model) | 52.5% | 63.7% | 78.0% | 26.3% | 100.0% | 14.5s | Structured `entry.lyrics` (verse number, text, syllabic, melisma extend) round-tripped identically (`0` regression) |
| Step 3 (Choir rules) | 52.5% | 63.7% | 78.0% | 62.3% | 100.0% | 14.5s | Choir voice ranges, tenor-8 part-level flag, vocal leaps (>12 st), onset-merged lyric checks, voice crossing; disabled noisy 7th/tritone warnings by default (+36.0% catch, 100.0% precision) |
| Step 4 (Cross-part consensus) | 52.5% | 63.7% | 78.0% | 68.4% | 99.1% | 14.5s | Added `web/scan-consensus.js` cross-part measure-count, signature, and homophonic rhythm/lyric checks (`+6.1%` catch rate, `99.1%` precision) |
| Step 5 (Multi-run consensus) | 60.0% *(v300 parAll)* / 52.5% *(base)* | 74.9% / 63.7% | 89.4% / 78.0% | 82.9% *(flaggedOnly)* | 90.7% *(flaggedOnly)* | 14.1s *(1st/single)* / 31.5s *(parAll)* | Added `preprocess.swift variants`, parallel `OMR_MULTI_RUN` (`v300`/`v400`/`v350c`), fast first-result completion, and `sfCompareOcrRuns` consensus flags |
| Step 6 (Docker + 24h cleanup) | 60.0% *(v300)* / 52.5% *(base)* | 74.9% / 63.7% | 89.4% / 78.0% | 82.9% *(flaggedOnly)* / 68.4% *(1-run)* | 90.7% / 99.1% | 14.1s | Local Java 17 + Audiveris 5.x (`eng`+`lat`) Dockerfile, automatic 24-hour upload/job cleanup, and updated teacher docs |
| Pre-hosting polish (9-piece) | **68.4%** | **73.5%** | **78.7%** | **70.9%** | **96.8%** | 14.5s | Fixed choir split-part merging (`S`/`5`↔`Soprano`, `S.`↔`Sopran`, `B.`↔`BASS`, active-measure clef check: `locus-iste` `5.8%→99.4%`, `sub-tuum-praesidium` `50.2%→99.2%`), switched PDF default to 300 DPI raster PDF, parallelized flagged-page reruns, and created unseen holdout folder `~/Rehearsal-Backups/omr-bench/unseen/` |
| Correctness pass (9-piece) | **68.4%** | **74.2%** | **78.7%** | **70.8%** | **96.8%** | 14.5s | Reverted 300 DPI PDF default (native PDF pass-through avoids dropped measures), added `sfAutoFixMissingDots` (`missing_dot` `40→5`), `sfDedupeChordNotes` (removes phantom doubled chord heads), and `sfStabilizeKeySignatures` (eliminates same-sign per-system key flicker & reconciles unmarked pitches) |
| Generic merge & grader PDF/dummy-part fix (9-piece) | **94.0%** | **90.2%** | **78.6%** | **65.7%** | **91.2%** | 14.5s | Added Pass-2 unique generic-name disjoint merging in `sfMergeSplitParts` (`abide-with-me-photo` `61.0%→98.2%` note/rhythm), `sfExtractMeasureBoxes`, page-offset `sfCompareOcrRuns`, empty dummy gold part filtering (`stille-nacht` `1.0%→98.6%` note, `stille-nacht-photo` `1.0%→96.8%` note), and native PDF lyric vocabulary extraction in `grade.py` (`OVERALL 75.61→87.24`) |

### Step 5 Multi-Run Strategy Comparison (5-Piece Subset Only — 8 Pages Total)

*(Note: Measured on a 5-piece subset — `abide-with-me`, `abide-with-me-photo`, `locus-iste-photo`, `stille-nacht`, `stille-nacht-photo` — so single-run baseline metrics differ from the 9-piece table above; compare numbers strictly within one table.)*

| Strategy | Note Acc | Rhythm Acc | Lyric Acc | Flag Catch | Flag Precision | Sec/Page (Wall) | Sec/Page (1st Result) |
|---|---:|---:|---:|---:|---:|---:|---:|
| **1 run** (single pass) | 51.9% | 66.5% | 83.5% | 62.1% | 98.5% | 14.1s | 14.1s |
| **Parallel every page** (`v300`+`v400`+`v350c`) | **60.0%** | **74.9%** | **89.4%** | 53.5% | 86.1% | 31.5s | **17.7s** |
| **Flagged-pages-only** (1 run + rerun flagged pages) | 51.9% | 66.5% | 83.5% | **82.9%** | **90.7%** | 40.3s* | 14.1s |

*\*4 of 5 test pieces had flags on every page; on typical mostly-clean multi-page scores where only 1–2 pages need review, `flagged-pages-only` stays ~14–22s/page.*

---

## Modern Music Benchmark (`tests/fixtures/omr-bench/modern/`)

Measured on 4 original MuseScore 4 + Audiveris fixtures testing modern school-music conventions (syncopation, ties across barlines, mixed meter `4/4 → 2/4` and `6/8 → 4/4`, key modulation, `Spoken`/`Clap` cues, contractions, treble-8 tenor clef, triplets, transposing brass/sax parts, and phone-photo degradation):

| Mode | Overall | Note Acc | Rhythm Acc | Lyric Acc | Flag Catch | Flag Precision | Notes |
|---|---:|---:|---:|---:|---:|---:|---|
| **Raw Audiveris** (`--no-postprocess`) | 50.81 | 39.4% | 43.7% | 30.9% | n/a | n/a | Baseline without `scan-model.js` post-processing |
| **Post-processed** | **66.68** | **60.8%** | **66.4%** | **40.8%** | **59.7%** | **75.0%** | `musical-theater-duet` jumps `35.64→86.84`; `pop-choir-syncopated` `69.56` (`-photo` `70.33`, 91.7% flag catch); `jazz-band-lead` `39.99` (exposes `Bl; Trumpet`/`El; Alto Saxophone` OCR prefix drift) |
