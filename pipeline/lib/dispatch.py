"""Trigger the posting workflow when a queued post comes due, so it goes out at its exact minute while the runner
is on. run.sh calls this every minute. Any queue folder whose time arrived in the last dispatch_grace_minutes and
was not triggered yet counts (image and text posts too). With the PC off, the GitHub schedule still posts them.
"""
from __future__ import annotations

import subprocess
import sys
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import core  # noqa: E402


def main() -> None:
    if not core.cfg("dispatch", True):
        return
    now = core.now_rome()
    grace = timedelta(minutes=core.cfg("runner.dispatch_grace_minutes", 10))
    done = core.load_json(core.DATA / "dispatched.json", [])
    names = [p.name for p in (core.ROOT / "queue").iterdir()] if (core.ROOT / "queue").exists() else []
    due = [n for n in names if (t := core.slot_time(n)) and now - grace <= t <= now and n not in done]
    if not due:
        return
    p = subprocess.run([core.gh(), "workflow", "run", "post.yml", "-R", core.cfg("repo")], capture_output=True, timeout=60)
    if p.returncode:
        core.say("WARN", f"could not trigger the posting workflow: {p.stderr.decode('utf-8', 'replace').strip()[:200]}")
        return
    core.save_json(core.DATA / "dispatched.json", (done + due)[-300:])
    core.say("POST", f"triggered the posting workflow for {', '.join(due)}")


if __name__ == "__main__":
    main()
