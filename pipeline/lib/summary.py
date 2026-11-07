"""The runner's session counters and stop line.
  python pipeline/lib/summary.py start   reset the counters for a new session
  python pipeline/lib/summary.py stop    print what this session did and how far ahead the auto posts reach
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import core  # noqa: E402


def stop_line() -> str:
    s = core.load_json(core.DATA / "session.json", {})
    now = core.now_rome()
    waiting = sorted(h["slot"] for h in core.history()
                     if h.get("status") == "queued" and (t := core.slot_time(h.get("slot", ""))) and t >= now
                     and (core.ROOT / "queue" / h["slot"]).exists())
    line = (f"Stopped. This session: {s.get('queued', 0)} posts queued, {s.get('review', 0)} sent to review/, "
            f"{s.get('dropped', 0)} dropped. ")
    if not waiting:
        return line + "No auto posts are waiting in the queue."
    last = core.slot_time(waiting[-1])
    days = (last.date() - now.date()).days
    return line + (f"{len(waiting)} auto posts are waiting, scheduled through {last:%a %d %b} "
                   f"({days} {'day' if days == 1 else 'days'} from today).")


if __name__ == "__main__":
    if sys.argv[1:] == ["start"]:
        core.save_json(core.DATA / "session.json", {"started": core.now_rome().isoformat(timespec="seconds")})
    else:
        line = stop_line()
        print(line)
        core.LOGS.mkdir(parents=True, exist_ok=True)
        with open(core.LOGS / "sessions.log", "a", encoding="utf-8", newline="\n") as f:
            f.write(f"[{core.now_rome():%Y-%m-%d %H:%M}] {line}\n")
