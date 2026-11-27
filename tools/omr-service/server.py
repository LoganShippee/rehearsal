#!/usr/bin/env python3
"""
Standalone OMR wrapper service for Rehearsal's "Scan and Fix" feature.

AGPL v3 Isolation Boundary:
  Audiveris 5.x is invoked strictly as an external CLI subprocess:
      audiveris -batch -export -output <out_dir> -- <input_file>
  This service never bundles, imports, or links any GPL/AGPL code.

Zero external dependencies: Python 3.9+ standard library only.
"""

from __future__ import annotations

import base64
import collections
import concurrent.futures
import datetime
import hashlib
import importlib.util
import io
import json
import os
import queue
import re
import shlex
import shutil
import signal
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import xml.etree.ElementTree as ET
import zipfile
import zlib
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional, Sequence, Tuple

SERVICE_NAME = "rehearsal-omr"
SERVICE_VERSION = "1.0.0"

VALID_SCAN_MODES = ("full", "notes-lyrics", "notes-only")
VALID_MULTI_RUN_MODES = ("off", "all", "flagged")


def normalize_scan_mode(val: Optional[str]) -> str:
    cleaned = (val or "").strip().lower()
    if cleaned in VALID_SCAN_MODES:
        return cleaned
    return "full"


def normalize_multi_run_mode(val: Optional[str]) -> str:
    cleaned = (val or "").strip().lower()
    if cleaned in VALID_MULTI_RUN_MODES:
        return cleaned
    return "off"


def scan_cache_key(upload_hash: str, scan_mode: str) -> str:
    mode = normalize_scan_mode(scan_mode)
    return upload_hash if mode == "full" else f"{upload_hash}:{mode}"

ALLOWED_EXTENSIONS = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
}

ALLOWED_MIMES = {
    "application/pdf": ".pdf",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/tiff": ".tiff",
    "image/x-tiff": ".tiff",
}

DEFAULT_AUDIVERIS_CANDIDATES = (
    "/Applications/Audiveris.app/Contents/MacOS/Audiveris",
    "/opt/homebrew/bin/audiveris",
    "/usr/local/bin/audiveris",
    "/usr/bin/audiveris",
)

NO_USABLE_OUTPUT_MSG = (
    "We couldn't read clear sheet music from this scan. "
    "Please retry with a flatter, evenly lit page or a cleaner PDF."
)
ENGINE_TIMEOUT_MSG = (
    "Scanning took too long and timed out. "
    "Please try a single, clear page or a smaller PDF."
)
ENGINE_ERROR_MSG = (
    "The scanner couldn't process this file. "
    "Please retry with a flatter, evenly lit page or a cleaner PDF."
)
ENGINE_UNAVAILABLE_MSG = (
    "Audiveris 5.x is not installed or could not be found. "
    "Install Audiveris or set AUDIVERIS_BIN and restart the OMR service."
)


def utc_now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


DEFAULT_TESSDATA_CANDIDATES = (
    os.path.expanduser("~/Library/Application Support/AudiverisLtd/audiveris/tessdata"),
    "/opt/homebrew/share/tessdata",
    "/usr/local/share/tessdata",
    "/usr/share/tessdata",
    "/usr/share/tesseract-ocr/5/tessdata",
    "/usr/share/tesseract-ocr/4.00/tessdata",
)


def find_tessdata_dir(explicit: Optional[str] = None) -> Optional[str]:
    """
    Locate a readable Tesseract tessdata directory for Audiveris OCR (lyrics, titles, dynamics).
    Checks TESSDATA_PREFIX first, then standard macOS/Linux Audiveris & Homebrew/system paths.
    """
    env_dir = explicit if explicit is not None else os.environ.get("TESSDATA_PREFIX")
    if env_dir:
        cleaned = os.path.expanduser(env_dir.strip())
        if cleaned and os.path.isdir(cleaned) and os.access(cleaned, os.R_OK):
            return cleaned

    for candidate in DEFAULT_TESSDATA_CANDIDATES:
        if not os.path.isdir(candidate) or not os.access(candidate, os.R_OK):
            continue
        try:
            if any(name.endswith(".traineddata") for name in os.listdir(candidate)):
                return candidate
        except OSError:
            continue
    return None


def detect_audiveris_bin(explicit: Optional[str] = None) -> Optional[str]:
    if explicit is not None:
        cleaned = explicit.strip()
        return cleaned or None
    which = shutil.which("audiveris")
    if which:
        return which
    for candidate in DEFAULT_AUDIVERIS_CANDIDATES:
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    return None


def _is_executable_cmd(cmd: Sequence[str]) -> bool:
    if not cmd:
        return False
    exe = cmd[0]
    if not exe:
        return False
    if os.path.sep in exe or (os.path.altsep and os.path.altsep in exe):
        return os.path.isfile(exe) and os.access(exe, os.X_OK)
    return shutil.which(exe) is not None


@dataclass
class OMRConfig:
    host: str = "127.0.0.1"
    port: int = 8788
    data_dir: str = field(
        default_factory=lambda: os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "data"
        )
    )
    audiveris_bin: Optional[str] = field(default_factory=detect_audiveris_bin)
    engine_cmd: Optional[List[str]] = None
    tessdata_dir: Optional[str] = field(default_factory=find_tessdata_dir)
    job_timeout: float = 55.0
    per_page_timeout: float = 45.0
    max_job_timeout: float = 600.0
    workers: int = 2
    max_upload_bytes: int = 20 * 1024 * 1024
    auth_mode: str = "optional"  # "optional" | "required"
    auth_api: str = "https://api.rehearsalmusic.com"
    cors_origins: str = "*"
    auth_timeout: float = 8.0
    preprocess_mode: str = "auto"  # "auto" | "off"
    preprocess: bool = True
    multi_run_mode: str = "off"  # "off" | "all" | "flagged"
    retention_hours: float = 24.0
    engine_name: str = "audiveris"  # "audiveris" | "homr" | "oemer" | "api" | "flat" | "newzik" | "custom"
    omr_api_url: str = ""
    omr_api_key: str = ""
    omr_api_provider: str = "generic"  # "generic" | "flat" | "newzik"

    def resolved_engine_cmd(self) -> Optional[List[str]]:
        if self.engine_cmd is not None:
            return list(self.engine_cmd) if self.engine_cmd else None
        if self.engine_name == "homr":
            h = shutil.which("homr")
            return [h] if h else None
        if self.engine_name == "oemer":
            o = shutil.which("oemer")
            return [o] if o else None
        if self.audiveris_bin:
            return [self.audiveris_bin]
        return None

    def engine_available(self) -> bool:
        return build_engine_adapter(self).is_available()


class EngineAdapter:
    """Pluggable OMR CLI engine adapter (keeps AGPL/external tools isolated behind subprocesses)."""

    name: str = "custom"

    def __init__(self, cmd_prefix: Optional[List[str]]) -> None:
        self.cmd_prefix = list(cmd_prefix) if cmd_prefix else []

    def is_available(self) -> bool:
        return _is_executable_cmd(self.cmd_prefix)

    def build_command(self, input_path: str, out_dir: str, enable_ocr: bool = True) -> List[str]:
        return list(self.cmd_prefix) + [
            "-batch",
            "-transcribe",
            "-export",
            "-swap",
            "-output",
            out_dir,
            "--",
            input_path,
        ]

    def build_export_sheets_command(
        self, omr_path: str, valid_pages: List[int], out_dir: str
    ) -> Optional[List[str]]:
        return None

    def find_output(
        self, out_dir: str, input_stem: Optional[str] = None
    ) -> Optional[str]:
        return find_audiveris_output(out_dir, input_stem=input_stem)


class AudiverisAdapter(EngineAdapter):
    """Audiveris 5.x CLI adapter (strictly isolated external subprocess)."""

    name: str = "audiveris"

    def build_export_sheets_command(
        self, omr_path: str, valid_pages: List[int], out_dir: str
    ) -> Optional[List[str]]:
        return list(self.cmd_prefix) + [
            "-batch",
            "-export",
            "-sheets",
            *[str(p) for p in valid_pages],
            "-output",
            out_dir,
            "--",
            omr_path,
        ]


class CustomCmdAdapter(EngineAdapter):
    """Adapter for OMR_ENGINE_CMD overrides or custom CLI engines."""

    name: str = "custom"

    def build_export_sheets_command(
        self, omr_path: str, valid_pages: List[int], out_dir: str
    ) -> Optional[List[str]]:
        return list(self.cmd_prefix) + [
            "-batch",
            "-export",
            "-sheets",
            *[str(p) for p in valid_pages],
            "-output",
            out_dir,
            "--",
            omr_path,
        ]


class HomrAdapter(EngineAdapter):
    """Adapter for the `homr` neural OMR CLI."""

    name: str = "homr"

    def build_command(self, input_path: str, out_dir: str, enable_ocr: bool = True) -> List[str]:
        return list(self.cmd_prefix) + [input_path]

    def find_output(
        self, out_dir: str, input_stem: Optional[str] = None
    ) -> Optional[str]:
        found = find_audiveris_output(out_dir, input_stem=input_stem)
        if found:
            return found
        if input_stem:
            parent_dir = os.path.dirname(out_dir)
            for ext in (".musicxml", ".xml", ".mxl"):
                cand = os.path.join(parent_dir, f"{input_stem}{ext}")
                if os.path.isfile(cand):
                    return cand
        return None


class OemerAdapter(EngineAdapter):
    """Adapter for the `oemer` CNN/segmentation OMR CLI."""

    name: str = "oemer"

    def build_command(self, input_path: str, out_dir: str, enable_ocr: bool = True) -> List[str]:
        return list(self.cmd_prefix) + [input_path, "-o", out_dir]


class HttpApiEngineAdapter(EngineAdapter):
    """Adapter for commercial/hosted OMR REST APIs (Flat.io, Newzik, or generic)."""

    name: str = "api"

    def __init__(self, api_url: str, api_key: str, provider: str = "generic") -> None:
        super().__init__([])
        self.api_url = (api_url or "").strip().rstrip("/")
        self.api_key = (api_key or "").strip()
        self.provider = (provider or "generic").strip().lower() or "generic"
        if self.provider in ("flat", "newzik"):
            self.name = self.provider

    def is_available(self) -> bool:
        return bool(self.api_url and self.api_key)

    def run_direct(
        self, input_path: str, out_dir: str, timeout_sec: float = 120.0
    ) -> Tuple[Optional[str], Optional[str]]:
        if not self.is_available():
            return None, "OMR API URL or API key not configured"
        os.makedirs(out_dir, exist_ok=True)
        with open(input_path, "rb") as f:
            file_bytes = f.read()
        fname = os.path.basename(input_path)
        ctype = ALLOWED_EXTENSIONS.get(os.path.splitext(fname)[1].lower(), "application/octet-stream")
        boundary = f"----RehearsalOMR{uuid.uuid4().hex}"
        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{fname}"\r\n'
            f"Content-Type: {ctype}\r\n\r\n"
        ).encode("utf-8") + file_bytes + f"\r\n--{boundary}--\r\n".encode("utf-8")
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Accept": "application/json, application/vnd.recordare.musicxml+xml, application/xml",
        }
        req = urllib.request.Request(self.api_url, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=min(60.0, timeout_sec)) as resp:
                resp_ctype = (resp.headers.get("Content-Type") or "").lower()
                raw = resp.read()
        except Exception as exc:
            return None, str(exc)

        if "json" in resp_ctype or raw.lstrip().startswith(b"{"):
            try:
                data = json.loads(raw.decode("utf-8"))
            except Exception as exc:
                return None, f"Invalid API JSON: {exc}"
            xml_text = data.get("musicxml") or data.get("xml")
            poll_url = data.get("statusUrl") or data.get("pollUrl") or data.get("resultUrl")
            deadline = time.monotonic() + max(5.0, timeout_sec - 10.0)
            while not xml_text and poll_url and time.monotonic() < deadline:
                time.sleep(1.5)
                preq = urllib.request.Request(
                    poll_url,
                    headers={"Authorization": f"Bearer {self.api_key}", "Accept": "application/json"},
                    method="GET",
                )
                with urllib.request.urlopen(preq, timeout=15.0) as presp:
                    pdata = json.loads(presp.read().decode("utf-8"))
                xml_text = pdata.get("musicxml") or pdata.get("xml")
                if pdata.get("status") in ("failed", "error"):
                    return None, pdata.get("error") or "Remote OMR job failed"
            if not xml_text:
                return None, "Remote OMR API returned no MusicXML"
            out_path = os.path.join(out_dir, "api-output.musicxml")
            with open(out_path, "w", encoding="utf-8") as out_f:
                out_f.write(xml_text)
            return out_path, None

        ext = ".mxl" if raw[:2] == b"PK" else ".musicxml"
        out_path = os.path.join(out_dir, f"api-output{ext}")
        with open(out_path, "wb") as out_f:
            out_f.write(raw)
        return out_path, None


def build_engine_adapter(config: OMRConfig) -> EngineAdapter:
    if config.engine_cmd is not None:
        return CustomCmdAdapter(config.engine_cmd)
    ename = (config.engine_name or "audiveris").strip().lower()
    if ename == "homr":
        exe = shutil.which("homr")
        return HomrAdapter([exe] if exe else [])
    if ename == "oemer":
        exe = shutil.which("oemer")
        return OemerAdapter([exe] if exe else [])
    if ename in ("api", "flat", "newzik"):
        prov = ename if ename in ("flat", "newzik") else config.omr_api_provider
        return HttpApiEngineAdapter(config.omr_api_url, config.omr_api_key, provider=prov)
    if config.audiveris_bin:
        return AudiverisAdapter([config.audiveris_bin])
    return AudiverisAdapter([])


def load_config_from_env() -> OMRConfig:
    default_data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
    audiveris_env = os.environ.get("AUDIVERIS_BIN")
    engine_cmd_env = os.environ.get("OMR_ENGINE_CMD", "").strip()
    engine_cmd = shlex.split(engine_cmd_env) if engine_cmd_env else None
    auth_mode = os.environ.get("OMR_AUTH_MODE", "optional").strip().lower()
    if auth_mode not in ("optional", "required"):
        auth_mode = "optional"
    prep_mode = os.environ.get("OMR_PREPROCESS", "auto").strip().lower()
    if prep_mode not in ("auto", "off"):
        prep_mode = "auto"
    return OMRConfig(
        host=os.environ.get("OMR_HOST", "127.0.0.1").strip() or "127.0.0.1",
        port=int(os.environ.get("OMR_PORT", "8788")),
        data_dir=os.environ.get("OMR_DATA_DIR", default_data_dir).strip() or default_data_dir,
        audiveris_bin=detect_audiveris_bin(audiveris_env) if audiveris_env is not None else detect_audiveris_bin(),
        engine_cmd=engine_cmd,
        tessdata_dir=find_tessdata_dir(),
        job_timeout=float(os.environ.get("OMR_JOB_TIMEOUT", "55")),
        per_page_timeout=float(os.environ.get("OMR_PER_PAGE_TIMEOUT", "45")),
        max_job_timeout=float(os.environ.get("OMR_MAX_JOB_TIMEOUT", "600")),
        workers=max(1, int(os.environ.get("OMR_WORKERS", "2"))),
        max_upload_bytes=max(1024, int(os.environ.get("OMR_MAX_UPLOAD_BYTES", str(20 * 1024 * 1024)))),
        auth_mode=auth_mode,
        auth_api=os.environ.get("REHEARSAL_AUTH_API", "https://api.rehearsalmusic.com").rstrip("/"),
        cors_origins=os.environ.get("OMR_CORS_ORIGINS", "*").strip() or "*",
        preprocess_mode=prep_mode,
        preprocess=(prep_mode != "off"),
        multi_run_mode=normalize_multi_run_mode(os.environ.get("OMR_MULTI_RUN")),
        retention_hours=float(os.environ.get("OMR_RETENTION_HOURS", "24")),
        engine_name=os.environ.get("OMR_ENGINE", "audiveris").strip().lower() or "audiveris",
        omr_api_url=os.environ.get("OMR_API_URL", "").strip(),
        omr_api_key=os.environ.get("OMR_API_KEY", "").strip(),
        omr_api_provider=os.environ.get("OMR_API_PROVIDER", "generic").strip().lower() or "generic",
    )


def _strip_ns(tag: str) -> str:
    if "}" in tag:
        return tag.split("}", 1)[1]
    return tag


