# Rehearsal feature registry

Phase 1 of the regression-protection plan: Rehearsal's core features, what "working correctly" means for each, how bad it is if it breaks, and what automatic checks protect it today.

Draft by Claude Code, 2026-11-23, for Logan to correct. Antigravity and Claude Code both keep it up to date: every new feature gets a row.

## How to read this
- Risk: **Break-it-all** = crash, lost work, or a class can't be taught. **Quiet** = keeps running but gives wrong results (the most dangerous, since nobody notices). **Cosmetic** = looks wrong but works.
- Protection: **Behavior tests** = automatic checks that run the feature and compare results. **Shape checks only** = checks that protected code wasn't edited, but nothing checks results. **None** = nothing automatic.

## Registry
| # | Feature | Code | Correct behavior | Risk | Protection today |
|---|---|---|---|---|---|
| 1 | Mic grading (singing) | web/grade.js, web/music.js | Same performance always gets the same scores and the same note marks. | Crash: break-it-all. Drift: quiet | Behavior tests on computer-made performances (grader-test, grader-test2) and on 7 of Logan's real sung takes (grader-takes-test, two-tier rule, baseline in tests/fixtures/takes/takes.json). Rhythm-only grading is tap-only (Logan's call, 2026-11-23): clapping into the mic missed claps (43–63% on perfect takes), so Sight Reading, Score Practice and homework no longer offer it, and older 'rhythm' (mic) settings are tapped. Known issues: a whole-beat-late start scores 100% rhythm. Fixed: a note whose first pitch reading came late lost its pitch; pitch was read only every ~120 ms (the timer runs ~3× slower than asked), now read by time, at most every 25 ms (about 4× more readings per note). Sliders loosened 2026-11-23 (Standard ±100 ms / ±60¢; Very Strict ±40 ms / ±25¢). Scoring (Logan's call, 2026-11-23): a note a bit early or late gets half rhythm credit and keeps its pitch credit when the pitch is right, the same rule the homework gradebook and server use, so the grade card and gradebook always agree. |
| 2 | Tap grading | web/grade.js | Taps match the right notes; missed/extra counted right. | Quiet | Behavior tests (tap-test) |
| 3 | Listen back | web/grade.js, web/sight.js | Take plays back lined up with the example, delay removed. | Quiet | None |
| 4 | Sight Reading generator | web/sight.js | Measures add up; only chosen notes/rests/key/range; answers match. | Quiet | Behavior tests (sight-test, seeded via srSeed; the app itself is never seeded): measures add up in every meter, only chosen rhythms, pitches in range, starts/ends on do, leap setting kept ("Steps only" = steps everywhere, including endings and repeated patterns), 2–3 parts, 4 pinned exercises. |
| 5 | Worksheet + answer key | web/sight.js | Printed sheet and page-2 key match. | Quiet | None |
| 6 | Score Practice | web/score.js, native/main.swift | Files open, show and play the right notes; loops, count-ins, focus, solfege follow the score. | Break-it-all / quiet | Shape checks only. No sample score files. |
| 7 | Tuner & drone | web/music.js | Right note and cents for Concert/B♭/E♭/F. | Quiet | Pitch detection indirectly via grader tests; transposition none |
| 8 | Metronome | web/music.js | Right tempo, accents, subdivisions. | Quiet | None |
| 9 | Piano, warm-ups, solfege board | web/tools.js, web/app.js | Right pitches and labels. | Cosmetic–quiet | Shape checks only |
| 10 | Homework server | tools/hw-worker/src | Codes, assignments, submissions, gradebook correct and private. | Break-it-all + privacy | Behavior tests run by tests/run.sh: hw-worker-unit (541 checks) and hw-schema-test (26 checks). hw-api-test needs a local server, so it is still run by hand. |
| 11 | 90-day audio delete | tools/hw-worker/src/cron.js | Deletes audio >90 days, keeps grades. | Privacy | Behavior tests (hw-cleanup-test .mjs + .py): real SQL on SQLite picks only due audio and keeps grades; files deleted, failures don't stop it, batches finish. |
| 12 | Homework student/teacher screens | web/hw-*.js | Record, submit (saved if offline), assign, review, export. | Break-it-all | Shape checks for the homework piano guide (invariants-test); sound itself is manual only (needs headphones and a real mic). |
| 13 | Present screen & bell schedules | web/app.js | Right class at right time; automations on time. | Break-it-all | Shape checks only |
| 14 | Saving data | web/app.js (loadData/migrate/save) | Everything comes back; old data opens after updates. | Break-it-all (data loss) | None |
| 15 | Offline | web/sw.js | Every tab works offline. | Break-it-all | Offline file list checked; never actually tested offline |
| 16 | PDF viewer | web/pdfview.js | Opens, zooms, pedal turns, annotations save. | Quiet–break-it-all | Shape checks (protected zone) |
| 17 | Recorder / track player | web/app.js, web/tools.js | Recordings save and play back. | Break-it-all | None |
| 18 | Annotation, tools | web/app.js, web/tools.js | Drawing on top, buttons still clickable. | Cosmetic | Shape checks (stacking) |
| 19 | Updates & releases | native/updater.swift, release.sh | Signed updates install; bad ones refused. | Break-it-all | Only tests/run.sh |
| 20 | Rhythm systems (Numbers / Kodály / Takadimi) | web/sight.js | Each count/syllable matches the rhythm shown. | Quiet | None |
| 21 | Tuner transposition (Concert / B♭ / E♭ / F) | web/music.js | Written note shown for each instrument key is right. | Quiet | None |
| 22 | Homework paid-plan gating | tools/hw-worker/src/billing.js | Trials and lapsed plans become read-only on time; paid plans unlock. | Break-it-all (teachers locked out) | Some unit checks in hw-worker-unit; not reviewed yet |
| 23 | No-account classroom mode | web/app.js | Classroom features never ask for a login. | Break-it-all | None |
| 24 | Homework offline save + resend | web/hw-*.js | A recording made with no internet is kept and sent once back online. | Break-it-all (lost student work) | None |
| 25 | Pinned tabs & foot-pedal page turns | web/app.js, web/pdfview.js | Pinned tabs come back; pedal turns one page. | Cosmetic–quiet | None |
| 26 | Student recordings stay on the device | web/app.js, web/hw-*.js | Audio only leaves the device through a homework submit. | Privacy | None |

Rows 20–26 came from the outside plan Logan shared on 2026-11-23; please confirm they belong.

## Biggest gaps (suggested order)
1. ~~Add the homework tests to tests/run.sh.~~ Done 2026-11-23 (unit + schema tests; the live-server API test is still manual).
2. ~~Saved practice takes for grading (teacher-made, never real student audio).~~ Done 2026-11-23: 7 sung takes in tests/fixtures/takes/, re-recorded at the faster pitch-reading rate (raw audio in ~/Rehearsal-Backups/grader-takes/).
3. ~~Test that the 90-day delete removes old audio and keeps grades.~~ Done 2026-11-23 (tests/hw-cleanup-test.mjs and .py).
4. ~~Make the Sight Reading generator reproducible (seed), then test measures add up.~~ Done 2026-11-23 (srSeed in web/sight.js, tests/sight-test.js).
5. Saved-data tests (old data opens after migrate()).
6. Bell schedule tests.
7. Sample MusicXML files for Score Practice.

## Questions for Logan
- Is this the right "core" list?
- ~~For grading, should a 1-point score change fail the tests, or only bigger changes?~~ Decided 2026-11-23 (replaces the earlier ±5): a two-tier rule for the saved practice takes, applied to each score (overall, rhythm, pitch) on each take:
  - **Any change at all** is listed as a warning, take by take.
  - **Fails (needs Logan's review):** a change of more than 2 points on any take, **or any change at all when the grading code (web/grade.js, web/music.js) was not edited** — the same recording should always give the same score, so a move means something else changed underneath.
  - **Drift over time:** scores are always compared to one fixed, Logan-approved baseline, not to the last run, so many small 1-point changes can't add up unnoticed. The baseline only moves when Logan approves it.
- Sight Reading stays random for teachers and students. Only tests use a fixed seed (a starting number) so they can rebuild the same exercise. Approved and added 2026-11-23.
- ~~With "Steps only", melodies jumped in the last measure (e.g. sol→do).~~ Fixed 2026-11-23: endings now step home to do, and (Logan's call) "Steps only" also steps into repeated patterns — no 3rds anywhere.
- Can you record a few practice takes (good and bad on purpose) to use as test fixtures?
