"""The virality queue and the slot arrangement.

Every thread that passes quality control and the virality stage waits in data/virality.json with its final virality
score. arrange() keeps queue/ filled for the next horizon_days (3 slots a day: 06:00, 10:00 and 14:00 Rome) with the
highest scored threads, the highest in the earliest slot. A newer thread that scores higher takes the earliest slot
and pushes the others back, out of queue/ when they no longer fit; a thread can wait indefinitely. Slots that are due
or within lead_minutes, and folders that are not auto threads, are never touched.
Statuses: waiting (no slot), scheduled (in queue/), posted (its slot time came, or the dashboard posted it now),
lost (its run folder is gone). The dashboard's "Post thread now" lists runs in data/posted-now.json (only the
dashboard writes it): those are never scheduled again and their slot goes to the next best thread.
Usage: python pipeline/lib/virality.py   prints the virality queue, best first
"""
from __future__ import annotations

import shutil
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import core  # noqa: E402
import discover  # noqa: E402
import stages  # noqa: E402

POOL = core.DATA / "virality.json"
POSTED_NOW = core.DATA / "posted-now.json"
QUEUE = core.ROOT / "queue"


def load() -> dict:
    return core.load_json(POOL, {})


def posted_now() -> set[str]:
    return {p["run"] for p in core.load_json(POSTED_NOW, [])}


def add(run: Path, ev: dict, draft: dict, disc: dict, name: str) -> None:
    pool = load()
    early = run.name in posted_now()  # posted from the dashboard while it was still being made
    pool[run.name] = {"run": run.name, "name": name, "discovery": disc.get("id"), "score": ev["final"],
                      "hook_score": ev["hook_score"], "thread_score": ev["thread_score"],
                      "classification": ev["classification"], "hook": draft["hook"],
                      "created": core.now_rome().isoformat(timespec="seconds"),
                      "status": "posted" if early else "waiting", "slot": None, "posted_now": early}
    core.save_json(POOL, pool)


def made_today() -> int:
    today = core.now_rome().strftime("%Y-%m-%d")
    return sum(1 for e in load().values() if e["created"][:10] == today)


def upcoming_slots(now: datetime, times: list[str], horizon_days: int, lead_minutes: int) -> list[str]:
    """The slot names after now + lead and at most horizon_days ahead."""
    start, end = now + timedelta(minutes=lead_minutes), now + timedelta(days=horizon_days)
    out = []
    for d in range(horizon_days + 1):
        day = now.date() + timedelta(days=d)
        for t in times:
            h, m = map(int, t.split(":"))
            dt = datetime(day.year, day.month, day.day, h, m, tzinfo=core.ROME)
            if start < dt <= end:
                out.append(core.slot_name(dt))
    return sorted(out)


def assign(entries: list[dict], slots: list[str]) -> dict[str, str]:
    """slot -> run: the highest score gets the earliest slot (on a tie the older thread goes first)."""
    ranked = sorted(entries, key=lambda e: (-e["score"], e["created"]))
    return {slot: e["run"] for slot, e in zip(sorted(slots), ranked)}


def write_folder(slot: str, run: str) -> bool:
    draft = core.load_json(core.RUNS / run / "draft.json")
    if not draft:
        return False
    folder = QUEUE / slot
    folder.mkdir(parents=True, exist_ok=True)
    parts = stages.thread_parts(draft)
    core.write_text(folder / "post.txt", parts[0])
    for i, reply in enumerate(parts[1:], 1):
        core.write_text(folder / f"reply{i}.txt", reply)
    return True


def arrange() -> list[str]:
    """Bring queue/ in line with the virality queue, commit and push. Returns the slots that changed."""
    if core.cfg("push", True):  # see the posts GitHub moved and anything scheduled from elsewhere
        stages.git("pull", "--rebase", "--autostash", "-q")
    pool, now = load(), core.now_rome()
    lead = core.cfg("lead_minutes", 15)
    touched, out = [], []
    early = posted_now()
    for e in pool.values():  # posted from the dashboard: never again, and its slot is free for the next best thread
        if e["run"] in early and e["status"] in ("waiting", "scheduled"):
            if e["status"] == "scheduled":
                shutil.rmtree(QUEUE / e["slot"], ignore_errors=True)
                touched.append(e["slot"])
            e.update(status="posted", slot=None, posted_now=True)
            discover.set_status(e.get("discovery"), "published", published_at=now.isoformat(timespec="seconds"))
            core.say("SLOT", f"[{e['score']}] {e['name']} was posted from the dashboard, its slot is free")
    for e in pool.values():  # a slot that is due, or about to be, belongs to the posting workflow now
        if e["status"] == "scheduled" and core.slot_time(e["slot"]) <= now + timedelta(minutes=lead):
            e["status"] = "posted"
            discover.set_status(e.get("discovery"), "published", published_at=core.slot_time(e["slot"]).isoformat())
    ours = {e["slot"]: e for e in pool.values() if e["status"] == "scheduled"}
    slots = [s for s in upcoming_slots(now, core.cfg("slots.times"), core.cfg("slots.horizon_days", 4), lead)
             if s in ours or not (QUEUE / s).exists()]
    want = assign([e for e in pool.values() if e["status"] in ("waiting", "scheduled")], slots)
    for slot, e in ours.items():
        if want.get(slot) != e["run"]:
            shutil.rmtree(QUEUE / slot, ignore_errors=True)
            e.update(status="waiting", slot=None)
            touched.append(slot)
            out.append(e)
    for slot, run in want.items():
        e = pool[run]
        if e["status"] == "scheduled" and e["slot"] == slot:
            continue
        if not write_folder(slot, run):
            e["status"] = "lost"
            continue
        e.update(status="scheduled", slot=slot)
        touched.append(slot)
    core.save_json(POOL, pool)
    if not touched:
        return []
    paths = [f"queue/{s}" for s in sorted(set(touched))]
    stages.git("add", "-A", "--", *paths)
    p = stages.git("commit", "-q", "-m", "pipeline: arrange the thread queue", "--", *paths)
    if p.returncode and b"nothing" not in p.stdout + p.stderr:
        raise RuntimeError(f"git commit: {p.stderr.decode('utf-8', 'replace').strip()[:200]}")
    if core.cfg("push", True):
        stages.push()
    for slot, run in sorted(want.items()):
        if slot in touched:
            core.say("SLOT", f"{slot}  [{pool[run]['score']}] {pool[run]['name']}")
    for e in out:
        if e["status"] == "waiting":
            core.say("SLOT", f"[{e['score']}] {e['name']} moved back to the virality queue")
    return touched


if __name__ == "__main__":
    for e in sorted(load().values(), key=lambda e: (-e["score"], e["created"])):
        if e["status"] in ("waiting", "scheduled"):
            print(f"{e['score']:>3} {e['classification']:<11} {e['slot'] or 'waiting':<16} {e['name']}: {e['hook']}")