def validate_musicxml(xml_text: str) -> Tuple[bool, str]:
    """Validate MusicXML string: well-formed XML with >=1 part, >=1 measure, >=1 note."""
    if not xml_text or not xml_text.strip():
        return False, "empty xml"
    try:
        root = ET.fromstring(xml_text.strip())
    except ET.ParseError as exc:
        return False, f"xml parse error: {exc}"

    root_tag = _strip_ns(root.tag)
    if root_tag not in ("score-partwise", "score-timewise"):
        return False, f"unexpected root tag: {root_tag}"

    part_count = 0
    measure_count = 0
    note_count = 0
    for elem in root.iter():
        t = _strip_ns(elem.tag)
        if t == "part":
            part_count += 1
        elif t == "measure":
            measure_count += 1
        elif t == "note":
            note_count += 1

    if part_count < 1 or measure_count < 1 or note_count < 1:
        return (
            False,
            f"insufficient music content (parts={part_count}, measures={measure_count}, notes={note_count})",
        )
    return True, "ok"


def decode_xml_bytes(raw_bytes: bytes) -> str:
    if not raw_bytes:
        return ""
    if raw_bytes.startswith(b"\xef\xbb\xbf"):
        return raw_bytes.decode("utf-8-sig")
    if raw_bytes.startswith((b"\xff\xfe", b"\xfe\xff")):
        return raw_bytes.decode("utf-16")
    return raw_bytes.decode("utf-8")


def extract_musicxml_from_mxl_bytes(mxl_bytes: bytes) -> str:
    """Decompress a .mxl archive and return the primary MusicXML string."""
    with zipfile.ZipFile(io.BytesIO(mxl_bytes), "r") as zf:
        names = zf.namelist()
        rootfile: Optional[str] = None
        if "META-INF/container.xml" in names:
            container_text = decode_xml_bytes(zf.read("META-INF/container.xml"))
            container_root = ET.fromstring(container_text)
            for elem in container_root.iter():
                if _strip_ns(elem.tag) == "rootfile":
                    fp = elem.attrib.get("full-path", "").strip()
                    if fp:
                        rootfile = fp
                        break
        if not rootfile or rootfile not in names:
            candidates = [
                n
                for n in names
                if not n.endswith("/")
                and not n.upper().startswith("META-INF/")
                and n.lower().endswith((".musicxml", ".xml"))
            ]
            if not candidates:
                raise ValueError("no MusicXML entry in .mxl archive")
            rootfile = sorted(candidates)[0]
        return decode_xml_bytes(zf.read(rootfile))


def package_musicxml_to_mxl(xml_text: str) -> bytes:
    """Package a MusicXML string into a valid .mxl ZIP archive (Stored method 0)."""
    container_xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        "<container>\n"
        "  <rootfiles>\n"
        '    <rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/>\n'
        "  </rootfiles>\n"
        "</container>\n"
    ).encode("utf-8")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_STORED) as zf:
        zf.writestr("META-INF/container.xml", container_xml)
        zf.writestr("score.musicxml", xml_text.encode("utf-8"))
    return buf.getvalue()


AUDIVERIS_STEPS: Tuple[str, ...] = (
    "LOAD",
    "BINARY",
    "SCALE",
    "GRID",
    "HEADERS",
    "STEM_SEEDS",
    "BEAMS",
    "LEDGERS",
    "HEADS",
    "STEMS",
    "REDUCTION",
    "CUE_BEAMS",
    "TEXTS",
    "MEASURES",
    "CHORDS",
    "CURVES",
    "SYMBOLS",
    "LINKS",
    "RHYTHMS",
    "PAGE",
    "SCORE",
    "EXPORT",
)
_AUDIVERIS_STEP_INDEX: Dict[str, int] = {name: i for i, name in enumerate(AUDIVERIS_STEPS)}
_SHEETS_IN_RE = re.compile(r"\b(\d+)\s+sheets\s+in\b", re.IGNORECASE)
_STEP_MON_RE = re.compile(r"\[[^\]]*#(\d+)\][^\n]*?StepMonitoring\s+\d+\s*\|\s*([A-Z_]+)")
_INVALID_SHEET_RE = re.compile(
    r"Sheet\s+[^\s#]+#(\d+)\s+flagged\s+as\s+invalid", re.IGNORECASE
)
_STORED_SHEET_RE = re.compile(r"Stored\s+/sheet#(\d+)/sheet#\1\.xml", re.IGNORECASE)
_OMR_SHEET_ENTRY_RE = re.compile(r"^sheet#(\d+)/sheet#\1\.xml$")
_PDF_PAGE_RE = re.compile(rb"/Type\s*/Page\b")


def inspect_omr_pages(omr_path: str) -> Tuple[List[int], List[int]]:
    """
    Inspect an Audiveris .omr zip archive and return (valid_pages, invalid_pages).
    Checks sheet#<N>/sheet#<N>.xml entries and book.xml sheet metadata.
    """
    try:
        with zipfile.ZipFile(omr_path, "r") as zf:
            names = zf.namelist()
            book_invalid: set[int] = set()
            book_all: set[int] = set()
            if "book.xml" in names:
                try:
                    broot = ET.fromstring(decode_xml_bytes(zf.read("book.xml")))
                    for el in broot.iter():
                        if _strip_ns(el.tag) == "sheet":
                            raw_id = el.attrib.get("id") or el.attrib.get("number") or ""
                            m_num = re.search(r"(\d+)", raw_id)
                            if not m_num:
                                continue
                            snum = int(m_num.group(1))
                            book_all.add(snum)
                            if el.attrib.get("invalid", "").lower() == "true":
                                book_invalid.add(snum)
                except Exception:
                    pass

            valid_pages: List[int] = []
            invalid_pages: List[int] = sorted(book_invalid)
            seen_sheets: set[int] = set()
            for name in names:
                m = _OMR_SHEET_ENTRY_RE.match(name)
                if not m:
                    continue
                snum = int(m.group(1))
                seen_sheets.add(snum)
                if snum in book_invalid:
                    continue
                try:
                    sroot = ET.fromstring(decode_xml_bytes(zf.read(name)))
                    if sroot.attrib.get("invalid", "").lower() == "true":
                        if snum not in invalid_pages:
                            invalid_pages.append(snum)
                        continue
                    has_measure = any(_strip_ns(el.tag) == "measure" for el in sroot.iter())
                    step_attr = (
                        sroot.attrib.get("last-step") or sroot.attrib.get("step") or ""
                    ).upper()
                    if has_measure or step_attr in ("PAGE", "SCORE", "EXPORT"):
                        valid_pages.append(snum)
                    else:
                        if snum not in invalid_pages:
                            invalid_pages.append(snum)
                except Exception:
                    if snum not in invalid_pages:
                        invalid_pages.append(snum)

            for snum in sorted(book_all - seen_sheets):
                if snum not in invalid_pages:
                    invalid_pages.append(snum)

            return sorted(valid_pages), sorted(invalid_pages)
    except (zipfile.BadZipFile, OSError):
        return [], []


def find_omr_project_file(out_dir: str, input_stem: Optional[str] = None) -> Optional[str]:
    """Locate a saved Audiveris .omr project file inside out_dir."""
    omr_files: List[str] = []
    for root, _dirs, files in os.walk(out_dir):
        for name in sorted(files):
            if name.lower().endswith(".omr"):
                omr_files.append(os.path.join(root, name))
    if not omr_files:
        return None
    if input_stem:
        target = f"{input_stem.lower()}.omr"
        for path in omr_files:
            if os.path.basename(path).lower() == target:
                return path
    return sorted(omr_files)[0]


def detect_pdf_page_count(pdf_path: str) -> Optional[int]:
    """Lightweight stdlib PDF page counter (/Type /Page excluding /Pages)."""
    try:
        with open(pdf_path, "rb") as f:
            data = f.read(16 * 1024 * 1024)
        matches = _PDF_PAGE_RE.findall(data)
        if matches:
            return max(1, len(matches))
    except OSError:
        pass
    return None


SPOKEN_CUE_WORDS = (
    "spoken",
    "speak",
    "shout",
    "shouted",
    "whisper",
    "whispered",
    "clap",
    "claps",
    "snap",
    "snaps",
    "stomp",
    "chant",
    "rhythmically",
    "sprechstimme",
)
_SPOKEN_CUE_RE = re.compile(
    r"\b(" + "|".join(SPOKEN_CUE_WORDS) + r")\b", re.IGNORECASE
)
_PDF_MAX_STREAM_BYTES = 2 * 1024 * 1024
_PDF_NON_TEXT_DICT_RE = re.compile(
    rb"/(?:Image|DCTDecode|JPXDecode|JBIG2Decode|CCITTFaxDecode|Length1|Type1C|CIDFontType0C|OpenType)\b"
)
_PDF_TJ_ARRAY_RE = re.compile(rb"\[([^\]\r\n]{1,4096})\]\s*TJ")


def _decode_pdf_literal(raw: bytes) -> str:
    out = bytearray()
    i = 0
    n = len(raw)
    while i < n:
        ch = raw[i]
        if ch == 92 and i + 1 < n:  # backslash
            nxt = raw[i + 1]
            if nxt in (40, 41, 92):  # (, ), \
                out.append(nxt)
                i += 2
                continue
            if nxt == 110:  # n
                out.append(10)
                i += 2
                continue
            if nxt == 114:  # r
                out.append(13)
                i += 2
                continue
            if nxt == 116:  # t
                out.append(9)
                i += 2
                continue
            if 48 <= nxt <= 55:  # octal \ddd
                oct_digits = bytes([nxt])
                j = i + 2
                while j < min(n, i + 4) and 48 <= raw[j] <= 55:
                    oct_digits += bytes([raw[j]])
                    j += 1
                out.append(int(oct_digits, 8) & 0xFF)
                i = j
                continue
            out.append(nxt)
            i += 2
            continue
        out.append(ch)
        i += 1
    return out.decode("latin-1", errors="ignore")


def _decode_pdf_hex(hex_bytes: bytes) -> str:
    cleaned = re.sub(rb"[^0-9A-Fa-f]", b"", hex_bytes)
    if len(cleaned) % 2 == 1:
        cleaned += b"0"
    try:
        raw = bytes.fromhex(cleaned.decode("ascii"))
    except ValueError:
        return ""
    if raw.startswith(b"\xfe\xff") or (len(raw) >= 4 and len(raw) % 2 == 0 and raw[0] == 0):
        try:
            return raw.decode("utf-16-be", errors="ignore")
        except UnicodeDecodeError:
            pass
    return raw.decode("latin-1", errors="ignore")


def _extract_pdf_strings_from_stream(
    stream_bytes: bytes, deadline: Optional[float] = None
) -> List[str]:
    if not stream_bytes:
        return []
    if b"Tj" not in stream_bytes and b"TJ" not in stream_bytes and b"BT" not in stream_bytes:
        return []
    texts: List[str] = []

    def _scan_literals_and_hex(buf: bytes, sep: str = "") -> str:
        parts: List[str] = []
        i = 0
        n = len(buf)
        while i < n:
            if deadline is not None and (i & 4095) == 0 and time.monotonic() > deadline:
                break
            b = buf[i]
            if b == 40:  # '('
                depth = 1
                j = i + 1
                while j < n and depth > 0:
                    if buf[j] == 92:
                        j += 2
                        continue
                    if buf[j] == 40:
                        depth += 1
                    elif buf[j] == 41:
                        depth -= 1
                        if depth == 0:
                            break
                    j += 1
                if j - (i + 1) <= 8192:
                    parts.append(_decode_pdf_literal(buf[i + 1 : j]))
                i = j + 1
            elif b == 60 and i + 1 < n and buf[i + 1] != 60:  # '<' not '<<'
                end = buf.find(b">", i + 1, min(n, i + 4096))
                if end != -1:
                    parts.append(_decode_pdf_hex(buf[i + 1 : end]))
                    i = end + 1
                else:
                    i += 1
            else:
                i += 1
        return sep.join(parts)

    # Reconstruct kerned TJ arrays first so [(Spok) -15 (en)] TJ -> "Spoken"
    for m in _PDF_TJ_ARRAY_RE.finditer(stream_bytes):
        if deadline is not None and time.monotonic() > deadline:
            break
        joined = _scan_literals_and_hex(m.group(1), sep="")
        if joined.strip():
            texts.append(joined)

    # Also scan standalone Tj / ' / " text strings (space-separated across operators)
    if deadline is None or time.monotonic() <= deadline:
        outside = _PDF_TJ_ARRAY_RE.sub(b" ", stream_bytes)
        whole = _scan_literals_and_hex(outside, sep=" ")
        if whole.strip():
            texts.append(whole)
    return texts


def _safe_zlib_decompress(
    raw_stream: bytes, max_bytes: int = _PDF_MAX_STREAM_BYTES
) -> Optional[bytes]:
    for wbits in (zlib.MAX_WBITS, -zlib.MAX_WBITS):
        try:
            d = zlib.decompressobj(wbits)
            out = d.decompress(raw_stream, max_bytes + 1)
            if len(out) > max_bytes:
                return None
            return out
        except zlib.error:
            continue
    return None


_DYNAMICS_RE = re.compile(
    r"(?<![A-Za-z])(ppp|pp|mp|mf|fff|ff|sfz|fp|cresc\.?|decresc\.?|dim\.?|[pf])(?![A-Za-z])"
)
_TEMPO_RE = re.compile(
    r"\b(Allegro|Andante|Adagio|Moderato|Largo|Presto|Vivace|Lento|rit\.|ritard\.?|rall\.|accel\.|a tempo)\b",
    re.IGNORECASE,
)
_VOCAB_WORD_RE = re.compile(r"\b([A-Za-z]{3,})\b")
_PDF_FONT_RE = re.compile(rb"/Font\b")


def extract_pdf_text_metadata(
    pdf_path: str, prep_bin: Optional[str] = None
) -> Dict[str, Any]:
    """
    Extract real PDF text metadata (spoken cues, dynamics, tempo markings, lyric vocabulary).
    Prefers macOS PDFKit (`rehearsal-omr-prep text`) or `pdftotext` so subsetted CID/ToUnicode
    music fonts decode cleanly, and falls back to stdlib PDF stream parsing for minimal PDFs.
    """
    empty: Dict[str, Any] = {
        "isVectorPdf": False,
        "spokenCues": [],
        "dynamics": [],
        "tempoMarkings": [],
        "lyricVocabulary": [],
    }
    if not os.path.isfile(pdf_path):
        return empty

    counts: Dict[str, int] = {}
    dynamics_seen: Dict[str, str] = {}
    tempo_seen: Dict[str, str] = {}
    vocab: set[str] = set()
    extracted_any = False

    def _tally(text: str) -> None:
        nonlocal extracted_any
        if text.strip():
            extracted_any = True
        for m in _SPOKEN_CUE_RE.finditer(text):
            word = m.group(1).lower()
            counts[word] = counts.get(word, 0) + 1
        for m in _DYNAMICS_RE.finditer(text):
            tok = m.group(1)
            dynamics_seen.setdefault(tok.lower(), tok)
        for m in _TEMPO_RE.finditer(text):
            tok = m.group(1)
            tempo_seen.setdefault(tok.lower(), tok)
        for m in _VOCAB_WORD_RE.finditer(text):
            w = m.group(1)
            if len(vocab) < 800:
                vocab.add(w)

    def _build_result(is_vector: bool) -> Dict[str, Any]:
        spoken_cues = [
            {"text": word, "count": count}
            for word, count in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
        ]
        return {
            "isVectorPdf": bool(is_vector),
            "spokenCues": spoken_cues,
            "dynamics": sorted(dynamics_seen.values(), key=str.lower),
            "tempoMarkings": sorted(tempo_seen.values(), key=str.lower),
            "lyricVocabulary": sorted(vocab, key=lambda s: (s.lower(), s))[:400],
        }

    native_checked = False
    native_text = ""
    extract_cmds: List[List[str]] = []
    if prep_bin and os.path.isfile(prep_bin) and os.access(prep_bin, os.X_OK):
        extract_cmds.append([prep_bin, "text", pdf_path])
    pdftotext_bin = shutil.which("pdftotext")
    if pdftotext_bin:
        extract_cmds.append([pdftotext_bin, "-q", pdf_path, "-"])

    for cmd in extract_cmds:
        try:
            proc = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=10.0,
                check=False,
            )
            if proc.returncode == 0:
                native_checked = True
                if proc.stdout and proc.stdout.strip():
                    native_text = proc.stdout
                    break
        except (subprocess.TimeoutExpired, OSError):
            continue

    if native_text.strip():
        _tally(native_text)
        return _build_result(True)

    try:
        with open(pdf_path, "rb") as f:
            data = f.read(32 * 1024 * 1024)
    except OSError:
        return empty

    has_fonts = bool(_PDF_FONT_RE.search(data))
    has_images = bool(re.search(rb"/(?:Image|DCTDecode|JPXDecode|JBIG2Decode|CCITTFaxDecode)\b", data))
    if native_checked and has_images and not has_fonts:
        return empty

    deadline = time.monotonic() + 3.0
    pos = 0
    n = len(data)
    while pos < n:
        if time.monotonic() > deadline:
            break
        s_idx = data.find(b"stream", pos)
        if s_idx == -1:
            break
        after_kw = s_idx + 6
        if s_idx > 0 and chr(data[s_idx - 1]).isalpha():
            pos = after_kw
            continue
        if after_kw + 1 < n and data[after_kw : after_kw + 2] == b"\r\n":
            body_start = after_kw + 2
        elif after_kw < n and data[after_kw : after_kw + 1] == b"\n":
            body_start = after_kw + 1
        else:
            pos = after_kw
            continue

        e_idx = data.find(b"endstream", body_start)
        if e_idx == -1:
            break
        pos = e_idx + 9

        dict_slice = data[max(0, s_idx - 512) : s_idx]
        if _PDF_NON_TEXT_DICT_RE.search(dict_slice):
            continue

        raw_stream = data[body_start:e_idx]
        if raw_stream.endswith(b"\r\n"):
            raw_stream = raw_stream[:-2]
        elif raw_stream.endswith(b"\n"):
            raw_stream = raw_stream[:-1]

        if not raw_stream or len(raw_stream) > _PDF_MAX_STREAM_BYTES:
            continue

        is_flate = b"/FlateDecode" in dict_slice or b"/Fl" in dict_slice
        target: Optional[bytes] = None
        if is_flate or raw_stream[:1] == b"\x78":
            target = _safe_zlib_decompress(raw_stream, _PDF_MAX_STREAM_BYTES)
        if target is None:
            if is_flate:
                continue
            target = raw_stream

        if b"BT" not in target or b"ET" not in target:
            continue

        for s in _extract_pdf_strings_from_stream(target, deadline=deadline):
            _tally(s)

    return _build_result(bool(has_fonts and extracted_any))


