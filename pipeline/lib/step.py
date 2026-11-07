"""One unit of work for the runner: finish the open run, or harvest if due, scout a new idea and take it through
every stage. Exit codes: 0 a post was queued, 10 the idea was dropped, 11 the post went to review/,
12 nothing passed the scout (the runner waits), 1 an error (logged; the run resumes next time).
"""
from __future__ import annotations

import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import core  # noqa: E402
import harvest  # noqa: E402
import scout  # noqa: E402
import stages  # noqa: E402

DONE = ("queued", "review", "dropped")


def open_run() -> Path | None:
    for path in sorted(core.RUNS.glob("*/state.json")) if core.RUNS.exists() else []:
        if core.load_json(path, {}).get("stage") not in DONE:
            return path.parent
    return None


def finish(run: Path, outcome: str) -> None:
    idea = stages.load(run, "idea", {})
    brief = {k: idea.get(k) for k in ("niche", "tool", "audience", "problem", "takeaway")}
    if outcome.startswith("dropped"):
        reason = outcome.split(":", 1)[1].strip() if ":" in outcome else outcome
        scout.drop(idea, reason)
        core.add_history({"status": "dropped", "run": run.name, "reason": reason, **brief})
        core.bump_session("dropped")
        core.say("DROP", f"{idea.get('audience')}: {reason[:150]}")
        stage = "dropped"
    elif outcome == "review":
        core.add_history({"status": "review", "run": run.name, **brief})
        core.bump_session("review")
        core.say("REVIEW", f"needs review, not queued: pipeline/review/{run.name}.txt")
        stage = "review"
    else:
        core.bump_session("queued")
        stage = "queued"
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


def main() -> int:
    run = None
    try:
        stages.push_pending()
        run = open_run()
        if run is None:
            if harvest.due():
                harvest.harvest()
            run = scout.scout()
            if run is None:
                core.say("IDLE", "no idea passed the scout, waiting for new items")
                return 12
        outcome = advance(run)
        return 0 if outcome == "queued" else 11 if outcome == "review" else 10
    except Exception as exc:  # Ctrl+C (KeyboardInterrupt) is not caught: the run resumes at the same stage
        msg = core.undash(f"{type(exc).__name__}: {exc}")[:300]
        core.LOGS.mkdir(parents=True, exist_ok=True)
        with open(core.LOGS / "errors.log", "a", encoding="utf-8", newline="\n") as f:
            f.write(f"\n[{core.now_rome():%Y-%m-%d %H:%M}] {run.name if run else 'scout'}\n{traceback.format_exc()}")
        if run is None:
            core.say("ERROR", f"scout: {msg}")
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
