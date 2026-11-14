"""One unit of work for the runner. First queue/ is brought in line with the virality queue (virality.arrange).
Then: finish the open run; else stop for the day once max_per_day threads are ready; else search the next category
while today's searches are not used up; else pick the best pending discovery and take it through every stage.
Exit codes: 0 a thread joined the virality queue, 10 the discovery was dropped, 11 the thread went to review/,
12 nothing to do (the runner waits), 13 a category search ran (the runner goes on at once), 1 an error (logged;
the run resumes).
"""
from __future__ import annotations

import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import core  # noqa: E402
import discover  # noqa: E402
import stages  # noqa: E402
import virality  # noqa: E402

DONE = ("ready", "queued", "review", "dropped")


def open_run() -> Path | None:
    for path in sorted(core.RUNS.glob("*/state.json")) if core.RUNS.exists() else []:
        st = core.load_json(path, {})
        if st.get("stage") in DONE:
            continue
        if st.get("stage") not in stages.STAGES:  # a run of the old long-form pipeline
            core.save_json(path, {**st, "stage": "dropped", "outcome": "dropped: made by the old pipeline"})
            continue
        return path.parent
    return None


def finish(run: Path, outcome: str) -> None:
    disc = stages.load(run, "discovery", {})
    brief = {"discovery": disc.get("id"), "name": disc.get("name"), "category": disc.get("category_name")}
    now = core.now_rome().isoformat(timespec="seconds")
    if outcome.startswith("dropped"):
        reason = outcome.split(":", 1)[1].strip() if ":" in outcome else outcome
        discover.set_status(disc.get("id"), "rejected", reason=reason, closed_at=now)
        core.add_history({"status": "dropped", "run": run.name, "reason": reason, **brief})
        core.bump_session("dropped")
        core.say("DROP", f"{disc.get('name')}: {reason[:150]}")
        stage = "dropped"
    elif outcome == "review":
        discover.set_status(disc.get("id"), "review", closed_at=now)
        core.add_history({"status": "review", "run": run.name, **brief})
        core.bump_session("review")
        core.say("REVIEW", f"needs review, not queued: pipeline/review/{run.name}.txt")
        stage = "review"
    else:  # ready: the thread waits in the virality queue for a slot
        a, ev, draft = stages.load(run, "analysis"), stages.load(run, "virality"), stages.load(run, "draft")
        virality.add(run, ev, draft, disc, a["project_name"])
        discover.set_status(disc.get("id"), "ready", ready_at=now, closed_at=now)
        facts = stages.load(run, "facts", [])
        core.add_history({"status": "ready", "run": run.name, **brief, "name": a["project_name"], "repo": a["repo"],
                          "hook": draft["hook"], "score": ev["final"], "problem": a["problem"],
                          "hooks": [h["text"] for h in stages.load(run, "hooks", {}).get("candidates", [])],
                          "sources": sorted({f["url"] for f in facts if f.get("url", "").startswith("http")})[:20]})
        core.bump_session("ready")
        core.say("READY", f"[{ev['final']}] {draft['hook']}")
        stage = "ready"
    stages.set_state(run, stage=stage, outcome=outcome)


def advance(run: Path) -> str:
    while True:
        stage = stages.state(run)["stage"]
        core.say("STEP", f"{stage} ({run.name})")
        nxt = stages.STAGES[stage](run)
        if nxt in stages.STAGES:
            stages.set_state(run, stage=nxt)
            continue
        finish(run, nxt)
        return nxt


def arrange() -> None:
    try:
        virality.arrange()
    except Exception as exc:  # the next step tries again; a finished run must not count it as its own error
        core.say("WARN", f"arranging the queue failed, will retry: {core.undash(str(exc))[:200]}")


def main() -> int:
    run = None
    try:
        stages.push_pending()
        arrange()
        run = open_run()
        if run is None:
            made, most = virality.made_today(), core.cfg("virality.max_per_day", 20)
            if made >= most:
                core.say("IDLE", f"{made} threads made today, the most for one day; tomorrow's generation starts at midnight")
                return 12
            if discover.search_due(made, core.cfg("virality.min_per_day", 4)):
                discover.search_one()
                core.bump_session("searches")
                return 13
            run = discover.select()
            if run is None:
                core.say("IDLE", "today's category searches are done and no pending discovery is good enough, waiting")
                return 12
        outcome = advance(run)
        if outcome == "ready":
            arrange()
        return 0 if outcome == "ready" else 11 if outcome == "review" else 10
    except Exception as exc:  # Ctrl+C (KeyboardInterrupt) is not caught: the run resumes at the same stage
        msg = core.undash(f"{type(exc).__name__}: {exc}")[:300]
        core.LOGS.mkdir(parents=True, exist_ok=True)
        with open(core.LOGS / "errors.log", "a", encoding="utf-8", newline="\n") as f:
            f.write(f"\n[{core.now_rome():%Y-%m-%d %H:%M}] {run.name if run else 'search'}\n{traceback.format_exc()}")
        if run is None:
            core.say("ERROR", f"search: {msg}")
            return 1
        st = stages.state(run)
        errors = st.get("errors", 0) + 1
        stages.set_state(run, errors=errors, last_error=msg)
        core.say("ERROR", f"{st.get('stage')}: {msg} (details in pipeline/logs/errors.log)")
        if errors >= core.cfg("caps.run_errors", 2):
            finish(run, f"dropped: failed twice in {st.get('stage')}: {msg}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
