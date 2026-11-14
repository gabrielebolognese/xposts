"""The posting loop: run.sh runs this every poster.interval_seconds. This PC does all the posting; GitHub only keeps
the repo. Each round, holding the queue lock:
  1. git pull every poster.pull_minutes (posts added from the phone or another PC)
  2. the dashboard's "Post thread now" requests (data/post-now/<run>.json): post-now.js posts the thread, the run
     goes into data/posted-now.json, and its queue/ folder (if it had a slot) is removed so it never goes out twice
  3. post.js posts every due queue/ folder (posts and threads) and moves it to posted/ or missed/
  4. the changes in queue/, posted/ and missed/ are committed and pushed
The X keys live in the .env file next to post.js, which only the user writes; this code never reads it.
POSTS_FAKE_X=1 (tests) makes post.js and post-now.js use a fake X client.
"""
from __future__ import annotations

import base64
import json
import os
import re
import shutil
import subprocess
import sys
import time
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import core  # noqa: E402
import stages  # noqa: E402

STAMP = core.DATA / "poster.json"
REQUESTS = core.DATA / "post-now"
POSTED_NOW = core.DATA / "posted-now.json"
POOL = core.DATA / "virality.json"
FOLDERS = ("queue", "posted", "missed")


def node(script: str, extra: dict | None = None) -> subprocess.CompletedProcess:
    env = {**os.environ, "TZ": "Europe/Rome", **(extra or {})}
    return subprocess.run(["node", script], cwd=core.ROOT, capture_output=True, timeout=1800, env=env)


def report(p: subprocess.CompletedProcess, posts: bool = True) -> None:
    for line in p.stdout.decode("utf-8", "replace").splitlines() if posts else []:
        if line.startswith(("posted", "missed")):
            core.say("POSTED" if line.startswith("posted") else "MISSED", line)
    for line in p.stderr.decode("utf-8", "replace").splitlines():
        if line.strip():
            core.say("ERROR", f"posting: {line.strip()[:300]}")


def due_folders() -> list[str]:
    q = core.ROOT / "queue"
    now = core.slot_name(core.now_rome())
    return sorted(n for n in (os.listdir(q) if q.exists() else []) if core.slot_time(n) and n <= now)


def post_now(req_file: Path) -> None:
    req = core.load_json(req_file, {})
    run = req.get("run", "")
    draft = core.load_json(core.RUNS / run / "draft.json") if re.fullmatch(r"[\w.-]+", run) else None
    if not draft:
        core.save_json(req_file.with_suffix(".failed"), {"error": "no finished thread for this run", "at": time.time()})
        req_file.unlink()
        return
    out = core.DATA / "post-now" / f"{run}.ids.json"
    thread = base64.b64encode(json.dumps(stages.thread_parts(draft), ensure_ascii=False).encode("utf-8")).decode()
    core.say("POST", f"posting now from the dashboard: {run}")
    p = node("post-now.js", {"THREAD": thread, "RUN": run, "POST_NOW_OUT": str(out)})
    report(p, posts=False)  # the POSTED line below says it once
    ids = core.load_json(out, {}).get("ids", [])
    out.unlink(missing_ok=True)
    if not ids:  # nothing went out: the user can press the button again
        err = (p.stderr.decode("utf-8", "replace").strip().splitlines() or ["unknown error"])[-1]
        core.save_json(req_file.with_suffix(".failed"), {"error": err[:300], "at": time.time()})
        req_file.unlink()
        return
    url = f"https://x.com/i/status/{ids[0]}"
    entry = core.load_json(POOL, {}).get(run, {})
    slot = entry.get("slot") if entry.get("status") == "scheduled" else None
    if slot and (core.ROOT / "queue" / slot).exists():  # the scheduled copy must not go out again
        shutil.rmtree(core.ROOT / "queue" / slot)
    done = core.load_json(POSTED_NOW, [])
    done.append({"run": run, "at": core.now_rome().isoformat(timespec="seconds"), "slot": slot, "url": url,
                 "parts": len(ids), "complete": p.returncode == 0})
    core.save_json(POSTED_NOW, done)
    req_file.unlink()
    core.say("POSTED", f"posted now -> {url} ({len(ids)} parts){'' if p.returncode == 0 else ', not all parts went out'}")


def changed() -> list[str]:
    paths = [f for f in FOLDERS if (core.ROOT / f).exists() or stages.git("ls-files", "--", f).stdout.strip()]
    if not paths:
        return []
    out = stages.git("status", "--porcelain", "--", *paths).stdout.strip()
    return paths if out else []


def commit(paths: list[str]) -> None:
    stages.git("add", "-A", "--", *paths)
    p = stages.git("commit", "-q", "-m", "autopost: update queue", "--", *paths)
    if p.returncode and b"nothing" not in p.stdout + p.stderr:
        core.say("WARN", f"git commit failed: {p.stderr.decode('utf-8', 'replace').strip()[:200]}")
        return
    if core.cfg("push", True):
        stages.push()


def main() -> None:
    stamp = core.load_json(STAMP, {})
    with core.queue_lock():
        if core.cfg("push", True) and time.time() - stamp.get("pulled", 0) >= core.cfg("poster.pull_minutes", 5) * 60:
            stages.git("pull", "--rebase", "--autostash", "-q")
            stamp["pulled"] = time.time()
        for req in sorted(REQUESTS.glob("*.json")) if REQUESTS.exists() else []:
            if not req.name.endswith(".ids.json"):
                post_now(req)
        if due_folders():
            report(node("post.js"))
        paths = changed()
        if paths:
            commit(paths)
    stamp["at"] = time.time()
    core.save_json(STAMP, stamp)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # the loop goes on; the next round tries again
        core.LOGS.mkdir(parents=True, exist_ok=True)
        with open(core.LOGS / "errors.log", "a", encoding="utf-8", newline="\n") as f:
            f.write(f"\n[{core.now_rome():%Y-%m-%d %H:%M}] poster\n{traceback.format_exc()}")
        core.say("ERROR", f"posting loop: {core.undash(str(exc))[:200]}")
