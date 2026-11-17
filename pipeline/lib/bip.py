"""The daily build-in-public post. run.sh runs this every minute. From bip.time (20:00), until today's post is made,
it serves a small form at http://127.0.0.1:<bip.port> and opens it in the browser: the replies written today and
today's views. On submit:
  1. Jarvis's /mbrief for the last bip.brief_minutes (Jarvis's API on this PC): what got done today, all projects
  2. two screenshots: Jarvis's STATISTICS tab (lib/bip-shot.mjs) and today's Claude Studio project
  3. Opus writes the parts from pipeline/prompts/bip.md (hook, what Claude Studio built, the X numbers, what got
     done); the code adds the fixed lines (the day opener and the closer) and checks the format
  4. queue/<now> gets post.txt and the two screenshots; the posting loop posts it within 30 s
The form shows each step, then the post and its link. State: pipeline/data/bip/<date>.json.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ai  # noqa: E402
import core  # noqa: E402

DIR = core.DATA / "bip"
STUDIO = core.ROOT / "studio" / "projects"
PAGE = core.PIPE / "bip.html"
CROSS = chr(0x274C)
DASHES = f"[{chr(0x2014)}{chr(0x2013)}]"
EMOJI = f"[{chr(0x1F000)}-{chr(0x1FAFF)}{chr(0x2600)}-{chr(0x27BF)}]"
SENTENCE_MAX, ITEM_MAX, PARAGRAPHS_MAX, STUDIO_CHARS = 150, 60, 3, (500, 700)
SAVING = threading.Lock()


def day_number(d: date) -> int:
    """bip.day on bip.day_date (day 5 on 2026-11-17), one more each calendar day."""
    return core.cfg("bip.day", 5) + (d - date.fromisoformat(core.cfg("bip.day_date", "2026-11-17"))).days


def load(d: date) -> dict:
    return core.load_json(DIR / f"{d}.json", {})


def save(d: date, **values) -> dict:
    with SAVING:
        st = {**load(d), **values}
        core.save_json(DIR / f"{d}.json", st)
        return st


# Inputs ----------------------------------------------------------------------------------------------------------------

def http_json(url: str, body: dict | None = None) -> dict:
    req = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read().decode("utf-8")).get("error")
        except ValueError:
            msg = None
        raise RuntimeError(f"Jarvis: {msg or e}") from None
    except urllib.error.URLError:
        raise RuntimeError("Jarvis is not running: start it (npm run dev in the Jarvis folder), then press Submit again") from None


def jarvis_brief() -> str:
    """Jarvis's /mbrief: one plain note of what got done across all projects (its job, polled until done)."""
    api, minutes = core.cfg("bip.jarvis_api"), core.cfg("bip.brief_minutes", 720)
    job = http_json(f"{api}/api/console/summarize", {"minutes": minutes, "label": f"{minutes // 60}h", "brief": True})["job"]
    after, text, end = 0, "", time.time() + 1800
    while time.time() < end:
        j = http_json(f"{api}/api/console/job?id={job}&after={after}")
        for e in j.get("events", []):
            if e.get("kind") == "text":
                text = e.get("text", "")
            elif e.get("kind") == "error":
                raise RuntimeError(f"Jarvis: {e.get('text')}")
        after += len(j.get("events", []))
        if j.get("done"):
            break
        time.sleep(3)
    if not text.strip():
        raise RuntimeError("Jarvis's /mbrief returned nothing")
    return text.strip()


def jarvis_shot(out: Path) -> None:
    p = subprocess.run(["node", str(core.PIPE / "lib" / "bip-shot.mjs"), core.cfg("bip.jarvis_web"), str(out)],
                       cwd=core.ROOT, capture_output=True, timeout=400)
    if p.returncode or not out.exists():
        err = p.stderr.decode("utf-8", "replace").strip().splitlines() or ["no output"]
        raise RuntimeError(f"the Jarvis screenshot failed: {err[-1][:200]}")


def studio_project(d: date) -> Path | None:
    """Today's Claude Studio project (the one that posts today), else the latest finished one."""
    done = [p for p in sorted(STUDIO.iterdir()) if p.is_dir() and not p.name.startswith("_")
            and (p / "post.txt").exists()] if STUDIO.exists() else []
    today = [p for p in done if str(core.load_json(p / "state.json", {}).get("slot", "")).startswith(str(d))]
    return (today or done or [None])[-1]


def studio_shot(p: Path) -> Path | None:
    """The full screen screenshot nearest two thirds into the video."""
    shots = {int(m.group(1)): f for f in (p / "shots").glob("at-*s.png") if (m := re.fullmatch(r"at-(\d+)s\.png", f.name))}
    if not shots:
        return None
    target = core.load_json(p / "brief.json", {}).get("video_seconds", 60) * 0.65
    return shots[min(shots, key=lambda t: abs(t - target))]