def extract_pdf_spoken_cues(pdf_path: str) -> List[Dict[str, Any]]:
    """Backwards-compatible wrapper returning spokenCues from extract_pdf_text_metadata."""
    return extract_pdf_text_metadata(pdf_path)["spokenCues"]


def _friendly_step_detail(
    step_name: str, current_page: Optional[int], total_pages: Optional[int]
) -> str:
    if total_pages and total_pages > 1 and current_page:
        prefix = f"Page {current_page} of {total_pages} — "
    elif current_page and total_pages == 1:
        prefix = ""
    elif current_page:
        prefix = f"Page {current_page} — "
    else:
        prefix = ""

    if step_name in ("LOAD", "BINARY", "SCALE"):
        if total_pages and total_pages > 1 and not current_page:
            return f"Opening PDF ({total_pages} pages)…"
        return f"{prefix}preparing page image…"
    if step_name in ("GRID", "HEADERS", "MEASURES"):
        return f"{prefix}finding staves and barlines…"
    if step_name in ("STEM_SEEDS", "BEAMS", "LEDGERS", "HEADS", "STEMS", "REDUCTION", "CUE_BEAMS"):
        return f"{prefix}reading notes, stems, and beams…"
    if step_name in ("TEXTS", "CHORDS", "CURVES", "SYMBOLS", "LINKS", "RHYTHMS"):
        return f"{prefix}reading rhythms and markings…"
    if step_name in ("PAGE", "SCORE"):
        return f"{prefix}building score layout…"
    if step_name == "EXPORT":
        return "Exporting MusicXML…"
    return f"{prefix}reading sheet music…"


def _count_measures_in_export(path: str) -> int:
    try:
        with open(path, "rb") as f:
            raw = f.read()
        xml_text = (
            extract_musicxml_from_mxl_bytes(raw)
            if path.lower().endswith(".mxl")
            else decode_xml_bytes(raw)
        )
        root = ET.fromstring(xml_text.strip())
        return sum(1 for el in root.iter() if _strip_ns(el.tag) == "measure")
    except Exception:
        return -1


def find_audiveris_output(out_dir: str, input_stem: Optional[str] = None) -> Optional[str]:
    """Recursively locate the primary exported .mxl or .musicxml/.xml file in out_dir."""
    mxl_files: List[str] = []
    musicxml_files: List[str] = []
    xml_files: List[str] = []
    for root, _dirs, files in os.walk(out_dir):
        for name in sorted(files):
            lower = name.lower()
            full = os.path.join(root, name)
            if lower.endswith(".mxl"):
                mxl_files.append(full)
            elif lower.endswith(".musicxml"):
                musicxml_files.append(full)
            elif lower.endswith(".xml") and lower != "container.xml":
                xml_files.append(full)
    if mxl_files:
        if len(mxl_files) == 1:
            return mxl_files[0]
        if input_stem:
            target = f"{input_stem.lower()}.mxl"
            for path in mxl_files:
                if os.path.basename(path).lower() == target:
                    return path
        best = max(mxl_files, key=lambda p: (_count_measures_in_export(p), -len(p)))
        return best
    if musicxml_files:
        if len(musicxml_files) == 1:
            return musicxml_files[0]
        return max(musicxml_files, key=lambda p: (_count_measures_in_export(p), -len(p)))
    if xml_files:
        if len(xml_files) == 1:
            return xml_files[0]
        return max(xml_files, key=lambda p: (_count_measures_in_export(p), -len(p)))
    return None


def _parse_header_params(value: str) -> Tuple[str, Dict[str, str]]:
    parts = value.split(";")
    main = parts[0].strip().lower()
    params: Dict[str, str] = {}
    for part in parts[1:]:
        if "=" not in part:
            continue
        k, v = part.split("=", 1)
        k = k.strip().lower()
        v = v.strip()
        if len(v) >= 2 and v[0] == '"' and v[-1] == '"':
            v = v[1:-1].replace('\\"', '"').replace("\\\\", "\\")
        params[k] = v
    return main, params


def parse_multipart_form_data(
    body: bytes, content_type: str
) -> Tuple[Dict[str, str], Optional[Tuple[str, str, bytes]]]:
    """
    Binary-safe RFC 7578 multipart/form-data parser (stdlib only, no cgi module).
    Returns (text_fields, file_tuple_or_None) where file_tuple is (filename, mime_type, bytes).
    """
    ctype, params = _parse_header_params(content_type)
    if ctype != "multipart/form-data":
        raise ValueError("not multipart/form-data")
    boundary = params.get("boundary")
    if not boundary:
        raise ValueError("missing multipart boundary")

    delim = ("--" + boundary).encode("latin-1")
    chunks = body.split(delim)
    fields: Dict[str, str] = {}
    file_part: Optional[Tuple[str, str, bytes]] = None

    for chunk in chunks[1:]:
        if chunk.startswith(b"--"):
            break
        if chunk.startswith(b"\r\n"):
            chunk = chunk[2:]
        elif chunk.startswith(b"\n"):
            chunk = chunk[1:]

        sep = b"\r\n\r\n"
        sep_idx = chunk.find(sep)
        if sep_idx == -1:
            sep = b"\n\n"
            sep_idx = chunk.find(sep)
            if sep_idx == -1:
                continue

        raw_headers = chunk[:sep_idx].decode("latin-1", errors="replace")
        part_data = chunk[sep_idx + len(sep) :]
        if part_data.endswith(b"\r\n"):
            part_data = part_data[:-2]
        elif part_data.endswith(b"\n"):
            part_data = part_data[:-1]

        headers: Dict[str, str] = {}
        for line in raw_headers.splitlines():
            if ":" in line:
                hk, hv = line.split(":", 1)
                headers[hk.strip().lower()] = hv.strip()

        disp = headers.get("content-disposition", "")
        _disp_type, disp_params = _parse_header_params(disp)
        name = disp_params.get("name", "")
        filename = disp_params.get("filename")
        part_ctype = headers.get("content-type", "application/octet-stream")
        part_mime = part_ctype.split(";", 1)[0].strip().lower()

        if filename is not None or name == "file":
            if file_part is None:
                file_part = (filename or "upload", part_mime, part_data)
        elif name:
            fields[name] = part_data.decode("utf-8", errors="replace")

    return fields, file_part


def validate_upload(
    filename: str, mime_type: str, data: bytes, max_bytes: int
) -> Tuple[Optional[str], Optional[str], Optional[str], Optional[str]]:
    """
    Validate uploaded bytes, filename extension, and MIME type.
    Returns (ext, normalized_mime, error_code, error_message).
    """
    if not data:
        return None, None, "EMPTY_UPLOAD", "The uploaded file is empty."
    if len(data) > max_bytes:
        mb = round(max_bytes / (1024 * 1024), 1)
        return (
            None,
            None,
            "FILE_TOO_LARGE",
            f"The uploaded file exceeds the {mb} MB limit.",
        )

    clean_name = os.path.basename(filename or "").strip()
    _, ext = os.path.splitext(clean_name)
    ext = ext.lower()
    mime = (mime_type or "").split(";", 1)[0].strip().lower()

    if ext and ext not in ALLOWED_EXTENSIONS:
        return (
            None,
            None,
            "INVALID_FILE_TYPE",
            "Unsupported file type. Please upload a PDF, PNG, JPG, WebP, or TIFF scan.",
        )

    if mime and mime != "application/octet-stream" and mime not in ALLOWED_MIMES:
        return (
            None,
            None,
            "INVALID_FILE_TYPE",
            "Unsupported media type. Please upload a PDF, PNG, JPG, WebP, or TIFF scan.",
        )

    if not ext and mime in ALLOWED_MIMES:
        ext = ALLOWED_MIMES[mime]
    if not ext:
        return (
            None,
            None,
            "INVALID_FILE_TYPE",
            "Could not determine file type. Please upload a PDF, PNG, JPG, WebP, or TIFF scan.",
        )

    norm_mime = ALLOWED_EXTENSIONS[ext]
    if mime in ALLOWED_MIMES:
        norm_mime = "image/jpeg" if mime == "image/jpg" else ("image/tiff" if mime == "image/x-tiff" else mime)

    return ext, norm_mime, None, None


def _parse_bool(val: Optional[str]) -> bool:
    if val is None:
        return False
    return str(val).strip().lower() in ("1", "true", "yes", "on")


def _sanitize_download_stem(name: str) -> str:
    stem = os.path.splitext(os.path.basename(name or "score"))[0]
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", stem).strip("-._")
    return cleaned or "score"


