#!/usr/bin/env python3
"""
Measure-by-measure PDF cropping and AI visual verification prototype.

Crops each measure of a score from its original PDF using MusicXML layout
coordinates, extracts Audiveris + scan-model.js draft notes and review flags,
and optionally verifies every measure against a multimodal Gemini vision model.
"""

import argparse
import base64
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
import zipfile


REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
JSC_PATHS = [
    shutil.which("jsc"),
    "/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc",
    "/System/Library/Frameworks/JavaScriptCore.framework/Helpers/jsc",
]
CROP_SWIFT = os.path.join(os.path.dirname(__file__), "crop_measures.swift")
CROP_BIN = "/tmp/rehearsal-crop-measures"


def find_jsc():
    for p in JSC_PATHS:
        if p and os.path.exists(p):
            return p
    raise RuntimeError("JavaScriptCore CLI (jsc) not found on this system")


def read_mxl_xml(mxl_path):
    if mxl_path.lower().endswith((".xml", ".musicxml")):
        with open(mxl_path, "r", encoding="utf-8") as f:
            return f.read()
    with zipfile.ZipFile(mxl_path) as z:
        names = [n for n in z.namelist() if n.lower().endswith((".xml", ".musicxml")) and "META-INF" not in n]
        if not names:
            raise ValueError(f"No MusicXML found inside {mxl_path}")
        return z.read(names[0]).decode("utf-8")


def _float_text(el, default=None):
    if el is None or not el.text:
        return default
    try:
        return float(el.text.strip())
    except ValueError:
        return default


def extract_measure_boxes(xml_text):
    """Compute normalized top-left [0..1] bounding boxes per measure across all systems/pages."""
    root = ET.fromstring(xml_text)
    defaults = root.find("defaults")
    page_w = 1860.0
    page_h = 2359.0
    left_margin = 80.0
    top_margin = 80.0
    if defaults is not None:
        pl = defaults.find("page-layout")
        if pl is not None:
            page_w = _float_text(pl.find("page-width"), page_w)
            page_h = _float_text(pl.find("page-height"), page_h)
            pm = pl.find("page-margins")
            if pm is not None:
                left_margin = _float_text(pm.find("left-margin"), left_margin)
                top_margin = _float_text(pm.find("top-margin"), top_margin)

    parts = root.findall("part")
    if not parts:
        return []
    part_measures = [p.findall("measure") for p in parts]
    max_measures = max(len(ms) for ms in part_measures)

    # Track per-part staves & remembered staff distances (tenths)
    part_staves = [1] * len(parts)
    staff_dists = {}  # (pi, staff_idx_1based) -> float
    sys_left_margin = 0.0
    page = 0
    y_top = top_margin
    prev_sys_bottom = top_margin
    x_cursor = left_margin
    boxes = []

    for mi in range(max_measures):
        m_p0 = part_measures[0][mi] if mi < len(part_measures[0]) else None
        if m_p0 is None:
            continue

        # Update per-part staff counts from any explicit <attributes><staves>
        for pi, ms in enumerate(part_measures):
            if mi < len(ms):
                st_el = ms[mi].find("attributes/staves")
                if st_el is not None and st_el.text and st_el.text.strip().isdigit():
                    part_staves[pi] = max(1, int(st_el.text.strip()))
                pr_el = ms[mi].find("print")
                if pr_el is not None:
                    for sl in pr_el.findall("staff-layout"):
                        s_num = int(sl.attrib.get("number", "1"))
                        sd = _float_text(sl.find("staff-distance"))
                        if sd is not None:
                            staff_dists[(pi, s_num)] = sd

        pr = m_p0.find("print")
        is_new_page = (mi == 0) or (pr is not None and pr.attrib.get("new-page") == "yes")
        is_new_sys = is_new_page or (pr is not None and pr.attrib.get("new-system") == "yes")

        if is_new_sys:
            if pr is not None:
                sl = pr.find("system-layout")
                if sl is not None:
                    sm = sl.find("system-margins")
                    if sm is not None:
                        sys_left_margin = _float_text(sm.find("left-margin"), sys_left_margin)
                    if is_new_page:
                        page += 1
                        top_dist = _float_text(sl.find("top-system-distance"), 200.0)
                        y_top = top_margin + top_dist
                    else:
                        sys_dist = _float_text(sl.find("system-distance"), 360.0)
                        y_top = prev_sys_bottom + sys_dist
                elif is_new_page:
                    page += 1
                    y_top = top_margin + 200.0
            elif is_new_page:
                page += 1
                y_top = top_margin + 200.0

            # Compute height of the full choir+piano system in this system
            sys_height = 0.0
            for pi in range(len(parts)):
                for s_num in range(1, part_staves[pi] + 1):
                    if pi == 0 and s_num == 1:
                        sys_height += 40.0
                    else:
                        dist = staff_dists.get((pi, s_num), 90.0 if s_num == 1 else 65.0)
                        sys_height += dist + 40.0
            prev_sys_bottom = y_top + sys_height
            x_cursor = left_margin + sys_left_margin

        meas_w = float(m_p0.attrib.get("width") or 240.0)
        meas_num = str(m_p0.attrib.get("number") or (mi + 1))

        pad_x = 36.0
        pad_top = 85.0
        pad_bot = 115.0
        bx = max(0.0, x_cursor - pad_x)
        bw = min(page_w - bx, meas_w + 2 * pad_x)
        by = max(0.0, y_top - pad_top)
        bh = min(page_h - by, (prev_sys_bottom - y_top) + pad_top + pad_bot)

        boxes.append({
            "measure": meas_num,
            "index": mi,
            "page": max(1, page),
            "x": round(bx / page_w, 5),
            "y": round(by / page_h, 5),
            "w": round(bw / page_w, 5),
            "h": round(bh / page_h, 5),
        })
        x_cursor += meas_w

    return boxes


