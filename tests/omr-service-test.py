#!/usr/bin/env python3
"""
Automated test suite for tools/omr-service/server.py.
Uses Python 3.9+ stdlib only, ephemeral localhost ports (127.0.0.1:0),
and tempfile.TemporaryDirectory() — zero network calls or external deps.

Usage: /usr/bin/python3 tests/omr-service-test.py
"""

from __future__ import annotations

import base64
import email.parser
import hashlib
import io
import json
import os
import socket
import stat
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional, Tuple

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OMR_DIR = os.path.join(ROOT, "tools", "omr-service")
DEMO_XML_PATH = os.path.join(ROOT, "web", "demo", "ode-to-joy.musicxml")

sys.path.insert(0, OMR_DIR)
os.environ["OMR_QUIET_LOGS"] = "1"

import server as omr_server  # noqa: E402


FAKE_CLI_SCRIPT = """#!/usr/bin/env python3
import io
import os
import sys
import time
import xml.etree.ElementTree as ET
import zipfile
import zlib

# Parse Audiveris-compatible CLI arguments:
#   -batch -export -output <out_dir> -- <input_file>
args = sys.argv[1:]
out_dir = None
input_file = None
sheets_args = []
i = 0
while i < len(args):
    if args[i] == "-output" and i + 1 < len(args):
        out_dir = args[i + 1]
        i += 2
    elif args[i] == "-sheets":
        i += 1
        while i < len(args) and not args[i].startswith("-"):
            sheets_args.append(args[i])
            i += 1
    elif args[i] == "--" and i + 1 < len(args):
        input_file = args[i + 1]
        i += 2
    else:
        i += 1

if not out_dir or not input_file:
    sys.stderr.write("missing -output or input_file\\n")
    sys.exit(2)

mode = os.environ.get("FAKE_OMR_MODE", "mxl")
xml_source = os.environ.get("FAKE_OMR_XML_PATH", "")
invocations_file = os.environ.get("FAKE_OMR_INVOCATIONS", "")
if invocations_file:
    with open(invocations_file, "a", encoding="utf-8") as f:
        f.write(input_file + "\\n")
tess_log = os.environ.get("FAKE_OMR_TESS_LOG", "")
if tess_log:
    with open(tess_log, "a", encoding="utf-8") as f:
        f.write(os.environ.get("TESSDATA_PREFIX", "<UNSET>") + "\\n")
java_log = os.environ.get("FAKE_OMR_JAVA_LOG", "")
if java_log:
    with open(java_log, "a", encoding="utf-8") as f:
        f.write(os.environ.get("JAVA_TOOL_OPTIONS", "<UNSET>") + "\\n")

stem = os.path.splitext(os.path.basename(input_file))[0]
sub = os.path.join(out_dir, stem)
os.makedirs(sub, exist_ok=True)

if mode == "mxl":
    with open(xml_source, "r", encoding="utf-8") as f:
        xml_text = f.read()
    mxl_path = os.path.join(sub, stem + ".mxl")
    container = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<container><rootfiles>'
        '<rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/>'
        '</rootfiles></container>'
    )
    with zipfile.ZipFile(mxl_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("META-INF/container.xml", container)
        zf.writestr("score.musicxml", xml_text)
    sys.exit(0)
elif mode == "empty_dir":
    sys.exit(0)
elif mode == "empty_file":
    with open(os.path.join(sub, stem + ".mxl"), "wb") as f:
        pass
    sys.exit(0)
elif mode == "corrupt_xml":
    with open(os.path.join(sub, stem + ".musicxml"), "w", encoding="utf-8") as f:
        f.write("<score-partwise><part id='P1'><measure number='1'><broken")
    sys.exit(0)
elif mode == "corrupt_mxl":
    with open(os.path.join(sub, stem + ".mxl"), "wb") as f:
        f.write(b"not a real zip archive")
    sys.exit(0)
elif mode == "zero_notes":
    with open(os.path.join(sub, stem + ".musicxml"), "w", encoding="utf-8") as f:
        f.write(
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<score-partwise version="3.1">'
            '<part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list>'
            '<part id="P1"><measure number="1">'
            '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>'
            '</measure></part></score-partwise>'
        )
    sys.exit(0)
elif mode == "nonzero_exit":
    sys.stderr.write("simulated audiveris failure\\n")
    sys.exit(17)
elif mode == "timeout":
    time.sleep(5.0)
    sys.exit(0)
elif mode == "multipage_stream":
    log_lines = [
        f"INFO [Book] 4 sheets in {os.path.basename(input_file)}",
        f"INFO [] Book 2525 | Book stored as {os.path.join(out_dir, stem + '.omr')}",
        "INFO [input#1] StepMonitoring 1 | LOAD",
        "INFO [input#1] StepMonitoring 4 | GRID",
        "INFO [input#1] StepMonitoring 9 | HEADS",
        f"INFO [] Book 2525 | Book stored as {os.path.join(out_dir, stem + '.omr')}",
        "INFO [input#2] StepMonitoring 10 | STEMS",
        "INFO [input#2] StepMonitoring 19 | RHYTHMS",
        "INFO [input#3] StepMonitoring 10 | STEMS",
        "INFO [input#4] StepMonitoring 21 | SCORE",
        f"INFO [Book] ScoreExporter | Exported to {os.path.join(sub, stem + '.mxl')}",
    ]
    for ln in log_lines:
        print(ln, flush=True)
        time.sleep(0.06)
    with open(xml_source, "r", encoding="utf-8") as f:
        xml_text = f.read()
    mxl_path = os.path.join(sub, stem + ".mxl")
    container = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<container><rootfiles>'
        '<rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/>'
        '</rootfiles></container>'
    )
    with zipfile.ZipFile(mxl_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("META-INF/container.xml", container)
        zf.writestr("score.musicxml", xml_text)
    sys.exit(0)
elif mode == "partial_invalid_sheet":
    if input_file.endswith(".omr"):
        if sheets_args != ["1", "2"]:
            sys.stderr.write("unexpected -sheets: " + repr(sheets_args) + "\\n")
            sys.exit(4)
        with open(xml_source, "r", encoding="utf-8") as f:
            xml_text = f.read()
        mxl_path = os.path.join(sub, stem + ".mxl")
        container = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<container><rootfiles>'
            '<rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/>'
            '</rootfiles></container>'
        )
        with zipfile.ZipFile(mxl_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("META-INF/container.xml", container)
            zf.writestr("score.musicxml", xml_text)
        sys.exit(0)
    else:
        print(f"INFO [Book] 3 sheets in {os.path.basename(input_file)}", flush=True)
        print("INFO [input#1] StepMonitoring 1 | LOAD", flush=True)
        print("INFO [input#2] StepMonitoring 10 | STEMS", flush=True)
        print("WARN [input#3] Sheet input#3 flagged as invalid.", flush=True)
        with open(os.path.join(out_dir, stem + ".omr"), "wb") as f:
            f.write(b"FAKE_OMR_ARCHIVE")
        sys.exit(1)
elif mode == "omr_book_page_error":
    if input_file.endswith(".omr"):
        if sheets_args != ["2", "3"]:
            sys.stderr.write("unexpected -sheets: " + repr(sheets_args) + "\\n")
            sys.exit(4)
        with open(xml_source, "r", encoding="utf-8") as f:
            xml_text = f.read()
        mxl_path = os.path.join(sub, stem + ".mxl")
        container = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<container><rootfiles>'
            '<rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/>'
            '</rootfiles></container>'
        )
        with zipfile.ZipFile(mxl_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("META-INF/container.xml", container)
            zf.writestr("score.musicxml", xml_text)
        sys.exit(0)
    else:
        print(f"INFO [Book] 3 sheets in {os.path.basename(input_file)}", flush=True)
        print("INFO [input#2] StepMonitoring 98 | PAGE", flush=True)
        print("INFO [input#2] Sheet 1583 | Stored /sheet#2/sheet#2.xml", flush=True)
        print("INFO [input#3] StepMonitoring 98 | PAGE", flush=True)
        print("INFO [input#3] Sheet 1583 | Stored /sheet#3/sheet#3.xml", flush=True)
        print("WARN [input] CLI 956 | Exception occurred java.lang.Exception: Error in reaching step PAGE", flush=True)
        omr_path = os.path.join(out_dir, stem + ".omr")
        with zipfile.ZipFile(omr_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr(
                "book.xml",
                '<book><sheet id="1"/><sheet id="2"/><sheet id="3"/></book>',
            )
            zf.writestr("sheet#2/sheet#2.xml", '<sheet step="PAGE"><page/></sheet>')
            zf.writestr("sheet#3/sheet#3.xml", '<sheet step="PAGE"><page/></sheet>')
        sys.exit(1)
elif mode == "incomplete_sheet_crash":
    if input_file.endswith(".omr"):
        if sheets_args != ["1", "2"]:
            sys.stderr.write("unexpected -sheets: " + repr(sheets_args) + "\\n")
            sys.exit(4)
        with open(xml_source, "r", encoding="utf-8") as f:
            xml_text = f.read()
        mxl_path = os.path.join(sub, stem + ".mxl")
        container = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<container><rootfiles>'
            '<rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/>'
            '</rootfiles></container>'
        )
        with zipfile.ZipFile(mxl_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("META-INF/container.xml", container)
            zf.writestr("score.musicxml", xml_text)
        sys.exit(0)
    else:
        print(f"INFO [Book] 3 sheets in {os.path.basename(input_file)}", flush=True)
        print("INFO [input#1] StepMonitoring 98 | PAGE", flush=True)
        print("INFO [input#1] Sheet 1583 | Stored /sheet#1/sheet#1.xml", flush=True)
        print("INFO [input#2] StepMonitoring 98 | PAGE", flush=True)
        print("INFO [input#2] Sheet 1583 | Stored /sheet#2/sheet#2.xml", flush=True)
        print("INFO [input#3] StepMonitoring 98 | STEMS", flush=True)
        print("INFO [input#3] Sheet 1583 | Stored /sheet#3/sheet#3.xml", flush=True)
        print("Caused by: java.lang.IllegalArgumentException: Comparison method violates its general contract!", flush=True)
        omr_path = os.path.join(out_dir, stem + ".omr")
        with zipfile.ZipFile(omr_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("book.xml", '<book><sheet id="1"/><sheet id="2"/><sheet id="3"/></book>')
            zf.writestr("sheet#1/sheet#1.xml", '<sheet step="PAGE"><page><measure/></page></sheet>')
            zf.writestr("sheet#2/sheet#2.xml", '<sheet step="PAGE"><page><measure/></page></sheet>')
            zf.writestr("sheet#3/sheet#3.xml", '<sheet step="STEMS"><page><system/></page></sheet>')
        sys.exit(1)
elif mode == "adaptive_retry_pdf":
    if input_file.lower().endswith(".png"):
        with open(xml_source, "r", encoding="utf-8") as f:
            xml_text = f.read()
        mxl_path = os.path.join(sub, stem + ".mxl")
        container = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<container><rootfiles>'
            '<rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/>'
            '</rootfiles></container>'
        )
        with zipfile.ZipFile(mxl_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("META-INF/container.xml", container)
            zf.writestr("score.musicxml", xml_text)
        sys.exit(0)
    else:
        print(f"INFO [Book] 1 sheets in {os.path.basename(input_file)}", flush=True)
        print("WARN [input#1] Sheet input#1 flagged as invalid.", flush=True)
        sys.exit(1)
elif mode == "multirun_variants":
    if "v300" in input_file:
        vtag = "v300"
        time.sleep(0.05)
    elif "v400" in input_file:
        vtag = "v400"
        time.sleep(0.35)
    else:
        vtag = "v350c"
        time.sleep(0.35)
    with open(xml_source, "r", encoding="utf-8") as f:
        xml_text = f.read().replace(
            "<work-title>Ode to Joy</work-title>",
            f"<work-title>Variant {vtag}</work-title>",
        )
    mxl_path = os.path.join(sub, stem + ".mxl")
    container = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<container><rootfiles>'
        '<rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/>'
        '</rootfiles></container>'
    )
    with zipfile.ZipFile(mxl_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("META-INF/container.xml", container)
        zf.writestr("score.musicxml", xml_text)
    sys.exit(0)
else:
    sys.stderr.write("unknown mode: " + mode + "\\n")
    sys.exit(3)
"""


