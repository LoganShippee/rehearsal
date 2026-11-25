#!/usr/bin/env python3
"""
Zero-dependency OMR Baseline Grading & Issue-Identification Harness for Rehearsal.

Grades candidate OMR MusicXML/.mxl against a verified gold MusicXML/.mxl across:
  - structure, pitch, rhythm, ties, accidentals, text, and optional flag recall/precision
  - automatic issue classification & ranked frequency summary
  - optional JS post-processing delta evaluation via macOS JavaScriptCore (web/scan-model.js + web/scan-flags.js)
  - two-tier baseline regression gate (> 2.0 drop fails, >= 1.0 drift warns)
  - private local benchmark capture (--capture-job) strictly outside git

Python 3.9+ standard library only.
"""

from __future__ import annotations

import argparse
import difflib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from typing import Any, Dict, List, Optional, Set, Tuple

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_BENCH_DIR = os.path.join(ROOT, "tests", "fixtures", "omr-bench")
DEFAULT_BASELINE_PATH = os.path.join(DEFAULT_BENCH_DIR, "baseline.json")
DEFAULT_JOBS_DIR = os.path.join(ROOT, "tools", "omr-service", "data", "jobs")
DEFAULT_PRIVATE_BENCH_DIR = os.path.expanduser("~/Rehearsal-Backups/omr-bench")
JSC_BIN = "/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc"

DYNAMIC_TAGS = {
    "ppp", "pp", "p", "mp", "mf", "f", "ff", "fff",
    "fp", "sf", "sfz", "sffz", "rf", "rfz", "fz",
}
SPOKEN_WORDS_RE = re.compile(
    r"\b(spoken|speak|shout|shouted|whisper|whispered|clap|claps|snap|snaps|stomp|chant|rhythmically|sprechstimme)\b",
    re.IGNORECASE,
)
DYNAMIC_WORDS_RE = re.compile(
    r"^(ppp|pp|mp|mf|fff|ff|sfz|fp|cresc\.?|decresc\.?|dim\.?|[pf])$",
    re.IGNORECASE,
)


def _strip_ns(tag: str) -> str:
    return tag.split("}", 1)[1] if "}" in tag else tag


def load_musicxml(path: str) -> str:
    """Load MusicXML text from .xml, .musicxml, or .mxl."""
    if path.lower().endswith(".mxl"):
        with zipfile.ZipFile(path, "r") as zf:
            names = zf.namelist()
            rootfile: Optional[str] = None
            if "META-INF/container.xml" in names:
                croot = ET.fromstring(zf.read("META-INF/container.xml").decode("utf-8", errors="replace"))
                for el in croot.iter():
                    if _strip_ns(el.tag) == "rootfile":
                        fp = el.attrib.get("full-path", "").strip()
                        if fp:
                            rootfile = fp
                            break
            if not rootfile or rootfile not in names:
                cands = [
                    n for n in names
                    if not n.endswith("/")
                    and not n.upper().startswith("META-INF/")
                    and n.lower().endswith((".musicxml", ".xml"))
                ]
                if not cands:
                    raise ValueError(f"No MusicXML found inside {path}")
                rootfile = sorted(cands)[0]
            return zf.read(rootfile).decode("utf-8", errors="replace")
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


def _child_text(elem: ET.Element, tag: str) -> str:
    for ch in elem:
        if _strip_ns(ch.tag) == tag:
            return (ch.text or "").strip()
    return ""


def _find_child(elem: ET.Element, tag: str) -> Optional[ET.Element]:
    for ch in elem:
        if _strip_ns(ch.tag) == tag:
            return ch
    return None