def parse_score_via_jsc(xml_text):
    """Run Rehearsal's scan-model.js + scan-flags.js via JSC to extract per-measure summaries & flags."""
    jsc = find_jsc()
    escaped_xml = json.dumps(xml_text)
    js_code = f"""
var window = this;
load({json.dumps(os.path.join(REPO_ROOT, "web/scan-model.js"))});
load({json.dumps(os.path.join(REPO_ROOT, "web/scan-wordlist.js"))});
load({json.dumps(os.path.join(REPO_ROOT, "web/scan-consensus.js"))});
load({json.dumps(os.path.join(REPO_ROOT, "web/scan-flags.js"))});

const model = sfParseMusicXml({escaped_xml});
const flags = sfAnalyzeFlags(model);
const flagMap = {{}};
for (const fm of (flags.measures || [])) {{
  flagMap[fm.measureIndex] = {{
    flagged: !!fm.flagged,
    findings: (fm.findings || []).map(f => ({{ rule: f.rule, partIndex: f.partIndex, message: f.message }}))
  }};
}}

const maxM = Math.max(...model.parts.map(p => (p.measures || []).length));
const outMeasures = [];
for (let mi = 0; mi < maxM; mi++) {{
  const partsInfo = [];
  let keySig = 0;
  let timeSig = "4/4";
  for (let pi = 0; pi < model.parts.length; pi++) {{
    const p = model.parts[pi];
    const m = p.measures && p.measures[mi];
    if (!m) continue;
    if (pi === 0 && m.key) keySig = m.key.fifths || 0;
    if (pi === 0 && m.time) timeSig = (m.time.beats || 4) + "/" + (m.time.beatType || 4);
    const tokens = [];
    let chords = 0;
    for (const e of (m.entries || [])) {{
      if (e.kind !== 'note') continue;
      const durTag = e.type ? (e.type[0] + (e.dots ? '.' : '')) : (e.durationQ + 'q');
      if (e.isRest) {{
        tokens.push(`R(${{durTag}})`);
      }} else {{
        const alt = e.alter === 1 ? '#' : e.alter === -1 ? 'b' : e.alter === 2 ? '##' : e.alter === -2 ? 'bb' : '';
        const ch = e.isChord ? '+' : '';
        if (e.isChord) chords++;
        tokens.push(`${{ch}}${{e.step || '?'}}${{alt}}${{e.octave ?? ''}}(${{durTag}},v${{e.voice || '1'}}${{e.staff > 1 ? ',s' + e.staff : ''}})`);
      }}
    }}
    partsInfo.push({{
      id: p.id,
      name: p.name,
      staves: p.staves || 1,
      chords,
      tokens
    }});
  }}
  const fl = flagMap[mi] || {{ flagged: false, findings: [] }};
  outMeasures.push({{
    index: mi,
    keyFifths: keySig,
    timeSig,
    parts: partsInfo,
    flagged: fl.flagged,
    findings: fl.findings
  }});
}}

print(JSON.stringify({{
  title: model.workTitle || "",
  autoFixedDots: model.autoFixedDots || 0,
  dedupedChords: model.dedupedChords || 0,
  stabilizedKeyMeasures: model.stabilizedKeyMeasures || 0,
  flaggedCount: flags.flaggedCount || 0,
  measures: outMeasures
}}));
"""
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as tf:
        tf.write(js_code)
        tf_path = tf.name
    try:
        res = subprocess.run([jsc, tf_path], capture_output=True, text=True, check=True)
        return json.loads(res.stdout)
    finally:
        if os.path.exists(tf_path):
            os.unlink(tf_path)