# The post --------------------------------------------------------------------------------------------------------------

def sentences(line: str) -> list[str]:
    return [s for s in re.split(r"(?<=[.!?])\s+", line.strip()) if s]


def problems(parts: dict, replies: str, views: str) -> list[str]:
    """The measurable rules: lengths, the numbers, the mix in what got done, plain text."""
    out = []
    hook = parts.get("hook", "").strip()
    if "\n" in hook or len(sentences(hook)) != 1:
        out.append("hook: exactly one sentence on one line")
    n = len(parts.get("studio", "").strip())
    if not STUDIO_CHARS[0] <= n <= STUDIO_CHARS[1]:
        out.append(f"studio: {n} characters, it must be {STUDIO_CHARS[0]} to {STUDIO_CHARS[1]}")
    for value, what in ((replies, "replies"), (views, "views")):
        if value not in parts.get("x", ""):
            out.append(f"x: write the {what} exactly as {value}")
    lines = [ln.strip() for ln in parts.get("done", "").splitlines() if ln.strip()]
    if not any(ln.startswith("- ") for ln in lines) or all(ln.startswith("- ") for ln in lines):
        out.append("done: mix a list with sentences and paragraphs")
    paragraphs = [ln for ln in lines if not ln.startswith("- ") and len(sentences(ln)) >= 2]
    if len(paragraphs) > PARAGRAPHS_MAX:
        out.append(f"done: {len(paragraphs)} paragraphs, at most {PARAGRAPHS_MAX}")
    for key in ("hook", "studio", "x", "done"):
        text = parts.get(key, "")
        for line in (ln.strip() for ln in text.splitlines()):
            if line.startswith("- "):
                if len(line) - 2 > ITEM_MAX:
                    out.append(f"{key}: list item over {ITEM_MAX} characters: {line[:70]}")
            else:
                out += [f"{key}: sentence over {SENTENCE_MAX} characters: {s[:70]}" for s in sentences(line) if len(s) > SENTENCE_MAX]
        if re.search(DASHES, text):
            out.append(f"{key}: no em or en dashes")
        if re.search(r"https?://|www\.", text):
            out.append(f"{key}: no links")
        if re.search(r"\*\*|^#|`", text, re.M):
            out.append(f"{key}: no markdown")
        if re.search(EMOJI, text):
            out.append(f"{key}: no emojis")
    return out


def assemble(parts: dict, day: int) -> str:
    return "\n\n".join([parts["hook"].strip(), f"This is day {day} of building Claude Studio in public.",
                        parts["studio"].strip(), parts["x"].strip(), parts["done"].strip(), f"See you on day {day + 1}",
                        f"1000 followers {CROSS}\nmonetization {CROSS}"])


def write_post(d: date, brief: str, project: Path | None, replies: str, views: str, work: Path) -> str:
    studio = "(no Claude Studio project yet)"
    if project:
        facts = (project / "facts.txt").read_text(encoding="utf-8") if (project / "facts.txt").exists() else ""
        when = str(core.load_json(project / "state.json", {}).get("slot", ""))[:10] or project.name  # the day it posts
        studio = f"Project date: {when}\n\nIts X post:\n{(project / 'post.txt').read_text(encoding='utf-8')}\n\nMeasured facts:\n{facts[:4000]}"
    prompt = core.render("bip", DATE=str(d), DAY=str(day_number(d)), REPLIES=replies, VIEWS=views, STUDIO=studio, BRIEF=brief)
    parts = ai.call("bip", work, "write", prompt, schema="bip")
    for rnd in range(core.cfg("bip.fix_rounds", 2)):
        probs = problems(parts, replies, views)
        if not probs:
            break
        parts = ai.call("bip", work, f"fix-{rnd + 1}", f"{prompt}\n\nYour last answer:\n{json.dumps(parts, ensure_ascii=False, indent=1)}"
                        "\n\nIt breaks these rules. Fix them and return all four parts again:\n" + "\n".join(f"- {p}" for p in probs),
                        schema="bip")
    probs = problems(parts, replies, views)
    if probs:
        raise RuntimeError("the post still breaks the format: " + "; ".join(probs[:4]))
    return assemble(parts, day_number(d))


def queue_post(text: str, images: list[Path]) -> str:
    with core.queue_lock():
        at = core.now_rome()
        while (core.ROOT / "queue" / core.slot_name(at)).exists():
            at += timedelta(minutes=1)
        q = core.ROOT / "queue" / core.slot_name(at)
        q.mkdir(parents=True)
        core.write_text(q / "post.txt", text)
        for img in images:
            shutil.copy(img, q / img.name)
    return q.name