def parse_score_for_grading(xml_text: str) -> Dict[str, Any]:
    """Parse MusicXML into a normalized per-part, per-measure structure for grading."""
    root = ET.fromstring(xml_text.strip())
    part_names: Dict[str, str] = {}
    part_list = _find_child(root, "part-list")
    if part_list is not None:
        for sp in part_list:
            if _strip_ns(sp.tag) == "score-part":
                pid = sp.attrib.get("id", "")
                pname = _child_text(sp, "part-name") or pid
                if pid:
                    part_names[pid] = pname

    parts: List[Dict[str, Any]] = []
    for p_idx, part_el in enumerate(root):
        if _strip_ns(part_el.tag) != "part":
            continue
        pid = part_el.attrib.get("id", f"P{p_idx + 1}")
        pname = part_names.get(pid, pid)
        divisions = 1.0
        measures: List[Dict[str, Any]] = []

        for m_idx, m_el in enumerate(part_el):
            if _strip_ns(m_el.tag) != "measure":
                continue
            m_num = str(m_el.attrib.get("number", m_idx + 1))
            notes: List[Dict[str, Any]] = []
            dynamics: List[str] = []
            words: List[str] = []
            spoken_cues: List[str] = []

            for ch in m_el:
                ctag = _strip_ns(ch.tag)
                if ctag == "attributes":
                    divs_txt = _child_text(ch, "divisions")
                    if divs_txt:
                        try:
                            divisions = max(1.0, float(divs_txt))
                        except ValueError:
                            pass
                elif ctag == "direction":
                    for dt in ch:
                        if _strip_ns(dt.tag) != "direction-type":
                            continue
                        for dchild in dt:
                            dtag = _strip_ns(dchild.tag)
                            if dtag == "dynamics":
                                for dyn in dchild:
                                    dname = _strip_ns(dyn.tag).lower()
                                    if dname:
                                        dynamics.append(dname)
                            elif dtag == "words":
                                wtxt = (dchild.text or "").strip()
                                if wtxt:
                                    words.append(wtxt)
                                    if DYNAMIC_WORDS_RE.match(wtxt):
                                        dynamics.append(wtxt.lower().rstrip("."))
                                    for sm in SPOKEN_WORDS_RE.finditer(wtxt):
                                        spoken_cues.append(sm.group(1).lower())
                elif ctag == "note":
                    is_grace = _find_child(ch, "grace") is not None
                    if is_grace:
                        continue
                    is_rest = _find_child(ch, "rest") is not None
                    is_chord = _find_child(ch, "chord") is not None
                    is_unpitched = _find_child(ch, "unpitched") is not None
                    notehead = _child_text(ch, "notehead").lower()
                    if is_unpitched or notehead == "x":
                        spoken_cues.append("x-notehead")

                    dur_txt = _child_text(ch, "duration")
                    try:
                        dur_divs = float(dur_txt) if dur_txt else divisions
                    except ValueError:
                        dur_divs = divisions
                    dur_q = round(dur_divs / divisions, 4)
                    dots = sum(1 for sub in ch if _strip_ns(sub.tag) == "dot")

                    step = ""
                    octave = 0
                    alter = 0
                    pitch_el = _find_child(ch, "pitch")
                    if pitch_el is not None:
                        step = _child_text(pitch_el, "step").upper()
                        try:
                            octave = int(_child_text(pitch_el, "octave") or "4")
                        except ValueError:
                            octave = 4
                        try:
                            alter = int(round(float(_child_text(pitch_el, "alter") or "0")))
                        except ValueError:
                            alter = 0

                    accidental = _child_text(ch, "accidental").lower()
                    ties: Set[str] = set()
                    for sub in ch:
                        stag = _strip_ns(sub.tag)
                        if stag == "tie":
                            ttype = sub.attrib.get("type", "").lower()
                            if ttype in ("start", "stop"):
                                ties.add(ttype)
                        elif stag == "notations":
                            for nsub in sub:
                                if _strip_ns(nsub.tag) == "tied":
                                    ttype = nsub.attrib.get("type", "").lower()
                                    if ttype in ("start", "stop"):
                                        ties.add(ttype)

                    lyrics: List[str] = []
                    for sub in ch:
                        if _strip_ns(sub.tag) == "lyric":
                            ltxt = _child_text(sub, "text")
                            if ltxt:
                                lyrics.append(ltxt)

                    notes.append(
                        {
                            "is_rest": is_rest,
                            "is_chord": is_chord,
                            "step": step,
                            "octave": octave,
                            "alter": alter,
                            "accidental": accidental,
                            "duration_q": dur_q,
                            "dots": dots,
                            "ties": sorted(ties),
                            "lyrics": lyrics,
                        }
                    )

            measures.append(
                {
                    "index": m_idx,
                    "number": m_num,
                    "notes": notes,
                    "dynamics": dynamics,
                    "words": words,
                    "spoken_cues": spoken_cues,
                }
            )
        parts.append({"id": pid, "name": pname, "measures": measures})

    return {"parts": parts}


def _f1_multiset(cand_items: List[Any], gold_items: List[Any]) -> float:
    if not gold_items and not cand_items:
        return 100.0
    if not gold_items or not cand_items:
        return 0.0
    g_counts: Dict[Any, int] = {}
    for x in gold_items:
        g_counts[x] = g_counts.get(x, 0) + 1
    c_counts: Dict[Any, int] = {}
    for x in cand_items:
        c_counts[x] = c_counts.get(x, 0) + 1
    tp = sum(min(g_counts[k], c_counts.get(k, 0)) for k in g_counts)
    prec = tp / float(len(cand_items))
    rec = tp / float(len(gold_items))
    if prec + rec == 0:
        return 0.0
    return round(100.0 * (2.0 * prec * rec / (prec + rec)), 2)


