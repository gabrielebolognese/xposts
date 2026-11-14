"""Shared helpers for the auto post pipeline: paths, config, JSON files, log lines, Rome time, prompt templates."""
from __future__ import annotations

import json
import os
import re
import shutil
import sys
import time
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

PIPE = Path(__file__).resolve().parents[1]          # x-autopost/pipeline
ROOT = PIPE.parent                                  # x-autopost
DATA = PIPE / "data"
RUNS = PIPE / "runs"
REVIEW = PIPE / "review"
LOGS = PIPE / "logs"
ROME = ZoneInfo("Europe/Rome")

for stream in (sys.stdout, sys.stderr):  # Windows Python writes CRLF and cp1252 to pipes otherwise
    try:
        stream.reconfigure(encoding="utf-8", newline="\n")
    except (AttributeError, ValueError):
        pass

_config = None


def cfg(key: str, default=None):
    """A dotted key from pipeline/config.json (POSTS_CONFIG overrides the file, for tests)."""
    global _config
    if _config is None:
        _config = load_json(Path(os.environ.get("POSTS_CONFIG", PIPE / "config.json")), {})
    cur = _config
    for part in key.split("."):
        if not isinstance(cur, dict) or part not in cur:
            if default is None:
                raise KeyError(f"config.json has no {key}")
            return default
        cur = cur[part]
    return cur


def load_json(path: Path, default=None):
    try:
        with open(path, encoding="utf-8-sig") as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def save_json(path: Path, data) -> None:
    """Write aside, then rename, so a reader (or a Ctrl+C) never leaves a half written file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}")
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    for attempt in range(10):  # OneDrive or an editor can hold the target open for a moment
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            time.sleep(0.3 * (attempt + 1))
    os.replace(tmp, path)


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def undash(text: str) -> str:
    """No line or file of this project may hold an em dash: external text gets ", " instead."""
    return re.sub(r"\s*" + chr(0x2014) + r"+\s*", ", ", text)


def say(tag: str, text: str) -> None:
    """[HH:MM] TAG    text, on the terminal and in logs/runner.log."""
    line = f"[{datetime.now():%H:%M}] {tag:<6} {undash(str(text))}"
    print(line, flush=True)
    LOGS.mkdir(parents=True, exist_ok=True)
    with open(LOGS / "runner.log", "a", encoding="utf-8", newline="\n") as f:
        f.write(line + "\n")


def now_rome(epoch: float | None = None) -> datetime:
    return datetime.fromtimestamp(time.time() if epoch is None else epoch, ROME)


def slot_name(dt: datetime) -> str:
    """Queue folder name: YYYY-MM-DD_HHMM in Rome wall clock time."""
    return dt.astimezone(ROME).strftime("%Y-%m-%d_%H%M")


def slot_time(name: str) -> datetime | None:
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})", name)
    if not m:
        return None
    y, mo, d, h, mi = map(int, m.groups())
    return datetime(y, mo, d, h, mi, tzinfo=ROME)


def days_ago(iso: str | None) -> float:
    """Days since an ISO date or datetime (naive values count as Rome time); 9999 when missing or unreadable."""
    if not iso:
        return 9999.0
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return 9999.0
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=ROME)
    return (now_rome() - dt) / timedelta(days=1)


def render(name: str, **values) -> str:
    """pipeline/prompts/<name>.md with every {{KEY}} filled; a key without a value is an error."""
    text = (PIPE / "prompts" / f"{name}.md").read_text(encoding="utf-8")
    def fill(m):
        key = m.group(1)
        if key not in values:
            raise KeyError(f"prompt {name}: no value for {{{{{key}}}}}")
        v = values[key]
        return v if isinstance(v, str) else json.dumps(v, ensure_ascii=False, indent=1)
    return re.sub(r"\{\{([A-Z_]+)\}\}", fill, text)


def gh() -> str:
    """The GitHub CLI: on PATH in a fresh Git Bash, or its default install folder."""
    return shutil.which("gh") or "C:/Program Files/GitHub CLI/gh.exe"


def rulebook() -> str:
    """The thread rulebook, the single source of truth for every writing prompt."""
    text = (ROOT / ".claude" / "skills" / "x-threads" / "SKILL.md").read_text(encoding="utf-8")
    return re.sub(r"^---\n.*?\n---\n", "", text, flags=re.S).strip()


def history() -> list:
    return load_json(DATA / "history.json", [])


def add_history(entry: dict) -> None:
    items = history()
    items.append({**entry, "at": now_rome().isoformat(timespec="seconds")})
    save_json(DATA / "history.json", items)


@contextmanager
def queue_lock(wait_seconds: float = 900, stale_seconds: float = 1200):
    """One process at a time changes queue/, posted/ or missed/ and runs git: the posting loop (poster.py) and the
    arrangement (virality.arrange). A lock left by a crashed process is taken over after stale_seconds (age based:
    on Windows os.kill(pid, 0) would end the process instead of testing it)."""
    lock = PIPE / ".queue-lock"
    start = time.time()
    while True:
        try:
            lock.mkdir()
            break
        except FileExistsError:
            try:
                if time.time() - lock.stat().st_mtime > stale_seconds:
                    shutil.rmtree(lock, ignore_errors=True)
                    continue
            except FileNotFoundError:
                continue
            if time.time() - start > wait_seconds:
                raise TimeoutError(f"{lock} is held by another process")
            time.sleep(0.5)
    try:
        yield
    finally:
        shutil.rmtree(lock, ignore_errors=True)


def bump_session(key: str) -> None:
    """Count an outcome for the stop summary (queued, review, dropped, searches)."""
    s = load_json(DATA / "session.json", {})
    s[key] = s.get(key, 0) + 1
    save_json(DATA / "session.json", s)