def compile_and_crop(pdf_path, boxes, out_dir, dpi):
    os.makedirs(out_dir, exist_ok=True)
    need_build = not os.path.exists(CROP_BIN) or os.path.getmtime(CROP_SWIFT) > os.path.getmtime(CROP_BIN)
    if need_build:
        cmd = [
            "swiftc",
            "-O",
            "-module-cache-path",
            "/tmp/swift-modcache",
            CROP_SWIFT,
            "-o",
            CROP_BIN,
        ]
        subprocess.run(cmd, check=True)

    boxes_path = os.path.join(out_dir, "boxes.json")
    with open(boxes_path, "w", encoding="utf-8") as f:
        json.dump(boxes, f, indent=2)

    res = subprocess.run([CROP_BIN, pdf_path, boxes_path, out_dir, str(dpi)], capture_output=True, text=True, check=True)
    return json.loads(res.stdout.strip().splitlines()[-1])


def build_prompt(item):
    draft_lines = []
    for p in item["parts"]:
        note_str = " ".join(p["tokens"]) if p["tokens"] else "(empty/rest)"
        draft_lines.append(f"- {p['id']} ({p['name']}, staves={p['staves']}, chords={p['chords']}): {note_str}")
    flag_lines = [f"- [{f['rule']}] {f['message']}" for f in item["findings"]]
    key_desc = f"{abs(item['keyFifths'])} flats" if item["keyFifths"] < 0 else f"{item['keyFifths']} sharps" if item["keyFifths"] > 0 else "0 accidentals"
    return (
        f"You are verifying measure {item['measure']} (0-based measureIndex={item['index']}) of a vocal+piano score against the cropped PDF image.\n"
        f"Global score context: Time signature = {item['timeSig']}, Key signature = {key_desc} (fifths={item['keyFifths']}).\n"
        f"Audiveris OMR draft for measure {item['measure']}:\n"
        + "\n".join(draft_lines)
        + ("\nScanner flags:\n" + "\n".join(flag_lines) if flag_lines else "\nScanner flags: none")
        + "\n\nInspect the cropped PDF image carefully (staves top-to-bottom correspond to parts 0..N-1 in order) and return STRICT JSON matching:\n"
        '{"measure": <number>, "verdict": "ok" | "needs_fix", '
        '"vocal_phantom_chords": [<string describing any extra chord noteheads wrongly added to vocal staves>], '
        '"missing_dots": [<string describing any notes missing an augmentation dot>], '
        '"pitch_errors": [<string describing wrong pitch/accidental>], '
        '"rhythm_errors": [<string describing wrong duration/beats>], '
        '"patches": [{"op": "remove_phantom_chord" | "add_dot" | "remove_dot" | "octave_down_part", '
        '"partIndex": <0-based int>, "measureIndex": <0-based int>, "noteHint": "<e.g. G4>", "reason": "<short plain text>"}], '
        '"notes": "<brief 1-sentence summary>"}'
    )


