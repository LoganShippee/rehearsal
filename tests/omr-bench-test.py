#!/usr/bin/env python3
"""
Automated regression tests for tools/omr-bench/grade.py.
Python 3.9+ standard library only (plus macOS jsc for post-processing delta test).

Usage: /usr/bin/python3 tests/omr-bench-test.py
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools", "omr-bench"))

import grade as omr_bench  # noqa: E402


class OMRBenchTestSuite(unittest.TestCase):
    def test_01_identical_score_is_100_percent(self) -> None:
        xml = omr_bench.load_musicxml(os.path.join(ROOT, "web", "demo", "ode-to-joy.musicxml"))
        res = omr_bench.grade_score(xml, xml)
        self.assertEqual(res["overall"], 100.0)
        for dim in ("structure", "pitch", "rhythm", "ties", "accidentals", "text"):
            self.assertEqual(res["dimensions"][dim], 100.0, f"{dim} should be 100.0")
        self.assertEqual(res["issues"], [])
        self.assertEqual(res["issueSummary"], [])

    def test_02_degraded_fixtures_detect_seeded_issues(self) -> None:
        ode_gold = omr_bench.load_musicxml(os.path.join(ROOT, "web", "demo", "ode-to-joy.musicxml"))
        ode_raw = omr_bench.load_musicxml(
            os.path.join(ROOT, "tests", "fixtures", "omr-bench", "ode-to-joy-omr-raw.musicxml")
        )
        ode_res = omr_bench.grade_score(ode_raw, ode_gold)
        ode_cats = {iss["category"] for iss in ode_res["issues"]}
        for expected_cat in ("duplicated_part", "wrong_pitch", "octave_error", "missing_dot"):
            self.assertIn(expected_cat, ode_cats)

        band_gold = omr_bench.load_musicxml(
            os.path.join(ROOT, "tests", "fixtures", "scan-band-part.musicxml")
        )
        band_raw = omr_bench.load_musicxml(
            os.path.join(ROOT, "tests", "fixtures", "omr-bench", "band-part-omr-raw.musicxml")
        )
        band_res = omr_bench.grade_score(band_raw, band_gold)
        band_cats = {iss["category"] for iss in band_res["issues"]}
        for expected_cat in ("wrong_pitch", "missing_dot", "missed_accidental"):
            self.assertIn(expected_cat, band_cats)

    def test_03_ties_lyrics_dynamics_spoken_and_postprocess_delta(self) -> None:
        gold_xml = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<score-partwise version="3.1">'
            '<part-list><score-part id="P1"><part-name>Soprano</part-name></score-part></part-list>'
            '<part id="P1">'
            '<measure number="1">'
            '<attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>'
            '<direction><direction-type><dynamics><mf/></dynamics></direction-type></direction>'
            '<direction><direction-type><words>spoken</words></direction-type></direction>'
            '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>half</type>'
            '<tie type="start"/><notations><tied type="start"/></notations><lyric><text>monster</text></lyric></note>'
            '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>half</type>'
            '<tie type="stop"/><notations><tied type="stop"/></notations><lyric><text>forever</text></lyric></note>'
            '</measure></part></score-partwise>'
        )
        cand_xml = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<score-partwise version="3.1">'
            '<part-list><score-part id="P1"><part-name>Soprano</part-name></score-part></part-list>'
            '<part id="P1">'
            '<measure number="1">'
            '<attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>'
            '<direction><direction-type><words>mf</words></direction-type></direction>'
            '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>half</type>'
            '<lyric><text>monstcr</text></lyric></note>'
            '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>half</type>'
            '<lyric><text>forevor</text></lyric></note>'
            '</measure></part></score-partwise>'
        )
        raw_grade = omr_bench.grade_score(cand_xml, gold_xml)
        cats = {iss["category"] for iss in raw_grade["issues"]}
        self.assertIn("missed_tie", cats)
        self.assertIn("lyric_ocr_typo", cats)
        self.assertIn("missed_spoken", cats)

        # Post-processing via jsc + sfCleanOcrLyrics repairs both lyric typos and raises score!
        if os.path.isfile(omr_bench.JSC_BIN):
            pp_xml, flag_rep = omr_bench.postprocess_with_jsc(cand_xml, ["monster", "forever"])
            pp_grade = omr_bench.grade_score(pp_xml, gold_xml, flag_report=flag_rep)
            self.assertGreater(pp_grade["overall"], raw_grade["overall"])
            self.assertGreater(pp_grade["dimensions"]["text"], raw_grade["dimensions"]["text"])

    def test_04_baseline_gate_passes_and_catches_regression(self) -> None:
        code, results = omr_bench.run_benchmark(
            bench_dir=omr_bench.DEFAULT_BENCH_DIR,
            baseline_path=omr_bench.DEFAULT_BASELINE_PATH,
            postprocess=True,
            update_baseline=False,
        )
        self.assertEqual(code, 0)
        self.assertEqual(len(results), 2)

        with open(omr_bench.DEFAULT_BASELINE_PATH, "r", encoding="utf-8") as f:
            baseline = json.load(f)

        # Simulated > 2-point regression must fail the gate
        regressed = [dict(results[0], overall=round(results[0]["overall"] - 3.5, 2))]
        ok, _warns, failures = omr_bench.check_baseline_regression(regressed, baseline)
        self.assertFalse(ok)
        self.assertEqual(len(failures), 1)

    def test_05_capture_job_copies_artifacts_to_dest_dir(self) -> None:
        with tempfile.TemporaryDirectory(prefix="omr-capture-test-") as td:
            jobs_dir = os.path.join(td, "jobs")
            job_id = "job12345"
            jdir = os.path.join(jobs_dir, job_id)
            os.makedirs(jdir, exist_ok=True)
            with open(os.path.join(jdir, "original.pdf"), "wb") as f:
                f.write(b"%PDF-1.4")
            with open(os.path.join(jdir, "raw.musicxml"), "w", encoding="utf-8") as f:
                f.write("<score-partwise/>")
            with open(os.path.join(jdir, "corrected.mxl"), "wb") as f:
                f.write(b"FAKE_MXL")

            dest_root = os.path.join(td, "private-bench")
            captured = omr_bench.capture_job_to_bench(
                job_id, jobs_dir=jobs_dir, dest_root=dest_root, slug="my-piece"
            )
            self.assertTrue(os.path.isfile(os.path.join(captured, "original.pdf")))
            self.assertTrue(os.path.isfile(os.path.join(captured, "raw.musicxml")))
            self.assertTrue(os.path.isfile(os.path.join(captured, "gold.mxl")))

    def test_06_sf_analyze_flags_format_counts_and_lyric_accuracy(self) -> None:
        gold_xml = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<score-partwise version="3.1">'
            '<part-list><score-part id="P1"><part-name>Alto</part-name></score-part></part-list>'
            '<part id="P1">'
            '<measure number="1">'
            '<attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>'
            '<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type><lyric><text>Win</text></lyric></note>'
            '<note><pitch><step>D</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type><lyric><text>ter</text></lyric></note>'
            '<note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>half</type><lyric><text>song</text></lyric></note>'
            '</measure></part></score-partwise>'
        )
        cand_xml = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<score-partwise version="3.1">'
            '<part-list><score-part id="P1"><part-name>Alto</part-name></score-part></part-list>'
            '<part id="P1">'
            '<measure number="1">'
            '<attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>'
            '<note><pitch><step>F</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type><lyric><text>W1n</text></lyric></note>'
            '<note><pitch><step>D</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type><lyric><text>ter</text></lyric></note>'
            '</measure></part></score-partwise>'
        )
        flag_report = {
            "measures": [
                {"measureIndex": 0, "measureNumber": "1", "flagged": True, "reasons": ["duration_mismatch"]}
            ]
        }
        res = omr_bench.grade_score(cand_xml, gold_xml, flag_report=flag_report)
        self.assertEqual(res["dimensions"]["flags"]["recall"], 100.0)
        self.assertEqual(res["dimensions"]["flags"]["precision"], 100.0)
        self.assertLess(res["dimensions"]["lyric"], 100.0)
        self.assertEqual(res["counts"]["pitch_errors"], 1)
        self.assertEqual(res["counts"]["missing_notes"], 1)
        self.assertEqual(res["counts"]["rhythm_errors"], 1)
        self.assertEqual(res["counts"]["lyric_syllable_errors"], 2)


def main() -> int:
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(OMRBenchTestSuite)
    runner = unittest.TextTestRunner(verbosity=2)
    res = runner.run(suite)
    return 0 if res.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main())