class OMRService:
    """Core async job queue, SQLite persistence, artifact storage, and auth verification."""

    def __init__(self, config: OMRConfig) -> None:
        self.config = config
        os.makedirs(self.config.data_dir, exist_ok=True)
        self.jobs_dir = os.path.join(self.config.data_dir, "jobs")
        os.makedirs(self.jobs_dir, exist_ok=True)
        self.db_path = os.path.join(self.config.data_dir, "omr.sqlite")

        self._db_lock = threading.Lock()
        self._state_lock = threading.Lock()
        self._active_jobs = 0
        self._queue: "queue.Queue[str]" = queue.Queue()
        self._stop_event = threading.Event()
        self._workers: List[threading.Thread] = []
        self._collector_threads: List[threading.Thread] = []
        self._cleanup_thread: Optional[threading.Thread] = None

        self._init_db()
        self.cleanup_expired_jobs()
        self._start_workers()
        self._start_cleanup_thread()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=30.0)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._db_lock:
            conn = self._connect()
            try:
                conn.execute("PRAGMA journal_mode = WAL;")
                conn.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS scan_jobs (
                        job_id TEXT PRIMARY KEY,
                        status TEXT NOT NULL,
                        progress INTEGER NOT NULL DEFAULT 0,
                        stage TEXT NOT NULL DEFAULT 'queued',
                        stage_detail TEXT NOT NULL DEFAULT '',
                        current_page INTEGER,
                        total_pages INTEGER,
                        cache_hit INTEGER NOT NULL DEFAULT 0,
                        upload_hash TEXT NOT NULL,
                        filename TEXT NOT NULL,
                        mime_type TEXT NOT NULL,
                        instrument TEXT NOT NULL DEFAULT '',
                        title TEXT NOT NULL DEFAULT '',
                        scan_mode TEXT NOT NULL DEFAULT 'full',
                        multi_run_mode TEXT NOT NULL DEFAULT 'off',
                        alternate_runs_json TEXT NOT NULL DEFAULT '[]',
                        original_path TEXT NOT NULL DEFAULT '',
                        raw_path TEXT NOT NULL DEFAULT '',
                        raw_musicxml TEXT NOT NULL DEFAULT '',
                        corrected_path TEXT NOT NULL DEFAULT '',
                        corrected_mxl_path TEXT NOT NULL DEFAULT '',
                        corrected_musicxml TEXT NOT NULL DEFAULT '',
                        flagged_log_json TEXT NOT NULL DEFAULT '[]',
                        skipped_pages_json TEXT NOT NULL DEFAULT '[]',
                        spoken_cues_json TEXT NOT NULL DEFAULT '[]',
                        pdf_text_meta_json TEXT NOT NULL DEFAULT '{}',
                        warning TEXT NOT NULL DEFAULT '',
                        verified INTEGER NOT NULL DEFAULT 0,
                        owner_type TEXT NOT NULL DEFAULT '',
                        owner_id TEXT NOT NULL DEFAULT '',
                        error TEXT NOT NULL DEFAULT '',
                        error_code TEXT NOT NULL DEFAULT '',
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        completed_at TEXT NOT NULL DEFAULT '',
                        confirmed_at TEXT NOT NULL DEFAULT ''
                    );
                    CREATE INDEX IF NOT EXISTS idx_scan_jobs_hash ON scan_jobs(upload_hash);
                    CREATE INDEX IF NOT EXISTS idx_scan_jobs_verified ON scan_jobs(verified, confirmed_at DESC);

                    CREATE TABLE IF NOT EXISTS verified_cache (
                        upload_hash TEXT PRIMARY KEY,
                        source_job_id TEXT NOT NULL,
                        title TEXT NOT NULL DEFAULT '',
                        instrument TEXT NOT NULL DEFAULT '',
                        musicxml TEXT NOT NULL,
                        corrected_mxl_path TEXT NOT NULL DEFAULT '',
                        owner_type TEXT NOT NULL DEFAULT '',
                        owner_id TEXT NOT NULL DEFAULT '',
                        confirmed_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    );
                    """
                )
                existing_cols = {
                    r[1] for r in conn.execute("PRAGMA table_info(scan_jobs)").fetchall()
                }
                for col_name, col_def in (
                    ("scan_mode", "TEXT NOT NULL DEFAULT 'full'"),
                    ("multi_run_mode", "TEXT NOT NULL DEFAULT 'off'"),
                    ("alternate_runs_json", "TEXT NOT NULL DEFAULT '[]'"),
                    ("stage_detail", "TEXT NOT NULL DEFAULT ''"),
                    ("current_page", "INTEGER"),
                    ("total_pages", "INTEGER"),
                    ("skipped_pages_json", "TEXT NOT NULL DEFAULT '[]'"),
                    ("spoken_cues_json", "TEXT NOT NULL DEFAULT '[]'"),
                    ("pdf_text_meta_json", "TEXT NOT NULL DEFAULT '{}'"),
                    ("warning", "TEXT NOT NULL DEFAULT ''"),
                ):
                    if col_name not in existing_cols:
                        conn.execute(
                            f"ALTER TABLE scan_jobs ADD COLUMN {col_name} {col_def}"
                        )
                conn.commit()
            finally:
                conn.close()

    def _start_workers(self) -> None:
        for i in range(self.config.workers):
            t = threading.Thread(
                target=self._worker_loop,
                name=f"omr-worker-{i + 1}",
                daemon=True,
            )
            t.start()
            self._workers.append(t)

    def _start_cleanup_thread(self) -> None:
        if self.config.retention_hours <= 0:
            return
        t = threading.Thread(
            target=self._cleanup_loop,
            name="omr-cleanup",
            daemon=True,
        )
        t.start()
        self._cleanup_thread = t

    def _cleanup_loop(self) -> None:
        while not self._stop_event.wait(3600.0):
            try:
                self.cleanup_expired_jobs()
            except Exception:
                pass

    @staticmethod
    def _parse_iso_ts(ts_str: str) -> Optional[float]:
        if not ts_str:
            return None
        try:
            dt = datetime.datetime.strptime(ts_str.strip(), "%Y-%m-%dT%H:%M:%SZ")
            return dt.replace(tzinfo=datetime.timezone.utc).timestamp()
        except ValueError:
            return None

    def cleanup_expired_jobs(self, now_ts: Optional[float] = None) -> int:
        """Delete scan_jobs rows and job folders older than retention_hours (skipping active jobs)."""
        if self.config.retention_hours <= 0:
            return 0
        now_val = now_ts if now_ts is not None else time.time()
        cutoff = now_val - (self.config.retention_hours * 3600.0)
        deleted = 0
        expired_ids: List[str] = []
        active_ids: set[str] = set()

        with self._db_lock:
            conn = self._connect()
            try:
                rows = conn.execute(
                    "SELECT job_id, status, created_at, updated_at FROM scan_jobs"
                ).fetchall()
                for r in rows:
                    jid = r["job_id"]
                    if r["status"] in ("queued", "processing"):
                        active_ids.add(jid)
                        continue
                    ts = self._parse_iso_ts(r["updated_at"] or "") or self._parse_iso_ts(r["created_at"] or "")
                    if ts is not None and ts < cutoff:
                        expired_ids.append(jid)
                for jid in expired_ids:
                    conn.execute("DELETE FROM scan_jobs WHERE job_id = ?", (jid,))
                if expired_ids:
                    conn.commit()
            finally:
                conn.close()

        for jid in expired_ids:
            jdir = os.path.join(self.jobs_dir, jid)
            if os.path.isdir(jdir):
                shutil.rmtree(jdir, ignore_errors=True)
            deleted += 1

        # Also clean up orphaned job folders older than cutoff
        if os.path.isdir(self.jobs_dir):
            expired_set = set(expired_ids)
            for name in os.listdir(self.jobs_dir):
                if name in active_ids or name in expired_set:
                    continue
                jdir = os.path.join(self.jobs_dir, name)
                if not os.path.isdir(jdir):
                    continue
                try:
                    if os.path.getmtime(jdir) < cutoff:
                        shutil.rmtree(jdir, ignore_errors=True)
                        deleted += 1
                except OSError:
                    pass
        return deleted

    def stop(self) -> None:
        self._stop_event.set()
        for t in self._workers:
            t.join(timeout=2.0)
        if self._cleanup_thread is not None:
            self._cleanup_thread.join(timeout=2.0)
        with self._state_lock:
            collectors = list(self._collector_threads)
        for ct in collectors:
            ct.join(timeout=5.0)

    def preprocess_available(self) -> bool:
        if not self.config.preprocess or self.config.preprocess_mode == "off":
            return False
        prep_bin = os.path.join(self.config.data_dir, "rehearsal-omr-prep")
        if os.path.isfile(prep_bin) and os.access(prep_bin, os.X_OK):
            return True
        swift_src = os.path.join(os.path.dirname(os.path.abspath(__file__)), "preprocess.swift")
        if os.path.isfile(swift_src) and shutil.which("swiftc"):
            return True
        return shutil.which("pdftoppm") is not None

    def available_engines(self) -> List[str]:
        engines: List[str] = []
        if self.config.audiveris_bin or AudiverisAdapter([detect_audiveris_bin() or ""]).is_available():
            engines.append("audiveris")
        if shutil.which("homr"):
            engines.append("homr")
        if shutil.which("oemer"):
            engines.append("oemer")
        if self.config.omr_api_url and self.config.omr_api_key:
            engines.append(self.config.omr_api_provider or "api")
        if self.config.engine_cmd:
            engines.append("custom")
        return engines

    def health_info(self) -> Dict[str, Any]:
        with self._state_lock:
            active = self._active_jobs
        adapter = build_engine_adapter(self.config)
        ai_key = bool(os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"))
        return {
            "ok": True,
            "service": SERVICE_NAME,
            "engine": adapter.name,
            "engineAdapter": adapter.name,
            "engineAvailable": adapter.is_available(),
            "availableEngines": self.available_engines(),
            "aiVerifyAvailable": ai_key,
            "ocrAvailable": bool(self.config.tessdata_dir),
            "tessdataDir": self.config.tessdata_dir,
            "preprocessAvailable": self.preprocess_available(),
            "multiRun": self.config.multi_run_mode,
            "retentionHours": self.config.retention_hours,
            "queueDepth": self._queue.qsize(),
            "activeJobs": active,
            "authMode": self.config.auth_mode,
            "version": SERVICE_VERSION,
        }

    def _job_dir(self, job_id: str) -> str:
        path = os.path.join(self.jobs_dir, job_id)
        os.makedirs(path, exist_ok=True)
        return path

    def get_cache(self, upload_hash: str) -> Optional[Dict[str, Any]]:
        with self._db_lock:
            conn = self._connect()
            try:
                row = conn.execute(
                    "SELECT * FROM verified_cache WHERE upload_hash = ?",
                    (upload_hash,),
                ).fetchone()
                return dict(row) if row else None
            finally:
                conn.close()

    def create_job(
        self,
        filename: str,
        mime_type: str,
        ext: str,
        data: bytes,
        instrument: str = "",
        title: str = "",
        skip_cache: bool = False,
        scan_mode: str = "full",
        multi_run_mode: Optional[str] = None,
    ) -> Dict[str, Any]:
        norm_mode = normalize_scan_mode(scan_mode)
        eff_multi_run = normalize_multi_run_mode(
            multi_run_mode if multi_run_mode is not None else self.config.multi_run_mode
        )
        upload_hash = hashlib.sha256(data).hexdigest()
        cache_key = scan_cache_key(upload_hash, norm_mode)
        job_id = uuid.uuid4().hex
        now = utc_now_iso()
        jdir = self._job_dir(job_id)
        original_path = os.path.join(jdir, f"original{ext}")
        with open(original_path, "wb") as f:
            f.write(data)

        cached = None if skip_cache else self.get_cache(cache_key)
        if cached is not None:
            cached_xml = cached["musicxml"]
            raw_path = os.path.join(jdir, "raw.musicxml")
            with open(raw_path, "w", encoding="utf-8") as f:
                f.write(cached_xml)
            eff_title = title.strip() or cached.get("title") or _sanitize_download_stem(filename)
            eff_instrument = instrument.strip() or cached.get("instrument") or ""
            with self._db_lock:
                conn = self._connect()
                try:
                    conn.execute(
                        """
                        INSERT INTO scan_jobs (
                            job_id, status, progress, stage, stage_detail, cache_hit, upload_hash,
                            filename, mime_type, instrument, title, scan_mode,
                            original_path, raw_path, raw_musicxml,
                            corrected_musicxml, flagged_log_json, verified,
                            created_at, updated_at, completed_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            job_id,
                            "completed",
                            100,
                            "cache_hit",
                            "Loaded from verified scan cache.",
                            1,
                            upload_hash,
                            os.path.basename(filename) or f"upload{ext}",
                            mime_type,
                            eff_instrument,
                            eff_title,
                            norm_mode,
                            original_path,
                            raw_path,
                            cached_xml,
                            cached_xml,
                            "[]",
                            0,
                            now,
                            now,
                            now,
                        ),
                    )
                    conn.commit()
                finally:
                    conn.close()
            return {
                "ok": True,
                "jobId": job_id,
                "status": "completed",
                "cacheHit": True,
                "uploadHash": upload_hash,
                "scanMode": norm_mode,
            }

        eff_title = title.strip() or _sanitize_download_stem(filename)
        with self._db_lock:
            conn = self._connect()
            try:
                conn.execute(
                    """
                    INSERT INTO scan_jobs (
                        job_id, status, progress, stage, stage_detail, cache_hit, upload_hash,
                        filename, mime_type, instrument, title, scan_mode, multi_run_mode,
                        original_path, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        job_id,
                        "queued",
                        5,
                        "queued",
                        "Queued for scanning…",
                        0,
                        upload_hash,
                        os.path.basename(filename) or f"upload{ext}",
                        mime_type,
                        instrument.strip(),
                        eff_title,
                        norm_mode,
                        eff_multi_run,
                        original_path,
                        now,
                        now,
                    ),
                )
                conn.commit()
            finally:
                conn.close()

        self._queue.put(job_id)
        return {
            "ok": True,
            "jobId": job_id,
            "status": "queued",
            "cacheHit": False,
            "uploadHash": upload_hash,
            "scanMode": norm_mode,
        }

    def get_job_row(self, job_id: str) -> Optional[Dict[str, Any]]:
        with self._db_lock:
            conn = self._connect()
            try:
                row = conn.execute(
                    "SELECT * FROM scan_jobs WHERE job_id = ?", (job_id,)
                ).fetchone()
                return dict(row) if row else None
            finally:
                conn.close()

    def format_job(self, row: Dict[str, Any]) -> Dict[str, Any]:
        job_id = row["job_id"]
        try:
            flagged_log = json.loads(row.get("flagged_log_json") or "[]")
        except Exception:
            flagged_log = []
        try:
            skipped_pages = json.loads(row.get("skipped_pages_json") or "[]")
        except Exception:
            skipped_pages = []
        try:
            spoken_cues = json.loads(row.get("spoken_cues_json") or "[]")
        except Exception:
            spoken_cues = []
        try:
            pdf_text_meta = json.loads(row.get("pdf_text_meta_json") or "{}")
            if not isinstance(pdf_text_meta, dict):
                pdf_text_meta = {}
        except Exception:
            pdf_text_meta = {}
        try:
            alternate_runs = json.loads(row.get("alternate_runs_json") or "[]")
            if not isinstance(alternate_runs, list):
                alternate_runs = []
        except Exception:
            alternate_runs = []
        raw_exists = bool(row.get("raw_path") and os.path.isfile(row["raw_path"]))
        mxl_exists = bool(
            row.get("verified")
            and row.get("corrected_mxl_path")
            and os.path.isfile(row["corrected_mxl_path"])
        )
        return {
            "ok": True,
            "jobId": job_id,
            "status": row["status"],
            "progress": int(round(float(row["progress"]))),
            "stage": row["stage"],
            "stageDetail": row.get("stage_detail") or "",
            "currentPage": row.get("current_page"),
            "totalPages": row.get("total_pages"),
            "cacheHit": bool(row["cache_hit"]),
            "uploadHash": row["upload_hash"],
            "filename": row["filename"],
            "mimeType": row["mime_type"],
            "instrument": row["instrument"],
            "title": row["title"],
            "scanMode": normalize_scan_mode(row.get("scan_mode")),
            "multiRun": normalize_multi_run_mode(row.get("multi_run_mode")),
            "alternateRuns": alternate_runs,
            "verified": bool(row["verified"]),
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
            "completedAt": row["completed_at"] or None,
            "confirmedAt": row["confirmed_at"] or None,
            "error": row["error"] or None,
            "errorCode": row["error_code"] or None,
            "warning": row.get("warning") or None,
            "skippedPages": skipped_pages,
            "detectedSpokenCues": spoken_cues,
            "pdfTextMeta": pdf_text_meta or None,
            "rawMusicxml": row["raw_musicxml"] or None,
            "correctedMusicxml": row["corrected_musicxml"] or None,
            "flaggedLog": flagged_log,
            "originalUrl": f"/api/scan/jobs/{job_id}/original",
            "rawUrl": f"/api/scan/jobs/{job_id}/raw" if raw_exists else None,
            "correctedMxlUrl": (
                f"/api/scan/jobs/{job_id}/corrected.mxl" if mxl_exists else None
            ),
        }

    def _update_job(self, job_id: str, **fields: Any) -> None:
        fields["updated_at"] = utc_now_iso()
        cols = ", ".join(f"{k} = ?" for k in fields.keys())
        vals = list(fields.values()) + [job_id]
        with self._db_lock:
            conn = self._connect()
            try:
                conn.execute(f"UPDATE scan_jobs SET {cols} WHERE job_id = ?", vals)
                conn.commit()
            finally:
                conn.close()

    def _fail_job(
        self,
        job_id: str,
        error_code: str,
        error_message: str,
        log_lines: Optional[Sequence[str]] = None,
    ) -> None:
        if log_lines:
            try:
                log_path = os.path.join(self._job_dir(job_id), "engine.log")
                with open(log_path, "w", encoding="utf-8") as f:
                    f.write(f"errorCode={error_code}\n")
                    for ln in list(log_lines)[-120:]:
                        f.write(ln + "\n")
            except OSError:
                pass
        self._update_job(
            job_id,
            status="failed",
            progress=100,
            stage="failed",
            stage_detail=error_message,
            error_code=error_code,
            error=error_message,
            completed_at=utc_now_iso(),
        )

    def _worker_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                job_id = self._queue.get(timeout=0.25)
            except queue.Empty:
                continue
            with self._state_lock:
                self._active_jobs += 1
            try:
                self._process_job(job_id)
            except Exception as exc:
                self._fail_job(
                    job_id,
                    "ENGINE_ERROR",
                    f"{ENGINE_ERROR_MSG} ({type(exc).__name__})",
                )
            finally:
                with self._state_lock:
                    self._active_jobs -= 1
                self._queue.task_done()

    def _effective_timeout(self, total_pages: Optional[int]) -> float:
        base = self.config.job_timeout
        if total_pages and total_pages > 1 and base >= 30.0:
            return min(
                self.config.max_job_timeout,
                base + (total_pages - 1) * self.config.per_page_timeout,
            )
        return base

    def _ensure_preprocess_bin(self) -> Optional[str]:
        if not self.config.preprocess or self.config.preprocess_mode == "off":
            return None
        prep_bin = os.path.join(self.config.data_dir, "rehearsal-omr-prep")
        swift_src = os.path.join(os.path.dirname(os.path.abspath(__file__)), "preprocess.swift")
        swiftc = shutil.which("swiftc")
        if os.path.isfile(prep_bin) and os.access(prep_bin, os.X_OK):
            if not os.path.isfile(swift_src) or os.path.getmtime(prep_bin) >= os.path.getmtime(swift_src):
                return prep_bin
        if not os.path.isfile(swift_src) or not swiftc:
            return prep_bin if (os.path.isfile(prep_bin) and os.access(prep_bin, os.X_OK)) else None
        with self._db_lock:
            if os.path.isfile(prep_bin) and os.access(prep_bin, os.X_OK):
                if os.path.getmtime(prep_bin) >= os.path.getmtime(swift_src):
                    return prep_bin
            cache_dir = os.path.join(self.config.data_dir, ".swift-cache")
            os.makedirs(cache_dir, exist_ok=True)
            try:
                res = subprocess.run(
                    [swiftc, "-O", "-module-cache-path", cache_dir, swift_src, "-o", prep_bin],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    timeout=60.0,
                    check=False,
                )
                if res.returncode == 0 and os.path.isfile(prep_bin) and os.access(prep_bin, os.X_OK):
                    return prep_bin
            except (subprocess.TimeoutExpired, OSError):
                pass
        return prep_bin if (os.path.isfile(prep_bin) and os.access(prep_bin, os.X_OK)) else None

    def _preprocess_image(self, src_path: str, dst_path: str) -> bool:
        prep_bin = self._ensure_preprocess_bin()
        if not prep_bin:
            return False
        try:
            res = subprocess.run(
                [prep_bin, "image", src_path, dst_path],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=20.0,
                check=False,
            )
            return res.returncode == 0 and os.path.isfile(dst_path) and os.path.getsize(dst_path) > 0
        except (subprocess.TimeoutExpired, OSError):
            return False

    def _render_pdf_page_for_retry(
        self, pdf_path: str, page_num: int, out_dir: str, dpi: int = 400
    ) -> Optional[str]:
        if not self.config.preprocess or self.config.preprocess_mode == "off":
            return None
        os.makedirs(out_dir, exist_ok=True)
        prep_bin = self._ensure_preprocess_bin()
        if prep_bin:
            try:
                res = subprocess.run(
                    [prep_bin, "pdf", pdf_path, out_dir, str(dpi), str(page_num)],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    timeout=30.0,
                    check=False,
                )
                expected = os.path.join(out_dir, f"page-{page_num:04d}.png")
                if res.returncode == 0 and os.path.isfile(expected):
                    return expected
            except (subprocess.TimeoutExpired, OSError):
                pass
        pdftoppm = shutil.which("pdftoppm")
        if pdftoppm:
            prefix = os.path.join(out_dir, "page")
            try:
                res = subprocess.run(
                    [pdftoppm, "-png", "-gray", "-r", str(dpi), "-f", str(page_num), "-l", str(page_num), pdf_path, prefix],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    timeout=30.0,
                    check=False,
                )
                if res.returncode == 0:
                    for name in sorted(os.listdir(out_dir)):
                        if name.lower().endswith(".png"):
                            return os.path.join(out_dir, name)
            except (subprocess.TimeoutExpired, OSError):
                pass
        return None

    @staticmethod
    def _detect_flagged_pages_from_xml(
        xml_text: str, total_pages: Optional[int]
    ) -> List[int]:
        """Heuristic: identify 1-based PDF page numbers likely to have duration mismatches."""
        pages = max(1, total_pages or 1)
        try:
            root = ET.fromstring(xml_text.strip())
        except ET.ParseError:
            return [1]
        flagged_measure_indices: set[int] = set()
        total_measures = 0
        for part in root:
            if _strip_ns(part.tag) != "part":
                continue
            divisions = 1.0
            expected_q = 4.0
            measures = [m for m in part if _strip_ns(m.tag) == "measure"]
            total_measures = max(total_measures, len(measures))
            for mi, m in enumerate(measures):
                cur_q = 0.0
                has_notes = False
                for ch in m:
                    t = _strip_ns(ch.tag)
                    if t == "attributes":
                        for sub in ch:
                            st = _strip_ns(sub.tag)
                            if st == "divisions" and sub.text:
                                try:
                                    divisions = max(1.0, float(sub.text.strip()))
                                except ValueError:
                                    pass
                            elif st == "time":
                                beats = 4.0
                                btype = 4.0
                                for tb in sub:
                                    if _strip_ns(tb.tag) == "beats" and tb.text:
                                        try:
                                            beats = float(tb.text.strip())
                                        except ValueError:
                                            pass
                                    elif _strip_ns(tb.tag) == "beat-type" and tb.text:
                                        try:
                                            btype = float(tb.text.strip())
                                        except ValueError:
                                            pass
                                expected_q = beats * (4.0 / max(1.0, btype))
                    elif t == "note":
                        if any(_strip_ns(s.tag) == "grace" for s in ch):
                            continue
                        if any(_strip_ns(s.tag) == "chord" for s in ch):
                            continue
                        has_notes = True
                        for s in ch:
                            if _strip_ns(s.tag) == "duration" and s.text:
                                try:
                                    cur_q += float(s.text.strip()) / divisions
                                except ValueError:
                                    pass
                if has_notes and mi > 0 and abs(cur_q - expected_q) > 0.05:
                    flagged_measure_indices.add(mi)
        if not flagged_measure_indices or total_measures <= 0:
            return []
        if pages == 1:
            return [1]
        flagged_pages: set[int] = set()
        for mi in flagged_measure_indices:
            p = min(pages, 1 + int((mi * pages) / float(total_measures)))
            flagged_pages.add(p)
        return sorted(flagged_pages)

    def _build_sub_env(self, enable_ocr: bool) -> Dict[str, str]:
        sub_env = os.environ.copy()
        legacy_sort_flag = "-Djava.util.Arrays.useLegacyMergeSort=true"
        existing_java_opts = sub_env.get("JAVA_TOOL_OPTIONS", "").strip()
        if legacy_sort_flag not in existing_java_opts:
            sub_env["JAVA_TOOL_OPTIONS"] = (
                f"{existing_java_opts} {legacy_sort_flag}".strip()
                if existing_java_opts
                else legacy_sort_flag
            )
        if enable_ocr and self.config.tessdata_dir:
            sub_env["TESSDATA_PREFIX"] = self.config.tessdata_dir
        elif not enable_ocr:
            sub_env.pop("TESSDATA_PREFIX", None)
        return sub_env

    def _run_variant_once(
        self,
        variant: str,
        input_path: str,
        out_dir: str,
        adapter: EngineAdapter,
        enable_ocr: bool,
        timeout_sec: float,
        sub_env: Dict[str, str],
    ) -> Dict[str, Any]:
        t0 = time.monotonic()
        os.makedirs(out_dir, exist_ok=True)
        run_direct = getattr(adapter, "run_direct", None)
        if callable(run_direct):
            exp, err = run_direct(input_path, out_dir, timeout_sec=timeout_sec)
            elapsed = round(time.monotonic() - t0, 3)
            if err or not exp or not os.path.isfile(exp):
                return {"variant": variant, "status": "failed", "error": err or "no output", "seconds": elapsed}
        else:
            cmd = adapter.build_command(input_path, out_dir, enable_ocr=enable_ocr)
            try:
                proc = subprocess.run(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=timeout_sec,
                    check=False,
                    env=sub_env,
                )
            except subprocess.TimeoutExpired:
                return {"variant": variant, "status": "failed", "error": "timeout", "seconds": round(time.monotonic() - t0, 3)}
            except OSError as exc:
                return {"variant": variant, "status": "failed", "error": str(exc), "seconds": round(time.monotonic() - t0, 3)}

            elapsed = round(time.monotonic() - t0, 3)
            if proc.returncode != 0:
                return {"variant": variant, "status": "failed", "error": f"exit {proc.returncode}", "seconds": elapsed}

            stem = os.path.splitext(os.path.basename(input_path))[0]
            exp = adapter.find_output(out_dir, input_stem=stem)
            if not exp or not os.path.isfile(exp):
                return {"variant": variant, "status": "failed", "error": "no output", "seconds": elapsed}

        try:
            with open(exp, "rb") as f:
                raw_bytes = f.read()
            is_mxl = exp.lower().endswith(".mxl")
            xml_text = extract_musicxml_from_mxl_bytes(raw_bytes) if is_mxl else decode_xml_bytes(raw_bytes)
            ok, reason = validate_musicxml(xml_text)
            if not ok:
                return {"variant": variant, "status": "failed", "error": reason, "seconds": elapsed}
            return {
                "variant": variant,
                "status": "completed",
                "rawMusicxml": xml_text,
                "rawBytes": raw_bytes,
                "isMxl": is_mxl,
                "seconds": elapsed,
            }
        except Exception as exc:
            return {"variant": variant, "status": "failed", "error": str(exc), "seconds": elapsed}

    def _process_job_multi_run(
        self,
        job_id: str,
        row: Dict[str, Any],
        adapter: EngineAdapter,
        original_path: str,
        ext: str,
        total_pages: Optional[int],
    ) -> None:
        tmpdir = tempfile.mkdtemp(prefix="rehearsal-omr-mr-")
        handed_off_tmpdir = False
        try:
            variants_root = os.path.join(tmpdir, "variants")
            os.makedirs(variants_root, exist_ok=True)
            is_pdf = ext.lower() == ".pdf" or row.get("mime_type") == "application/pdf"
            variant_names = ("v300", "v400", "v350c")
            variant_inputs: List[Tuple[str, str, str]] = []

            prep_bin = (
                self._ensure_preprocess_bin()
                if (self.config.preprocess and self.config.preprocess_mode != "off")
                else None
            )
            multi_run_mode = normalize_multi_run_mode(row.get("multi_run_mode"))
            scan_mode = normalize_scan_mode(row.get("scan_mode"))
            enable_ocr = scan_mode != "notes-only"
            sub_env = self._build_sub_env(enable_ocr)
            effective_timeout = self._effective_timeout(total_pages)

            if multi_run_mode == "flagged":
                orig_copy = os.path.join(tmpdir, f"input{ext or '.png'}")
                shutil.copy2(original_path, orig_copy)
                primary_input = orig_copy
                if not is_pdf and self.config.preprocess and self.config.preprocess_mode != "off":
                    prepped_img = os.path.join(tmpdir, "input-prepped.png")
                    if self._preprocess_image(orig_copy, prepped_img):
                        primary_input = prepped_img

                self._update_job(
                    job_id,
                    progress=20,
                    stage="running_omr",
                    stage_detail="Running primary OMR scan…",
                )
                primary_result = self._run_variant_once(
                    "v300",
                    primary_input,
                    os.path.join(tmpdir, "out-v300"),
                    adapter,
                    enable_ocr,
                    effective_timeout,
                    sub_env,
                )
                if primary_result.get("status") != "completed":
                    self._fail_job(job_id, "ENGINE_ERROR", ENGINE_ERROR_MSG)
                    return

                jdir = self._job_dir(job_id)
                raw_dest = os.path.join(jdir, "raw.mxl" if primary_result["isMxl"] else "raw.musicxml")
                with open(raw_dest, "wb") as f:
                    f.write(primary_result["rawBytes"])

                pdf_meta: Dict[str, Any] = {}
                spoken_cues: List[Dict[str, Any]] = []
                if is_pdf and enable_ocr:
                    pdf_meta = extract_pdf_text_metadata(original_path, prep_bin=prep_bin)
                    spoken_cues = pdf_meta.get("spokenCues", [])

                flagged_pages = (
                    self._detect_flagged_pages_from_xml(primary_result["rawMusicxml"], total_pages)
                    if is_pdf
                    else [1]
                )
                initial_alts: List[Dict[str, Any]] = [
                    {"variant": f"{vn}-p{p_num}", "status": "pending", "page": p_num}
                    for p_num in flagged_pages
                    for vn in ("v400", "v350c")
                ]
                self._update_job(
                    job_id,
                    status="completed",
                    progress=100,
                    stage="completed",
                    stage_detail="Scan complete (v300).",
                    spoken_cues_json=json.dumps(spoken_cues),
                    pdf_text_meta_json=json.dumps(pdf_meta),
                    alternate_runs_json=json.dumps(initial_alts),
                    raw_path=raw_dest,
                    raw_musicxml=primary_result["rawMusicxml"],
                    error="",
                    error_code="",
                    completed_at=utc_now_iso(),
                )

                if flagged_pages:
                    handed_off_tmpdir = True

                    def _run_flagged_alternates() -> None:
                        alt_results: List[Dict[str, Any]] = list(initial_alts)
                        alt_lock = threading.Lock()
                        tasks: List[Tuple[str, int, str, str]] = []
                        for p_num in flagged_pages:
                            for vn, dpi, contrast in (("v400", 400, False), ("v350c", 350, True)):
                                p_dir = os.path.join(variants_root, f"{vn}-p{p_num}")
                                os.makedirs(p_dir, exist_ok=True)
                                if is_pdf and prep_bin:
                                    img = self._render_pdf_page_for_retry(orig_copy, p_num, p_dir, dpi=dpi)
                                    if img and contrast:
                                        enh = os.path.join(p_dir, f"page-{p_num:04d}-c.png")
                                        if self._preprocess_image(img, enh):
                                            img = enh
                                    in_path = img or orig_copy
                                else:
                                    in_path = os.path.join(p_dir, f"input{ext or '.png'}")
                                    shutil.copy2(orig_copy, in_path)
                                tasks.append((f"{vn}-p{p_num}", p_num, in_path, os.path.join(tmpdir, f"out-{vn}-p{p_num}")))

                        max_w = max(1, min(self.config.workers, os.cpu_count() or 2, 4))
                        with concurrent.futures.ThreadPoolExecutor(max_workers=max_w) as ex:
                            fmap = {
                                ex.submit(
                                    self._run_variant_once,
                                    vlabel,
                                    in_p,
                                    out_p,
                                    adapter,
                                    enable_ocr,
                                    effective_timeout,
                                    sub_env,
                                ): (vlabel, p_num)
                                for vlabel, p_num, in_p, out_p in tasks
                            }
                            try:
                                for f in concurrent.futures.as_completed(fmap):
                                    if self._stop_event.is_set():
                                        break
                                    vlabel, p_num = fmap[f]
                                    try:
                                        r = f.result()
                                    except Exception as exc:
                                        r = {"variant": vlabel, "status": "failed", "error": str(exc)}
                                    entry = {
                                        k: v
                                        for k, v in r.items()
                                        if k in ("variant", "status", "rawMusicxml", "seconds", "error")
                                    }
                                    entry["page"] = p_num
                                    with alt_lock:
                                        replaced = False
                                        for idx, existing in enumerate(alt_results):
                                            if existing.get("variant") == vlabel:
                                                alt_results[idx] = entry
                                                replaced = True
                                                break
                                        if not replaced:
                                            alt_results.append(entry)
                                        snapshot = json.dumps(alt_results)
                                    self._update_job(
                                        job_id,
                                        alternate_runs_json=snapshot,
                                    )
                            finally:
                                shutil.rmtree(tmpdir, ignore_errors=True)

                    ct = threading.Thread(
                        target=_run_flagged_alternates,
                        name=f"omr-mr-flagged-{job_id[:8]}",
                        daemon=True,
                    )
                    with self._state_lock:
                        self._collector_threads.append(ct)
                    ct.start()
                return

            used_prep_variants = False
            if prep_bin:
                try:
                    res = subprocess.run(
                        [prep_bin, "variants", original_path, variants_root],
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        timeout=60.0,
                        check=False,
                    )
                    if res.returncode == 0:
                        cand_inputs: List[Tuple[str, str, str]] = []
                        if is_pdf:
                            for vn in variant_names:
                                r_pdf = os.path.join(variants_root, f"{vn}.pdf")
                                if os.path.isfile(r_pdf) and os.path.getsize(r_pdf) > 0:
                                    cand_inputs.append((vn, r_pdf, os.path.join(tmpdir, f"out-{vn}")))
                        if len(cand_inputs) != len(variant_names):
                            cand_inputs = []
                            for vn in variant_names:
                                p_img = os.path.join(variants_root, vn, "page-0001.png")
                                if os.path.isfile(p_img):
                                    cand_inputs.append((vn, p_img, os.path.join(tmpdir, f"out-{vn}")))
                        if len(cand_inputs) == len(variant_names):
                            variant_inputs = cand_inputs
                            used_prep_variants = True
                except (subprocess.TimeoutExpired, OSError):
                    pass

            if not used_prep_variants:
                for vn in variant_names:
                    vdir = os.path.join(variants_root, vn)
                    os.makedirs(vdir, exist_ok=True)
                    dst = os.path.join(vdir, f"input{ext or '.png'}")
                    shutil.copy2(original_path, dst)
                    variant_inputs.append((vn, dst, os.path.join(tmpdir, f"out-{vn}")))

            scan_mode = normalize_scan_mode(row.get("scan_mode"))
            enable_ocr = scan_mode != "notes-only"
            sub_env = self._build_sub_env(enable_ocr)
            effective_timeout = self._effective_timeout(total_pages)
            max_workers = max(1, min(self.config.workers, os.cpu_count() or 2, 3))

            self._update_job(
                job_id,
                progress=20,
                stage="running_omr",
                stage_detail="Running multi-variant OMR scan…",
            )

            executor = concurrent.futures.ThreadPoolExecutor(max_workers=max_workers)
            fut_to_var = {
                executor.submit(
                    self._run_variant_once,
                    vn,
                    vin,
                    vout,
                    adapter,
                    enable_ocr,
                    effective_timeout,
                    sub_env,
                ): vn
                for vn, vin, vout in variant_inputs
            }

            primary_result: Optional[Dict[str, Any]] = None
            finished_alternates: List[Dict[str, Any]] = []
            pending_futs: List[concurrent.futures.Future[Dict[str, Any]]] = []

            for fut in concurrent.futures.as_completed(fut_to_var):
                res = fut.result()
                if primary_result is None and res.get("status") == "completed":
                    primary_result = res
                    # Collect any others that happen to already be done; leave rest for background
                    pending_futs = [f for f in fut_to_var if not f.done()]
                    break
                else:
                    finished_alternates.append(
                        {
                            k: v
                            for k, v in res.items()
                            if k in ("variant", "status", "rawMusicxml", "seconds", "error")
                        }
                    )

            if primary_result is None:
                executor.shutdown(wait=True)
                self._fail_job(job_id, "ENGINE_ERROR", ENGINE_ERROR_MSG)
                return

            jdir = self._job_dir(job_id)
            raw_dest = os.path.join(jdir, "raw.mxl" if primary_result["isMxl"] else "raw.musicxml")
            with open(raw_dest, "wb") as f:
                f.write(primary_result["rawBytes"])

            pdf_meta: Dict[str, Any] = {}
            spoken_cues: List[Dict[str, Any]] = []
            if is_pdf and enable_ocr:
                pdf_meta = extract_pdf_text_metadata(original_path, prep_bin=prep_bin)
                spoken_cues = pdf_meta.get("spokenCues", [])

            initial_all_alts = list(finished_alternates) + [
                {"variant": fut_to_var[f], "status": "pending"}
                for f in pending_futs
            ]
            self._update_job(
                job_id,
                status="completed",
                progress=100,
                stage="completed",
                stage_detail=f"Scan complete ({primary_result['variant']}).",
                spoken_cues_json=json.dumps(spoken_cues),
                pdf_text_meta_json=json.dumps(pdf_meta),
                alternate_runs_json=json.dumps(initial_all_alts),
                raw_path=raw_dest,
                raw_musicxml=primary_result["rawMusicxml"],
                error="",
                error_code="",
                completed_at=utc_now_iso(),
            )

            if pending_futs:
                handed_off_tmpdir = True
                all_alts_lock = threading.Lock()
                all_alts_state = list(initial_all_alts)

                def _collect_remaining() -> None:
                    try:
                        for f in concurrent.futures.as_completed(pending_futs):
                            if self._stop_event.is_set():
                                break
                            vn = fut_to_var[f]
                            try:
                                r = f.result()
                            except Exception as exc:
                                r = {"variant": vn, "status": "failed", "error": str(exc)}
                            entry = {
                                k: v
                                for k, v in r.items()
                                if k in ("variant", "status", "rawMusicxml", "seconds", "error")
                            }
                            with all_alts_lock:
                                replaced = False
                                for idx, existing in enumerate(all_alts_state):
                                    if existing.get("variant") == vn:
                                        all_alts_state[idx] = entry
                                        replaced = True
                                        break
                                if not replaced:
                                    all_alts_state.append(entry)
                                snapshot = json.dumps(all_alts_state)
                            self._update_job(
                                job_id,
                                alternate_runs_json=snapshot,
                            )
                    finally:
                        executor.shutdown(wait=True)
                        shutil.rmtree(tmpdir, ignore_errors=True)

                ct = threading.Thread(
                    target=_collect_remaining,
                    name=f"omr-mr-collect-{job_id[:8]}",
                    daemon=True,
                )
                with self._state_lock:
                    self._collector_threads.append(ct)
                ct.start()
            else:
                executor.shutdown(wait=True)
        finally:
            if not handed_off_tmpdir:
                shutil.rmtree(tmpdir, ignore_errors=True)

    def _process_job(self, job_id: str) -> None:
        row = self.get_job_row(job_id)
        if not row:
            return

        original_path = row["original_path"]
        if not original_path or not os.path.isfile(original_path):
            self._fail_job(job_id, "ENGINE_ERROR", "Uploaded file could not be read.")
            return

        _, ext = os.path.splitext(original_path)
        total_pages: Optional[int] = None
        if ext.lower() == ".pdf" or row.get("mime_type") == "application/pdf":
            total_pages = detect_pdf_page_count(original_path)

        init_detail = (
            f"Opening PDF ({total_pages} pages)…"
            if total_pages and total_pages > 1
            else "Preparing scan…"
        )
        progress = 10
        self._update_job(
            job_id,
            status="processing",
            progress=progress,
            stage="preparing",
            stage_detail=init_detail,
            total_pages=total_pages,
        )

        adapter = build_engine_adapter(self.config)
        if not adapter.is_available():
            self._fail_job(job_id, "ENGINE_UNAVAILABLE", ENGINE_UNAVAILABLE_MSG)
            return

        multi_run_mode = normalize_multi_run_mode(row.get("multi_run_mode"))
        if multi_run_mode != "off":
            self._process_job_multi_run(job_id, row, adapter, original_path, ext, total_pages)
            return

        with tempfile.TemporaryDirectory(prefix="rehearsal-omr-") as tmpdir:
            tmp_input = os.path.join(tmpdir, f"input{ext or '.png'}")
            out_dir = os.path.join(tmpdir, "out")
            os.makedirs(out_dir, exist_ok=True)
            shutil.copy2(original_path, tmp_input)

            is_pdf = ext.lower() == ".pdf" or row.get("mime_type") == "application/pdf"
            engine_input = tmp_input
            if not is_pdf and self.config.preprocess and self.config.preprocess_mode != "off":
                prepped_img = os.path.join(tmpdir, "input-prepped.png")
                if self._preprocess_image(tmp_input, prepped_img):
                    engine_input = prepped_img

            progress = 12
            self._update_job(
                job_id,
                progress=progress,
                stage="running_omr",
                stage_detail=(
                    f"Opening PDF ({total_pages} pages)…"
                    if total_pages and total_pages > 1
                    else "Starting sheet music scanner…"
                ),
            )

            # Strict AGPL v3 isolation: external CLI subprocess invocation only.
            scan_mode = normalize_scan_mode(row.get("scan_mode"))
            enable_ocr = scan_mode != "notes-only"
            effective_timeout = self._effective_timeout(total_pages)

            skipped_pages: List[int] = []
            recovered_pages: List[int] = []
            warning_msg = ""
            export_file: Optional[str] = None
            log_tail: "collections.deque[str]" = collections.deque(maxlen=120)

            run_direct = getattr(adapter, "run_direct", None)
            if hasattr(adapter, "run_direct") and callable(run_direct):
                exp, err = run_direct(engine_input, out_dir, timeout_sec=effective_timeout)
                if err or not exp or not os.path.isfile(exp):
                    self._fail_job(
                        job_id,
                        "ENGINE_ERROR",
                        err or ENGINE_ERROR_MSG,
                        log_lines=[err] if err else None,
                    )
                    return
                export_file = exp
            else:
                cmd = adapter.build_command(engine_input, out_dir, enable_ocr=enable_ocr)
                timed_out = threading.Event()
                sub_env = self._build_sub_env(enable_ocr)

                try:
                    proc = subprocess.Popen(
                        cmd,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.STDOUT,
                        text=True,
                        encoding="utf-8",
                        errors="replace",
                        bufsize=1,
                        start_new_session=True,
                        env=sub_env,
                    )
                except (FileNotFoundError, PermissionError, OSError):
                    self._fail_job(job_id, "ENGINE_UNAVAILABLE", ENGINE_UNAVAILABLE_MSG)
                    return

                def _on_timeout() -> None:
                    timed_out.set()
                    try:
                        os.killpg(proc.pid, signal.SIGKILL)
                    except OSError:
                        try:
                            proc.kill()
                        except OSError:
                            pass

                timer = threading.Timer(effective_timeout, _on_timeout)
                timer.daemon = True
                timer.start()

                current_page: Optional[int] = None
                invalid_pages: set[int] = set()
                stored_pages: set[int] = set()
                page_reached: set[int] = set()
                num_steps = max(1, len(AUDIVERIS_STEPS))
                try:
                    if proc.stdout is not None:
                        for raw_line in proc.stdout:
                            if timed_out.is_set():
                                break
                            line = raw_line.strip()
                            if not line:
                                continue
                            log_tail.append(line)

                            m_stored = _STORED_SHEET_RE.search(line)
                            if m_stored:
                                stored_pages.add(int(m_stored.group(1)))

                            m_invalid = _INVALID_SHEET_RE.search(line)
                            if m_invalid:
                                invalid_pages.add(int(m_invalid.group(1)))
                                continue

                            if (
                                current_page is not None
                                and current_page not in page_reached
                                and ("Exception" in line or "Caused by:" in line)
                            ):
                                m_sheet_in_err = re.search(r"#(\d+)\b", line)
                                err_page = int(m_sheet_in_err.group(1)) if m_sheet_in_err else current_page
                                if err_page not in page_reached:
                                    invalid_pages.add(err_page)

                            m_sheets = _SHEETS_IN_RE.search(line)
                            if m_sheets:
                                detected = max(1, int(m_sheets.group(1)))
                                if total_pages != detected:
                                    total_pages = detected
                                    self._update_job(
                                        job_id,
                                        total_pages=total_pages,
                                        stage_detail=f"Opening PDF ({total_pages} pages)…",
                                    )
                                continue

                            m_step = _STEP_MON_RE.search(line)
                            if m_step:
                                sheet_idx = max(1, int(m_step.group(1)))
                                step_name = m_step.group(2).upper()
                                if step_name in ("PAGE", "SCORE", "EXPORT"):
                                    page_reached.add(sheet_idx)
                                current_page = sheet_idx
                                pages = max(total_pages or 1, sheet_idx)
                                if total_pages is None or sheet_idx > total_pages:
                                    total_pages = pages
                                if step_name == "EXPORT" and sheet_idx >= pages:
                                    progress = max(progress, 90)
                                    self._update_job(
                                        job_id,
                                        progress=progress,
                                        stage="exporting",
                                        stage_detail="Exporting MusicXML…",
                                        current_page=current_page,
                                        total_pages=total_pages,
                                    )
                                else:
                                    step_pos = _AUDIVERIS_STEP_INDEX.get(step_name, 0) / float(num_steps)
                                    fraction = min(1.0, ((sheet_idx - 1) + step_pos) / float(pages))
                                    computed = 12 + int(round(fraction * 76))
                                    progress = max(progress, min(88, computed))
                                    detail = _friendly_step_detail(step_name, current_page, total_pages)
                                    self._update_job(
                                        job_id,
                                        progress=progress,
                                        stage="running_omr",
                                        stage_detail=detail,
                                        current_page=current_page,
                                        total_pages=total_pages,
                                    )
                                continue

                            lower_line = line.lower()
                            if any(
                                tok in lower_line
                                for tok in (
                                    "partwisebuilder",
                                    "exporting sheet",
                                    "scoreexporter",
                                    "exported to ",
                                )
                            ):
                                progress = max(progress, 90)
                                self._update_job(
                                    job_id,
                                    progress=progress,
                                    stage="exporting",
                                    stage_detail="Exporting MusicXML…",
                                )
                    returncode = proc.wait()
                finally:
                    timer.cancel()
                    if proc.stdout is not None:
                        try:
                            proc.stdout.close()
                        except OSError:
                            pass

                if timed_out.is_set():
                    self._fail_job(job_id, "ENGINE_TIMEOUT", ENGINE_TIMEOUT_MSG, log_lines=log_tail)
                    return

                if returncode != 0:
                    # Per-page adaptive 400 DPI retry for any invalid PDF sheets when renderer is available
                    if is_pdf and invalid_pages and self.config.preprocess and self.config.preprocess_mode != "off":
                        for p_num in sorted(list(invalid_pages)):
                            retry_dir = os.path.join(tmpdir, f"retry-{p_num}")
                            retry_out = os.path.join(retry_dir, "out")
                            os.makedirs(retry_out, exist_ok=True)
                            self._update_job(
                                job_id,
                                stage="running_omr",
                                stage_detail=f"Retrying page {p_num} at 400 DPI…",
                            )
                            retry_png = self._render_pdf_page_for_retry(tmp_input, p_num, retry_dir, dpi=400)
                            if not retry_png:
                                continue
                            retry_cmd = adapter.build_command(retry_png, retry_out, enable_ocr=enable_ocr)
                            try:
                                retry_proc = subprocess.run(
                                    retry_cmd,
                                    stdout=subprocess.PIPE,
                                    stderr=subprocess.STDOUT,
                                    text=True,
                                    encoding="utf-8",
                                    errors="replace",
                                    timeout=max(30.0, min(90.0, self.config.job_timeout)),
                                    check=False,
                                    env=sub_env,
                                )
                            except (subprocess.TimeoutExpired, FileNotFoundError, PermissionError, OSError):
                                continue
                            if retry_proc.returncode == 0:
                                retry_exp = adapter.find_output(retry_out, input_stem=os.path.splitext(os.path.basename(retry_png))[0])
                                if retry_exp and os.path.isfile(retry_exp):
                                    try:
                                        with open(retry_exp, "rb") as rf:
                                            rb = rf.read()
                                        rxml = extract_musicxml_from_mxl_bytes(rb) if retry_exp.lower().endswith(".mxl") else decode_xml_bytes(rb)
                                        ok_xml, _ = validate_musicxml(rxml)
                                        if ok_xml:
                                            recovered_pages.append(p_num)
                                            if (total_pages or 1) == 1:
                                                export_file = retry_exp
                                    except Exception:
                                        pass

                    omr_file = find_omr_project_file(out_dir, input_stem="input")
                    omr_valid: List[int] = []
                    omr_invalid: List[int] = []
                    if omr_file:
                        omr_valid, omr_invalid = inspect_omr_pages(omr_file)
                        if not omr_valid and stored_pages:
                            omr_valid = sorted(stored_pages - invalid_pages - set(omr_invalid))
                        if page_reached and omr_valid:
                            omr_valid = [p for p in omr_valid if p in page_reached and p not in invalid_pages]

                    max_pages = max(
                        total_pages or 0,
                        max(invalid_pages) if invalid_pages else 0,
                        max(omr_valid) if omr_valid else 0,
                        max(omr_invalid) if omr_invalid else 0,
                        max(stored_pages) if stored_pages else 0,
                    )
                    if export_file is None and omr_file and (omr_valid or (invalid_pages and max_pages > len(invalid_pages))):
                        if omr_valid:
                            valid_pages = sorted(set(omr_valid) - invalid_pages)
                        else:
                            valid_pages = [
                                p for p in range(1, max_pages + 1) if p not in invalid_pages
                            ]
                        if not valid_pages:
                            self._fail_job(job_id, "ENGINE_ERROR", ENGINE_ERROR_MSG, log_lines=log_tail)
                            return
                        all_pages = set(range(1, max_pages + 1)) if max_pages > 0 else set(valid_pages)
                        skipped_pages = sorted((all_pages - set(valid_pages)) | invalid_pages | set(omr_invalid))
                        skipped_label = ", ".join(str(p) for p in skipped_pages)
                        progress = max(progress, 90)
                        self._update_job(
                            job_id,
                            progress=progress,
                            stage="exporting",
                            stage_detail=(
                                f"Skipping unreadable page(s) {skipped_label} — exporting {len(valid_pages)} valid page(s)…"
                                if skipped_pages
                                else f"Exporting {len(valid_pages)} valid page(s)…"
                            ),
                        )
                        cmd2 = adapter.build_export_sheets_command(omr_file, valid_pages, out_dir)
                        if not cmd2:
                            self._fail_job(job_id, "ENGINE_ERROR", ENGINE_ERROR_MSG, log_lines=log_tail)
                            return
                        try:
                            proc2 = subprocess.run(
                                cmd2,
                                stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT,
                                text=True,
                                encoding="utf-8",
                                errors="replace",
                                timeout=60.0,
                                check=False,
                                env=sub_env,
                            )
                        except (subprocess.TimeoutExpired, FileNotFoundError, PermissionError, OSError):
                            self._fail_job(job_id, "ENGINE_ERROR", ENGINE_ERROR_MSG, log_lines=log_tail)
                            return
                        if proc2.stdout:
                            for ln in proc2.stdout.splitlines():
                                if ln.strip():
                                    log_tail.append(ln.strip())
                        if proc2.returncode != 0:
                            self._fail_job(job_id, "ENGINE_ERROR", ENGINE_ERROR_MSG, log_lines=log_tail)
                            return
                        if len(skipped_pages) == 1:
                            warning_msg = (
                                f"Skipped page {skipped_pages[0]} (no readable staves found). "
                                f"Exported the remaining {len(valid_pages)} pages."
                            )
                        elif len(skipped_pages) > 1:
                            warning_msg = (
                                f"Skipped pages {skipped_label} (no readable staves found). "
                                f"Exported the remaining {len(valid_pages)} pages."
                            )
                    elif export_file is None:
                        # Fallback: if a valid .mxl/.musicxml was already exported before exit, use it.
                        candidate = adapter.find_output(out_dir, input_stem="input")
                        if candidate and os.path.isfile(candidate):
                            export_file = candidate
                        else:
                            self._fail_job(job_id, "ENGINE_ERROR", ENGINE_ERROR_MSG, log_lines=log_tail)
                            return

            progress = max(progress, 95)
            self._update_job(
                job_id,
                progress=progress,
                stage="validating_output",
                stage_detail="Checking extracted notes…",
            )

            if export_file is None:
                export_file = adapter.find_output(out_dir, input_stem="input")
            if not export_file or not os.path.isfile(export_file):
                self._fail_job(job_id, "NO_USABLE_OUTPUT", NO_USABLE_OUTPUT_MSG, log_lines=log_tail)
                return

            try:
                with open(export_file, "rb") as f:
                    raw_bytes = f.read()
            except OSError:
                self._fail_job(job_id, "NO_USABLE_OUTPUT", NO_USABLE_OUTPUT_MSG)
                return

            if not raw_bytes:
                self._fail_job(job_id, "NO_USABLE_OUTPUT", NO_USABLE_OUTPUT_MSG)
                return

            is_mxl = export_file.lower().endswith(".mxl")
            try:
                if is_mxl:
                    xml_text = extract_musicxml_from_mxl_bytes(raw_bytes)
                else:
                    xml_text = decode_xml_bytes(raw_bytes)
            except (zipfile.BadZipFile, ET.ParseError, ValueError, KeyError, UnicodeDecodeError):
                self._fail_job(job_id, "NO_USABLE_OUTPUT", NO_USABLE_OUTPUT_MSG)
                return

            valid, _reason = validate_musicxml(xml_text)
            if not valid:
                self._fail_job(job_id, "NO_USABLE_OUTPUT", NO_USABLE_OUTPUT_MSG)
                return

            jdir = self._job_dir(job_id)
            raw_dest = os.path.join(jdir, "raw.mxl" if is_mxl else "raw.musicxml")
            with open(raw_dest, "wb") as f:
                f.write(raw_bytes)

            pdf_meta: Dict[str, Any] = {}
            spoken_cues: List[Dict[str, Any]] = []
            if is_pdf and enable_ocr:
                prep_bin = self._ensure_preprocess_bin()
                pdf_meta = extract_pdf_text_metadata(original_path, prep_bin=prep_bin)
                spoken_cues = pdf_meta.get("spokenCues", [])

            self._update_job(
                job_id,
                status="completed",
                progress=100,
                stage="completed",
                stage_detail="Scan complete.",
                skipped_pages_json=json.dumps(skipped_pages),
                spoken_cues_json=json.dumps(spoken_cues),
                pdf_text_meta_json=json.dumps(pdf_meta),
                warning=warning_msg,
                raw_path=raw_dest,
                raw_musicxml=xml_text,
                error="",
                error_code="",
                completed_at=utc_now_iso(),
            )

    def verify_member_token(self, token: str) -> Optional[Tuple[str, str]]:
        """
        Verify a Rehearsal member token against REHEARSAL_AUTH_API:
        first /api/auth/teacher/me (Google/email sign-in), then /api/auth/student/me
        (student access code or Google sign-in).
        Returns (owner_type, owner_id) or None.
        """
        if not token:
            return None
        base = self.config.auth_api.rstrip("/")
        checks = (
            ("teacher", f"{base}/api/auth/teacher/me"),
            ("student", f"{base}/api/auth/student/me"),
        )
        for kind, url in checks:
            req = urllib.request.Request(
                url,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/json",
                },
                method="GET",
            )
            try:
                with urllib.request.urlopen(req, timeout=self.config.auth_timeout) as resp:
                    if resp.status != 200:
                        continue
                    payload = json.loads(resp.read().decode("utf-8"))
                    if not isinstance(payload, dict):
                        continue
                    if payload.get("ok") is False:
                        continue
                    obj = payload.get(kind)
                    if isinstance(obj, dict) and obj.get("id") is not None:
                        return (kind, str(obj["id"]))
                    if payload.get("id") is not None:
                        return (kind, str(payload["id"]))
                    if payload.get("ok") is True:
                        return (kind, kind)
            except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ValueError, OSError):
                continue
        return None

    def resolve_auth(
        self, auth_header: Optional[str]
    ) -> Tuple[bool, Optional[Tuple[str, str]]]:
        """
        Resolve caller auth according to OMR_AUTH_MODE.
        Returns (authorized, owner_tuple_or_None).
        When auth_mode == 'required', a valid Bearer token is mandatory.
        When auth_mode == 'optional', a missing token uses ('local', 'local')
        for saves (None for unfiltered library reads), while a provided token
        is still verified against REHEARSAL_AUTH_API.
        """
        token = ""
        if auth_header:
            parts = auth_header.strip().split(None, 1)
            if len(parts) == 2 and parts[0].lower() == "bearer":
                token = parts[1].strip()
            else:
                return False, None

        if token:
            identity = self.verify_member_token(token)
            if identity is None:
                return False, None
            return True, identity

        if self.config.auth_mode == "required":
            return False, None

        return True, None

    def confirm_job(
        self,
        job_id: str,
        payload: Dict[str, Any],
        identity: Optional[Tuple[str, str]],
    ) -> Tuple[int, Dict[str, Any]]:
        row = self.get_job_row(job_id)
        if not row:
            return 404, {
                "ok": False,
                "errorCode": "JOB_NOT_FOUND",
                "error": "Scan job not found.",
            }
        if row["status"] != "completed":
            return 409, {
                "ok": False,
                "errorCode": "JOB_NOT_READY",
                "error": "Only completed scans can be confirmed.",
            }

        flagged_log = payload.get("flaggedLog")
        if flagged_log is None:
            flagged_log = []
        if not isinstance(flagged_log, list):
            return 400, {
                "ok": False,
                "errorCode": "INVALID_FLAGGED_LOG",
                "error": "flaggedLog must be a list.",
            }

        unresolved: List[Any] = []
        for idx, entry in enumerate(flagged_log):
            if not isinstance(entry, dict):
                unresolved.append(idx)
                continue
            if entry.get("flagged") is False:
                continue
            visited = entry.get("visited") is True
            status = entry.get("status")
            if not (visited and status in ("confirmed", "fixed")):
                unresolved.append(entry.get("measureNumber", entry.get("measureIndex", idx)))

        if unresolved:
            return 400, {
                "ok": False,
                "errorCode": "UNRESOLVED_FLAGS",
                "error": "Review and confirm or fix every flagged measure before saving.",
                "unresolvedCount": len(unresolved),
                "unresolvedMeasures": unresolved,
            }

        corrected_xml = payload.get("correctedXml")
        corrected_mxl_b64 = payload.get("correctedMxlBase64")
        mxl_bytes: Optional[bytes] = None

        if corrected_mxl_b64:
            if not isinstance(corrected_mxl_b64, str):
                return 400, {
                    "ok": False,
                    "errorCode": "INVALID_MXL",
                    "error": "correctedMxlBase64 must be a base64 string.",
                }
            try:
                mxl_bytes = base64.b64decode(corrected_mxl_b64, validate=True)
                extracted_xml = extract_musicxml_from_mxl_bytes(mxl_bytes)
            except Exception:
                return 400, {
                    "ok": False,
                    "errorCode": "INVALID_MXL",
                    "error": "correctedMxlBase64 is not a valid .mxl archive.",
                }
            if not corrected_xml:
                corrected_xml = extracted_xml

        if not corrected_xml or not isinstance(corrected_xml, str):
            return 400, {
                "ok": False,
                "errorCode": "INVALID_MUSICXML",
                "error": "correctedXml is required.",
            }

        valid, _reason = validate_musicxml(corrected_xml)
        if not valid:
            return 400, {
                "ok": False,
                "errorCode": "INVALID_MUSICXML",
                "error": "Corrected score is not valid MusicXML.",
            }

        if mxl_bytes is None:
            mxl_bytes = package_musicxml_to_mxl(corrected_xml)

        owner_type, owner_id = identity if identity is not None else ("local", "local")
        confirmed_at = (
            str(payload.get("confirmedAt")).strip()
            if payload.get("confirmedAt")
            else utc_now_iso()
        )
        title = str(payload.get("title") or row["title"] or "").strip()
        instrument = str(payload.get("instrument") or row["instrument"] or "").strip()

        jdir = self._job_dir(job_id)
        corrected_xml_path = os.path.join(jdir, "corrected.musicxml")
        corrected_mxl_path = os.path.join(jdir, "corrected.mxl")
        flagged_log_path = os.path.join(jdir, "flagged-log.json")

        with open(corrected_xml_path, "w", encoding="utf-8") as f:
            f.write(corrected_xml)
        with open(corrected_mxl_path, "wb") as f:
            f.write(mxl_bytes)
        with open(flagged_log_path, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "jobId": job_id,
                    "confirmedAt": confirmed_at,
                    "ownerType": owner_type,
                    "ownerId": owner_id,
                    "flaggedLog": flagged_log,
                },
                f,
                indent=2,
            )

        now = utc_now_iso()
        flagged_json = json.dumps(flagged_log)
        upload_hash = row["upload_hash"]
        cache_key = scan_cache_key(upload_hash, row.get("scan_mode") or "full")

        with self._db_lock:
            conn = self._connect()
            try:
                conn.execute(
                    """
                    UPDATE scan_jobs
                    SET title = ?,
                        instrument = ?,
                        corrected_path = ?,
                        corrected_mxl_path = ?,
                        corrected_musicxml = ?,
                        flagged_log_json = ?,
                        verified = 1,
                        owner_type = ?,
                        owner_id = ?,
                        confirmed_at = ?,
                        updated_at = ?
                    WHERE job_id = ?
                    """,
                    (
                        title,
                        instrument,
                        corrected_xml_path,
                        corrected_mxl_path,
                        corrected_xml,
                        flagged_json,
                        owner_type,
                        owner_id,
                        confirmed_at,
                        now,
                        job_id,
                    ),
                )
                conn.execute(
                    """
                    INSERT INTO verified_cache (
                        upload_hash, source_job_id, title, instrument, musicxml,
                        corrected_mxl_path, owner_type, owner_id, confirmed_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(upload_hash) DO UPDATE SET
                        source_job_id = excluded.source_job_id,
                        title = excluded.title,
                        instrument = excluded.instrument,
                        musicxml = excluded.musicxml,
                        corrected_mxl_path = excluded.corrected_mxl_path,
                        owner_type = excluded.owner_type,
                        owner_id = excluded.owner_id,
                        confirmed_at = excluded.confirmed_at,
                        updated_at = excluded.updated_at
                    """,
                    (
                        cache_key,
                        job_id,
                        title,
                        instrument,
                        corrected_xml,
                        corrected_mxl_path,
                        owner_type,
                        owner_id,
                        confirmed_at,
                        now,
                    ),
                )
                conn.commit()
            finally:
                conn.close()

        return 200, {
            "ok": True,
            "jobId": job_id,
            "verified": True,
            "confirmedAt": confirmed_at,
            "correctedMxlUrl": f"/api/scan/jobs/{job_id}/corrected.mxl",
            "uploadHash": upload_hash,
        }

    def list_library(self, identity: Optional[Tuple[str, str]]) -> List[Dict[str, Any]]:
        with self._db_lock:
            conn = self._connect()
            try:
                if identity is not None:
                    rows = conn.execute(
                        """
                        SELECT * FROM scan_jobs
                        WHERE verified = 1 AND owner_type = ? AND owner_id = ?
                        ORDER BY confirmed_at DESC, created_at DESC
                        """,
                        (identity[0], identity[1]),
                    ).fetchall()
                else:
                    rows = conn.execute(
                        """
                        SELECT * FROM scan_jobs
                        WHERE verified = 1
                        ORDER BY confirmed_at DESC, created_at DESC
                        """
                    ).fetchall()
            finally:
                conn.close()

        items: List[Dict[str, Any]] = []
        for r in rows:
            row = dict(r)
            job_id = row["job_id"]
            try:
                flagged_log = json.loads(row.get("flagged_log_json") or "[]")
            except Exception:
                flagged_log = []
            items.append(
                {
                    "jobId": job_id,
                    "title": row["title"],
                    "instrument": row["instrument"],
                    "filename": row["filename"],
                    "uploadHash": row["upload_hash"],
                    "verified": True,
                    "confirmedAt": row["confirmed_at"],
                    "createdAt": row["created_at"],
                    "ownerType": row["owner_type"],
                    "ownerId": row["owner_id"],
                    "flaggedCount": len(flagged_log),
                    "correctedMxlUrl": f"/api/scan/jobs/{job_id}/corrected.mxl",
                    "originalUrl": f"/api/scan/jobs/{job_id}/original",
                }
            )
        return items

    @staticmethod
    def _load_verify_measures_module() -> Any:
        bench_path = os.path.abspath(
            os.path.join(
                os.path.dirname(os.path.abspath(__file__)),
                "..",
                "omr-bench",
                "verify_measures.py",
            )
        )
        if not os.path.isfile(bench_path):
            raise FileNotFoundError(f"verify_measures.py not found at {bench_path}")
        mod_name = "rehearsal_omr_verify_measures"
        if mod_name in sys.modules:
            return sys.modules[mod_name]
        spec = importlib.util.spec_from_file_location(mod_name, bench_path)
        if spec is None or spec.loader is None:
            raise ImportError(f"Unable to load {bench_path}")
        mod = importlib.util.module_from_spec(spec)
        sys.modules[mod_name] = mod
        spec.loader.exec_module(mod)
        return mod

    def verify_job_measures(
        self,
        job_id: str,
        measures: List[int],
        model_name: Optional[str] = None,
    ) -> Tuple[int, Dict[str, Any]]:
        api_key = (
            os.environ.get("GEMINI_API_KEY")
            or os.environ.get("GOOGLE_API_KEY")
            or ""
        ).strip()
        if not api_key:
            return 503, {
                "ok": False,
                "errorCode": "AI_VERIFY_UNAVAILABLE",
                "error": "Set GEMINI_API_KEY on the scan server to enable AI measure verification.",
            }

        row = self.get_job_row(job_id)
        if not row:
            return 404, {
                "ok": False,
                "errorCode": "JOB_NOT_FOUND",
                "error": "Scan job not found.",
            }
        if row["status"] != "completed":
            return 409, {
                "ok": False,
                "errorCode": "JOB_NOT_READY",
                "error": "Only completed scans can be verified.",
            }

        original_path = row.get("original_path") or ""
        is_pdf = original_path.lower().endswith(".pdf") or row.get("mime_type") == "application/pdf"
        if not is_pdf or not os.path.isfile(original_path):
            return 400, {
                "ok": False,
                "errorCode": "PDF_REQUIRED",
                "error": "AI measure verification requires a PDF upload.",
            }

        xml_text = row.get("corrected_musicxml") or row.get("raw_musicxml") or ""
        if not xml_text.strip() and row.get("raw_path") and os.path.isfile(row["raw_path"]):
            try:
                with open(row["raw_path"], "rb") as rf:
                    raw_bytes = rf.read()
                xml_text = (
                    extract_musicxml_from_mxl_bytes(raw_bytes)
                    if row["raw_path"].lower().endswith(".mxl")
                    else decode_xml_bytes(raw_bytes)
                )
            except Exception:
                xml_text = ""
        if not xml_text.strip():
            return 400, {
                "ok": False,
                "errorCode": "NO_MUSICXML",
                "error": "No MusicXML is available for this scan job.",
            }

        cleaned_indices: List[int] = []
        seen_idx: set[int] = set()
        for m in measures:
            try:
                idx = int(m)
            except (TypeError, ValueError):
                continue
            if idx >= 0 and idx not in seen_idx:
                seen_idx.add(idx)
                cleaned_indices.append(idx)
            if len(cleaned_indices) >= 12:
                break

        if not cleaned_indices:
            return 400, {
                "ok": False,
                "errorCode": "INVALID_MEASURES",
                "error": "Provide at least one 0-based measure index.",
            }

        eff_model = (model_name or "").strip() or "gemini-3.5-flash-lite"

        try:
            vm = self._load_verify_measures_module()
            boxes = vm.extract_measure_boxes(xml_text)
            parsed = vm.parse_score_via_jsc(xml_text)
        except Exception as exc:
            return 500, {
                "ok": False,
                "errorCode": "AI_VERIFY_FAILED",
                "error": f"Could not inspect score measures: {exc}",
            }

        with tempfile.TemporaryDirectory(prefix="rehearsal-ai-verify-") as crop_dir:
            crop_boxes: List[Dict[str, Any]] = []
            items: List[Dict[str, Any]] = []
            parsed_measures = parsed.get("measures") or []
            for idx in cleaned_indices:
                if idx < 0 or idx >= len(boxes):
                    continue
                box = boxes[idx]
                m_info = (
                    parsed_measures[idx]
                    if idx < len(parsed_measures)
                    else {
                        "parts": [],
                        "flagged": False,
                        "findings": [],
                        "keyFifths": 0,
                        "timeSig": "4/4",
                    }
                )
                parts = m_info.get("parts") or []
                vocal_chords = sum(p.get("chords", 0) for p in parts[:-1]) if len(parts) > 1 else 0
                crop_boxes.append(box)
                item = {
                    "index": idx,
                    "measure": box["measure"],
                    "page": box["page"],
                    "image": os.path.join(crop_dir, f"m{idx + 1:03d}.png"),
                    "keyFifths": m_info.get("keyFifths", 0),
                    "timeSig": m_info.get("timeSig", "4/4"),
                    "flagged": bool(m_info.get("flagged")),
                    "vocalChords": vocal_chords,
                    "findings": m_info.get("findings") or [],
                    "parts": parts,
                }
                item["prompt"] = vm.build_prompt(item)
                items.append(item)

            if not items:
                return 400, {
                    "ok": False,
                    "errorCode": "MEASURES_OUT_OF_RANGE",
                    "error": "Requested measure indices are out of range for this score.",
                }

            try:
                vm.compile_and_crop(original_path, crop_boxes, crop_dir, 220)
            except Exception as exc:
                return 500, {
                    "ok": False,
                    "errorCode": "AI_VERIFY_FAILED",
                    "error": f"Could not crop requested PDF measures: {exc}",
                }

            results_by_idx: Dict[int, Dict[str, Any]] = {}
            max_w = min(4, max(1, len(items)))
            with concurrent.futures.ThreadPoolExecutor(max_workers=max_w) as pool:
                fut_map = {
                    pool.submit(vm.verify_measure_gemini, it, it["image"], api_key, eff_model): it
                    for it in items
                }
                for fut in concurrent.futures.as_completed(fut_map):
                    it = fut_map[fut]
                    try:
                        res = fut.result()
                    except Exception as exc:
                        res = {"measure": it["measure"], "status": "error", "error": str(exc)}
                    if isinstance(res, dict):
                        res = dict(res)
                        res.setdefault("measureIndex", it["index"])
                    results_by_idx[it["index"]] = res

        results: List[Dict[str, Any]] = []
        patches: List[Dict[str, Any]] = []
        for it in items:
            res = results_by_idx[it["index"]]
            results.append(res)
            if res.get("status") == "verified" and isinstance(res.get("result"), dict):
                raw_patches = res["result"].get("patches")
                if isinstance(raw_patches, list):
                    for p in raw_patches:
                        if isinstance(p, dict):
                            patch_copy = dict(p)
                            patch_copy.setdefault("measureIndex", it["index"])
                            patches.append(patch_copy)

        return 200, {
            "ok": True,
            "model": eff_model,
            "checked": len(results),
            "results": results,
            "patches": patches,
        }


JOB_ID_RE = re.compile(r"^[a-f0-9-]{8,64}$")
HASH_RE = re.compile(r"^[a-f0-9]{16,128}$")


class OMRRequestHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    @property
    def service(self) -> OMRService:
        return self.server.service  # type: ignore[attr-defined]

    def log_message(self, format: str, *args: Any) -> None:
        if os.environ.get("OMR_QUIET_LOGS") == "1":
            return
        super().log_message(format, *args)

    def _cors_origin(self) -> str:
        allowed = self.service.config.cors_origins
        if allowed == "*":
            return "*"
        req_origin = self.headers.get("Origin", "").strip()
        origins = [o.strip() for o in allowed.split(",") if o.strip()]
        if req_origin and req_origin in origins:
            return req_origin
        return origins[0] if origins else "*"

    def _send_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", self._cors_origin())
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header(
            "Access-Control-Allow-Headers",
            "Authorization, Content-Type, X-Filename, X-Instrument, X-Title, X-Skip-Cache",
        )
        self.send_header("Access-Control-Max-Age", "86400")

    def _send_json(self, status: int, data: Dict[str, Any]) -> None:
        body = json.dumps(data).encode("utf-8")
        self.close_connection = True
        self.send_response(status)
        self._send_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def _send_bytes(
        self,
        status: int,
        data: bytes,
        content_type: str,
        filename: Optional[str] = None,
    ) -> None:
        self.close_connection = True
        self.send_response(status)
        self._send_cors_headers()
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Connection", "close")
        if filename:
            self.send_header(
                "Content-Disposition", f'attachment; filename="{filename}"'
            )
        self.end_headers()
        self.wfile.write(data)

    def _read_body(self, max_bytes: int) -> Tuple[Optional[bytes], Optional[str]]:
        raw_len = self.headers.get("Content-Length")
        if raw_len is None:
            return b"", None
        try:
            length = int(raw_len)
        except ValueError:
            return None, "Invalid Content-Length header."
        if length < 0:
            return None, "Invalid Content-Length header."
        if length > max_bytes:
            # Drain gently only if small; otherwise reject immediately
            return None, f"Payload exceeds limit of {max_bytes} bytes."
        if length == 0:
            return b"", None
        return self.rfile.read(length), None

    def do_OPTIONS(self) -> None:
        self.close_connection = True
        self.send_response(204)
        self._send_cors_headers()
        self.send_header("Content-Length", "0")
        self.send_header("Connection", "close")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urllib.parse.urlsplit(self.path)
        path = parsed.path

        if path == "/health":
            self._send_json(200, self.service.health_info())
            return

        if path == "/api/scan/library":
            ok, identity = self.service.resolve_auth(self.headers.get("Authorization"))
            if not ok:
                self._send_json(
                    401,
                    {
                        "ok": False,
                        "errorCode": "UNAUTHORIZED",
                        "error": "Sign in to Rehearsal to view your verified scan library.",
                    },
                )
                return
            items = self.service.list_library(identity)
            self._send_json(200, {"ok": True, "items": items})
            return

        m_cache = re.match(r"^/api/scan/cache/([^/]+)$", path)
        if m_cache:
            upload_hash = m_cache.group(1).lower()
            if not HASH_RE.match(upload_hash):
                self._send_json(
                    400,
                    {
                        "ok": False,
                        "errorCode": "INVALID_HASH",
                        "error": "Invalid upload hash.",
                    },
                )
                return
            cached = self.service.get_cache(upload_hash)
            if not cached:
                self._send_json(
                    200,
                    {
                        "ok": True,
                        "hit": False,
                        "uploadHash": upload_hash,
                        "title": None,
                        "instrument": None,
                        "musicxml": None,
                        "confirmedAt": None,
                    },
                )
                return
            self._send_json(
                200,
                {
                    "ok": True,
                    "hit": True,
                    "uploadHash": upload_hash,
                    "title": cached["title"],
                    "instrument": cached["instrument"],
                    "musicxml": cached["musicxml"],
                    "confirmedAt": cached["confirmed_at"],
                },
            )
            return

        m_job = re.match(r"^/api/scan/jobs/([^/]+)(?:/([^/]+))?$", path)
        if m_job:
            job_id = m_job.group(1)
            sub = m_job.group(2)
            if not JOB_ID_RE.match(job_id):
                self._send_json(
                    404,
                    {
                        "ok": False,
                        "errorCode": "JOB_NOT_FOUND",
                        "error": "Scan job not found.",
                    },
                )
                return
            row = self.service.get_job_row(job_id)
            if not row:
                self._send_json(
                    404,
                    {
                        "ok": False,
                        "errorCode": "JOB_NOT_FOUND",
                        "error": "Scan job not found.",
                    },
                )
                return

            if sub is None:
                self._send_json(200, self.service.format_job(row))
                return

            if sub == "original":
                orig_path = row.get("original_path") or ""
                if not orig_path or not os.path.isfile(orig_path):
                    self._send_json(
                        404,
                        {
                            "ok": False,
                            "errorCode": "NOT_FOUND",
                            "error": "Original upload not found.",
                        },
                    )
                    return
                with open(orig_path, "rb") as f:
                    data = f.read()
                self._send_bytes(200, data, row["mime_type"] or "application/octet-stream")
                return

            if sub == "raw":
                raw_path = row.get("raw_path") or ""
                if not raw_path or not os.path.isfile(raw_path):
                    self._send_json(
                        404,
                        {
                            "ok": False,
                            "errorCode": "NOT_FOUND",
                            "error": "Raw OMR output is not available for this job.",
                        },
                    )
                    return
                with open(raw_path, "rb") as f:
                    data = f.read()
                ctype = (
                    "application/vnd.recordare.musicxml"
                    if raw_path.lower().endswith(".mxl")
                    else "application/vnd.recordare.musicxml+xml"
                )
                self._send_bytes(200, data, ctype)
                return

            if sub == "corrected.mxl":
                mxl_path = row.get("corrected_mxl_path") or ""
                if not row.get("verified") or not mxl_path or not os.path.isfile(mxl_path):
                    self._send_json(
                        404,
                        {
                            "ok": False,
                            "errorCode": "NOT_FOUND",
                            "error": "Verified .mxl score has not been saved for this job.",
                        },
                    )
                    return
                with open(mxl_path, "rb") as f:
                    data = f.read()
                stem = _sanitize_download_stem(row.get("title") or row.get("filename") or job_id)
                self._send_bytes(
                    200,
                    data,
                    "application/vnd.recordare.musicxml",
                    filename=f"{stem}.mxl",
                )
                return

        self._send_json(
            404,
            {"ok": False, "errorCode": "NOT_FOUND", "error": "Endpoint not found."},
        )

    def do_POST(self) -> None:
        parsed = urllib.parse.urlsplit(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)

        if path == "/api/scan/jobs":
            self._handle_create_job(qs)
            return

        m_confirm = re.match(r"^/api/scan/jobs/([^/]+)/confirm$", path)
        if m_confirm:
            job_id = m_confirm.group(1)
            if not JOB_ID_RE.match(job_id):
                self._send_json(
                    404,
                    {
                        "ok": False,
                        "errorCode": "JOB_NOT_FOUND",
                        "error": "Scan job not found.",
                    },
                )
                return
            self._handle_confirm_job(job_id)
            return

        m_verify = re.match(r"^/api/scan/jobs/([^/]+)/verify-measures$", path)
        if m_verify:
            job_id = m_verify.group(1)
            if not JOB_ID_RE.match(job_id):
                self._send_json(
                    404,
                    {
                        "ok": False,
                        "errorCode": "JOB_NOT_FOUND",
                        "error": "Scan job not found.",
                    },
                )
                return
            self._handle_verify_measures(job_id)
            return

        self._send_json(
            404,
            {"ok": False, "errorCode": "NOT_FOUND", "error": "Endpoint not found."},
        )

    def _handle_create_job(self, qs: Dict[str, List[str]]) -> None:
        # Allow slight overhead for multipart headers above max_upload_bytes
        max_bytes = self.service.config.max_upload_bytes
        content_type = self.headers.get("Content-Type", "")
        is_multipart = content_type.lower().startswith("multipart/form-data")
        read_limit = max_bytes + (256 * 1024 if is_multipart else 0)

        body, err = self._read_body(read_limit)
        if err is not None or body is None:
            self._send_json(
                400,
                {
                    "ok": False,
                    "errorCode": "FILE_TOO_LARGE",
                    "error": err or "Invalid upload payload.",
                },
            )
            return

        if is_multipart:
            try:
                fields, file_part = parse_multipart_form_data(body, content_type)
            except ValueError as exc:
                self._send_json(
                    400,
                    {
                        "ok": False,
                        "errorCode": "INVALID_MULTIPART",
                        "error": str(exc),
                    },
                )
                return
            if file_part is None:
                self._send_json(
                    400,
                    {
                        "ok": False,
                        "errorCode": "MISSING_FILE",
                        "error": "Missing file field in multipart upload.",
                    },
                )
                return
            filename, mime_type, file_bytes = file_part
            instrument = fields.get("instrument", "")
            title = fields.get("title", "")
            scan_mode = fields.get("scanMode", "") or (qs.get("scanMode") or [""])[0]
            multi_run = fields.get("multiRun") or (qs.get("multiRun") or [None])[0]
            skip_cache = _parse_bool(fields.get("skipCache")) or _parse_bool(
                (qs.get("skipCache") or [None])[0]
            )
        else:
            file_bytes = body
            filename = self.headers.get("X-Filename", "")
            mime_type = content_type
            instrument = self.headers.get("X-Instrument", "")
            title = self.headers.get("X-Title", "")
            scan_mode = self.headers.get("X-Scan-Mode", "") or (qs.get("scanMode") or [""])[0]
            multi_run = self.headers.get("X-Multi-Run") or (qs.get("multiRun") or [None])[0]
            skip_cache = _parse_bool(self.headers.get("X-Skip-Cache")) or _parse_bool(
                (qs.get("skipCache") or [None])[0]
            )

        ext, norm_mime, err_code, err_msg = validate_upload(
            filename, mime_type, file_bytes, max_bytes
        )
        if err_code or not ext or not norm_mime:
            self._send_json(
                400,
                {
                    "ok": False,
                    "errorCode": err_code or "INVALID_UPLOAD",
                    "error": err_msg or "Invalid upload.",
                },
            )
            return

        result = self.service.create_job(
            filename=filename or f"upload{ext}",
            mime_type=norm_mime,
            ext=ext,
            data=file_bytes,
            instrument=instrument,
            title=title,
            skip_cache=skip_cache,
            scan_mode=scan_mode,
            multi_run_mode=multi_run,
        )
        self._send_json(202, result)

    def _handle_confirm_job(self, job_id: str) -> None:
        ok, identity = self.service.resolve_auth(self.headers.get("Authorization"))
        if not ok:
            self._send_json(
                401,
                {
                    "ok": False,
                    "errorCode": "UNAUTHORIZED",
                    "error": "Sign in to Rehearsal as a teacher or student to save verified scans.",
                },
            )
            return

        body, err = self._read_body(25 * 1024 * 1024)
        if err is not None or body is None:
            self._send_json(
                400,
                {
                    "ok": False,
                    "errorCode": "INVALID_BODY",
                    "error": err or "Invalid request body.",
                },
            )
            return

        try:
            payload = json.loads(body.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self._send_json(
                400,
                {
                    "ok": False,
                    "errorCode": "INVALID_JSON",
                    "error": "Request body must be valid JSON.",
                },
            )
            return

        if not isinstance(payload, dict):
            self._send_json(
                400,
                {
                    "ok": False,
                    "errorCode": "INVALID_JSON",
                    "error": "Request body must be a JSON object.",
                },
            )
            return

        status, resp = self.service.confirm_job(job_id, payload, identity)
        self._send_json(status, resp)

    def _handle_verify_measures(self, job_id: str) -> None:
        ok, _identity = self.service.resolve_auth(self.headers.get("Authorization"))
        if not ok:
            self._send_json(
                401,
                {
                    "ok": False,
                    "errorCode": "UNAUTHORIZED",
                    "error": "Sign in to Rehearsal to verify measures with AI.",
                },
            )
            return

        body, err = self._read_body(1024 * 1024)
        if err is not None or body is None:
            self._send_json(
                400,
                {
                    "ok": False,
                    "errorCode": "INVALID_BODY",
                    "error": err or "Invalid request body.",
                },
            )
            return

        try:
            payload = json.loads(body.decode("utf-8")) if body.strip() else {}
        except (ValueError, UnicodeDecodeError):
            self._send_json(
                400,
                {
                    "ok": False,
                    "errorCode": "INVALID_JSON",
                    "error": "Request body must be valid JSON.",
                },
            )
            return

        if not isinstance(payload, dict):
            self._send_json(
                400,
                {
                    "ok": False,
                    "errorCode": "INVALID_JSON",
                    "error": "Request body must be a JSON object.",
                },
            )
            return

        raw_measures = payload.get("measures", [])
        if not isinstance(raw_measures, list):
            self._send_json(
                400,
                {
                    "ok": False,
                    "errorCode": "INVALID_MEASURES",
                    "error": "measures must be a list of 0-based measure indices.",
                },
            )
            return

        model_raw = payload.get("model")
        model_name = (
            model_raw.strip() if isinstance(model_raw, str) and model_raw.strip() else None
        )
        status, resp = self.service.verify_job_measures(
            job_id, raw_measures, model_name=model_name
        )
        self._send_json(status, resp)


class OMRHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self, server_address: Tuple[str, int], service: OMRService) -> None:
        self.service = service
        super().__init__(server_address, OMRRequestHandler)

    def server_close(self) -> None:
        try:
            super().server_close()
        finally:
            self.service.stop()


def create_server(config: Optional[OMRConfig] = None) -> OMRHTTPServer:
    cfg = config if config is not None else load_config_from_env()
    service = OMRService(cfg)
    return OMRHTTPServer((cfg.host, cfg.port), service)


def main() -> int:
    cfg = load_config_from_env()
    server = create_server(cfg)
    host, port = server.server_address[:2]

    def _handle_sig(_signum: int, _frame: Any) -> None:
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGINT, _handle_sig)
    signal.signal(signal.SIGTERM, _handle_sig)

    engine_state = (
        f"ready ({' '.join(cfg.resolved_engine_cmd() or [])})"
        if cfg.engine_available()
        else "NOT FOUND (install Audiveris 5.x or set AUDIVERIS_BIN)"
    )
    ocr_state = (
        f"ready ({cfg.tessdata_dir})"
        if cfg.tessdata_dir
        else "NOT FOUND (lyrics/text OCR disabled; install eng.traineddata or set TESSDATA_PREFIX)"
    )
    print(f"Rehearsal OMR Service v{SERVICE_VERSION} listening on http://{host}:{port}")
    print(f"  Data dir : {cfg.data_dir}")
    print(f"  Auth mode: {cfg.auth_mode} (auth API: {cfg.auth_api})")
    print(f"  Engine   : {engine_state}")
    print(f"  OCR      : {ocr_state}")
    try:
        server.serve_forever()
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
