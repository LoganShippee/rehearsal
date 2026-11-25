#!/usr/bin/env python3
"""
Compare 3 Audiveris execution strategies on the Choir Benchmark:
  1. Single run (1 pass per PDF)
  2. Parallel multi-run on every page (300 dpi + 400 dpi + 350 dpi contrast-boosted)
  3. Flagged-pages-only rerun (1 pass first, then parallel alternates ONLY on pages with flagged measures)

Usage:
  /usr/bin/python3 tools/omr-bench/bench_multirun.py [--pieces p1,p2,...]
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
from typing import Any, Dict, List, Optional, Set, Tuple

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "tools", "omr-bench"))
import grade as g  # noqa: E402

AUDIVERIS_BIN = "/Applications/Audiveris.app/Contents/MacOS/Audiveris"
PREP_SWIFT = os.path.join(ROOT, "tools", "omr-service", "preprocess.swift")
PREP_BIN = "/tmp/rehearsal-prep-bench"


def ensure_prep_bin() -> str:
    if os.path.isfile(PREP_BIN) and os.access(PREP_BIN, os.X_OK):
        return PREP_BIN
    os.makedirs("/tmp/swift-modcache", exist_ok=True)
    subprocess.run(
        ["swiftc", "-O", "-module-cache-path", "/tmp/swift-modcache", PREP_SWIFT, "-o", PREP_BIN],
        check=True,
    )
    return PREP_BIN


def count_pdf_pages(path: str) -> int:
    data = open(path, "rb").read()
    return max(1, len(re.findall(rb"/Type\s*/Page(?![a-zA-Z])", data)))


def audiveris_env() -> Dict[str, str]:
    env = os.environ.copy()
    tess = os.path.expanduser("~/Library/Application Support/AudiverisLtd/audiveris/tessdata")
    if os.path.isdir(tess):
        env["TESSDATA_PREFIX"] = tess
    env["JAVA_TOOL_OPTIONS"] = (env.get("JAVA_TOOL_OPTIONS", "") + " -Djava.util.Arrays.useLegacyMergeSort=true").strip()
    return env


def run_audiveris_on_inputs(inputs: List[str], out_dir: str) -> Tuple[Optional[str], float]:
    os.makedirs(out_dir, exist_ok=True)
    t0 = time.monotonic()
    cmd = [AUDIVERIS_BIN, "-batch", "-transcribe", "-export", "-swap", "-output", out_dir, "--"] + inputs
    subprocess.run(cmd, env=audiveris_env(), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=240, check=False)
    elapsed = time.monotonic() - t0
    for root, _, files in os.walk(out_dir):
        for fn in sorted(files):
            if fn.endswith((".mxl", ".musicxml", ".xml")):
                return os.path.join(root, fn), elapsed
    return None, elapsed


def jsc_analyze_with_alternates(primary_xml: str, alternate_xmls: List[str]) -> Tuple[str, Dict[str, Any]]:
    with tempfile.TemporaryDirectory(prefix="omr-mr-jsc-") as td:
        prim_p = os.path.join(td, "prim.xml")
        alt_paths = []
        with open(prim_p, "w", encoding="utf-8") as f:
            f.write(primary_xml)
        for idx, ax in enumerate(alternate_xmls):
            ap = os.path.join(td, f"alt-{idx}.xml")
            with open(ap, "w", encoding="utf-8") as f:
                f.write(ax)
            alt_paths.append(ap)
        drv = os.path.join(td, "drv.js")
        js = (
            f"load({json.dumps(os.path.join(ROOT, 'web', 'scan-model.js'))});\n"
            f"load({json.dumps(os.path.join(ROOT, 'web', 'scan-wordlist.js'))});\n"
            f"load({json.dumps(os.path.join(ROOT, 'web', 'scan-consensus.js'))});\n"
            f"load({json.dumps(os.path.join(ROOT, 'web', 'scan-flags.js'))});\n"
            f"var primary = sfParseMusicXml(readFile({json.dumps(prim_p)}));\n"
            f"var altPaths = {json.dumps(alt_paths)};\n"
            "var alts = [];\n"
            "for (var i = 0; i < altPaths.length; i++) {\n"
            "  try { alts.push(sfParseMusicXml(readFile(altPaths[i]))); } catch (e) {}\n"
            "}\n"
            "var flags = sfAnalyzeFlags(primary, { alternateModels: alts });\n"
            "print(JSON.stringify({ xml: sfExportMusicXml(primary), flagReport: flags }));\n"
        )
        with open(drv, "w", encoding="utf-8") as f:
            f.write(js)
        pr = subprocess.run([g.JSC_BIN, drv], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
        obj = json.loads(pr.stdout)
        return obj["xml"], obj["flagReport"]


def estimate_flagged_pages(xml_text: str, flag_report: Dict[str, Any], total_pages: int) -> List[int]:
    """Map flagged measureIndex values to 1-based page numbers using <print new-page='yes'/> or uniform fallback."""
    flagged_idxs = {
        int(m.get("measureIndex", 0))
        for m in flag_report.get("measures", [])
        if m.get("flagged")
    }
    if not flagged_idxs:
        return []
    root = ET.fromstring(xml_text.strip())
    first_part = root.find("part")
    measures = first_part.findall("measure") if first_part is not None else []
    measure_to_page: Dict[int, int] = {}
    cur_page = 1
    saw_explicit_break = False
    for mi, mel in enumerate(measures):
        pr = mel.find("print")
        if pr is not None and (pr.attrib.get("new-page", "").lower() == "yes" or "page-number" in pr.attrib):
            if mi > 0:
                cur_page += 1
                saw_explicit_break = True
        measure_to_page[mi] = min(total_pages, cur_page)
    pages: Set[int] = set()
    total_m = max(1, len(measures))
    for mi in flagged_idxs:
        if saw_explicit_break and mi in measure_to_page:
            pages.add(measure_to_page[mi])
        else:
            p = min(total_pages, max(1, 1 + (mi * total_pages) // total_m))
            pages.add(p)
    return sorted(pages)


def eval_piece(pair: Dict[str, Any], prep_bin: str) -> Dict[str, Any]:
    slug = pair["name"]
    pdf_path = pair["originalPath"]
    gold_xml = g.load_musicxml(pair["goldPath"])
    pages = count_pdf_pages(pdf_path)

    # 1) Single run baseline (load existing raw.mxl + timings.json if present, else run live)
    timings_path = os.path.join(os.path.dirname(pair["goldPath"]), "..", "timings.json")
    raw_xml = g.load_musicxml(pair["rawPath"])
    t_single = 0.0
    if os.path.isfile(timings_path):
        tmap = json.load(open(timings_path))
        if slug in tmap:
            t_single = float(tmap[slug]["seconds"])
    if t_single <= 0:
        with tempfile.TemporaryDirectory() as td:
            exp, t_single = run_audiveris_on_inputs([pdf_path], os.path.join(td, "out"))
            if exp:
                raw_xml = g.load_musicxml(exp)

    pp1_xml, flags1 = g.postprocess_with_jsc(raw_xml)
    grade1 = g.grade_score(pp1_xml, gold_xml, flag_report=flags1)

    # 2) Render 3 variants for all pages and run Audiveris in parallel across all 3 variants
    with tempfile.TemporaryDirectory(prefix=f"omr-mr-{slug}-") as td:
        var_dir = os.path.join(td, "variants")
        t_prep0 = time.monotonic()
        subprocess.run([prep_bin, "variants", pdf_path, var_dir], check=True)
        t_prep = time.monotonic() - t_prep0

        variants = ["v300", "v400", "v350c"]
        var_inputs: Dict[str, List[str]] = {}
        for v in variants:
            vd = os.path.join(var_dir, v)
            var_inputs[v] = sorted(os.path.join(vd, fn) for fn in os.listdir(vd) if fn.endswith(".png"))

        max_workers = max(1, min(3, os.cpu_count() or 2))
        t_par0 = time.monotonic()
        first_finish = None
        var_xmls: Dict[str, str] = {}
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as pool:
            futs = {
                pool.submit(run_audiveris_on_inputs, var_inputs[v], os.path.join(td, f"out-{v}")): v
                for v in variants
            }
            for fut in concurrent.futures.as_completed(futs):
                v = futs[fut]
                exp, _dur = fut.result()
                if first_finish is None:
                    first_finish = time.monotonic() - t_par0 + t_prep
                if exp:
                    try:
                        var_xmls[v] = g.load_musicxml(exp)
                    except Exception:
                        pass
        t_all_par = (time.monotonic() - t_par0) + t_prep

        # Pick v300 or first available as primary, rest as alternates
        prim_v = "v300" if "v300" in var_xmls else next(iter(var_xmls.keys()), None)
        if prim_v:
            alt_xmls = [var_xmls[v] for v in variants if v != prim_v and v in var_xmls]
            pp2_xml, flags2 = jsc_analyze_with_alternates(var_xmls[prim_v], alt_xmls)
            grade2 = g.grade_score(pp2_xml, gold_xml, flag_report=flags2)
        else:
            grade2 = grade1

        # 3) Flagged-pages-only approach: run v400 + v350c ONLY on pages flagged in approach 1
        flagged_pages = estimate_flagged_pages(pp1_xml, flags1, pages)
        t_flagged_extra = 0.0
        if flagged_pages and len(flagged_pages) < pages:
            flagged_v400 = [os.path.join(var_dir, "v400", f"page-{p:04d}.png") for p in flagged_pages]
            flagged_v350 = [os.path.join(var_dir, "v350c", f"page-{p:04d}.png") for p in flagged_pages]
            tf0 = time.monotonic()
            # Run only 2 alternates on flagged pages
            flagged_alts: List[str] = []
            with concurrent.futures.ThreadPoolExecutor(max_workers=min(2, max_workers)) as pool:
                futs3 = [
                    pool.submit(run_audiveris_on_inputs, flagged_v400, os.path.join(td, "fl-400")),
                    pool.submit(run_audiveris_on_inputs, flagged_v350, os.path.join(td, "fl-350")),
                ]
                for fut in futs3:
                    exp, _ = fut.result()
                    if exp:
                        try:
                            flagged_alts.append(g.load_musicxml(exp))
                        except Exception:
                            pass
            t_flagged_extra = time.monotonic() - tf0
            # Note: single-page partial XML has page-scoped measures; report full comparison vs single run when all pages ran vs subset
            grade3 = grade2 if not flagged_pages else grade2  # measure flags come from aligning primary + alternates
            # Recompute cleanly when flagged_alts is partial using full single-run + flags delta
            if len(flagged_pages) < pages and flagged_alts:
                # Only count alternate disagreement on measures belonging to flagged pages
                pp3_xml, flags3 = jsc_analyze_with_alternates(pp1_xml, flagged_alts)
                grade3 = g.grade_score(pp3_xml, gold_xml, flag_report=flags3)
        elif not flagged_pages:
            t_flagged_extra = 0.0
            grade3 = grade1
        else:
            # All pages were flagged -> rerunning flagged == rerunning all pages (except reusing run 1!)
            tf0 = time.monotonic()
            with concurrent.futures.ThreadPoolExecutor(max_workers=min(2, max_workers)) as pool:
                futs3 = [
                    pool.submit(run_audiveris_on_inputs, var_inputs["v400"], os.path.join(td, "flall-400")),
                    pool.submit(run_audiveris_on_inputs, var_inputs["v350c"], os.path.join(td, "flall-350")),
                ]
                fl_alts = []
                for fut in futs3:
                    exp, _ = fut.result()
                    if exp:
                        fl_alts.append(g.load_musicxml(exp))
            t_flagged_extra = time.monotonic() - tf0 + t_prep
            pp3_xml, flags3 = jsc_analyze_with_alternates(pp1_xml, fl_alts)
            grade3 = g.grade_score(pp3_xml, gold_xml, flag_report=flags3)

    t_flagged_total = t_single + t_flagged_extra
    return {
        "piece": slug,
        "pages": pages,
        "flaggedPages": flagged_pages,
        "single": {
            "overall": grade1["overall"],
            "note": grade1["dimensions"]["pitch"],
            "rhythm": grade1["dimensions"]["rhythm"],
            "lyric": grade1["dimensions"]["lyric"],
            "catch": grade1["dimensions"]["flags"]["recall"],
            "prec": grade1["dimensions"]["flags"]["precision"],
            "secPerPage": round(t_single / pages, 2),
        },
        "parallelAll": {
            "overall": grade2["overall"],
            "note": grade2["dimensions"]["pitch"],
            "rhythm": grade2["dimensions"]["rhythm"],
            "lyric": grade2["dimensions"]["lyric"],
            "catch": grade2["dimensions"]["flags"]["recall"],
            "prec": grade2["dimensions"]["flags"]["precision"],
            "firstResultSecPerPage": round((first_finish or t_all_par) / pages, 2),
            "secPerPage": round(t_all_par / pages, 2),
        },
        "flaggedOnly": {
            "overall": grade3["overall"],
            "note": grade3["dimensions"]["pitch"],
            "rhythm": grade3["dimensions"]["rhythm"],
            "lyric": grade3["dimensions"]["lyric"],
            "catch": grade3["dimensions"]["flags"]["recall"],
            "prec": grade3["dimensions"]["flags"]["precision"],
            "secPerPage": round(t_flagged_total / pages, 2),
        },
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pieces", default="stille-nacht,stille-nacht-photo,abide-with-me,abide-with-me-photo,locus-iste-photo")
    ap.add_argument("--out", default="/tmp/multirun-bench.json")
    args = ap.parse_args()

    wanted = {x.strip() for x in args.pieces.split(",") if x.strip()}
    pairs = [p for p in g.discover_bench_pairs(os.path.join(ROOT, "tests", "fixtures", "omr-bench", "choir")) if p["name"] in wanted]
    prep_bin = ensure_prep_bin()

    rows = []
    for p in pairs:
        print(f"Running multi-run comparison on {p['name']}...", flush=True)
        row = eval_piece(p, prep_bin)
        rows.append(row)
        print(
            f"  {row['piece']} ({row['pages']}p, flaggedPages={row['flaggedPages']}): "
            f"1run={row['single']['secPerPage']}s/p catch={row['single']['catch']}% | "
            f"parAll={row['parallelAll']['secPerPage']}s/p (1st {row['parallelAll']['firstResultSecPerPage']}s/p) catch={row['parallelAll']['catch']}% prec={row['parallelAll']['prec']}% | "
            f"flaggedOnly={row['flaggedOnly']['secPerPage']}s/p catch={row['flaggedOnly']['catch']}% prec={row['flaggedOnly']['prec']}%",
            flush=True,
        )

    def avg(key: str, field: str) -> float:
        return round(sum(r[key][field] for r in rows) / max(1, len(rows)), 2)

    summary = {
        mode: {
            "note": avg(mode, "note"),
            "rhythm": avg(mode, "rhythm"),
            "lyric": avg(mode, "lyric"),
            "catch": avg(mode, "catch"),
            "prec": avg(mode, "prec"),
            "secPerPage": avg(mode, "secPerPage"),
        }
        for mode in ("single", "parallelAll", "flaggedOnly")
    }
    summary["parallelAll"]["firstResultSecPerPage"] = avg("parallelAll", "firstResultSecPerPage")
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump({"pieces": rows, "summary": summary}, f, indent=2)
    print("\nSUMMARY:", json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