def build_multipart(
    fields: Dict[str, str],
    file_field: Optional[Tuple[str, str, str, bytes]] = None,
) -> Tuple[bytes, str]:
    boundary = "----RehearsalOMRTestBoundary987654"
    chunks: List[bytes] = []
    for key, val in fields.items():
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        chunks.append(
            f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode("utf-8")
        )
        chunks.append(val.encode("utf-8"))
        chunks.append(b"\r\n")
    if file_field is not None:
        field_name, filename, mime_type, data = file_field
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        chunks.append(
            (
                f'Content-Disposition: form-data; name="{field_name}"; filename="{filename}"\r\n'
                f"Content-Type: {mime_type}\r\n\r\n"
            ).encode("utf-8")
        )
        chunks.append(data)
        chunks.append(b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def _can_use_loopback_sockets() -> bool:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as srv:
            srv.bind(("127.0.0.1", 0))
            srv.listen(1)
            port = srv.getsockname()[1]
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as cli:
                cli.settimeout(1.0)
                cli.connect(("127.0.0.1", port))
        return True
    except OSError:
        return False


class _InProcSocket:
    def __init__(self, request_bytes: bytes) -> None:
        self._rfile = io.BytesIO(request_bytes)
        self._wfile = io.BytesIO()

    def makefile(self, mode: str, *args: Any, **kwargs: Any) -> Any:
        if "r" in mode:
            return self._rfile
        return self._wfile

    def sendall(self, data: bytes) -> None:
        self._wfile.write(data)

    def close(self) -> None:
        pass

    def response_bytes(self) -> bytes:
        return self._wfile.getvalue()


class _InProcServerStub:
    def __init__(self, service: Optional[omr_server.OMRService] = None) -> None:
        self.service = service

    def shutdown(self) -> None:
        pass

    def server_close(self) -> None:
        if self.service is not None:
            self.service.stop()


_INPROC_TARGETS: Dict[str, Tuple[Any, _InProcServerStub]] = {}


def _run_inproc_http(
    handler_cls: Any,
    server_stub: _InProcServerStub,
    method: str,
    path: str,
    body: Optional[bytes],
    headers: Dict[str, str],
) -> Tuple[int, Dict[str, str], bytes]:
    req_headers = dict(headers)
    req_headers.setdefault("Host", "127.0.0.1")
    if body is not None:
        req_headers.setdefault("Content-Length", str(len(body)))
    lines = [f"{method} {path} HTTP/1.1"]
    for k, v in req_headers.items():
        lines.append(f"{k}: {v}")
    raw_req = ("\r\n".join(lines) + "\r\n\r\n").encode("latin-1") + (body or b"")
    sock = _InProcSocket(raw_req)
    handler_cls(sock, ("127.0.0.1", 0), server_stub)
    raw_resp = sock.response_bytes()
    head, _, resp_body = raw_resp.partition(b"\r\n\r\n")
    head_lines = head.decode("latin-1").split("\r\n")
    status_code = int(head_lines[0].split(" ", 2)[1])
    parsed_headers = email.parser.Parser().parsestr("\r\n".join(head_lines[1:]))
    return status_code, dict(parsed_headers.items()), resp_body


def http_request(
    base_url: str,
    method: str,
    path: str,
    body: Optional[bytes] = None,
    headers: Optional[Dict[str, str]] = None,
) -> Tuple[int, Dict[str, str], bytes]:
    req_headers = dict(headers or {})
    if base_url in _INPROC_TARGETS:
        handler_cls, stub = _INPROC_TARGETS[base_url]
        return _run_inproc_http(handler_cls, stub, method, path, body, req_headers)
    req = urllib.request.Request(
        base_url + path, data=body, headers=req_headers, method=method
    )
    try:
        with urllib.request.urlopen(req, timeout=10.0) as resp:
            return resp.status, dict(resp.headers.items()), resp.read()
    except urllib.error.HTTPError as err:
        return err.code, dict(err.headers.items()), err.read()


def http_json(
    base_url: str,
    method: str,
    path: str,
    payload: Optional[Dict[str, Any]] = None,
    headers: Optional[Dict[str, str]] = None,
) -> Tuple[int, Dict[str, str], Dict[str, Any]]:
    req_headers = dict(headers or {})
    body = None
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        req_headers.setdefault("Content-Type", "application/json")
    status, resp_headers, raw = http_request(base_url, method, path, body, req_headers)
    return status, resp_headers, json.loads(raw.decode("utf-8"))


def http_post_raw_json(
    base_url: str,
    path: str,
    body: bytes,
    headers: Optional[Dict[str, str]] = None,
) -> Tuple[int, Dict[str, str], Dict[str, Any]]:
    status, resp_headers, raw = http_request(base_url, "POST", path, body, headers)
    return status, resp_headers, json.loads(raw.decode("utf-8"))


class MockAuthHandler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:
        return

    def _send_json(self, status: int, data: Dict[str, Any]) -> None:
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        auth = self.headers.get("Authorization", "")
        if self.path == "/api/auth/teacher/me":
            if auth == "Bearer teacher-google-token":
                self._send_json(
                    200,
                    {
                        "ok": True,
                        "teacher": {
                            "id": "tch_001",
                            "email": "director@school.edu",
                            "name": "Ms. Rivera",
                        },
                    },
                )
                return
            self._send_json(401, {"ok": False, "error": "unauthorized"})
            return

        if self.path == "/api/auth/student/me":
            if auth == "Bearer student-code-token":
                self._send_json(
                    200,
                    {
                        "ok": True,
                        "student": {
                            "id": "stu_042",
                            "displayName": "Jordan M.",
                            "authMethod": "code",
                        },
                    },
                )
                return
            self._send_json(401, {"ok": False, "error": "unauthorized"})
            return

        self._send_json(404, {"ok": False, "error": "not found"})


class OMRServiceTestSuite(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory(prefix="omr-service-test-")
        self.fake_cli_path = os.path.join(self.tmpdir.name, "fake_audiveris.py")
        with open(self.fake_cli_path, "w", encoding="utf-8") as f:
            f.write(FAKE_CLI_SCRIPT)
        os.chmod(
            self.fake_cli_path,
            os.stat(self.fake_cli_path).st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH,
        )
        self.invocations_file = os.path.join(self.tmpdir.name, "invocations.log")
        self._saved_env = {
            "FAKE_OMR_MODE": os.environ.get("FAKE_OMR_MODE"),
            "FAKE_OMR_XML_PATH": os.environ.get("FAKE_OMR_XML_PATH"),
            "FAKE_OMR_INVOCATIONS": os.environ.get("FAKE_OMR_INVOCATIONS"),
        }
        os.environ["FAKE_OMR_MODE"] = "mxl"
        os.environ["FAKE_OMR_XML_PATH"] = DEMO_XML_PATH
        os.environ["FAKE_OMR_INVOCATIONS"] = self.invocations_file

        self._servers: List[Any] = []
        self._threads: List[threading.Thread] = []
        self._inproc_keys: List[str] = []
        self._orig_urlopen: Any = None
        self._use_tcp = _can_use_loopback_sockets()

        if self._use_tcp:
            self.auth_server = ThreadingHTTPServer(("127.0.0.1", 0), MockAuthHandler)
            self._register_server(self.auth_server)
            self.auth_url = f"http://127.0.0.1:{self.auth_server.server_address[1]}"
        else:
            auth_stub = _InProcServerStub()
            self.auth_url = f"http://inproc-auth-{id(self)}"
            _INPROC_TARGETS[self.auth_url] = (MockAuthHandler, auth_stub)
            self._inproc_keys.append(self.auth_url)
            self._install_inproc_auth_urlopen()

    def _install_inproc_auth_urlopen(self) -> None:
        orig_urlopen = urllib.request.urlopen
        self._orig_urlopen = orig_urlopen
        auth_prefix = self.auth_url

        class _InProcHTTPResponse:
            def __init__(self, status: int, body: bytes) -> None:
                self.status = status
                self._body = body

            def read(self) -> bytes:
                return self._body

            def __enter__(self) -> "_InProcHTTPResponse":
                return self

            def __exit__(self, *args: Any) -> None:
                return

        def wrapped_urlopen(req: Any, *args: Any, **kwargs: Any) -> Any:
            url = req.full_url if hasattr(req, "full_url") else str(req)
            if url.startswith(auth_prefix):
                path = url[len(auth_prefix) :] or "/"
                hdrs = dict(req.header_items()) if hasattr(req, "header_items") else {}
                method = req.get_method() if hasattr(req, "get_method") else "GET"
                handler_cls, stub = _INPROC_TARGETS[auth_prefix]
                status, _resp_hdrs, resp_body = _run_inproc_http(
                    handler_cls, stub, method, path, None, hdrs
                )
                if status >= 400:
                    raise urllib.error.HTTPError(
                        url, status, "HTTP Error", _resp_hdrs, io.BytesIO(resp_body)
                    )
                return _InProcHTTPResponse(status, resp_body)
            return orig_urlopen(req, *args, **kwargs)

        urllib.request.urlopen = wrapped_urlopen  # type: ignore[assignment]

    def tearDown(self) -> None:
        if self._orig_urlopen is not None:
            urllib.request.urlopen = self._orig_urlopen  # type: ignore[assignment]
        for key in reversed(self._inproc_keys):
            entry = _INPROC_TARGETS.pop(key, None)
            if entry is not None:
                entry[1].server_close()
        for srv in reversed(self._servers):
            srv.shutdown()
            srv.server_close()
        for t in self._threads:
            t.join(timeout=2.0)
        for k, v in self._saved_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        self.tmpdir.cleanup()

    def _register_server(self, srv: ThreadingHTTPServer) -> None:
        t = threading.Thread(target=srv.serve_forever, daemon=True)
        t.start()
        self._servers.append(srv)
        self._threads.append(t)

    def _start_omr_server(
        self,
        *,
        auth_mode: str = "optional",
        engine_cmd: Optional[List[str]] = None,
        audiveris_bin: Optional[str] = None,
        job_timeout: float = 5.0,
        max_upload_bytes: int = 2 * 1024 * 1024,
        subdir: str = "data",
        preprocess: bool = False,
    ) -> Tuple[Any, str]:
        data_dir = os.path.join(self.tmpdir.name, subdir)
        cfg = omr_server.OMRConfig(
            host="127.0.0.1",
            port=0,
            data_dir=data_dir,
            audiveris_bin=audiveris_bin,
            engine_cmd=engine_cmd,
            job_timeout=job_timeout,
            workers=2,
            max_upload_bytes=max_upload_bytes,
            auth_mode=auth_mode,
            auth_api=self.auth_url,
            cors_origins="*",
            preprocess=preprocess,
        )
        if self._use_tcp:
            srv = omr_server.create_server(cfg)
            self._register_server(srv)
            return srv, f"http://127.0.0.1:{srv.server_address[1]}"
        service = omr_server.OMRService(cfg)
        stub = _InProcServerStub(service)
        key = f"inproc://omr-{id(stub)}"
        _INPROC_TARGETS[key] = (omr_server.OMRRequestHandler, stub)
        self._inproc_keys.append(key)
        return stub, key

    def _poll_job(self, base_url: str, job_id: str, timeout: float = 10.0) -> Dict[str, Any]:
        deadline = time.time() + timeout
        last: Dict[str, Any] = {}
        while time.time() < deadline:
            status, _hdrs, data = http_json(base_url, "GET", f"/api/scan/jobs/{job_id}")
            self.assertEqual(status, 200)
            last = data
            if data["status"] in ("completed", "failed"):
                return data
            time.sleep(0.05)
        self.fail(f"Job {job_id} did not settle in time; last={last}")

    def _invocation_count(self) -> int:
        if not os.path.isfile(self.invocations_file):
            return 0
        with open(self.invocations_file, "r", encoding="utf-8") as f:
            return len([line for line in f if line.strip()])

    def _demo_xml(self) -> str:
        with open(DEMO_XML_PATH, "r", encoding="utf-8") as f:
            return f.read()

    # 1. Health & CORS preflight
    def test_01_health_and_cors(self) -> None:
        _srv, base = self._start_omr_server(engine_cmd=[sys.executable, self.fake_cli_path])

        status, hdrs, data = http_json(base, "GET", "/health")
        self.assertEqual(status, 200)
        self.assertTrue(data["ok"])
        self.assertEqual(data["service"], "rehearsal-omr")
        self.assertEqual(data["engine"], "audiveris")
        self.assertTrue(data["engineAvailable"])
        self.assertIsInstance(data["ocrAvailable"], bool)
        self.assertIn("tessdataDir", data)
        self.assertIsInstance(data["preprocessAvailable"], bool)
        self.assertEqual(data["retentionHours"], 24.0)
        self.assertEqual(data["authMode"], "optional")
        self.assertEqual(data["version"], "1.0.0")
        self.assertIsInstance(data["queueDepth"], int)
        self.assertIsInstance(data["activeJobs"], int)
        self.assertEqual(hdrs.get("Access-Control-Allow-Origin"), "*")

        # OPTIONS preflight
        opt_status, opt_hdrs, _ = http_request(base, "OPTIONS", "/api/scan/jobs")
        self.assertEqual(opt_status, 204)
        self.assertEqual(opt_hdrs.get("Access-Control-Allow-Origin"), "*")
        allow_hdrs = opt_hdrs.get("Access-Control-Allow-Headers", "")
        for required in ("Authorization", "Content-Type", "X-Filename", "X-Instrument", "X-Title"):
            self.assertIn(required, allow_hdrs)

        # Verify find_tessdata_dir detects a directory containing *.traineddata
        tess_dir = os.path.join(self.tmpdir.name, "tessdata")
        os.makedirs(tess_dir, exist_ok=True)
        with open(os.path.join(tess_dir, "eng.traineddata"), "wb") as f:
            f.write(b"FAKE_TESSDATA")
        self.assertEqual(omr_server.find_tessdata_dir(tess_dir), tess_dir)

    # 2. Full async job queue happy path + /original + /raw + isolation before confirm
    def test_02_happy_path_and_unverified_isolation(self) -> None:
        srv, base = self._start_omr_server(engine_cmd=[sys.executable, self.fake_cli_path])
        fake_png = b"\x89PNG\r\n\x1a\nFAKE_SHEET_MUSIC_IMAGE_BYTES_001"
        expected_hash = hashlib.sha256(fake_png).hexdigest()

        body, ctype = build_multipart(
            {"instrument": "Clarinet in Bb", "title": "Ode to Joy - Clarinet"},
            ("file", "ode-clarinet.png", "image/png", fake_png),
        )
        status, _hdrs, created = http_post_raw_json(
            base, "/api/scan/jobs", body, {"Content-Type": ctype}
        )

        self.assertEqual(status, 202)
        self.assertTrue(created["ok"])
        self.assertEqual(created["status"], "queued")
        self.assertFalse(created["cacheHit"])
        self.assertEqual(created["uploadHash"], expected_hash)
        job_id = created["jobId"]

        job = self._poll_job(base, job_id)
        self.assertEqual(job["status"], "completed")
        self.assertFalse(job["cacheHit"])
        self.assertEqual(job["instrument"], "Clarinet in Bb")
        self.assertEqual(job["title"], "Ode to Joy - Clarinet")
        self.assertIsNone(job["error"])
        self.assertIsNone(job["errorCode"])
        self.assertIn("<work-title>Ode to Joy</work-title>", job["rawMusicxml"])
        self.assertEqual(job["originalUrl"], f"/api/scan/jobs/{job_id}/original")
        self.assertEqual(job["rawUrl"], f"/api/scan/jobs/{job_id}/raw")
        self.assertIsNone(job["correctedMxlUrl"])
        self.assertEqual(self._invocation_count(), 1)

        # GET /original returns exact bytes & mime type
        st_orig, hdrs_orig, orig_bytes = http_request(base, "GET", job["originalUrl"])
        self.assertEqual(st_orig, 200)
        self.assertEqual(orig_bytes, fake_png)
        self.assertEqual(hdrs_orig.get("Content-Type"), "image/png")

        # GET /raw returns valid .mxl bytes from subprocess
        st_raw, _hdrs_raw, raw_bytes = http_request(base, "GET", job["rawUrl"])
        self.assertEqual(st_raw, 200)
        extracted = omr_server.extract_musicxml_from_mxl_bytes(raw_bytes)
        self.assertIn("<work-title>Ode to Joy</work-title>", extracted)

        # Unverified scan isolation:
        # 1) corrected.mxl must 404 before confirm
        st_mxl, _h, _b = http_request(base, "GET", f"/api/scan/jobs/{job_id}/corrected.mxl")
        self.assertEqual(st_mxl, 404)

        # 2) /api/scan/library must NOT include unverified job
        st_lib, _h, lib = http_json(base, "GET", "/api/scan/library")
        self.assertEqual(st_lib, 200)
        self.assertEqual(lib["items"], [])

        # 3) /api/scan/cache/<hash> must report hit=false
        st_cache, _h, cache = http_json(base, "GET", f"/api/scan/cache/{expected_hash}")
        self.assertEqual(st_cache, 200)
        self.assertFalse(cache["hit"])

        # Raw binary upload mode with X-Filename header also works
        fake_pdf = b"%PDF-1.4\n%FAKE_BAND_PART_PDF"
        st_bin, _h, raw_bin_resp = http_request(
            base,
            "POST",
            "/api/scan/jobs",
            fake_pdf,
            {
                "Content-Type": "application/pdf",
                "X-Filename": "trumpet-1.pdf",
                "X-Instrument": "Trumpet in Bb",
                "X-Title": "March Trumpet 1",
            },
        )
        self.assertEqual(st_bin, 202)
        bin_created = json.loads(raw_bin_resp.decode("utf-8"))
        bin_job = self._poll_job(base, bin_created["jobId"])
        self.assertEqual(bin_job["status"], "completed")
        self.assertEqual(bin_job["mimeType"], "application/pdf")
        self.assertEqual(bin_job["instrument"], "Trumpet in Bb")

        # Ensure temp dirs were cleaned up and per-job artifacts exist
        jdir = os.path.join(srv.service.jobs_dir, job_id)
        self.assertTrue(os.path.isfile(os.path.join(jdir, "original.png")))
        self.assertTrue(os.path.isfile(os.path.join(jdir, "raw.mxl")))

    # 3. Failure paths: empty output, empty file, corrupt XML, corrupt MXL, zero-note XML,
    #    non-zero exit, subprocess timeout, missing binary, invalid/empty/oversized uploads
    def test_03_failure_paths(self) -> None:
        _srv, base = self._start_omr_server(
            engine_cmd=[sys.executable, self.fake_cli_path],
            job_timeout=1.2,
            max_upload_bytes=1024,
            subdir="data_failures",
        )

        # Invalid/empty/oversized uploads -> 400
        # Empty upload
        st, _h, d = (lambda s, h, b: (s, h, json.loads(b.decode())))(
            *http_request(
                base,
                "POST",
                "/api/scan/jobs",
                b"",
                {"Content-Type": "image/png", "X-Filename": "empty.png"},
            )
        )
        self.assertEqual(st, 400)
        self.assertEqual(d["errorCode"], "EMPTY_UPLOAD")

        # Invalid extension / MIME
        st, _h, d = (lambda s, h, b: (s, h, json.loads(b.decode())))(
            *http_request(
                base,
                "POST",
                "/api/scan/jobs",
                b"hello world",
                {"Content-Type": "text/plain", "X-Filename": "notes.txt"},
            )
        )
        self.assertEqual(st, 400)
        self.assertEqual(d["errorCode"], "INVALID_FILE_TYPE")

        # Oversized upload (> 1024 bytes)
        st, _h, d = (lambda s, h, b: (s, h, json.loads(b.decode())))(
            *http_request(
                base,
                "POST",
                "/api/scan/jobs",
                b"\x89PNG" + (b"x" * 2048),
                {"Content-Type": "image/png", "X-Filename": "huge.png"},
            )
        )
        self.assertEqual(st, 400)
        self.assertEqual(d["errorCode"], "FILE_TOO_LARGE")

        # Engine failure modes over real subprocess boundary
        cases = [
            ("empty_dir", "NO_USABLE_OUTPUT"),
            ("empty_file", "NO_USABLE_OUTPUT"),
            ("corrupt_xml", "NO_USABLE_OUTPUT"),
            ("corrupt_mxl", "NO_USABLE_OUTPUT"),
            ("zero_notes", "NO_USABLE_OUTPUT"),
            ("nonzero_exit", "ENGINE_ERROR"),
            ("timeout", "ENGINE_TIMEOUT"),
        ]
        for idx, (mode, expected_code) in enumerate(cases):
            os.environ["FAKE_OMR_MODE"] = mode
            payload = f"\x89PNG-CASE-{idx}-{mode}".encode("utf-8")
            st, _h, raw = http_request(
                base,
                "POST",
                "/api/scan/jobs",
                payload,
                {"Content-Type": "image/png", "X-Filename": f"case-{idx}.png"},
            )
            self.assertEqual(st, 202, f"upload failed for mode={mode}")
            job_id = json.loads(raw.decode("utf-8"))["jobId"]
            job = self._poll_job(base, job_id, timeout=5.0)
            self.assertEqual(job["status"], "failed", f"expected failed for mode={mode}")
            self.assertEqual(
                job["errorCode"],
                expected_code,
                f"mode={mode} got errorCode={job['errorCode']} expected={expected_code}",
            )
            self.assertTrue(bool(job["error"]), f"missing friendly error message for mode={mode}")
            if mode == "nonzero_exit":
                log_file = os.path.join(_srv.service.jobs_dir, job_id, "engine.log")
                self.assertTrue(os.path.isfile(log_file))
                with open(log_file, "r", encoding="utf-8") as lf:
                    self.assertIn("simulated audiveris failure", lf.read())

        # Missing engine binary -> ENGINE_UNAVAILABLE & health reports engineAvailable=False
        _srv2, base2 = self._start_omr_server(
            engine_cmd=["/nonexistent/path/to/audiveris-missing"],
            audiveris_bin=None,
            subdir="data_missing_bin",
        )
        st_h, _h, health2 = http_json(base2, "GET", "/health")
        self.assertEqual(st_h, 200)
        self.assertFalse(health2["engineAvailable"])

        st, _h, raw = http_request(
            base2,
            "POST",
            "/api/scan/jobs",
            b"\x89PNG-MISSING-BIN",
            {"Content-Type": "image/png", "X-Filename": "missing.png"},
        )
        self.assertEqual(st, 202)
        job_missing = self._poll_job(base2, json.loads(raw.decode("utf-8"))["jobId"])
        self.assertEqual(job_missing["status"], "failed")
        self.assertEqual(job_missing["errorCode"], "ENGINE_UNAVAILABLE")

    # 4, 5, 6, 7, 8: Member auth (teacher & student), save gate, confirm, library, and cacheHit
    def test_04_auth_save_gate_confirm_library_and_cache_hit(self) -> None:
        srv, base = self._start_omr_server(
            auth_mode="required",
            engine_cmd=[sys.executable, self.fake_cli_path],
            subdir="data_auth_cache",
        )

        # Upload a scan (same bytes will be reused later to test cacheHit)
        scan_bytes = b"\x89PNG\r\n\x1a\nCONCERT_BAND_FLUTE_SCAN_V1"
        scan_hash = hashlib.sha256(scan_bytes).hexdigest()
        body, ctype = build_multipart(
            {"instrument": "Flute", "title": "Ode to Joy (Flute)"},
            ("file", "flute-part.png", "image/png", scan_bytes),
        )
        st, _h, raw = http_request(base, "POST", "/api/scan/jobs", body, {"Content-Type": ctype})
        self.assertEqual(st, 202)
        job_id = json.loads(raw.decode("utf-8"))["jobId"]
        job = self._poll_job(base, job_id)
        self.assertEqual(job["status"], "completed")
        self.assertEqual(self._invocation_count(), 1)

        corrected_xml = self._demo_xml().replace(
            "<work-title>Ode to Joy</work-title>",
            "<work-title>Ode to Joy (Verified)</work-title>",
        )
        resolved_flags = [
            {"measureNumber": 2, "visited": True, "status": "fixed", "reasons": ["Pitch outlier"]},
            {"measureNumber": 4, "visited": True, "status": "confirmed", "reasons": ["Dotted rhythm"]},
        ]

        # Auth check: missing token -> 401 UNAUTHORIZED
        st_no_auth, _h, err_no_auth = http_json(
            base,
            "POST",
            f"/api/scan/jobs/{job_id}/confirm",
            {"correctedXml": corrected_xml, "flaggedLog": resolved_flags},
        )
        self.assertEqual(st_no_auth, 401)
        self.assertEqual(err_no_auth["errorCode"], "UNAUTHORIZED")

        # Auth check: invalid token -> 401 UNAUTHORIZED
        st_bad_auth, _h, err_bad_auth = http_json(
            base,
            "POST",
            f"/api/scan/jobs/{job_id}/confirm",
            {"correctedXml": corrected_xml, "flaggedLog": resolved_flags},
            headers={"Authorization": "Bearer expired-or-bogus-token"},
        )
        self.assertEqual(st_bad_auth, 401)
        self.assertEqual(err_bad_auth["errorCode"], "UNAUTHORIZED")

        # Auth check on /api/scan/library without token -> 401
        st_lib_unauth, _h, _ = http_json(base, "GET", "/api/scan/library")
        self.assertEqual(st_lib_unauth, 401)

        # Save gate check: unresolved flagged measures rejected with 400 UNRESOLVED_FLAGS
        teacher_headers = {"Authorization": "Bearer teacher-google-token"}
        bad_flag_sets = [
            [{"measureNumber": 2, "visited": False, "status": "pending"}],
            [{"measureNumber": 2, "visited": True, "status": "pending"}],
            [{"measureNumber": 2, "visited": False, "status": "confirmed"}],
            [
                {"measureNumber": 2, "visited": True, "status": "fixed"},
                {"measureNumber": 5, "visited": True, "status": "unresolved"},
            ],
        ]
        for bad_flags in bad_flag_sets:
            st_gate, _h, err_gate = http_json(
                base,
                "POST",
                f"/api/scan/jobs/{job_id}/confirm",
                {"correctedXml": corrected_xml, "flaggedLog": bad_flags},
                headers=teacher_headers,
            )
            self.assertEqual(st_gate, 400)
            self.assertEqual(err_gate["errorCode"], "UNRESOLVED_FLAGS")

        # Still unverified after rejected attempts!
        st_lib0, _h, lib0 = http_json(base, "GET", "/api/scan/library", headers=teacher_headers)
        self.assertEqual(st_lib0, 200)
        self.assertEqual(lib0["items"], [])

        # Confirm with teacher token (omitting correctedMxlBase64 -> server packages .mxl)
        confirmed_ts = "2026-11-25T05:00:00Z"
        st_ok, _h, confirmed = http_json(
            base,
            "POST",
            f"/api/scan/jobs/{job_id}/confirm",
            {
                "correctedXml": corrected_xml,
                "title": "Ode to Joy (Verified)",
                "instrument": "Flute",
                "flaggedLog": resolved_flags,
                "confirmedAt": confirmed_ts,
            },
            headers=teacher_headers,
        )
        self.assertEqual(st_ok, 200)
        self.assertTrue(confirmed["ok"])
        self.assertTrue(confirmed["verified"])
        self.assertEqual(confirmed["confirmedAt"], confirmed_ts)
        self.assertEqual(confirmed["uploadHash"], scan_hash)
        self.assertEqual(confirmed["correctedMxlUrl"], f"/api/scan/jobs/{job_id}/corrected.mxl")

        # Verify saved corrected.mxl can be downloaded and unpacked
        st_mxl, hdrs_mxl, mxl_bytes = http_request(base, "GET", confirmed["correctedMxlUrl"])
        self.assertEqual(st_mxl, 200)
        self.assertIn("application/vnd.recordare.musicxml", hdrs_mxl.get("Content-Type", ""))
        unpacked_xml = omr_server.extract_musicxml_from_mxl_bytes(mxl_bytes)
        self.assertIn("<work-title>Ode to Joy (Verified)</work-title>", unpacked_xml)

        # Verify per-job artifact files on disk
        jdir = os.path.join(srv.service.jobs_dir, job_id)
        self.assertTrue(os.path.isfile(os.path.join(jdir, "corrected.mxl")))
        self.assertTrue(os.path.isfile(os.path.join(jdir, "corrected.musicxml")))
        with open(os.path.join(jdir, "flagged-log.json"), "r", encoding="utf-8") as f:
            saved_log = json.load(f)
        self.assertEqual(saved_log["ownerType"], "teacher")
        self.assertEqual(saved_log["ownerId"], "tch_001")
        self.assertEqual(saved_log["confirmedAt"], confirmed_ts)
        self.assertEqual(len(saved_log["flaggedLog"]), 2)

        # Verify GET /api/scan/jobs/<jobId> reflects confirmation
        st_j, _h, job_after = http_json(base, "GET", f"/api/scan/jobs/{job_id}")
        self.assertEqual(st_j, 200)
        self.assertTrue(job_after["verified"])
        self.assertEqual(job_after["confirmedAt"], confirmed_ts)
        self.assertEqual(len(job_after["flaggedLog"]), 2)
        self.assertEqual(job_after["correctedMxlUrl"], f"/api/scan/jobs/{job_id}/corrected.mxl")

        # Verify teacher's /api/scan/library has the verified item
        st_lib_t, _h, lib_t = http_json(base, "GET", "/api/scan/library", headers=teacher_headers)
        self.assertEqual(st_lib_t, 200)
        self.assertEqual(len(lib_t["items"]), 1)
        self.assertEqual(lib_t["items"][0]["jobId"], job_id)
        self.assertEqual(lib_t["items"][0]["ownerType"], "teacher")
        self.assertEqual(lib_t["items"][0]["ownerId"], "tch_001")

        # Verify student token gets its own isolated library (initially empty)
        student_headers = {"Authorization": "Bearer student-code-token"}
        st_lib_s0, _h, lib_s0 = http_json(base, "GET", "/api/scan/library", headers=student_headers)
        self.assertEqual(st_lib_s0, 200)
        self.assertEqual(lib_s0["items"], [])

        # Verify /api/scan/cache/<uploadHash> now hits!
        st_c, _h, cache_hit = http_json(base, "GET", f"/api/scan/cache/{scan_hash}")
        self.assertEqual(st_c, 200)
        self.assertTrue(cache_hit["hit"])
        self.assertEqual(cache_hit["title"], "Ode to Joy (Verified)")
        self.assertEqual(cache_hit["instrument"], "Flute")
        self.assertIn("<work-title>Ode to Joy (Verified)</work-title>", cache_hit["musicxml"])
        self.assertEqual(cache_hit["confirmedAt"], confirmed_ts)

        # Re-upload exact same bytes -> instant cacheHit: true WITHOUT invoking engine!
        invocations_before = self._invocation_count()
        body2, ctype2 = build_multipart(
            {"instrument": "Flute"},
            ("file", "flute-part-again.png", "image/png", scan_bytes),
        )
        st2, _h, raw2 = http_request(base, "POST", "/api/scan/jobs", body2, {"Content-Type": ctype2})
        self.assertEqual(st2, 202)
        created2 = json.loads(raw2.decode("utf-8"))
        self.assertTrue(created2["cacheHit"])
        self.assertEqual(created2["status"], "completed")
        self.assertEqual(created2["uploadHash"], scan_hash)

        # Give worker threads a moment to confirm engine was never called
        time.sleep(0.15)
        self.assertEqual(self._invocation_count(), invocations_before)

        st_j2, _h, job2 = http_json(base, "GET", f"/api/scan/jobs/{created2['jobId']}")
        self.assertEqual(st_j2, 200)
        self.assertTrue(job2["cacheHit"])
        self.assertEqual(job2["status"], "completed")
        self.assertIn("<work-title>Ode to Joy (Verified)</work-title>", job2["correctedMusicxml"])
        self.assertIn("<work-title>Ode to Joy (Verified)</work-title>", job2["rawMusicxml"])

        # Confirm second job using student token AND explicit correctedMxlBase64
        student_xml = self._demo_xml().replace(
            "<work-title>Ode to Joy</work-title>",
            "<work-title>Ode to Joy (Student Copy)</work-title>",
        )
        student_mxl_b64 = base64.b64encode(
            omr_server.package_musicxml_to_mxl(student_xml)
        ).decode("ascii")
        st_s_ok, _h, s_confirmed = http_json(
            base,
            "POST",
            f"/api/scan/jobs/{created2['jobId']}/confirm",
            {
                "correctedXml": student_xml,
                "correctedMxlBase64": student_mxl_b64,
                "title": "Ode to Joy (Student Copy)",
                "instrument": "Flute",
                "flaggedLog": [],
            },
            headers=student_headers,
        )
        self.assertEqual(st_s_ok, 200)
        self.assertTrue(s_confirmed["verified"])

        # Student's library now has 1 verified item; teacher's still has 1
        st_lib_s1, _h, lib_s1 = http_json(base, "GET", "/api/scan/library", headers=student_headers)
        self.assertEqual(st_lib_s1, 200)
        self.assertEqual(len(lib_s1["items"]), 1)
        self.assertEqual(lib_s1["items"][0]["ownerType"], "student")
        self.assertEqual(lib_s1["items"][0]["ownerId"], "stu_042")

        st_lib_t2, _h, lib_t2 = http_json(base, "GET", "/api/scan/library", headers=teacher_headers)
        self.assertEqual(st_lib_t2, 200)
        self.assertEqual(len(lib_t2["items"]), 1)
        self.assertEqual(lib_t2["items"][0]["jobId"], job_id)

        # skipCache=true forces a fresh engine run even when hash is cached
        body3, ctype3 = build_multipart(
            {"instrument": "Flute", "skipCache": "true"},
            ("file", "flute-part-fresh.png", "image/png", scan_bytes),
        )
        st3, _h, raw3 = http_request(base, "POST", "/api/scan/jobs", body3, {"Content-Type": ctype3})
        self.assertEqual(st3, 202)
        created3 = json.loads(raw3.decode("utf-8"))
        self.assertFalse(created3["cacheHit"])
        self.assertEqual(created3["status"], "queued")
        job3 = self._poll_job(base, created3["jobId"])
        self.assertEqual(job3["status"], "completed")
        self.assertEqual(self._invocation_count(), invocations_before + 1)

    # 5. Optional local auth mode + env config parsing
    def test_05_optional_auth_and_env_config(self) -> None:
        _srv, base = self._start_omr_server(
            auth_mode="optional",
            engine_cmd=[sys.executable, self.fake_cli_path],
            subdir="data_optional_auth",
        )
        st, _h, created = http_post_raw_json(
            base,
            "/api/scan/jobs",
            b"\x89PNG-OPTIONAL-AUTH-SCAN",
            {"Content-Type": "image/png", "X-Filename": "opt.png"},
        )
        self.assertEqual(st, 202)
        job = self._poll_job(base, created["jobId"])
        self.assertEqual(job["status"], "completed")

        # Invalid token is rejected even in optional mode
        st_bad, _h, err_bad = http_json(
            base,
            "POST",
            f"/api/scan/jobs/{job['jobId']}/confirm",
            {"correctedXml": self._demo_xml(), "flaggedLog": []},
            headers={"Authorization": "Bearer bogus-token"},
        )
        self.assertEqual(st_bad, 401)
        self.assertEqual(err_bad["errorCode"], "UNAUTHORIZED")

        # Omitting token in optional mode succeeds with local owner
        st_ok, _h, ok_resp = http_json(
            base,
            "POST",
            f"/api/scan/jobs/{job['jobId']}/confirm",
            {"correctedXml": self._demo_xml(), "flaggedLog": []},
        )
        self.assertEqual(st_ok, 200)
        self.assertTrue(ok_resp["verified"])

        st_lib, _h, lib = http_json(base, "GET", "/api/scan/library")
        self.assertEqual(st_lib, 200)
        self.assertEqual(len(lib["items"]), 1)
        self.assertEqual(lib["items"][0]["ownerType"], "local")

        # Verify load_config_from_env respects OMR_ENGINE_CMD and OMR_AUTH_MODE
        prev_cmd = os.environ.get("OMR_ENGINE_CMD")
        prev_mode = os.environ.get("OMR_AUTH_MODE")
        try:
            os.environ["OMR_ENGINE_CMD"] = f"{sys.executable} {self.fake_cli_path}"
            os.environ["OMR_AUTH_MODE"] = "required"
            cfg = omr_server.load_config_from_env()
            self.assertEqual(cfg.auth_mode, "required")
            self.assertEqual(cfg.resolved_engine_cmd(), [sys.executable, self.fake_cli_path])
            self.assertTrue(cfg.engine_available())
        finally:
            if prev_cmd is None:
                os.environ.pop("OMR_ENGINE_CMD", None)
            else:
                os.environ["OMR_ENGINE_CMD"] = prev_cmd
            if prev_mode is None:
                os.environ.pop("OMR_AUTH_MODE", None)
            else:
                os.environ["OMR_AUTH_MODE"] = prev_mode

    # 6. Multi-page streaming progress (0..100), StepMonitoring, dynamic timeout & multi-mvt output
    def test_06_multipage_streaming_progress_and_dynamic_timeout(self) -> None:
        srv, base = self._start_omr_server(
            engine_cmd=[sys.executable, self.fake_cli_path],
            job_timeout=55.0,
            subdir="data_multipage",
        )
        # Dynamic timeout scaling checks
        self.assertEqual(srv.service._effective_timeout(None), 55.0)
        self.assertEqual(srv.service._effective_timeout(1), 55.0)
        self.assertEqual(srv.service._effective_timeout(9), 55.0 + 8 * 45.0)
        self.assertEqual(srv.service._effective_timeout(50), 600.0)

        # Explicit small test timeout (<30s) is NOT scaled up
        small_srv, _ = self._start_omr_server(
            engine_cmd=[sys.executable, self.fake_cli_path],
            job_timeout=0.4,
            subdir="data_small_timeout",
        )
        self.assertEqual(small_srv.service._effective_timeout(9), 0.4)

        # PDF page count detection
        fake_pdf = (
            b"%PDF-1.4\n"
            b"1 0 obj << /Type /Pages /Count 4 >> endobj\n"
            b"2 0 obj << /Type /Page >> endobj\n"
            b"3 0 obj << /Type /Page >> endobj\n"
            b"4 0 obj << /Type /Page >> endobj\n"
            b"5 0 obj << /Type /Page >> endobj\n"
        )
        os.environ["FAKE_OMR_MODE"] = "multipage_stream"
        st, _h, raw = http_request(
            base,
            "POST",
            "/api/scan/jobs",
            fake_pdf,
            {"Content-Type": "application/pdf", "X-Filename": "choir-4page.pdf"},
        )
        self.assertEqual(st, 202)
        job_id = json.loads(raw.decode("utf-8"))["jobId"]

        seen_progress: List[int] = []
        seen_details: List[str] = []
        seen_pages: List[int] = []
        page1_progress: List[int] = []
        deadline = time.time() + 10.0
        final_job: Dict[str, Any] = {}
        while time.time() < deadline:
            st_p, _h, d = http_json(base, "GET", f"/api/scan/jobs/{job_id}")
            self.assertEqual(st_p, 200)
            self.assertIsInstance(d["progress"], int)
            self.assertGreaterEqual(d["progress"], 0)
            self.assertLessEqual(d["progress"], 100)
            if seen_progress:
                self.assertGreaterEqual(d["progress"], seen_progress[-1])
            seen_progress.append(d["progress"])
            if d.get("currentPage") == 1:
                page1_progress.append(d["progress"])
            if d.get("stageDetail"):
                seen_details.append(d["stageDetail"])
            if d.get("currentPage") is not None:
                seen_pages.append(d["currentPage"])
            if d["status"] in ("completed", "failed"):
                final_job = d
                break
            time.sleep(0.03)

        self.assertEqual(final_job.get("status"), "completed")
        self.assertEqual(final_job.get("progress"), 100)
        self.assertEqual(final_job.get("totalPages"), 4)
        self.assertEqual(final_job.get("currentPage"), 4)
        self.assertTrue(
            all(p < 40 for p in page1_progress),
            f"Book stored must not jump page 1 progress to 90%: {page1_progress}",
        )
        self.assertTrue(len(set(seen_progress)) >= 4, f"expected multiple progress ticks, got {seen_progress}")
        self.assertTrue(
            any("Page " in s and " of 4" in s for s in seen_details),
            f"expected multi-page stageDetail, got {seen_details}",
        )
        self.assertTrue(len(set(seen_pages)) >= 2, f"expected multiple currentPage ticks, got {seen_pages}")

        # Multi-movement output selection: prefer input.mxl over input.mvt1.mxl
        with tempfile.TemporaryDirectory(prefix="omr-mvt-") as mvt_dir:
            mvt1 = os.path.join(mvt_dir, "input.mvt1.mxl")
            combined = os.path.join(mvt_dir, "input.mxl")
            with open(mvt1, "wb") as f:
                f.write(omr_server.package_musicxml_to_mxl(self._demo_xml()))
            with open(combined, "wb") as f:
                f.write(omr_server.package_musicxml_to_mxl(self._demo_xml()))
            self.assertEqual(omr_server.find_audiveris_output(mvt_dir, input_stem="input"), combined)

    # 7. Partial invalid sheet recovery via saved .omr + -sheets export
    def test_07_partial_invalid_sheet_omr_recovery(self) -> None:
        _srv, base = self._start_omr_server(
            engine_cmd=[sys.executable, self.fake_cli_path],
            job_timeout=55.0,
            subdir="data_partial_invalid",
        )
        fake_pdf = (
            b"%PDF-1.4\n"
            b"1 0 obj << /Type /Pages /Count 3 >> endobj\n"
            b"2 0 obj << /Type /Page >> endobj\n"
            b"3 0 obj << /Type /Page >> endobj\n"
            b"4 0 obj << /Type /Page >> endobj\n"
        )
        os.environ["FAKE_OMR_MODE"] = "partial_invalid_sheet"
        st, _h, raw = http_request(
            base,
            "POST",
            "/api/scan/jobs",
            fake_pdf,
            {"Content-Type": "application/pdf", "X-Filename": "choir-with-blank-last.pdf"},
        )
        self.assertEqual(st, 202)
        job_id = json.loads(raw.decode("utf-8"))["jobId"]

        job = self._poll_job(base, job_id, timeout=10.0)
        self.assertEqual(job["status"], "completed")
        self.assertEqual(job["progress"], 100)
        self.assertEqual(job["skippedPages"], [3])
        self.assertTrue(bool(job["warning"]))
        self.assertIn("page 3", job["warning"].lower())
        self.assertIn("<work-title>Ode to Joy</work-title>", job["rawMusicxml"])
        # Invoked twice: pass 1 (PDF -> .omr) + pass 2 (.omr -sheets 1 2 -> .mxl)
        self.assertEqual(self._invocation_count(), 2)

    # 8. Vector PDF spoken/expression cue extraction via zlib stream inspection
    def test_08_pdf_spoken_cues_detection(self) -> None:
        _srv, base = self._start_omr_server(
            engine_cmd=[sys.executable, self.fake_cli_path],
            job_timeout=55.0,
            subdir="data_spoken_cues",
        )
        content_stream = (
            b"BT /F1 12 Tf 72 700 Td [(Spok) -15 (en)] TJ "
            b"0 -20 Td (Shout!) Tj "
            b"0 -20 Td (Spoken) Tj ET"
        )
        compressed = zlib.compress(content_stream)
        fake_pdf = (
            b"%PDF-1.4\n"
            b"1 0 obj << /Type /Pages /Count 1 >> endobj\n"
            b"2 0 obj << /Type /Page /Contents 3 0 R >> endobj\n"
            b"3 0 obj << /Filter /FlateDecode /Length "
            + str(len(compressed)).encode("ascii")
            + b" >>\nstream\n"
            + compressed
            + b"\nendstream\nendobj\n"
        )
        pdf_path = os.path.join(self.tmpdir.name, "spoken-cues.pdf")
        with open(pdf_path, "wb") as f:
            f.write(fake_pdf)

        cues = omr_server.extract_pdf_spoken_cues(pdf_path)
        self.assertEqual(cues, [{"text": "spoken", "count": 2}, {"text": "shout", "count": 1}])

        os.environ["FAKE_OMR_MODE"] = "mxl"
        st, _h, raw = http_request(
            base,
            "POST",
            "/api/scan/jobs",
            fake_pdf,
            {"Content-Type": "application/pdf", "X-Filename": "spoken-cues.pdf"},
        )
        self.assertEqual(st, 202)
        job_id = json.loads(raw.decode("utf-8"))["jobId"]

        job = self._poll_job(base, job_id, timeout=10.0)
        self.assertEqual(job["status"], "completed")
        self.assertEqual(
            job["detectedSpokenCues"],
            [{"text": "spoken", "count": 2}, {"text": "shout", "count": 1}],
        )

    # 9. Vector PDF text metadata, EngineAdapter abstraction & per-page adaptive retry
    def test_09_pdf_text_metadata_engine_adapter_and_adaptive_retry(self) -> None:
        # 1) EngineAdapter abstraction
        aud = omr_server.build_engine_adapter(
            omr_server.OMRConfig(audiveris_bin="/usr/bin/true", engine_cmd=None)
        )
        self.assertIsInstance(aud, omr_server.AudiverisAdapter)
        self.assertEqual(aud.name, "audiveris")
        self.assertIn("-transcribe", aud.build_command("/tmp/in.pdf", "/tmp/out"))
        self.assertIsNotNone(aud.build_export_sheets_command("/tmp/in.omr", [1, 2], "/tmp/out"))

        cust = omr_server.build_engine_adapter(
            omr_server.OMRConfig(engine_cmd=[sys.executable, self.fake_cli_path])
        )
        self.assertIsInstance(cust, omr_server.CustomCmdAdapter)
        self.assertEqual(cust.name, "custom")
        self.assertTrue(cust.is_available())

        # 2) Vector PDF text metadata extraction (dynamics, tempo, spokenCues, lyricVocabulary)
        _srv, base = self._start_omr_server(
            engine_cmd=[sys.executable, self.fake_cli_path],
            job_timeout=55.0,
            subdir="data_pdf_meta",
            preprocess=True,
        )
        content_stream = (
            b"BT /F1 12 Tf 72 720 Td (Allegro) Tj "
            b"0 -20 Td (mf) Tj 0 -20 Td (cresc.) Tj 0 -20 Td (ff) Tj "
            b"0 -20 Td (rit.) Tj 0 -20 Td [(Spok) -15 (en)] TJ "
            b"0 -20 Td (monster) Tj 0 -20 Td (forever) Tj ET"
        )
        compressed = zlib.compress(content_stream)
        fake_pdf = (
            b"%PDF-1.4\n"
            b"1 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n"
            b"2 0 obj << /Type /Pages /Count 1 >> endobj\n"
            b"3 0 obj << /Type /Page /Contents 4 0 R >> endobj\n"
            b"4 0 obj << /Filter /FlateDecode /Length "
            + str(len(compressed)).encode("ascii")
            + b" >>\nstream\n"
            + compressed
            + b"\nendstream\nendobj\n"
        )
        os.environ["FAKE_OMR_MODE"] = "mxl"
        st, _h, raw = http_request(
            base,
            "POST",
            "/api/scan/jobs",
            fake_pdf,
            {"Content-Type": "application/pdf", "X-Filename": "monster-meta.pdf"},
        )
        self.assertEqual(st, 202)
        job = self._poll_job(base, json.loads(raw.decode("utf-8"))["jobId"], timeout=10.0)
        self.assertEqual(job["status"], "completed")
        meta = job["pdfTextMeta"]
        self.assertIsInstance(meta, dict)
        self.assertTrue(meta["isVectorPdf"])
        self.assertIn("mf", meta["dynamics"])
        self.assertIn("ff", meta["dynamics"])
        self.assertIn("Allegro", meta["tempoMarkings"])
        self.assertEqual(meta["spokenCues"], [{"text": "spoken", "count": 1}])
        self.assertIn("monster", meta["lyricVocabulary"])
        self.assertIn("forever", meta["lyricVocabulary"])

        # 3) Per-page adaptive 400 DPI retry using a fake rehearsal-omr-prep in data_dir
        prep_dir = os.path.join(self.tmpdir.name, "data_adaptive_retry")
        os.makedirs(prep_dir, exist_ok=True)
        prep_bin = os.path.join(prep_dir, "rehearsal-omr-prep")
        with open(prep_bin, "w", encoding="utf-8") as f:
            f.write(
                "#!/usr/bin/env python3\n"
                "import os, sys\n"
                "if sys.argv[1] == 'pdf':\n"
                "    out_dir, page = sys.argv[3], int(sys.argv[5])\n"
                "    os.makedirs(out_dir, exist_ok=True)\n"
                "    with open(os.path.join(out_dir, f'page-{page:04d}.png'), 'wb') as out:\n"
                "        out.write(b'\\x89PNG_400DPI')\n"
                "    sys.exit(0)\n"
                "sys.exit(0)\n"
            )
        os.chmod(prep_bin, stat.S_IRWXU | stat.S_IRGRP | stat.S_IXGRP)

        _srv_r, base_r = self._start_omr_server(
            engine_cmd=[sys.executable, self.fake_cli_path],
            job_timeout=55.0,
            subdir="data_adaptive_retry",
            preprocess=True,
        )
        st_h, _h, health_r = http_json(base_r, "GET", "/health")
        self.assertEqual(st_h, 200)
        self.assertTrue(health_r["preprocessAvailable"])

        # Fake 1-page PDF where pass 1 flags invalid sheet, retry at 400 DPI succeeds
        os.environ["FAKE_OMR_MODE"] = "partial_invalid_sheet"
        # Use a dedicated mode in fake_cli via env for 1-page adaptive retry
        os.environ["FAKE_OMR_MODE"] = "adaptive_retry_pdf"
        st_r, _h, raw_r = http_request(
            base_r,
            "POST",
            "/api/scan/jobs",
            fake_pdf,
            {"Content-Type": "application/pdf", "X-Filename": "retry-1page.pdf"},
        )
        self.assertEqual(st_r, 202)
        job_r = self._poll_job(base_r, json.loads(raw_r.decode("utf-8"))["jobId"], timeout=10.0)
        self.assertEqual(job_r["status"], "completed")
        self.assertIn("<work-title>Ode to Joy</work-title>", job_r["rawMusicxml"])

    # 10. 3-way scanMode normalization, cache isolation, and notes-only OCR skip
    def test_10_scan_mode_and_notes_only_ocr_skip(self) -> None:
        self.assertEqual(omr_server.normalize_scan_mode(None), "full")
        self.assertEqual(omr_server.normalize_scan_mode("bogus"), "full")
        self.assertEqual(omr_server.normalize_scan_mode("Notes-Lyrics"), "notes-lyrics")
        self.assertEqual(omr_server.normalize_scan_mode("notes-only"), "notes-only")

        tess_dir = os.path.join(self.tmpdir.name, "tess_mode_test")
        os.makedirs(tess_dir, exist_ok=True)
        with open(os.path.join(tess_dir, "eng.traineddata"), "wb") as f:
            f.write(b"FAKE")
        tess_log = os.path.join(self.tmpdir.name, "tess_env.log")
        os.environ["FAKE_OMR_TESS_LOG"] = tess_log
        os.environ["FAKE_OMR_MODE"] = "mxl"

        data_dir = os.path.join(self.tmpdir.name, "data_scan_modes")
        cfg = omr_server.OMRConfig(
            host="127.0.0.1",
            port=0,
            data_dir=data_dir,
            engine_cmd=[sys.executable, self.fake_cli_path],
            tessdata_dir=tess_dir,
            job_timeout=10.0,
            workers=1,
            preprocess=False,
        )
        if self._use_tcp:
            srv = omr_server.create_server(cfg)
            self._register_server(srv)
            base = f"http://127.0.0.1:{srv.server_address[1]}"
        else:
            service = omr_server.OMRService(cfg)
            stub = _InProcServerStub(service)
            base = f"inproc://omr-{id(stub)}"
            _INPROC_TARGETS[base] = (omr_server.OMRRequestHandler, stub)
            self._inproc_keys.append(base)

        try:
            content_stream = b"BT /F1 12 Tf 72 700 Td (Spoken) Tj ET"
            compressed = zlib.compress(content_stream)
            pdf_bytes = (
                b"%PDF-1.4\n1 0 obj << /Type /Font >> endobj\n"
                b"2 0 obj << /Type /Pages /Count 1 >> endobj\n"
                b"3 0 obj << /Type /Page /Contents 4 0 R >> endobj\n"
                b"4 0 obj << /Filter /FlateDecode /Length "
                + str(len(compressed)).encode("ascii")
                + b" >>\nstream\n"
                + compressed
                + b"\nendstream\nendobj\n"
            )

            # 1) notes-lyrics: keeps OCR & TESSDATA_PREFIX
            body1, ctype1 = build_multipart(
                {"scanMode": "notes-lyrics"},
                ("file", "choir.pdf", "application/pdf", pdf_bytes),
            )
            st1, _h, created1 = http_post_raw_json(base, "/api/scan/jobs", body1, {"Content-Type": ctype1})
            self.assertEqual(st1, 202)
            self.assertEqual(created1["scanMode"], "notes-lyrics")
            job1 = self._poll_job(base, created1["jobId"], timeout=10.0)
            self.assertEqual(job1["status"], "completed")
            self.assertEqual(job1["scanMode"], "notes-lyrics")
            self.assertEqual(job1["detectedSpokenCues"], [{"text": "spoken", "count": 1}])

            # Confirm notes-lyrics job into cache
            st_c1, _h, _ = http_json(
                base,
                "POST",
                f"/api/scan/jobs/{job1['jobId']}/confirm",
                {"correctedXml": self._demo_xml(), "flaggedLog": []},
            )
            self.assertEqual(st_c1, 200)

            # 2) notes-only with exact same PDF bytes: must NOT hit notes-lyrics cache,
            #    must NOT set TESSDATA_PREFIX, and must skip extract_pdf_text_metadata!
            body2, ctype2 = build_multipart(
                {"scanMode": "notes-only"},
                ("file", "choir.pdf", "application/pdf", pdf_bytes),
            )
            st2, _h, created2 = http_post_raw_json(base, "/api/scan/jobs", body2, {"Content-Type": ctype2})
            self.assertEqual(st2, 202)
            self.assertFalse(created2["cacheHit"])
            self.assertEqual(created2["scanMode"], "notes-only")
            job2 = self._poll_job(base, created2["jobId"], timeout=10.0)
            self.assertEqual(job2["status"], "completed")
            self.assertEqual(job2["scanMode"], "notes-only")
            self.assertEqual(job2["detectedSpokenCues"], [])
            self.assertIsNone(job2["pdfTextMeta"])

            with open(tess_log, "r", encoding="utf-8") as f:
                tess_lines = [ln.strip() for ln in f if ln.strip()]
            self.assertEqual(tess_lines, [tess_dir, "<UNSET>"])
        finally:
            os.environ.pop("FAKE_OMR_TESS_LOG", None)

    # 11. Partial .omr recovery via inspect_omr_pages when stdout has Error in reaching step PAGE
    def test_11_omr_recovery_via_inspect_omr_pages_without_invalid_log(self) -> None:
        _srv, base = self._start_omr_server(
            engine_cmd=[sys.executable, self.fake_cli_path],
            job_timeout=55.0,
            subdir="data_omr_inspect_recovery",
        )
        fake_pdf = (
            b"%PDF-1.4\n"
            b"1 0 obj << /Type /Pages /Count 3 >> endobj\n"
            b"2 0 obj << /Type /Page >> endobj\n"
            b"3 0 obj << /Type /Page >> endobj\n"
            b"4 0 obj << /Type /Page >> endobj\n"
        )
        os.environ["FAKE_OMR_MODE"] = "omr_book_page_error"
        st, _h, raw = http_request(
            base,
            "POST",
            "/api/scan/jobs",
            fake_pdf,
            {"Content-Type": "application/pdf", "X-Filename": "homeward-bound-test.pdf"},
        )
        self.assertEqual(st, 202)
        job = self._poll_job(base, json.loads(raw.decode("utf-8"))["jobId"], timeout=10.0)
        self.assertEqual(job["status"], "completed")
        self.assertEqual(job["skippedPages"], [1])
        self.assertTrue(bool(job["warning"]))
        self.assertIn("page 1", job["warning"].lower())
        self.assertIn("<work-title>Ode to Joy</work-title>", job["rawMusicxml"])

    # 12. JAVA_TOOL_OPTIONS legacyMergeSort + incomplete sheet exclusion from .omr recovery
    def test_12_legacy_mergesort_env_and_incomplete_sheet_exclusion(self) -> None:
        _srv, base = self._start_omr_server(
            engine_cmd=[sys.executable, self.fake_cli_path],
            job_timeout=55.0,
            subdir="data_incomplete_sheet",
        )
        java_log = os.path.join(self.tmpdir.name, "java_opts.log")
        os.environ["FAKE_OMR_JAVA_LOG"] = java_log
        os.environ["FAKE_OMR_MODE"] = "incomplete_sheet_crash"
        try:
            fake_pdf = (
                b"%PDF-1.4\n"
                b"1 0 obj << /Type /Pages /Count 3 >> endobj\n"
                b"2 0 obj << /Type /Page >> endobj\n"
                b"3 0 obj << /Type /Page >> endobj\n"
                b"4 0 obj << /Type /Page >> endobj\n"
            )
            st, _h, raw = http_request(
                base,
                "POST",
                "/api/scan/jobs",
                fake_pdf,
                {"Content-Type": "application/pdf", "X-Filename": "little-fishes-test.pdf"},
            )
            self.assertEqual(st, 202)
            job = self._poll_job(base, json.loads(raw.decode("utf-8"))["jobId"], timeout=10.0)
            self.assertEqual(job["status"], "completed")
            self.assertEqual(job["skippedPages"], [3])
            self.assertIn("page 3", job["warning"].lower())
            self.assertIn("<work-title>Ode to Joy</work-title>", job["rawMusicxml"])

            with open(java_log, "r", encoding="utf-8") as f:
                java_lines = [ln.strip() for ln in f if ln.strip()]
            self.assertTrue(len(java_lines) >= 1)
            for ln in java_lines:
                self.assertIn("-Djava.util.Arrays.useLegacyMergeSort=true", ln)
        finally:
            os.environ.pop("FAKE_OMR_JAVA_LOG", None)

    # 13. extract_pdf_text_metadata finishes fast on large binary/image stream noise
    def test_13_extract_pdf_text_metadata_fast_on_binary_noise(self) -> None:
        noisy_image_stream = (b"\xff\xd8\xff\xe0[unclosed_bracket_noise" * 4000)
        compressed_text = zlib.compress(b"BT /F1 12 Tf 72 700 Td (Allegro) Tj (mf) Tj ET")
        noisy_pdf = (
            b"%PDF-1.4\n"
            b"1 0 obj << /Type /Font >> endobj\n"
            b"2 0 obj << /Subtype /Image /Filter /DCTDecode /Length "
            + str(len(noisy_image_stream)).encode("ascii")
            + b" >>\nstream\n"
            + noisy_image_stream
            + b"\nendstream\nendobj\n"
            b"3 0 obj << /Filter /FlateDecode /Length "
            + str(len(compressed_text)).encode("ascii")
            + b" >>\nstream\n"
            + compressed_text
            + b"\nendstream\nendobj\n"
        )
        pdf_path = os.path.join(self.tmpdir.name, "noisy-binary.pdf")
        with open(pdf_path, "wb") as f:
            f.write(noisy_pdf)

        t0 = time.monotonic()
        meta = omr_server.extract_pdf_text_metadata(pdf_path)
        elapsed = time.monotonic() - t0
        self.assertLess(elapsed, 1.0)
        self.assertTrue(meta["isVectorPdf"])
        self.assertIn("Allegro", meta["tempoMarkings"])
        self.assertIn("mf", meta["dynamics"])

    # 14. Parallel multi-run returns first fast variant and attaches alternates asynchronously
    def test_14_parallel_multirun_returns_first_fast_and_attaches_alternates(self) -> None:
        data_dir = os.path.join(self.tmpdir.name, "data_multirun")
        cfg = omr_server.OMRConfig(
            host="127.0.0.1",
            port=0,
            data_dir=data_dir,
            engine_cmd=[sys.executable, self.fake_cli_path],
            job_timeout=10.0,
            workers=3,
            preprocess=False,
            multi_run_mode="all",
        )
        if self._use_tcp:
            srv = omr_server.create_server(cfg)
            self._register_server(srv)
            base = f"http://127.0.0.1:{srv.server_address[1]}"
        else:
            service = omr_server.OMRService(cfg)
            stub = _InProcServerStub(service)
            base = f"inproc://omr-{id(stub)}"
            _INPROC_TARGETS[base] = (omr_server.OMRRequestHandler, stub)
            self._inproc_keys.append(base)

        st_h, _h, health = http_json(base, "GET", "/health")
        self.assertEqual(st_h, 200)
        self.assertEqual(health["multiRun"], "all")

        os.environ["FAKE_OMR_MODE"] = "multirun_variants"
        body, ctype = build_multipart(
            {"multiRun": "all"},
            ("file", "multirun.png", "image/png", b"\x89PNG_MULTIRUN_TEST"),
        )
        st, _h, created = http_post_raw_json(base, "/api/scan/jobs", body, {"Content-Type": ctype})
        self.assertEqual(st, 202)
        job_id = created["jobId"]

        job = self._poll_job(base, job_id, timeout=5.0)
        self.assertEqual(job["status"], "completed")
        self.assertEqual(job["multiRun"], "all")
        self.assertIn("<work-title>Variant v300</work-title>", job["rawMusicxml"])

        # Wait briefly for background collector thread to attach v400 & v350c alternates
        deadline = time.time() + 5.0
        alts: List[Dict[str, Any]] = job.get("alternateRuns") or []
        while len(alts) < 2 and time.time() < deadline:
            time.sleep(0.05)
            _, _, latest = http_json(base, "GET", f"/api/scan/jobs/{job_id}")
            alts = latest.get("alternateRuns") or []

        self.assertEqual(len(alts), 2)
        by_var = {a["variant"]: a for a in alts}
        self.assertIn("v400", by_var)
        self.assertIn("v350c", by_var)
        self.assertEqual(by_var["v400"]["status"], "completed")
        self.assertIn("<work-title>Variant v400</work-title>", by_var["v400"]["rawMusicxml"])
        self.assertGreaterEqual(by_var["v400"]["seconds"], 0.25)
        self.assertEqual(by_var["v350c"]["status"], "completed")
        self.assertIn("<work-title>Variant v350c</work-title>", by_var["v350c"]["rawMusicxml"])

    # 15. 24-hour auto-cleanup deletes expired jobs and preserves fresh jobs
    def test_15_cleanup_expired_jobs_deletes_after_24h(self) -> None:
        data_dir = os.path.join(self.tmpdir.name, "data_cleanup")
        cfg = omr_server.OMRConfig(
            host="127.0.0.1",
            port=0,
            data_dir=data_dir,
            engine_cmd=[sys.executable, self.fake_cli_path],
            job_timeout=10.0,
            workers=1,
            preprocess=False,
            retention_hours=24.0,
        )
        service = omr_server.OMRService(cfg)
        try:
            os.environ["FAKE_OMR_MODE"] = "mxl"
            expired = service.create_job(
                "old.png", "image/png", ".png", b"\x89PNG_OLD_JOB"
            )
            fresh = service.create_job(
                "new.png", "image/png", ".png", b"\x89PNG_FRESH_JOB"
            )
            # Wait for both to settle
            deadline = time.time() + 5.0
            while time.time() < deadline:
                r1 = service.get_job_row(expired["jobId"])
                r2 = service.get_job_row(fresh["jobId"])
                if r1 and r2 and r1["status"] == "completed" and r2["status"] == "completed":
                    break
                time.sleep(0.05)

            old_ts = "2020-01-01T00:00:00Z"
            with service._db_lock:
                conn = service._connect()
                try:
                    conn.execute(
                        "UPDATE scan_jobs SET created_at = ?, updated_at = ? WHERE job_id = ?",
                        (old_ts, old_ts, expired["jobId"]),
                    )
                    conn.commit()
                finally:
                    conn.close()
            exp_dir = os.path.join(service.jobs_dir, expired["jobId"])
            os.utime(exp_dir, (1577836800, 1577836800))

            deleted = service.cleanup_expired_jobs()
            self.assertEqual(deleted, 1)
            self.assertIsNone(service.get_job_row(expired["jobId"]))
            self.assertFalse(os.path.exists(exp_dir))
            self.assertIsNotNone(service.get_job_row(fresh["jobId"]))
            self.assertTrue(os.path.isdir(os.path.join(service.jobs_dir, fresh["jobId"])))
        finally:
            service.stop()


def main() -> int:
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(OMRServiceTestSuite)
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main())
