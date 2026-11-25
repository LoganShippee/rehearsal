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