def verify_measure_gemini(item, img_path, api_key, model):
    with open(img_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")
    payload = {
        "model": model,
        "store": False,
        "input": [
            {"type": "text", "text": item["prompt"]},
            {"type": "image", "data": b64, "mime_type": "image/png"},
        ],
        "generation_config": {"temperature": 0.1},
        "response_format": {
            "type": "object",
            "properties": {
                "measure": {"type": "integer"},
                "verdict": {"type": "string", "enum": ["ok", "needs_fix"]},
                "vocal_phantom_chords": {"type": "array", "items": {"type": "string"}},
                "missing_dots": {"type": "array", "items": {"type": "string"}},
                "pitch_errors": {"type": "array", "items": {"type": "string"}},
                "rhythm_errors": {"type": "array", "items": {"type": "string"}},
                "patches": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "op": {
                                "type": "string",
                                "enum": [
                                    "remove_phantom_chord",
                                    "add_dot",
                                    "remove_dot",
                                    "octave_down_part",
                                ],
                            },
                            "partIndex": {"type": "integer"},
                            "measureIndex": {"type": "integer"},
                            "noteHint": {"type": "string"},
                            "reason": {"type": "string"},
                        },
                        "required": ["op", "partIndex", "measureIndex", "reason"],
                    },
                },
                "notes": {"type": "string"},
            },
            "required": ["measure", "verdict", "patches", "notes"],
        },
    }
    url = "https://generativelanguage.googleapis.com/v1beta/interactions"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            body = json.loads(resp.read().decode("utf-8"))
        text = None
        for out in body.get("outputs") or []:
            if isinstance(out, dict) and out.get("type") == "text" and isinstance(out.get("text"), str):
                text = out["text"]
                break
        if text is None and body.get("candidates"):
            text = body["candidates"][0]["content"]["parts"][0]["text"]
        if not text:
            raise ValueError("No text output in Gemini response")
        parsed = json.loads(text)
        return {"measure": item["measure"], "status": "verified", "result": parsed}
    except urllib.error.HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="replace")
        detail = err_body.strip()
        try:
            err_json = json.loads(err_body)
            if isinstance(err_json, list) and err_json:
                err_json = err_json[0]
            if isinstance(err_json, dict) and isinstance(err_json.get("error"), dict):
                detail = err_json["error"].get("message") or detail
        except Exception:
            pass
        return {"measure": item["measure"], "status": "error", "error": f"HTTP {exc.code}: {detail}"}
    except Exception as exc:
        return {"measure": item["measure"], "status": "error", "error": str(exc)}


def parse_measure_filter(spec, total):
    if not spec:
        return None
    wanted = set()
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            for v in range(int(a), int(b) + 1):
                wanted.add(v)
        else:
            wanted.add(int(part))
    return wanted


