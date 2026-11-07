"""Stage 2, scout: cluster the pool, let a model turn clusters into candidate ideas, let a cheap model score them,
then decide in code (hard fails, similarity to past posts, tool cooldown, niche quota). Losers wait in a backlog
that decays. The winner becomes a run folder in pipeline/runs/ for the stages that follow.
"""
from __future__ import annotations

import difflib
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ai  # noqa: E402
import core  # noqa: E402

CRITERIA = ("value", "specificity", "freshness", "demand", "agreement", "novelty", "credibility")
OWN = ("decision", "known-issue", "commit")
STOP = set("with from that this what your about into have will when using after over their more than just".split())


def words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9][a-z0-9.+#-]{3,}", text.lower()) if w not in STOP}


def clusters(items: list[dict]) -> list[list[dict]]:
    """Greedy grouping: same source repo or tool, or at least 2 shared significant title words."""
    groups: list[tuple[set, str, list]] = []
    for it in items:
        w = words(it["title"])
        for gw, src, members in groups:
            if (it["kind"] in OWN + ("release", "changelog") and it["source"] == src) or len(w & gw) >= 2:
                members.append(it)
                gw |= w
                break
        else:
            groups.append((w, it["source"], [it]))
    return [m for _, _, m in groups]


def past_posts(limit: int = 60) -> list[str]:
    """First lines of the newest posts in queue/, posted/ and missed/, plus auto post history."""
    out = []
    for d in ("queue", "posted", "missed"):
        folder = core.ROOT / d
        for p in sorted(folder.glob("*/post.txt"), reverse=True)[:limit] if folder.exists() else []:
            text = p.read_text(encoding="utf-8", errors="replace").strip()
            out.append(f"{p.parent.name}: {' '.join(text.split())[:160]}")
    for h in core.history()[-limit:]:
        out.append(f"{h.get('status')}: {h.get('audience', '')}: {h.get('problem', '')} -> {h.get('takeaway', '')}")
    return out


def similarity(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, a.lower(), b.lower()).ratio()


def decide(cands: list[dict], hist: list[dict], conf: dict) -> tuple[dict | None, list[dict], list[dict]]:
    """Pure decision. cands carry scores (scores dict, substance_800), total, sources, release_dates.
    Returns (chosen or None, backlog, rejected), rejected entries carry a reason."""
    hard = conf["hard_min"]
    eligible, backlog, rejected = [], [], []
    queued = [h for h in hist if h.get("status") == "queued"]
    for c in cands:
        s = c["scores"]
        low = [k for k, v in hard.items() if s.get(k, 0) < v]
        if low or c.get("substance_800") != "pass":
            rejected.append({**c, "reason": "hard fail: " + ", ".join(low + ([] if c.get("substance_800") == "pass" else ["800 test"]))})
            continue
        key = f"{c['problem']} {c['takeaway']}"
        close = max(hist, key=lambda h: similarity(key, f"{h.get('problem', '')} {h.get('takeaway', '')}"), default=None)
        if close and similarity(key, f"{close.get('problem', '')} {close.get('takeaway', '')}") >= conf["similar_ratio"]:
            rejected.append({**c, "reason": f"too similar to {close.get('slot') or close.get('run')}"})
            continue
        if c["total"] < conf["min_total"]:
            rejected.append({**c, "reason": f"total {c['total']} below {conf['min_total']}"})
            continue
        tool = c.get("tool", "none").strip().lower()
        recent = [h for h in queued if tool not in ("", "none") and h.get("tool", "").strip().lower() == tool
                  and core.days_ago(h.get("at")) < conf["cooldown_days"]]
        newest = min((core.days_ago(h["at"]) for h in recent), default=None)
        if recent and not any(core.days_ago(d) < newest for d in c.get("release_dates", [])):
            backlog.append({**c, "reason": f"{tool} posted less than {conf['cooldown_days']} days ago"})
            continue
        eligible.append(c)
    eligible.sort(key=lambda c: c["total"], reverse=True)
    window, maxima = conf["quota_window"], conf["quota_max"]
    last = [h.get("niche") for h in queued[-(window - 1):]] if window > 1 else []
    under = [c for c in eligible if last.count(c["niche"]) < maxima.get(c["niche"], 1)]
    chosen = (under or eligible or [None])[0]
    backlog += [c for c in eligible if c is not chosen]
    return chosen, backlog, rejected


def decay(backlog: list[dict]) -> list[dict]:
    """Backlog entries lose backlog_decay per day and leave after backlog_days or below backlog_min."""
    keep = []
    for b in backlog:
        days = core.days_ago(b.get("added"))
        b["total"] = round(b["base_total"] * core.cfg("scout.backlog_decay") ** days, 2)
        if days <= core.cfg("scout.backlog_days") and b["total"] >= core.cfg("scout.backlog_min"):
            keep.append(b)
    return keep


def pick_items(pool: dict) -> list[dict]:
    fresh = [v for v in pool.values() if not v["used"] and core.days_ago(v["date"]) <= core.cfg("scout.pool_days")
             or not v["used"] and v["kind"] in OWN]
    fresh.sort(key=lambda v: v["date"], reverse=True)
    cap = core.cfg("scout.max_items")
    own = [v for v in fresh if v["kind"] in OWN][: cap // 3]
    rest = [v for v in fresh if v["kind"] not in OWN][: cap - len(own)]
    return own + rest


def scout() -> Path | None:
    """One scouting round. Returns the new run folder, or None when nothing passed."""
    pool = core.load_json(core.DATA / "pool.json", {})
    backlog = decay([b for b in core.load_json(core.DATA / "backlog.json", []) if b.get("status") != "dropped"])
    dropped = [b for b in core.load_json(core.DATA / "backlog.json", []) if b.get("status") == "dropped"]
    items = pick_items(pool)
    stage = core.DATA / "scout" / time.strftime("%Y-%m-%d_%H%M%S")
    hist_lines = "\n".join(f"- {x}" for x in past_posts()) or "- (none yet)"
    new: list[dict] = []
    if items:
        shown = {v["id"] for v in items}
        groups = [[{k: v[k] for k in ("id", "title", "kind", "source", "date", "text")} | {"text": v["text"][:400]}
                   for v in g] for g in clusters(items)]
        out = ai.call("ideate", stage, "ideate", core.render(
            "ideate", COUNT=str(core.cfg("scout.candidates")), HISTORY=hist_lines, CLUSTERS=groups), schema="ideate")
        for i, c in enumerate(out["candidates"]):
            c["source_ids"] = [s for s in c["source_ids"] if s in shown]
            if c["source_ids"]:
                new.append({**c, "id": f"c{i + 1}"})
        for v in items:
            pool[v["id"]]["used"] = True
        core.save_json(core.DATA / "pool.json", pool)
    if new:
        payload = [{**c, "sources": [{k: pool[s][k] for k in ("title", "kind", "source", "date")}
                                     | {"text": pool[s]["text"][:500]} for s in c["source_ids"]]} for c in new]
        scored = {s["id"]: s for s in ai.call("score", stage, "score", core.render(
            "score", HISTORY=hist_lines, CANDIDATES=payload), schema="score")["scores"]}
        now = core.now_rome().isoformat(timespec="seconds")
        for c in new:
            s = scored.get(c["id"])
            if not s:
                continue
            c["scores"] = {k: s[k] for k in CRITERIA}
            c["substance_800"], c["evidence"] = s["substance_800"], s["evidence"]
            srcs = {pool[x]["source"] for x in c["source_ids"]}
            c["base_total"] = sum(c["scores"].values()) + min(2, len(srcs) - 1)
            c["total"] = c["base_total"]
            c["release_dates"] = [pool[x]["date"] for x in c["source_ids"] if pool[x]["kind"] in ("release", "changelog")]
            c["sources"] = [{k: pool[x].get(k) for k in ("id", "title", "url", "kind", "source", "date", "text")}
                            for x in c["source_ids"]]
            c["added"] = now
    cands = [c for c in new if "scores" in c] + backlog
    conf = {**core.cfg("scout"), "quota_window": core.cfg("quota.window"), "quota_max": core.cfg("quota.max")}
    chosen, backlog, rejected = decide(cands, core.history() + dropped, conf)
    for r in rejected:
        core.say("SKIP", f"{r['audience']}: {r['problem'][:70]} ({r['reason']})")
    core.save_json(core.DATA / "backlog.json", backlog + dropped)
    if not chosen:
        return None
    slug = re.sub(r"[^a-z0-9]+", "-", f"{chosen['tool']} {chosen['problem']}".lower()).strip("-")[:40]
    run = core.RUNS / f"{core.slot_name(core.now_rome())}_{slug}"
    run.mkdir(parents=True, exist_ok=True)
    core.save_json(run / "idea.json", chosen)
    core.save_json(run / "state.json", {"stage": "research", "created": time.time(), "errors": 0, "reworks": 0})
    core.say("IDEA", f"[{chosen['niche']}, {chosen['total']}] {chosen['audience']}: {chosen['problem'][:90]}")
    return run


def drop(idea: dict, reason: str) -> None:
    """A dropped idea is kept in the backlog with its reason, never picked again, still counted for novelty."""
    items = core.load_json(core.DATA / "backlog.json", [])
    items.append({**idea, "status": "dropped", "reason": reason, "added": core.now_rome().isoformat(timespec="seconds")})
    core.save_json(core.DATA / "backlog.json", items)


if __name__ == "__main__":
    print(scout() or "nothing passed")