def grade_score(
    candidate_xml: str,
    gold_xml: str,
    flag_report: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Grade candidate MusicXML against gold MusicXML across 7 dimensions (0..100)
    and return ranked issue categories with exact (part, measure, expected, actual) examples.
    """
    cand = parse_score_for_grading(candidate_xml)
    gold = parse_score_for_grading(gold_xml)

    c_parts = cand["parts"]
    g_parts = gold["parts"]
    issues: List[Dict[str, Any]] = []
    erroneous_measures: Set[int] = set()

    def add_issue(
        category: str, part_name: str, measure_num: str, expected: Any, actual: Any
    ) -> None:
        issues.append(
            {
                "category": category,
                "part": part_name,
                "measure": measure_num,
                "expected": expected,
                "actual": actual,
            }
        )
        try:
            erroneous_measures.add(int(re.sub(r"[^0-9]", "", str(measure_num)) or "0"))
        except ValueError:
            pass

    # 1. Structure score
    gp_len = len(g_parts)
    cp_len = len(c_parts)
    if gp_len == 0 and cp_len == 0:
        part_ratio = 1.0
    elif gp_len == 0 or cp_len == 0:
        part_ratio = 0.0
    else:
        part_ratio = min(gp_len, cp_len) / float(max(gp_len, cp_len))

    if cp_len > gp_len:
        for extra in c_parts[gp_len:]:
            add_issue(
                "duplicated_part",
                extra["name"],
                "1",
                f"{gp_len} part(s)",
                f"{cp_len} parts (extra: {extra['name']})",
            )
    elif cp_len < gp_len:
        for missing in g_parts[cp_len:]:
            add_issue(
                "missing_part",
                missing["name"],
                "1",
                missing["name"],
                "missing",
            )

    aligned_parts = min(gp_len, cp_len)
    measure_ratios: List[float] = []
    pitch_ratios: List[float] = []
    rhythm_ratios: List[float] = []

    gold_ties_list: List[Tuple[str, int, str]] = []
    cand_ties_list: List[Tuple[str, int, str]] = []
    gold_acc_list: List[Tuple[str, str, int, int]] = []
    cand_acc_list: List[Tuple[str, str, int, int]] = []
    gold_text_tokens: List[str] = []
    cand_text_tokens: List[str] = []

    for pi in range(aligned_parts):
        gp = g_parts[pi]
        cp = c_parts[pi]
        pname = gp["name"]
        gm_list = gp["measures"]
        cm_list = cp["measures"]

        if len(gm_list) == 0 and len(cm_list) == 0:
            measure_ratios.append(1.0)
        elif len(gm_list) == 0 or len(cm_list) == 0:
            measure_ratios.append(0.0)
        else:
            measure_ratios.append(
                min(len(gm_list), len(cm_list)) / float(max(len(gm_list), len(cm_list)))
            )

        if len(cm_list) < len(gm_list):
            for gm in gm_list[len(cm_list) :]:
                add_issue("missing_measure", pname, gm["number"], f"m.{gm['number']}", "missing")

        for mi in range(min(len(gm_list), len(cm_list))):
            gm = gm_list[mi]
            cm = cm_list[mi]
            m_num = gm["number"]

            # Pitch comparison (pitched notes only)
            g_pitches = [
                (n["step"], n["octave"], n["alter"])
                for n in gm["notes"]
                if not n["is_rest"] and n["step"]
            ]
            c_pitches = [
                (n["step"], n["octave"], n["alter"])
                for n in cm["notes"]
                if not n["is_rest"] and n["step"]
            ]
            if g_pitches or c_pitches:
                sm_p = difflib.SequenceMatcher(None, g_pitches, c_pitches)
                pitch_ratios.append(sm_p.ratio())
                for tag, i1, i2, j1, j2 in sm_p.get_opcodes():
                    if tag == "replace":
                        for k in range(min(i2 - i1, j2 - j1)):
                            g_n = g_pitches[i1 + k]
                            c_n = c_pitches[j1 + k]
                            if g_n[0] == c_n[0] and g_n[2] == c_n[2] and g_n[1] != c_n[1]:
                                add_issue("octave_error", pname, m_num, f"{g_n[0]}{g_n[1]}", f"{c_n[0]}{c_n[1]}")
                            elif g_n[0] == c_n[0] and g_n[1] == c_n[1] and g_n[2] != c_n[2]:
                                add_issue("missed_accidental", pname, m_num, f"{g_n[0]}{g_n[1]}(alter={g_n[2]})", f"{c_n[0]}{c_n[1]}(alter={c_n[2]})")
                            else:
                                add_issue("wrong_pitch", pname, m_num, f"{g_n[0]}{g_n[1]}", f"{c_n[0]}{c_n[1]}")
                    elif tag == "delete":
                        for k in range(i1, i2):
                            g_n = g_pitches[k]
                            add_issue("wrong_pitch", pname, m_num, f"{g_n[0]}{g_n[1]}", "missing")
                    elif tag == "insert":
                        for k in range(j1, j2):
                            c_n = c_pitches[k]
                            add_issue("wrong_pitch", pname, m_num, "none", f"{c_n[0]}{c_n[1]}")

            # Rhythm comparison (all notes/rests)
            g_rhy = [(n["is_rest"], n["duration_q"]) for n in gm["notes"]]
            c_rhy = [(n["is_rest"], n["duration_q"]) for n in cm["notes"]]
            if g_rhy or c_rhy:
                sm_r = difflib.SequenceMatcher(None, g_rhy, c_rhy)
                rhythm_ratios.append(sm_r.ratio())
                for tag, i1, i2, j1, j2 in sm_r.get_opcodes():
                    if tag == "replace":
                        for k in range(min(i2 - i1, j2 - j1)):
                            gr = g_rhy[i1 + k]
                            cr = c_rhy[j1 + k]
                            if abs(gr[1] - cr[1] * 1.5) < 1e-3:
                                add_issue("missing_dot", pname, m_num, f"{gr[1]}q", f"{cr[1]}q")
                            elif abs(cr[1] - gr[1] * 1.5) < 1e-3:
                                add_issue("extra_dot", pname, m_num, f"{gr[1]}q", f"{cr[1]}q")
                            else:
                                add_issue("wrong_duration", pname, m_num, f"{gr[1]}q", f"{cr[1]}q")
                    elif tag == "delete":
                        for k in range(i1, i2):
                            add_issue("wrong_duration", pname, m_num, f"{g_rhy[k][1]}q", "missing")

            # Ties
            g_tie_set: Set[Tuple[str, int, str]] = set()
            c_tie_set: Set[Tuple[str, int, str]] = set()
            for ni, n in enumerate(gm["notes"]):
                for t in n["ties"]:
                    item = (m_num, ni, t)
                    gold_ties_list.append(item)
                    g_tie_set.add(item)
            for ni, n in enumerate(cm["notes"]):
                for t in n["ties"]:
                    item = (m_num, ni, t)
                    cand_ties_list.append(item)
                    c_tie_set.add(item)
            for missing_t in sorted(g_tie_set - c_tie_set):
                add_issue("missed_tie", pname, m_num, f"tie {missing_t[2]}", "none")

            # Accidentals / altered pitches
            g_acc_set: Set[Tuple[str, str, int, int]] = set()
            c_acc_set: Set[Tuple[str, str, int, int]] = set()
            for n in gm["notes"]:
                if not n["is_rest"] and (n["alter"] != 0 or n["accidental"]):
                    item = (m_num, n["step"], n["octave"], n["alter"])
                    gold_acc_list.append(item)
                    g_acc_set.add(item)
            for n in cm["notes"]:
                if not n["is_rest"] and (n["alter"] != 0 or n["accidental"]):
                    item = (m_num, n["step"], n["octave"], n["alter"])
                    cand_acc_list.append(item)
                    c_acc_set.add(item)
            for missing_a in sorted(g_acc_set - c_acc_set):
                # Avoid double-counting if already logged from pitch replacement
                if not any(
                    iss["category"] == "missed_accidental"
                    and iss["part"] == pname
                    and iss["measure"] == m_num
                    for iss in issues
                ):
                    add_issue(
                        "missed_accidental",
                        pname,
                        m_num,
                        f"{missing_a[1]}{missing_a[2]}(alter={missing_a[3]})",
                        "missing",
                    )

            # Lyrics
            g_lyrics = [ly for n in gm["notes"] for ly in n["lyrics"]]
            c_lyrics = [ly for n in cm["notes"] for ly in n["lyrics"]]
            gold_text_tokens.extend(g_lyrics)
            cand_text_tokens.extend(c_lyrics)
            for li in range(min(len(g_lyrics), len(c_lyrics))):
                if g_lyrics[li] != c_lyrics[li]:
                    add_issue("lyric_ocr_typo", pname, m_num, g_lyrics[li], c_lyrics[li])
            if len(g_lyrics) > len(c_lyrics):
                for ly in g_lyrics[len(c_lyrics) :]:
                    add_issue("lyric_ocr_typo", pname, m_num, ly, "missing")

            # Dynamics & words
            gold_text_tokens.extend(gm["dynamics"])
            cand_text_tokens.extend(cm["dynamics"])
            g_dyn_counts: Dict[str, int] = {}
            for d in gm["dynamics"]:
                g_dyn_counts[d] = g_dyn_counts.get(d, 0) + 1
            c_dyn_counts: Dict[str, int] = {}
            for d in cm["dynamics"]:
                c_dyn_counts[d] = c_dyn_counts.get(d, 0) + 1
            for d, cnt in g_dyn_counts.items():
                if c_dyn_counts.get(d, 0) < cnt:
                    add_issue("unparsed_dynamic", pname, m_num, d, "missing")

            # Spoken cues
            gold_text_tokens.extend(gm["spoken_cues"])
            cand_text_tokens.extend(cm["spoken_cues"])
            for spk in gm["spoken_cues"]:
                if spk not in cm["spoken_cues"]:
                    add_issue("missed_spoken", pname, m_num, spk, "missing")

    struct_score = round(
        100.0 * (0.5 * part_ratio + 0.5 * (sum(measure_ratios) / len(measure_ratios) if measure_ratios else 1.0)),
        2,
    )
    pitch_score = round(100.0 * (sum(pitch_ratios) / len(pitch_ratios) if pitch_ratios else 1.0), 2)
    rhythm_score = round(100.0 * (sum(rhythm_ratios) / len(rhythm_ratios) if rhythm_ratios else 1.0), 2)
    ties_score = _f1_multiset(cand_ties_list, gold_ties_list)
    acc_score = _f1_multiset(cand_acc_list, gold_acc_list)
    text_score = _f1_multiset(cand_text_tokens, gold_text_tokens)

    flags_metrics: Optional[Dict[str, Any]] = None
    if flag_report is not None:
        flagged_nums: Set[int] = set()
        for f in flag_report.get("flaggedMeasures", []):
            try:
                flagged_nums.add(int(f.get("measureNumber", f.get("measureIndex", 0) + 1)))
            except (TypeError, ValueError):
                pass
        if not erroneous_measures and not flagged_nums:
            prec = rec = f1 = 100.0
        elif not erroneous_measures:
            prec = 0.0 if flagged_nums else 100.0
            rec = 100.0
            f1 = 0.0 if flagged_nums else 100.0
        else:
            tp = len(erroneous_measures & flagged_nums)
            prec = round(100.0 * tp / len(flagged_nums), 2) if flagged_nums else 0.0
            rec = round(100.0 * tp / len(erroneous_measures), 2)
            f1 = round(2.0 * prec * rec / (prec + rec), 2) if (prec + rec) > 0 else 0.0
        flags_metrics = {
            "precision": prec,
            "recall": rec,
            "f1": f1,
            "erroneousMeasures": sorted(erroneous_measures),
            "flaggedMeasures": sorted(flagged_nums),
        }

    overall = round(
        0.15 * struct_score
        + 0.25 * pitch_score
        + 0.20 * rhythm_score
        + 0.10 * ties_score
        + 0.10 * acc_score
        + 0.20 * text_score,
        2,
    )

    by_cat: Dict[str, List[Dict[str, Any]]] = {}
    for iss in issues:
        by_cat.setdefault(iss["category"], []).append(iss)
    issue_summary = [
        {
            "category": cat,
            "count": len(items),
            "examples": items[:3],
        }
        for cat, items in sorted(by_cat.items(), key=lambda kv: (-len(kv[1]), kv[0]))
    ]

    return {
        "overall": overall,
        "dimensions": {
            "structure": struct_score,
            "pitch": pitch_score,
            "rhythm": rhythm_score,
            "ties": ties_score,
            "accidentals": acc_score,
            "text": text_score,
            "flags": flags_metrics,
        },
        "issues": issues,
        "issueSummary": issue_summary,
    }


def postprocess_with_jsc(
    xml_text: str, pdf_vocab: Optional[List[str]] = None
) -> Tuple[str, Dict[str, Any]]:
    """
    Run candidate MusicXML through web/scan-model.js + web/scan-flags.js in macOS JSC
    and return (postprocessed_xml, flag_report).
    """
    if not os.path.isfile(JSC_BIN):
        raise RuntimeError(f"JavaScriptCore not found at {JSC_BIN}")

    with tempfile.TemporaryDirectory(prefix="omr-bench-jsc-") as tmpdir:
        in_path = os.path.join(tmpdir, "in.xml")
        vocab_path = os.path.join(tmpdir, "vocab.json")
        out_path = os.path.join(tmpdir, "out.json")
        driver_path = os.path.join(tmpdir, "driver.js")

        with open(in_path, "w", encoding="utf-8") as f:
            f.write(xml_text)
        with open(vocab_path, "w", encoding="utf-8") as f:
            json.dump(pdf_vocab or [], f)

        driver_js = (
            f"load({json.dumps(os.path.join(ROOT, 'web', 'scan-model.js'))});\n"
            f"load({json.dumps(os.path.join(ROOT, 'web', 'scan-flags.js'))});\n"
            f"var xml = readFile({json.dumps(in_path)});\n"
            f"var vocab = JSON.parse(readFile({json.dumps(vocab_path)}));\n"
            "var model = sfParseMusicXml(xml);\n"
            "if (vocab && vocab.length && typeof sfCleanOcrLyrics === 'function') {\n"
            "  sfCleanOcrLyrics(model, vocab);\n"
            "}\n"
            "var flags = sfAnalyzeFlags(model);\n"
            "var outXml = sfExportMusicXml(model);\n"
            "print(JSON.stringify({ xml: outXml, flagReport: flags }));\n"
        )
        with open(driver_path, "w", encoding="utf-8") as f:
            f.write(driver_js)

        proc = subprocess.run(
            [JSC_BIN, driver_path],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            timeout=30.0,
            check=False,
        )
        if proc.returncode != 0:
            raise RuntimeError(f"jsc postprocess failed: {proc.stderr or proc.stdout}")
        payload = json.loads(proc.stdout.strip())
        return payload["xml"], payload["flagReport"]


def discover_bench_pairs(bench_dir: str) -> List[Dict[str, Any]]:
    """
    Discover benchmark pairs in either:
      - Repo fixture layout: <slug>-omr-raw.(musicxml|xml|mxl) + manifest/gold mapping
      - Private folder layout: <bench_dir>/<slug>/(raw.* + gold.*)
    """
    pairs: List[Dict[str, Any]] = []
    if not os.path.isdir(bench_dir):
        return pairs

    manifest_path = os.path.join(bench_dir, "manifest.json")
    if os.path.isfile(manifest_path):
        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest = json.load(f)
        for item in manifest.get("cases", []):
            raw_p = os.path.join(bench_dir, item["raw"])
            gold_p = os.path.join(ROOT, item["gold"]) if not os.path.isabs(item["gold"]) else item["gold"]
            vocab_p = os.path.join(bench_dir, item["vocab"]) if item.get("vocab") else None
            vocab = []
            if vocab_p and os.path.isfile(vocab_p):
                with open(vocab_p, "r", encoding="utf-8") as vf:
                    vocab = json.load(vf)
            pairs.append(
                {
                    "name": item["name"],
                    "rawPath": raw_p,
                    "goldPath": gold_p,
                    "originalPath": None,
                    "vocab": item.get("lyricVocabulary", vocab),
                }
            )
        return pairs

    # Repo default fixtures if no manifest.json
    ode_raw = os.path.join(bench_dir, "ode-to-joy-omr-raw.musicxml")
    band_raw = os.path.join(bench_dir, "band-part-omr-raw.musicxml")
    if os.path.isfile(ode_raw):
        pairs.append(
            {
                "name": "ode-to-joy",
                "rawPath": ode_raw,
                "goldPath": os.path.join(ROOT, "web", "demo", "ode-to-joy.musicxml"),
                "originalPath": None,
                "vocab": ["Joy", "sing", "Ode"],
            }
        )
    if os.path.isfile(band_raw):
        pairs.append(
            {
                "name": "band-part",
                "rawPath": band_raw,
                "goldPath": os.path.join(ROOT, "tests", "fixtures", "scan-band-part.musicxml"),
                "originalPath": None,
                "vocab": [],
            }
        )
    if pairs:
        return pairs

    # Subdirectory layout (<bench_dir>/<slug>/raw.* + gold.*)
    for entry in sorted(os.listdir(bench_dir)):
        sub = os.path.join(bench_dir, entry)
        if not os.path.isdir(sub):
            continue
        raw_p = next(
            (os.path.join(sub, f"raw{ext}") for ext in (".mxl", ".musicxml", ".xml") if os.path.isfile(os.path.join(sub, f"raw{ext}"))),
            None,
        )
        gold_p = next(
            (os.path.join(sub, f"gold{ext}") for ext in (".mxl", ".musicxml", ".xml") if os.path.isfile(os.path.join(sub, f"gold{ext}"))),
            None,
        )
        orig_p = next(
            (os.path.join(sub, name) for name in sorted(os.listdir(sub)) if name.startswith("original.")),
            None,
        )
        if raw_p and gold_p:
            pairs.append(
                {
                    "name": entry,
                    "rawPath": raw_p,
                    "goldPath": gold_p,
                    "originalPath": orig_p,
                    "vocab": [],
                }
            )
    return pairs


def capture_job_to_bench(
    job_id: str,
    jobs_dir: str = DEFAULT_JOBS_DIR,
    dest_root: str = DEFAULT_PRIVATE_BENCH_DIR,
    slug: Optional[str] = None,
) -> str:
    """Copy a verified/completed job's original, raw, and corrected.mxl (as gold.mxl) outside git."""
    src_dir = os.path.join(jobs_dir, job_id)
    if not os.path.isdir(src_dir):
        raise FileNotFoundError(f"Job directory not found: {src_dir}")

    orig = next(
        (os.path.join(src_dir, f) for f in sorted(os.listdir(src_dir)) if f.startswith("original.")),
        None,
    )
    raw = next(
        (os.path.join(src_dir, f) for f in ("raw.mxl", "raw.musicxml", "raw.xml") if os.path.isfile(os.path.join(src_dir, f))),
        None,
    )
    gold = next(
        (os.path.join(src_dir, f) for f in ("corrected.mxl", "corrected.musicxml") if os.path.isfile(os.path.join(src_dir, f))),
        None,
    )
    if not gold:
        raise FileNotFoundError(f"Verified corrected score not found in {src_dir}")

    folder_name = re.sub(r"[^A-Za-z0-9._-]+", "-", (slug or job_id)).strip("-") or job_id
    out_dir = os.path.join(dest_root, folder_name)
    os.makedirs(out_dir, exist_ok=True)
    if orig:
        shutil.copy2(orig, os.path.join(out_dir, os.path.basename(orig)))
    if raw:
        shutil.copy2(raw, os.path.join(out_dir, os.path.basename(raw)))
    gold_ext = os.path.splitext(gold)[1]
    shutil.copy2(gold, os.path.join(out_dir, f"gold{gold_ext}"))
    return out_dir


def check_baseline_regression(
    results: List[Dict[str, Any]],
    baseline: Dict[str, Any],
    *,
    strict: bool = False,
    max_drop: float = 2.0,
    warn_drift: float = 1.0,
) -> Tuple[bool, List[str], List[str]]:
    """
    Two-tier baseline regression check:
      - warns on any >= 1.0 point drift
      - fails if any piece regresses by > 2.0 points on overall (or core dims if strict=True)
    """
    warnings: List[str] = []
    failures: List[str] = []
    base_pieces = baseline.get("pieces", {})
    for res in results:
        name = res["name"]
        if name not in base_pieces:
            continue
        b = base_pieces[name]
        cur_ov = res["overall"]
        base_ov = float(b.get("overall", 0.0))
        diff = round(cur_ov - base_ov, 2)
        if diff < -max_drop:
            failures.append(f"{name}: overall regressed {base_ov:.2f} -> {cur_ov:.2f} ({diff:+.2f})")
        elif abs(diff) >= warn_drift:
            warnings.append(f"{name}: overall drifted {base_ov:.2f} -> {cur_ov:.2f} ({diff:+.2f})")

        if strict:
            for dim in ("structure", "pitch", "rhythm", "ties", "accidentals", "text"):
                c_val = float(res["dimensions"].get(dim) or 0.0)
                b_val = float(b.get("dimensions", {}).get(dim, 0.0))
                d_diff = round(c_val - b_val, 2)
                if d_diff < -max_drop:
                    failures.append(f"{name}.{dim}: regressed {b_val:.2f} -> {c_val:.2f} ({d_diff:+.2f})")
    return len(failures) == 0, warnings, failures


def run_benchmark(
    *,
    bench_dir: str = DEFAULT_BENCH_DIR,
    baseline_path: str = DEFAULT_BASELINE_PATH,
    postprocess: bool = True,
    update_baseline: bool = False,
    strict: bool = False,
    report_path: Optional[str] = None,
    run_omr: bool = False,
) -> Tuple[int, List[Dict[str, Any]]]:
    pairs = discover_bench_pairs(bench_dir)
    if not pairs:
        print(f"No benchmark pairs found in {bench_dir}", file=sys.stderr)
        return 1, []

    baseline: Dict[str, Any] = {"pieces": {}}
    if os.path.isfile(baseline_path):
        with open(baseline_path, "r", encoding="utf-8") as f:
            baseline = json.load(f)

    results: List[Dict[str, Any]] = []
    for pair in pairs:
        raw_xml = load_musicxml(pair["rawPath"])
        gold_xml = load_musicxml(pair["goldPath"])

        if run_omr and pair.get("originalPath"):
            # Optional live re-scan via tools/omr-service/server.py
            sys.path.insert(0, os.path.join(ROOT, "tools", "omr-service"))
            import server as omr_srv  # noqa: E402
            cfg = omr_srv.load_config_from_env()
            adapter = omr_srv.build_engine_adapter(cfg)
            if adapter.is_available():
                with tempfile.TemporaryDirectory(prefix="omr-bench-live-") as td:
                    out_d = os.path.join(td, "out")
                    os.makedirs(out_d, exist_ok=True)
                    subprocess.run(adapter.build_command(pair["originalPath"], out_d), check=False)
                    exp = adapter.find_output(out_d)
                    if exp:
                        raw_xml = load_musicxml(exp)

        raw_grade = grade_score(raw_xml, gold_xml)
        final_grade = raw_grade
        delta_vs_raw: Optional[float] = None

        if postprocess and os.path.isfile(JSC_BIN):
            pp_xml, flag_report = postprocess_with_jsc(raw_xml, pair.get("vocab") or [])
            final_grade = grade_score(pp_xml, gold_xml, flag_report=flag_report)
            delta_vs_raw = round(final_grade["overall"] - raw_grade["overall"], 2)

        final_grade["name"] = pair["name"]
        final_grade["rawOverall"] = raw_grade["overall"]
        final_grade["postprocessDelta"] = delta_vs_raw
        results.append(final_grade)

    # Print table
    header = (
        f"{'piece':<16} | {'overall':>7} | {'struct':>6} | {'pitch':>6} | "
        f"{'rhythm':>6} | {'ties':>6} | {'text':>6} | {'flag-rec':>8} | {'delta':>7}"
    )
    print(header)
    print("-" * len(header))
    agg_issues: Dict[str, int] = {}
    for r in results:
        d = r["dimensions"]
        f_rec = f"{d['flags']['recall']:.1f}%" if d.get("flags") else "  n/a"
        base_ov = baseline.get("pieces", {}).get(r["name"], {}).get("overall")
        delta_str = f"{r['overall'] - base_ov:+.2f}" if base_ov is not None else "  new"
        print(
            f"{r['name']:<16} | {r['overall']:7.2f} | {d['structure']:6.1f} | "
            f"{d['pitch']:6.1f} | {d['rhythm']:6.1f} | {d['ties']:6.1f} | "
            f"{d['text']:6.1f} | {f_rec:>8} | {delta_str:>7}"
        )
        for iss in r["issueSummary"]:
            agg_issues[iss["category"]] = agg_issues.get(iss["category"], 0) + iss["count"]

    if agg_issues:
        print("\nTop Issues:")
        for cat, cnt in sorted(agg_issues.items(), key=lambda kv: (-kv[1], kv[0])):
            print(f"  - {cat}: {cnt}")

    if update_baseline:
        new_base = {
            "version": 1,
            "pieces": {
                r["name"]: {
                    "overall": r["overall"],
                    "rawOverall": r["rawOverall"],
                    "dimensions": r["dimensions"],
                }
                for r in results
            },
        }
        os.makedirs(os.path.dirname(baseline_path), exist_ok=True)
        with open(baseline_path, "w", encoding="utf-8") as f:
            json.dump(new_base, f, indent=2)
            f.write("\n")
        print(f"\nUpdated baseline at {baseline_path}")

    if report_path:
        lines = ["# OMR Benchmark Report\n", "| Piece | Overall | Structure | Pitch | Rhythm | Ties | Text |", "|---|---|---|---|---|---|---|"]
        for r in results:
            d = r["dimensions"]
            lines.append(
                f"| {r['name']} | {r['overall']:.2f} | {d['structure']:.1f} | {d['pitch']:.1f} | {d['rhythm']:.1f} | {d['ties']:.1f} | {d['text']:.1f} |"
            )
        with open(report_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")

    ok, warnings, failures = check_baseline_regression(results, baseline, strict=strict)
    for w in warnings:
        print(f"WARN: {w}", file=sys.stderr)
    for fl in failures:
        print(f"FAIL: {fl}", file=sys.stderr)
    return (0 if ok else 1), results


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Rehearsal OMR Baseline Grader & Issue Identifier")
    ap.add_argument("--dir", default=DEFAULT_BENCH_DIR, help="Benchmark directory")
    ap.add_argument("--baseline", default=DEFAULT_BASELINE_PATH, help="Baseline JSON path")
    ap.add_argument("--no-postprocess", action="store_true", help="Grade raw XML without jsc post-processing")
    ap.add_argument("--update-baseline", action="store_true", help="Write current scores to baseline JSON")
    ap.add_argument("--strict", action="store_true", help="Fail if any individual dimension drops > 2.0 points")
    ap.add_argument("--capture-job", default=None, help="Capture verified jobId into ~/Rehearsal-Backups/omr-bench/")
    ap.add_argument("--slug", default=None, help="Folder slug for --capture-job")
    ap.add_argument("--report", default=None, help="Optional Markdown report output path")
    ap.add_argument("--run-omr", action="store_true", help="Re-run OMR engine on original.* before grading")
    args = ap.parse_args(argv)

    if args.capture_job:
        dest = capture_job_to_bench(args.capture_job, slug=args.slug)
        print(f"Captured job {args.capture_job} to {dest}")
        return 0

    code, _ = run_benchmark(
        bench_dir=args.dir,
        baseline_path=args.baseline,
        postprocess=not args.no_postprocess,
        update_baseline=args.update_baseline,
        strict=args.strict,
        report_path=args.report,
        run_omr=args.run_omr,
    )
    return code


if __name__ == "__main__":
    sys.exit(main())
