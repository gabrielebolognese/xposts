"""The runner's session counters and stop line.
  python pipeline/lib/summary.py start   reset the counters for a new session
  python pipeline/lib/summary.py stop    print what this session did, how far ahead the threads are scheduled and
                                         how many wait in the virality queue
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import core  # noqa: E402
import virality  # noqa: E402


def stop_line() -> str:
    s = core.load_json(core.DATA / "session.json", {})
    now = core.now_rome()
    pool = virality.load().values()
    scheduled = sorted(e["slot"] for e in pool if e["status"] == "scheduled" and core.slot_time(e["slot"]) >= now)
    waiting = sum(1 for e in pool if e["status"] == "waiting")
    line = (f"Stopped. This session: {s.get('ready', 0)} threads ready, {s.get('review', 0)} sent to review/, "
            f"{s.get('dropped', 0)} dropped, {s.get('searches', 0)} category searches. ")
    if scheduled:
        last = core.slot_time(scheduled[-1])
        days = (last.date() - now.date()).days
        line += (f"{len(scheduled)} threads are scheduled, through {last:%a %d %b} "
                 f"({days} {'day' if days == 1 else 'days'} from today). ")
    else:
        line += "No threads are scheduled. "
    return line + f"{waiting} more wait in the virality queue."


if __name__ == "__main__":
    if sys.argv[1:] == ["start"]:
        core.save_json(core.DATA / "session.json", {"started": core.now_rome().isoformat(timespec="seconds")})
    else:
        line = stop_line()
        print(core.paint(core.BLUE, line))
        core.LOGS.mkdir(parents=True, exist_ok=True)
        with open(core.LOGS / "sessions.log", "a", encoding="utf-8", newline="\n") as f:
            f.write(f"[{core.now_rome():%Y-%m-%d %H:%M}] {line}\n")
