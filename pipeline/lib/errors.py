#!/usr/bin/env python
# Copied unchanged from instagramReels/pipeline/lib/errors.py (the BUILD_SPEC.md and DECISIONS.md references point to that project).
"""Classify a failed claude -p call and normalize error signatures (BUILD_SPEC.md section 4).

The classifier runs after every model call made by ai() (pipeline/lib/ai.sh), in the spec's order:
  1. limit      a usage limit (session, weekly, usage): wait until the reset (limits.py parses it), then retry
  2. transient  overloaded or 529, 5xx, timeouts, network resets, rate limits with retry-after: back off and retry
  3. error      a code or runtime error: the review and fix loop (4.2)
  ok            exit 0, a JSON result with is_error false
Quality gate failures never reach this classifier: they are the stages' own loops. The same classifier reads the
tail of a failed stage script's log (runner_stage_failed): strip_echo() drops the source lines that Python
tracebacks and Node stack frames echo before any pattern runs, and a timeout has to look like an error. The
one-line message never carries an em dash (undash(): it becomes ", "), because it travels into the ERROR line,
state.json, history.txt, blocked.txt, STOPPED.md and E<n>.md, and no file or terminal line may hold one
(BUILD_SPEC.md 0.7; the bash side is reels_undash in log.sh).

Usage:
  errors.py classify --rc N [--stdout FILE] [--stderr FILE] [--tz ZONE] [--now EPOCH] [--margin S]
      prints JSON: class (ok|limit|transient|error), message (one line for the ERROR line), detail (a short label
      such as "overloaded" for the RETRY line), retry_after (seconds or null), session_id, structured (true when
      the result has structured_output), api_error_status, fatal (login, key, unknown option: the reviewer would
      hit the same wall), resume_failed (the --resume session does not exist), limit (limits.py detect output)
  errors.py signature TEXT | --stdin
      the normalized signature: digits, paths, hex ids and timestamps stripped, lower-cased, whitespace collapsed,
      sha1, first 12 characters (DECISIONS.md 19)
Exit 0. JSON on stdout, LF line endings.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import limits  # noqa: E402

TRANSIENT_STATUS = {408, 409, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 529}
# The text patterns also run on the tail of a failed stage's log (runner_stage_failed), which is far noisier than a
# CLI result: the error codes are word-bounded (ENOTFOUND used to match inside "FileNotFoundError"), an HTTP status
# counts only next to a word that makes it one ("API Error: 503", "status 500", not "wrote 503 bytes"), and
# "temporary" alone is not an outage ("temporary file"). A timeout has to look like an error ("timed out",
# TimeoutError, ETIMEDOUT, "timeout exceeded", exit 124 or 137), never the bare word: tracebacks echo source lines
# such as `subprocess.run(cmd, timeout=600)` (DECISIONS.md 92), and strip_echo() below removes those lines first.
# The network wordings are the ones this PC really produces (M3 review 3, fix 1; DECISIONS.md 93): Node's and
# Linux's codes, Claude Code's own messages ("No response from API", "Can't reach the API server", "Unable to
# connect to API (...)", "Connection dropped", the SDK's "Connection error." and "terminated"), Windows Python's
# exceptions (ConnectionResetError with WinError 10054, ConnectionAbortedError, ConnectionRefusedError with WinError
# 10061, RemoteDisconnected, "Connection aborted"), Chromium's net::ERR_* through Playwright, gh's "error connecting
# to" together with its "check your internet connection" line, curl's "Could not resolve host" and "Failed to
# connect to". Each code is word-bounded and each phrase whole, so KeyError, FileNotFoundError or a plain
# "connection" in a log line stay code errors.
STATUS_CONTEXT = r"(?:api error|http|status(?: code)?|error|code)[:= ]+"
TIMEOUT_WORDS = (
    r"timed[ -]out"
    r"|\b\w*timeout(?:error|exception|expired)\b"
    r"|\bE(?:SOCKET)?TIMEDOUT\b|\bUND_ERR_\w*TIMEOUT\b"
    r"|\btimeout (?:exceeded|expired|reached|elapsed|occurred|after \d|of \d|while |waiting )"
    r"|\btimeout \d+ ?ms exceeded|\bi/o timeout\b|due to (?:a )?timeout\b"
    r"|\b(?:request|connection|connect|read|handshake|navigation|socket|response|idle|operation|network|upstream|api)"
    r" timeout\b(?!\s*[=:]?\s*\d)"
    r"|deadline exceeded"
)
RESET_WORDS = (
    r"\bECONNRESET\b|connection reset|socket hang up|\bEPIPE\b"
    r"|\bConnectionResetError\b|\bConnectionAbortedError\b|\bBrokenPipeError\b|\bRemoteDisconnected\b"
    r"|connection aborted|forcibly closed by the remote host|remote end closed connection"
    r"|\b(?:WinError|Errno) 1005[34]\b|connection dropped"
)
REFUSED_WORDS = (
    r"\bECONNREFUSED\b|connection refused|\bConnectionRefusedError\b|\bConnectionRefused\b|actively refused"
    r"|\b(?:WinError|Errno) 10061\b|couldn.t connect to server|failed to connect to\b"
)
NETWORK_WORDS = (
    r"\bEAI_AGAIN\b|\bENOTFOUND\b|getaddrinfo|network error|fetch failed|network is unreachable|\bENETUNREACH\b"
    r"|\bEHOSTUNREACH\b|\bENETDOWN\b"
    r"|no response from api|can.t reach the api server|unable to connect to api|\bFailedToOpenSocket\b"
    r"|\bconnection error\.|api error: terminated\b"
    r"|\bnet::ERR_(?:CONNECTION_\w+|NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|NETWORK_\w+|TIMED_OUT|ADDRESS_UNREACHABLE"
    r"|EMPTY_RESPONSE|PROXY_CONNECTION_FAILED|SOCKET_NOT_CONNECTED)\b"
    r"|could not resolve host|error connecting to\b(?=(?s:.*)check your internet connection)"
    r"|\bConnectionError\b|\bNewConnectionError\b|\bNameResolutionError\b|max retries exceeded"
)
STREAM_WORDS = (
    r"stream (was )?(interrupted|closed)|incomplete (response|chunked)"
    r"|connection closed mid-response|the response stopped arriving|response above may be incomplete"
)
TRANSIENT_PATTERNS = [
    (r"overloaded", "overloaded"),
    (STATUS_CONTEXT + r"529\b", "overloaded"),
    (r"rate[_ -]?limit", "rate limit"),
    (r"too many requests|" + STATUS_CONTEXT + r"429\b", "rate limit"),
    (r"retry[- _]?after", "rate limit"),
    (TIMEOUT_WORDS, "timeout"),
    (RESET_WORDS, "connection reset"),
    (REFUSED_WORDS, "connection refused"),
    (NETWORK_WORDS, "network error"),
    (r"internal server error|server_error|api_error|" + STATUS_CONTEXT + r"50[0-4]\b|bad gateway|service unavailable|gateway timeout", "server error"),
    (r"temporarily unavailable|try again later|temporary (?:error|failure|problem|outage)|temporarily (?:overloaded|down)", "temporary error"),
    (STREAM_WORDS, "stream interrupted"),
]
FATAL_PATTERNS = [
    r"not logged in", r"run /login", r"please log in", r"authentication[_ ]failed", r"invalid api key",
    r"invalid_api_key", r"authentication_error", r"unknown option", r"error: unknown", r"unrecognized_model",
    r"billing_error", r"account_on_hold", r"oauth_org_not_allowed", r"model_not_found", r"command not found",
    r"is not recognized as an internal or external command", r"permission_error", r"credit balance",
]
RESUME_FAILED_RE = re.compile(r"no conversation found with session id", re.IGNORECASE)
RETRY_AFTER_RE = re.compile(r"retry[- _]?after[\"':=\s]+(\d+)", re.IGNORECASE)


def setup_streams() -> None:
    for stream in (sys.stdout, sys.stderr):  # Windows Python writes CRLF to pipes otherwise
        try:
            stream.reconfigure(encoding="utf-8", newline="\n")
        except (AttributeError, ValueError):
            pass


def read(path: str | None) -> str:
    if not path or not os.path.isfile(path):
        return ""
    with open(path, "rb") as f:
        return f.read().decode("utf-8", "replace").replace("\r\n", "\n").replace("\r", "\n")


FILE_LINE_RE = re.compile(r'^(\s*)File ".*", line \d+')
CARET_RE = re.compile(r"^\s*[\^~]+[\^~\s]*$")
FRAME_RE = re.compile(r"^\s+at\s+\S")


def strip_echo(text: str) -> str:
    """Remove the source code that tracebacks echo, so a frame like `subprocess.run(cmd, timeout=600)` or a Node
    frame `at Timeout._onTimeout (...)` cannot pass for an error message (DECISIONS.md 92): the lines indented
    deeper than a Python `File "...", line N` line (the code and its carets), caret-only lines and the code line
    above them (Node's uncaught-exception header), and JavaScript stack frames (`    at ...`). The exception lines
    themselves, chained causes and ordinary log lines stay."""
    lines = text.split("\n")
    drop: set[int] = set()
    file_indent = None
    for i, line in enumerate(lines):
        if not line.strip():
            file_indent = None
            continue
        m = FILE_LINE_RE.match(line)
        if m:
            file_indent = len(m.group(1))
            continue
        indent = len(line) - len(line.lstrip())
        if file_indent is not None and indent > file_indent:
            drop.add(i)
            continue
        file_indent = None
        if CARET_RE.match(line):
            drop.add(i)
            if i > 0 and not FILE_LINE_RE.match(lines[i - 1]):
                drop.add(i - 1)
        elif FRAME_RE.match(line):
            drop.add(i)
    return "\n".join(line for i, line in enumerate(lines) if i not in drop)


def parse_result(stdout: str) -> dict | None:
    text = stdout.strip()
    if not text:
        return None
    for candidate in (text, text.split("\n")[-1]):
        try:
            data = json.loads(candidate)
        except ValueError:
            continue
        if isinstance(data, dict):
            return data
    return None


def one_line(text: str, limit: int = 220) -> str:
    for line in text.split("\n"):
        line = line.strip()
        if line:
            return line[:limit]
    return ""


def last_line(text: str, limit: int = 220) -> str:
    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
    return lines[-1][:limit] if lines else ""


EM_DASH = chr(0x2014)  # built from the code points so this file never contains one
EN_DASH = chr(0x2013)


def undash(text: str) -> str:
    """An em dash becomes ", " whatever the spaces around it, one at either end is dropped; an en dash between spaces
    is treated the same and one inside a word (a range of numbers) becomes a hyphen. The same rules as reels_undash
    in log.sh (M3 review 3, fix 2)."""
    if EM_DASH not in text and EN_DASH not in text:
        return text
    text = re.sub(r"\s+" + EN_DASH + r"\s+", " " + EM_DASH + " ", text).replace(EN_DASH, "-")
    text = re.sub(r"^\s*" + EM_DASH + r"+\s*|\s*" + EM_DASH + r"+\s*$", "", text)
    return re.sub(r"\s*" + EM_DASH + r"+\s*", ", ", text)


def signature(text: str) -> str:
    t = text.strip()
    t = re.sub(r"\d{4}-\d{2}-\d{2}[ T_]\d{2}:?\d{2}(:?\d{2})?", " ", t)      # timestamps
    t = re.sub(r"\b\d{1,2}:\d{2}(:\d{2})?\b", " ", t)                        # times
    t = re.sub(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", " ", t, flags=re.I)  # uuids
    t = re.sub(r"\S*[\\/]\S*", " ", t)                                        # paths: any token with a slash
    t = re.sub(r"\b[0-9a-fA-F]{8,}\b", " ", t)                                # hex ids and hashes
    t = re.sub(r"\d+", "N", t)                                                # numbers
    t = re.sub(r"\s+", " ", t).strip().lower()
    return hashlib.sha1(t.encode("utf-8")).hexdigest()[:12]


def classify(rc: int, stdout: str, stderr: str, tz: str, now_epoch: int, margin: int) -> dict:
    out = classify_raw(rc, stdout, stderr, tz, now_epoch, margin)
    out["message"] = undash(out["message"])   # the one-line message goes into lines and files that may hold no em dash
    return out


def classify_raw(rc: int, stdout: str, stderr: str, tz: str, now_epoch: int, margin: int) -> dict:
    data = parse_result(stdout)
    session_id = data.get("session_id") if data else None
    is_error = bool(data.get("is_error")) if data else None
    status = data.get("api_error_status") if data else None
    out = {
        "class": "error", "message": "", "detail": "", "retry_after": None, "session_id": session_id,
        "structured": bool(data and isinstance(data.get("structured_output"), (dict, list))),
        "api_error_status": status, "fatal": False, "resume_failed": False, "rc": rc, "limit": None,
        "json": data is not None, "is_error": is_error,
    }
    if rc == 0 and data is not None and not is_error and data.get("type", "result") == "result":
        out["class"] = "ok"
        return out
    if rc == 0 and data is None and stdout.strip():
        out["class"] = "error"
        out["message"] = "the call exited 0 but printed no JSON result: " + one_line(stdout)
        return out

    result_text = str(data.get("result") or "") if data else ""
    # the patterns read the text without the source lines that tracebacks echo (the message below keeps the raw text)
    text = "\n".join(part for part in (result_text, strip_echo(stdout if data is None else ""), strip_echo(stderr)) if part)
    first = one_line(result_text) or last_line(stderr) or one_line(stdout) or f"exit {rc} with no output"
    if status:
        first = f"api error {status}: {first}" if first and not first.startswith(("api error", "API Error")) else first
    out["message"] = first

    default_zone, _ = limits.zone_for(tz, limits.local_zone())
    now = datetime.fromtimestamp(now_epoch, tz=timezone.utc)
    lim = limits.detect(text, now, default_zone, margin)
    if lim.get("limit"):
        out["class"] = "limit"
        out["limit"] = lim
        out["detail"] = lim.get("kind", "usage") + " limit"
        out["message"] = lim.get("message") or first
        return out

    m = RETRY_AFTER_RE.search(text)
    if m:
        out["retry_after"] = int(m.group(1))
    if rc in (124, 137):
        out["class"] = "transient"
        out["detail"] = "timeout"
        out["message"] = f"the call was killed after the timeout (exit {rc})"
        return out
    if status in TRANSIENT_STATUS:
        out["class"] = "transient"
        out["detail"] = "overloaded" if status == 529 else ("rate limit" if status == 429 else f"server error {status}")
        return out
    for pattern in FATAL_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            out["class"] = "error"
            out["fatal"] = True
            out["detail"] = "fatal"
            return out
    if RESUME_FAILED_RE.search(text):
        out["class"] = "error"
        out["resume_failed"] = True
        out["detail"] = "resume failed"
        return out
    for pattern, label in TRANSIENT_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            out["class"] = "transient"
            out["detail"] = label
            return out
    out["class"] = "error"
    return out


def main(argv=None) -> int:
    setup_streams()
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    sp = sub.add_parser("classify")
    sp.add_argument("--rc", type=int, required=True)
    sp.add_argument("--stdout")
    sp.add_argument("--stderr")
    sp.add_argument("--tz", default="")
    sp.add_argument("--now", type=int, default=None)
    sp.add_argument("--margin", type=int, default=120)
    sp = sub.add_parser("signature")
    sp.add_argument("text", nargs="?", default="")
    sp.add_argument("--stdin", action="store_true")
    args = parser.parse_args(argv)
    if args.cmd == "signature":
        text = sys.stdin.buffer.read().decode("utf-8", "replace") if args.stdin else args.text
        print(signature(text))
        return 0
    now_epoch = args.now if args.now is not None else int(time.time())
    out = classify(args.rc, read(args.stdout), read(args.stderr), args.tz, now_epoch, args.margin)
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