def main():
    ap = argparse.ArgumentParser(description="Measure-by-measure PDF crop + visual OMR verification")
    ap.add_argument("--job", help="OMR job id under tools/omr-service/data/jobs/")
    ap.add_argument("--pdf", help="Path to original PDF")
    ap.add_argument("--mxl", help="Path to raw.mxl or MusicXML")
    ap.add_argument("--out", help="Output directory (default: /tmp/rehearsal-measure-verify/<id>)")
    ap.add_argument("--measures", help="Optional measure range/list like '1-10' or '5,8,16'")
    ap.add_argument("--flagged-only", action="store_true", help="Only verify flagged/vocal-chord measures instead of all")
    ap.add_argument("--dump-only", action="store_true", help="Only crop PDF measures and write manifest.json (no API call)")
    ap.add_argument("--model", default="gemini-3.5-flash-lite", help="Gemini vision model")
    ap.add_argument("--workers", type=int, default=4, help="Parallel vision requests")
    ap.add_argument("--dpi", type=int, default=220, help="PDF rasterization DPI")
    args = ap.parse_args()

    if args.job:
        job_dir = os.path.join(REPO_ROOT, "tools/omr-service/data/jobs", args.job)
        pdf_path = args.pdf or os.path.join(job_dir, "original.pdf")
        mxl_path = args.mxl or os.path.join(job_dir, "raw.mxl")
        stem = args.job
    else:
        if not args.pdf or not args.mxl:
            ap.error("Provide either --job or both --pdf and --mxl")
        pdf_path = os.path.abspath(args.pdf)
        mxl_path = os.path.abspath(args.mxl)
        stem = os.path.splitext(os.path.basename(pdf_path))[0]

    out_dir = args.out or os.path.join("/tmp/rehearsal-measure-verify", stem)
    xml_text = read_mxl_xml(mxl_path)
    boxes = extract_measure_boxes(xml_text)
    parsed = parse_score_via_jsc(xml_text)

    wanted = parse_measure_filter(args.measures, len(boxes))
    items = []
    crop_boxes = []
    for idx, box in enumerate(boxes):
        m_num = idx + 1
        if wanted is not None and m_num not in wanted:
            continue
        m_info = parsed["measures"][idx] if idx < len(parsed["measures"]) else {"parts": [], "flagged": False, "findings": [], "keyFifths": 0, "timeSig": "4/4"}
        vocal_chords = sum(p["chords"] for p in m_info["parts"][:-1]) if len(m_info["parts"]) > 1 else 0
        if args.flagged_only and not m_info["flagged"] and vocal_chords == 0:
            continue
        crop_boxes.append(box)
        item = {
            "index": idx,
            "measure": box["measure"],
            "page": box["page"],
            "image": os.path.join(out_dir, f"m{idx + 1:03d}.png"),
            "keyFifths": m_info["keyFifths"],
            "timeSig": m_info["timeSig"],
            "flagged": m_info["flagged"],
            "vocalChords": vocal_chords,
            "findings": m_info["findings"],
            "parts": m_info["parts"],
        }
        item["prompt"] = build_prompt(item)
        items.append(item)

    crop_stats = compile_and_crop(pdf_path, crop_boxes, out_dir, args.dpi)
    manifest_path = os.path.join(out_dir, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump({
            "title": parsed["title"],
            "pdf": pdf_path,
            "mxl": mxl_path,
            "totalMeasures": len(boxes),
            "selectedMeasures": len(items),
            "cropStats": crop_stats,
            "scoreRepairs": {
                "autoFixedDots": parsed["autoFixedDots"],
                "dedupedChords": parsed["dedupedChords"],
                "stabilizedKeyMeasures": parsed["stabilizedKeyMeasures"],
                "flaggedCount": parsed["flaggedCount"],
            },
            "items": items,
        }, f, indent=2)

    print(json.dumps({
        "outDir": out_dir,
        "cropped": crop_stats["cropped"],
        "selectedMeasures": len(items),
        "flaggedMeasures": sum(1 for it in items if it["flagged"]),
        "vocalChordMeasures": sum(1 for it in items if it["vocalChords"] > 0),
        "manifest": manifest_path,
    }))

    if args.dump_only:
        return

    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        print("No GEMINI_API_KEY / GOOGLE_API_KEY set; crops and manifest saved cleanly.", file=sys.stderr)
        return

    results = []
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        futs = [pool.submit(verify_measure_gemini, it, it["image"], api_key, args.model) for it in items]
        for fut in as_completed(futs):
            results.append(fut.result())

    results.sort(key=lambda r: int(r["measure"]) if str(r["measure"]).isdigit() else 0)
    needs_fix = [r for r in results if r.get("status") == "verified" and r["result"].get("verdict") == "needs_fix"]
    ok_list = [r for r in results if r.get("status") == "verified" and r["result"].get("verdict") == "ok"]

    report_json = os.path.join(out_dir, "report.json")
    with open(report_json, "w", encoding="utf-8") as f:
        json.dump({
            "model": args.model,
            "checked": len(results),
            "ok": len(ok_list),
            "needsFix": len(needs_fix),
            "results": results,
        }, f, indent=2)

    report_md = os.path.join(out_dir, "report.md")
    with open(report_md, "w", encoding="utf-8") as f:
        f.write(f"# Measure-by-Measure Visual Verification ({parsed['title'] or stem})\n\n")
        f.write(f"- Checked: **{len(results)}** measures\n")
        f.write(f"- Matches PDF (`ok`): **{len(ok_list)}**\n")
        f.write(f"- Needs fix (`needs_fix`): **{len(needs_fix)}**\n\n")
        for r in needs_fix:
            res = r["result"]
            f.write(f"## Measure {r['measure']}\n")
            f.write(f"- Summary: {res.get('notes', '')}\n")
            if res.get("vocal_phantom_chords"):
                f.write(f"- Phantom vocal chords: {', '.join(res['vocal_phantom_chords'])}\n")
            if res.get("missing_dots"):
                f.write(f"- Missing dots: {', '.join(res['missing_dots'])}\n")
            if res.get("pitch_errors"):
                f.write(f"- Pitch errors: {', '.join(res['pitch_errors'])}\n")
            if res.get("rhythm_errors"):
                f.write(f"- Rhythm errors: {', '.join(res['rhythm_errors'])}\n")
            f.write("\n")

    print(f"Wrote {report_json} and {report_md} ({len(ok_list)} ok, {len(needs_fix)} needs_fix)")


if __name__ == "__main__":
    main()