def wait_posted(slot: str) -> str:
    end = time.time() + 1200
    while time.time() < end:
        if (core.ROOT / "posted" / slot).exists():
            log = (core.LOGS / "runner.log").read_text(encoding="utf-8", errors="replace")
            found = re.findall(rf"posted {slot} -> (\S+)", log)
            return found[-1] if found else ""
        if (core.ROOT / "missed" / slot).exists():
            raise RuntimeError("the post landed in missed/")
        time.sleep(5)
    raise RuntimeError(f"not posted after 20 minutes: is the runner running? The post waits in queue/{slot}")


def make(d: date, replies: int, views: int) -> None:
    work = DIR / str(d)
    try:
        r, v = f"{replies:,}", f"{views:,}"
        save(d, status="working", step="Asking Jarvis for today's brief (/mbrief, a few minutes)", replies=replies, views=views)
        brief = jarvis_brief()
        core.write_text(work / "brief.txt", brief)
        save(d, step="Taking the screenshots")
        images = [work / "1-jarvis-stats.png"]
        jarvis_shot(images[0])
        project = studio_project(d)
        if project and (shot := studio_shot(project)):
            shutil.copy(shot, work / "2-claude-studio.png")
            images.append(work / "2-claude-studio.png")
        save(d, step="Writing the post", images=[i.name for i in images])
        text = write_post(d, brief, project, r, v, work)
        core.write_text(work / "post.txt", text)
        slot = queue_post(text, images)
        save(d, status="queued", slot=slot, text=text, step="Posting (the posting loop sends it within 30 s)")
        core.say("POST", f"build in public, day {day_number(d)}: queued {slot}")
        save(d, status="posted", step="Posted", url=wait_posted(slot), posted_at=time.time())
    except Exception as exc:  # the form shows it and can be submitted again
        core.say("ERROR", f"build in public: {core.undash(str(exc))[:200]}")
        save(d, status="error", error=core.undash(str(exc))[:400])


# The form --------------------------------------------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args) -> None:
        pass

    def send(self, code: int, body, kind: str = "application/json") -> None:
        data = body if isinstance(body, bytes) else json.dumps(body).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        d = self.server.day
        if self.path == "/":
            return self.send(200, PAGE.read_text(encoding="utf-8").replace("{{DAY}}", str(day_number(d))).encode("utf-8"),
                             "text/html; charset=utf-8")
        if self.path == "/status":
            return self.send(200, load(d))
        name = self.path.removeprefix("/image/")
        if re.fullmatch(r"[\w-]+\.png", name) and (DIR / str(d) / name).exists():
            return self.send(200, (DIR / str(d) / name).read_bytes(), "image/png")
        self.send(404, {"error": "not found"})

    def do_POST(self) -> None:
        d = self.server.day
        if self.path != "/submit" or self.headers.get("Origin", self.server.origin) != self.server.origin:
            return self.send(403, {"error": "not allowed"})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            replies, views = int(body["replies"]), int(body["views"])
            if replies < 0 or views < 0:
                raise ValueError
        except (ValueError, KeyError, TypeError):
            return self.send(400, {"error": "type two whole numbers"})
        with SAVING:
            if load(d).get("status") in ("working", "queued", "posted"):
                return self.send(409, {"error": "already being made"})
        save(d, status="working", step="Starting", error=None)
        threading.Thread(target=make, args=(d, replies, views), daemon=True).start()
        self.send(200, {"ok": True})


def main() -> None:
    now = core.now_rome()
    d = now.date()
    st = load(d)
    if st.get("status") in ("queued", "posted"):
        return
    if now < datetime.fromisoformat(f"{d}T{core.cfg('bip.time', '20:00')}").replace(tzinfo=core.ROME):
        return
    port = core.cfg("bip.port", 3003)
    try:
        server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    except OSError:  # the form is already open
        return
    server.day, server.origin = d, f"http://127.0.0.1:{port}"
    if st.get("status") in (None, "working"):  # new, or cut short by a restart: ask again
        save(d, status="waiting")
    threading.Thread(target=server.serve_forever, daemon=True).start()
    core.say("POST", f"build in public, day {day_number(d)}: type today's replies and views at {server.origin}")
    webbrowser.open(server.origin)
    while core.now_rome().date() == d:  # open until posted (and 10 more minutes to read it) or midnight
        st = load(d)
        if st.get("status") == "posted" and time.time() - st.get("posted_at", 0) > 600:
            break
        time.sleep(5)
    server.shutdown()


if __name__ == "__main__":
    main()
