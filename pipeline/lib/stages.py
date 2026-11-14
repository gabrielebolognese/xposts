"""The stages for one run folder (one discovery): analyze, score, hooks, thread, inspect, virality.

Each stage takes the run folder and returns the next stage, or an outcome: "ready" (the thread joins the virality
queue, see virality.py), "review" or "dropped: <reason>". Everything a stage produces is saved in the run folder, so
a stopped runner resumes at the stage that was interrupted. The rules every thread follows live in
.claude/skills/x-threads/SKILL.md, the virality rules in prompts/virality.md.
"""
from __future__ import annotations

import difflib
import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ai  # noqa: E402
import core  # noqa: E402
import discover  # noqa: E402
import sandbox  # noqa: E402

CHECKER = core.ROOT / ".claude" / "skills" / "x-threads" / "check.mjs"
DETECT = core.PIPE / "vendor" / "ig-agent-skill" / "detect.py"
HUMANIZE = core.PIPE / "vendor" / "ig-agent-skill" / "humanize.py"
EMOJI_DASH_STAR = re.compile("[%s-%s%s-%s%s*`]" % tuple(map(chr, (0x1F000, 0x1FAFF, 0x2600, 0x27BF, 0x2014))))
SEP = "\n\n#--#\n\n"  # between the parts of a thread in the checker, editor, fixer and review files
# Editor checks that always block: a thread that fails one of them is never published as it is
CRITICAL = {"benefit_real", "promise_accurate", "solves_problem", "legitimate", "pricing_correct", "claims_supported",
            "final_no_link", "final_explains_access"}

# Links cut a post's reach, so threads carry none. X turns into a link: anything starting with http(s):// or www.,
# a domain on a long ending (.com, .dev, .app ...), and a domain on a two-letter ending (.ai, .io ...) only with a
# path, with a subdomain, or as .co or .tv. Names such as Node.js, next.config.js, README.md or claude.ai stay text.
URL = re.compile(r"https?://\S+|\bwww\.\S+", re.I)
DOMAIN = re.compile(r"(?<![\w@#$./-])((?:[a-z0-9-]+\.)+)([a-z]{2,})\b(/\S*)?", re.I)
LONG_ENDINGS = set("com org net edu gov info biz dev app xyz site page tech cloud online store shop blog news link "
                   "tools studio design video live mov zip".split())
CODE_ENDINGS = set("js ts py rs md sh rb go cs kt db gz".split())


def links(text: str) -> list[str]:
    found = URL.findall(text)
    for m in DOMAIN.finditer(URL.sub(" ", text)):
        dots, end, path = m.group(1).count("."), m.group(2).lower(), m.group(3)
        if end in LONG_ENDINGS or (len(end) == 2 and end not in CODE_ENDINGS and (path or dots > 1 or end in ("co", "tv"))):
            found.append(m.group(0))
    return [f.rstrip(".,;:!?)'\"") for f in found]


def load(run: Path, name: str, default=None):
    return core.load_json(run / f"{name}.json", default)


def save(run: Path, name: str, data) -> None:
    core.save_json(run / f"{name}.json", data)


def state(run: Path) -> dict:
    return load(run, "state", {})


def set_state(run: Path, **values) -> None:
    save(run, "state", {**state(run), **values})


def today() -> str:
    return core.now_rome().strftime("%Y-%m-%d")


def facts_md(facts: list[dict]) -> str:
    out = []
    for f in facts:
        if f.get("kind") == "measured":
            out.append(f"{f['id']} [measured in the sandbox by check {f['check_id']}] {f['claim']}\n"
                       f"   run: {f['url']}\n   output: {f['quote']}")
        elif f.get("kind") == "repo":
            out.append(f"{f['id']} [GitHub API] {f['claim']}\n   {f['url']} ({f['date']})\n   \"{f['quote']}\"")
        else:
            out.append(f"{f['id']} [{'primary' if f.get('primary') else 'secondary'}] {f['claim']}\n"
                       f"   {f['url']} ({f['date']})\n   \"{f['quote']}\"")
    return "\n".join(out)


def facts_text(run: Path) -> str:
    return (run / "facts.md").read_text(encoding="utf-8")


def brief(run: Path) -> dict:
    """The analysis without its facts and checks (those go to the prompts as facts.md)."""
    return {k: v for k, v in load(run, "analysis", {}).items() if k not in ("facts", "checks")}


def thread_parts(d: dict) -> list[str]:
    """The main post (hook, empty line, promise), then the replies numbered 1., 2., 3."""
    return [f"{d['hook'].strip()}\n\n{d['promise'].strip()}"] + [f"{i}. {r.strip()}" for i, r in enumerate(d["replies"], 1)]


def post_text(d: dict) -> str:
    return SEP.join(thread_parts(d))


def unnumber(reply: str) -> str:
    """Code numbers the replies, so a number the model put in front anyway is removed."""
    return re.sub(r"^\s*\d{1,2}\s*[.)/]\s+", "", reply.strip())


# 2. Analyze ---------------------------------------------------------------------------------------------------------

def repo_facts(r: dict) -> list[dict]:
    """GitHub API data as facts, so numbers like stars or the latest version can be traced."""
    if not r:
        return []
    url, date = r["html_url"], f"accessed {today()}"
    rows = [("the repository description", r.get("description"), f"description: {r.get('description')}"),
            (f"{r['full_name']} has {r.get('stars')} GitHub stars", True, f"stargazers_count: {r.get('stars')}"),
            (f"the license is {r.get('license')}", r.get("license") not in (None, "none", "NOASSERTION"),
             f"license: {r.get('license')}"),
            (f"the last push was on {(r.get('pushed_at') or '')[:10]}", r.get("pushed_at"), f"pushed_at: {r.get('pushed_at')}")]
    rel = r.get("latest_release") or {}
    if rel.get("tag"):
        rows.append((f"the latest release is {rel['tag']}, published {(rel.get('date') or '')[:10]}", True,
                     f"tag_name: {rel['tag']}, published_at: {rel.get('date')}"))
    return [{"id": f"R{n}", "claim": claim, "url": url, "date": date, "quote": quote, "primary": True, "kind": "repo"}
            for n, (claim, keep, quote) in enumerate((x for x in rows if x[1]), 1)]


def results_of(log: str) -> str:
    """What a check measured: every RESULT line (up to 3000 characters), else the end of its log."""
    lines = [l for l in log.splitlines() if l.startswith("RESULT ")]
    return "\n".join(lines)[:3000] if lines else log[-1500:]


def analyze(run: Path) -> str:
    stage = run / "02-analyze"
    disc = load(run, "discovery")
    cand = disc["candidate"]
    repo = discover.repo_key(disc.get("repo", "")) or discover.repo_key(disc.get("official_url", ""))
    r = discover.repo_data(repo)
    save(run, "repo", r)
    if r:
        tag = (r.get("latest_release") or {}).get("tag")
        if tag:
            discover.set_status(disc["id"], "analyzing", last_release_seen=tag)
        if r.get("archived") or r.get("disabled"):
            return f"dropped: the repository {r['full_name']} is archived"
        idle = core.days_ago(r.get("pushed_at"))
        if idle > core.cfg("select.max_inactive_days", 365):
            return f"dropped: no commits in {int(idle)} days, the project looks abandoned"
    out = ai.call("analyze", stage, "analyze", core.render(
        "analyze", TODAY=today(), DISCOVERY={**{k: cand.get(k) for k in (
            "name", "repo", "official_url", "what_it_does", "problem", "why_now", "pricing_guess", "update_note",
            "sources")}, "category": disc.get("category_name")},
        REPO=r or "(no public repository)"), schema="analyze", tools=["WebSearch", "WebFetch"],
        timeout=core.cfg("timeouts.analyze_seconds", 2700))
    save(run, "analysis", out)
    facts = [{**f, "kind": "source"} for f in out["facts"]] + repo_facts(r)
    reasons = []
    if not out["recommend"]:
        reasons.append(f"not recommended: {out['reason']}")
    if not out["safe_to_recommend"]:
        reasons.append(f"not safe to recommend: {out['safety_note']}")
    if not out["solves_stated_problem"]:
        reasons.append("does not solve the stated problem")
    if out["pricing_model"] != "free" and not out["pricing_verified"]:
        reasons.append(f"pricing could not be verified ({out['pricing_model']})")
    checks = []
    if not reasons:
        for c in out["checks"]:
            script, res = c["script"], None
            for rnd in range(core.cfg("caps.sandbox_fix_rounds", 2) + 1):
                core.say("CHECK", f"{c['id']} in the sandbox: {c['purpose'][:80]}")
                res = sandbox.run(script, stage / "checks" / f"{c['id']}-{rnd}")
                if res["ok"] or rnd == core.cfg("caps.sandbox_fix_rounds", 2):
                    break
                fix = ai.call("analyze", stage, f"fix-{c['id']}", core.render(
                    "check_fix", PURPOSE=c["purpose"], EXPECT=c["expect"], SCRIPT=script, LOG=res["log"][-3000:]),
                    schema="check_fix")
                if fix["give_up"]:
                    core.say("CHECK", f"{c['id']} given up: {fix['reason'][:100]}")
                    break
                script = fix["script"]
            checks.append({**c, "script": script, "ok": res["ok"], "url": res["url"], "log": res["log"][-3000:]})
            if res["ok"]:
                facts.append({"id": f"M{c['id'][1:]}", "claim": f"{c['purpose']} (expected: {c['expect']})",
                              "url": res["url"], "date": today(), "quote": results_of(res["log"]), "primary": True,
                              "kind": "measured", "check_id": c["id"], "command": script})
            elif c["kind"] == "install":
                reasons.append(f"it did not install and run in a clean machine: {c['purpose']}")
    save(run, "checks", checks)
    save(run, "facts", facts)
    core.write_text(run / "facts.md", facts_md(facts))
    if reasons:
        return "dropped: analysis: " + "; ".join(reasons)
    core.say("FACTS", f"{out['project_name']}: {len(facts)} facts, {sum(c['ok'] for c in checks)}/{len(checks)} "
             f"sandbox checks passed, {out['pricing_model']}, license {out['license']}")
    return "score"


# 3. Score -------------------------------------------------------------------------------------------------------------

def score_reasons(scores: dict, conf: dict) -> list[str]:
    """Why a scored discovery does not deserve a thread (empty: it does)."""
    reasons = []
    low = [k for k, least in conf["hard_min"].items() if scores[k] < least]
    if low:
        reasons.append("too low: " + ", ".join(f"{k} {scores[k]}" for k in low))
    total = sum(scores.values())
    if total < conf["min_total"]:
        reasons.append(f"total {total} below {conf['min_total']}")
    return reasons


def past_threads() -> list[dict]:
    """Threads already made (posted, scheduled or waiting in the virality queue)."""
    return [h for h in core.history() if h.get("status") in ("ready", "queued") and h.get("hook")]


def score(run: Path) -> str:
    a = load(run, "analysis")
    past = past_threads()[-60:]
    hist = "\n".join(f"- {h.get('name')}: {h['hook']}" for h in past) or "- (none yet)"
    out = ai.call("score", run / "03-score", "score", core.render(
        "score", HISTORY=hist, ANALYSIS=brief(run), FACTS=facts_text(run)), schema="score")
    reasons = score_reasons(out["scores"], core.cfg("select"))
    ratio = core.cfg("select.similar_ratio", 0.8)
    for h in past:
        if difflib.SequenceMatcher(None, a["problem"].lower(), (h.get("problem") or "").lower()).ratio() >= ratio:
            reasons.append(f"too similar to the thread about {h.get('name')} ({h.get('run')})")
    total = sum(out["scores"].values())
    save(run, "score", {**out, "total": total, "reasons": reasons})
    if reasons:
        return "dropped: score: " + "; ".join(reasons)
    core.say("SCORE", f"{total} of 24: {out['reason_to_exist'][:110]}")
    return "hooks"


# 4. Hooks (the most important text of the thread) ---------------------------------------------------------------------

def opening(text: str) -> str:
    return " ".join(re.findall(r"[a-z0-9$%']+", text.lower())[:3])


def hook_problems(text: str, facts: list[dict], taken: set[str]) -> list[str]:
    """What breaks a hook candidate: format, links, numbers not in the facts, an opening already used."""
    t = text.strip()
    problems = []
    if "\n" in t:
        problems.append("more than one line")
    if len(t) > 180:
        problems.append(f"{len(t)} characters, max 180")
    if EMOJI_DASH_STAR.search(t):
        problems.append("an emoji, em dash, asterisk or backtick")
    if links(t):
        problems.append("a link or web address")
    nums = untraced_numbers(t, [], facts)
    if nums:
        problems.append("numbers not in the facts: " + ", ".join(nums))
    if opening(t) in taken:
        problems.append(f"the opening \"{opening(t)}\" is already used")
    return problems


def hooks(run: Path) -> str:
    stage, facts = run / "04-hooks", load(run, "facts")
    recent = [h["hook"] for h in past_threads()[-core.cfg("hooks.recent_openings", 10):]]
    recent_openings = {opening(h) for h in recent}
    good, rejected, retry = [], [], ""
    for attempt in range(2):
        out = ai.call("hooks", stage, f"hooks-{attempt}", core.render(
            "hooks", COUNT=str(core.cfg("hooks.candidates", 12)), RECENT=recent or "(none yet)", RETRY=retry,
            ANALYSIS=brief(run), FACTS=facts_text(run), RULEBOOK=core.rulebook()), schema="hooks")
        taken = recent_openings | {opening(h["text"]) for h in good}
        for h in out["candidates"]:
            problems = hook_problems(h["text"], facts, taken)
            if problems:
                rejected.append({**h, "problems": problems})
            else:
                good.append({**h, "text": h["text"].strip()})
                taken.add(opening(h["text"]))
        if len(good) >= 3:
            break
        retry = ("\nYour earlier candidates failed these code checks; avoid the same mistakes:\n"
                 + "\n".join(f"- \"{r['text']}\": {'; '.join(r['problems'])}" for r in rejected) + "\n")
    if not good:
        return "dropped: hooks: no candidate passed the accuracy and format checks"
    crit = ai.call("hook_critic", stage, "critic", core.render(
        "hook_critic", CANDIDATES=[{"index": i, "text": h["text"], "angle": h["angle"]} for i, h in enumerate(good)],
        ANALYSIS=brief(run), FACTS=facts_text(run)), schema="hook_critic")
    chosen = None
    for i in [crit["best"]] + [i for i in range(3) if i != crit["best"]]:
        if not hook_problems(crit["refined"][i]["text"], facts, recent_openings):
            chosen = {**crit["refined"][i], "text": crit["refined"][i]["text"].strip()}
            break
    if chosen is None:  # every rewrite broke a rule: the best scored original candidate
        marks = {s["index"]: s for s in crit["scores"] if s["index"] < len(good)}
        value = lambda i: (marks[i]["accuracy"], sum(v for k, v in marks[i].items() if isinstance(v, int) and k != "index")) \
            if i in marks else (0, 0)
        chosen = good[max(range(len(good)), key=value)]
    save(run, "hooks", {"candidates": good, "rejected": rejected, "critic": crit, "chosen": chosen})
    set_state(run, hook=chosen["text"])
    core.say("HOOK", chosen["text"][:140])
    return "thread"


# 5. Thread ----------------------------------------------------------------------------------------------------------

def thread(run: Path) -> str:
    a = load(run, "analysis")
    passed = "\n".join(f"{c['id']}: {c['script'][:1500]}" for c in load(run, "checks", []) if c["ok"]) or "(none)"
    out = ai.call("thread", run / "05-thread", "thread", core.render(
        "thread", HOOK=state(run)["hook"], GITHUB=a["find_it"]["github_search"] or "(no GitHub repository)",
        WEB=a["find_it"]["web_search"] or a["project_name"], CHECKS=passed, ANALYSIS=brief(run), FACTS=facts_text(run),
        RULEBOOK=core.rulebook()), schema="thread")
    save(run, "draft", {"hook": state(run)["hook"], "promise": out["promise"].strip(),
                        "replies": [unnumber(r) for r in out["replies"]], "snippets": out["snippets"],
                        "numbers": out["numbers"]})
    return "inspect"


# 6. Inspect -------------------------------------------------------------------------------------------------------------

def untraced_numbers(text: str, snippets: list[dict], facts: list[dict]) -> list[str]:
    """Numbers in the text that appear nowhere in the facts (reply numbers, code and small counts excepted)."""
    for s in snippets:
        text = text.replace(s["text"], " ")
    text = re.sub(r"(?m)^\s*\d+[.)]\s", " ", text)
    norm = lambda s: re.sub(r"(?<=\d),(?=\d{3})", "", s)
    hay = norm(" ".join(f"{f['claim']} {f['quote']} {f.get('date', '')} {f.get('command', '')}" for f in facts))
    out = []
    for m in re.finditer(r"(?<![\w.])\d+(?:[.,]\d+)*(%?)", text):
        n = norm(m.group(0)).rstrip("%").rstrip(".,")
        if n.isdigit() and int(n) <= 10 and not m.group(1):
            continue
        if not re.search(r"(?<![\d.])" + re.escape(n) + r"(?!\d)", hay):
            out.append(m.group(0))
    return sorted(set(out))


def squash(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def code_problems(run: Path, draft: dict, rnd: int) -> tuple[list[str], str]:
    stage = run / "06-inspect"
    file, plain_file = stage / f"thread-{rnd}.txt", stage / f"thread-{rnd}-plain.txt"
    core.write_text(file, post_text(draft))
    parts = thread_parts(draft)
    plain = "\n\n".join(parts)
    core.write_text(plain_file, plain)
    res = subprocess.run(["node", str(CHECKER), str(file), "--json"], capture_output=True, timeout=60)
    problems = json.loads(res.stdout.decode("utf-8"))["problems"]
    facts = load(run, "facts", [])
    problems += [f"number not found in the facts: {n}" for n in untraced_numbers(plain, draft["snippets"], facts)]
    for i, p in enumerate(parts):
        problems += [f"{'main post' if i == 0 else f'reply {i}'}: links are not allowed, they cut the reach. Remove it "
                     f"and name the tool or repository in words: {u}" for u in links(p)]
    passed = {c["id"] for c in load(run, "checks", []) if c["ok"]}
    quotes = {f["id"]: squash(f"{f['quote']} {f.get('command', '')}") for f in facts}
    for s in draft["snippets"]:
        src = s["source"].strip()
        if s["text"] not in plain:
            problems.append(f"snippet listed but not in the thread verbatim: {s['text'][:60]}")
        elif src in passed:
            continue
        elif src not in quotes or squash(s["text"]) not in quotes[src]:
            problems.append(f"command or code that no passing check ran and no fact quotes ({src}): {s['text'][:60]}")
    det = json.loads(subprocess.run([sys.executable, "-I", "-X", "utf8", str(DETECT), str(plain_file), "--json"],
                                    capture_output=True, timeout=60).stdout.decode("utf-8"))["checks"]
    hum = json.loads(subprocess.run([sys.executable, "-I", "-X", "utf8", str(HUMANIZE), str(plain_file), "--json"],
                                    capture_output=True, timeout=60).stdout.decode("utf-8"))
    report = {k: v for k, v in hum.items() if k != "text"}
    if det["SLOP DENSITY"]["score"] < core.cfg("inspect.min_slop_score", 70):
        problems.append(f"stock AI phrasing ({det['SLOP DENSITY']['detail']}): {json.dumps(report, ensure_ascii=False)[:400]}")
    if det["FINGERPRINT"]["score"] < core.cfg("inspect.min_fingerprint_score", 100):
        problems.append(f"typographic fingerprint: {det['FINGERPRINT']['detail']} (use straight quotes, no hard spaces)")
    detector = "; ".join(f"{k} {v['score']}: {v['detail']}" for k, v in det.items())
    return problems, detector


def editor_problems(ed: dict, rnd: int) -> tuple[list[str], list[dict]]:
    """Blocking problems from the editor's answer. After the first review only issues still open from the earlier
    review, and critical ones, block, so the fix rounds settle instead of chasing fresh notes each time."""
    blocking = [i for i in ed["issues"] if (i["blocking"] or i["kind"] in CRITICAL)
                and (not rnd or i.get("earlier") or i["kind"] in CRITICAL)]
    listed = {i["kind"] for i in blocking}
    failed = [k for k in sorted(CRITICAL) if not ed["checks"][k]["pass"] and k not in listed]
    return ([f"editor ({i['kind']}): \"{i['quote'][:200]}\" -> {i['fix']}" for i in blocking]
            + [f"editor: the check {k} failed: {ed['checks'][k]['note']}" for k in failed]), blocking


def inspect(run: Path) -> str:
    stage = run / "06-inspect"
    draft = load(run, "draft")
    rnd = state(run).get("fix_round", 0)
    while True:
        problems, detector = code_problems(run, draft, rnd)
        earlier = load(run, f"inspect-{rnd - 1}", {}).get("editor_blocking", []) if rnd else []
        recheck = ("This is the first review: every issue gets earlier false." if not rnd else
                   "This is a re-check after a fix. Your earlier blocking issues were:\n"
                   + "\n".join(f"- ({i['kind']}) \"{i['quote'][:200]}\" -> {i['fix']}" for i in earlier)
                   + "\nReport each earlier issue the thread still has again, with earlier true; leave out the solved "
                     "ones. Anything new gets earlier false and only blocks when it fails a critical check, so do not "
                     "look for new polish.")
        ed = ai.call("editor", stage, f"editor-{rnd}", core.render(
            "editor", RECHECK=recheck, DETECTOR=detector, POST=post_text(draft), ANALYSIS=brief(run),
            FACTS=facts_text(run), RULEBOOK=core.rulebook()), schema="editor")
        found, blocking = editor_problems(ed, rnd)
        problems += found
        save(run, f"inspect-{rnd}", {"problems": problems, "editor": ed, "editor_blocking": blocking, "detector": detector})
        if not problems:
            core.say("PASS", f"inspect round {rnd}: no problems left")
            return "virality"
        core.say("FIX", f"inspect round {rnd}: {len(problems)} problems, e.g. {problems[0][:100]}")
        if rnd >= core.cfg("caps.inspect_fix_rounds", 3):
            core.write_text(core.REVIEW / f"{run.name}.txt", "NEEDS REVIEW\n\nOpen problems after "
                            f"{rnd} fix rounds:\n" + "\n".join(f"- {p}" for p in problems)
                            + f"\n\nFacts: {run / 'facts.md'}\n\n---\n\n{post_text(draft)}\n")
            return "review"
        fixed = ai.call("fixer", stage, f"fix-{rnd}", core.render(
            "fix", PROBLEMS="\n".join(f"- {p}" for p in problems), POST=post_text(draft),
            LISTS={"snippets": draft["snippets"], "numbers": draft["numbers"]}, ANALYSIS=brief(run),
            FACTS=facts_text(run), RULEBOOK=core.rulebook()), schema="fix")
        draft = {"hook": fixed["hook"].strip(), "promise": fixed["promise"].strip(),
                 "replies": [unnumber(r) for r in fixed["replies"]], "snippets": fixed["snippets"],
                 "numbers": fixed["numbers"]}
        rnd += 1
        save(run, "draft", draft)
        set_state(run, fix_round=rnd)


# 7. Virality ----------------------------------------------------------------------------------------------------------

CLASSES = ((90, "Exceptional"), (80, "Excellent"), (70, "Good"), (60, "Average"), (40, "Weak"), (0, "Reject"))
PENALTIES = {"misleading_financial": (10, 30), "weak_hook": (5, 15), "overused": (3, 10), "weak_delivery": (5, 15),
             "unverified": (10, 25), "engagement_bait": (3, 10)}


def classify(score: int) -> str:
    return next(name for floor, name in CLASSES if score >= floor)


def thread_score(ev: dict) -> int:
    """Weighted criteria plus bonuses minus penalties, 0 to 100. Each penalty is held to its range and counted once
    per kind, so the same weakness is never subtracted twice."""
    worst: dict[str, int] = {}
    for p in ev["penalties"]:
        if p["points"] > 0:
            lo, hi = PENALTIES[p["kind"]]
            worst[p["kind"]] = max(worst.get(p["kind"], 0), min(max(p["points"], lo), hi))
    raw = sum(ev["criteria"].values()) + sum(ev["bonuses"].values()) - sum(worst.values())
    return max(0, min(100, raw))


def final_score(hook: int, thread: int, weight: float = 0.65) -> int:
    return round(hook * weight + thread * (1 - weight))


def evaluate(run: Path, draft: dict, name: str) -> dict:
    ev = ai.call("virality", run / "07-virality", name, core.render(
        "virality", POST=post_text(draft), ANALYSIS=brief(run), FACTS=facts_text(run)), schema="virality")
    thread_points = thread_score(ev)
    final = final_score(ev["hook_score"], thread_points, core.cfg("virality.hook_weight", 0.65))
    return {**ev, "thread_score": thread_points, "final": final, "classification": classify(final)}


def better_hook(run: Path, draft: dict, ev: dict) -> dict | None:
    """Alternative hooks from 10 angles, scored together with the current one by a fresh session. Returns the draft
    with the best accurate alternative when it beats the current hook, else None."""
    stage, facts = run / "07-virality", load(run, "facts")
    out = ai.call("virality_hooks", stage, "alternatives", core.render(
        "virality_hooks", SCORE=str(ev["final"]), COUNT=str(core.cfg("virality.alternative_hooks", 10)),
        PROMISE=draft["promise"], WEAKNESSES=ev["weaknesses"], IMPROVEMENT=ev["improvement"], HOOK=draft["hook"],
        POST=post_text(draft), ANALYSIS=brief(run), FACTS=facts_text(run), RULEBOOK=core.rulebook()),
        schema="virality_hooks")
    hooks = [draft["hook"]]
    for alt in out["alternatives"]:
        t = alt["text"].strip()
        if t not in hooks and not hook_problems(t, facts, set()) and len(f"{t}\n\n{draft['promise']}") <= 280:
            hooks.append(t)
    if len(hooks) == 1:
        return None
    scored = ai.call("hook_score", stage, "hook-scores", core.render(
        "hook_score", PROMISE=draft["promise"], HOOKS=[{"index": i, "text": h} for i, h in enumerate(hooks)],
        REPLIES="\n".join(thread_parts(draft)[1:]), ANALYSIS=brief(run), FACTS=facts_text(run)),
        schema="hook_score")["scores"]
    save(run, "hook-alternatives", {"hooks": hooks, "scores": scored})
    marks = {s["index"]: s for s in scored if 0 <= s["index"] < len(hooks)}
    current = marks.get(0, {"score": 0})["score"]
    best = max((i for i in marks if i > 0 and marks[i]["accurate"]), key=lambda i: marks[i]["score"], default=None)
    if best is None or marks[best]["score"] <= current:
        return None
    new = {**draft, "hook": hooks[best]}
    if code_problems(run, new, "virality")[0]:
        return None
    core.say("HOOK", f"better hook ({current} -> {marks[best]['score']}): {hooks[best][:120]}")
    return new


def virality(run: Path) -> str:
    draft = load(run, "draft")
    ev = evaluate(run, draft, "virality-0")
    if ev["final"] < core.cfg("virality.optimize_below", 80):
        new = better_hook(run, draft, ev)
        if new:
            save(run, "draft-before-hook", draft)
            draft = new
            save(run, "draft", draft)
            set_state(run, hook=draft["hook"])
            ev = evaluate(run, draft, "virality-1")
    save(run, "virality", ev)
    if ev["final"] < core.cfg("virality.min_score", 70):
        return f"dropped: virality {ev['final']} ({ev['classification']}): {ev['weaknesses'][:200]}"
    core.say("VIRAL", f"{ev['final']} {ev['classification']} (hook {ev['hook_score']}, thread {ev['thread_score']}): "
             f"{ev['title'][:80]}")
    return "ready"


# Git (the arrangement in virality.py commits and pushes queue/) --------------------------------------------------------

def git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=core.ROOT, capture_output=True, timeout=180)


def push() -> bool:
    """Send local pipeline commits to GitHub; False (and a WARN line) when it fails, the next step tries again."""
    for args in (("pull", "--rebase", "--autostash", "-q"), ("push", "-q")):
        p = git(*args)
        if p.returncode:
            core.say("WARN", f"git {args[0]} failed, will retry: {p.stderr.decode('utf-8', 'replace').strip()[:200]}")
            return False
    return True


def push_pending() -> None:
    if core.cfg("push", True) and git("rev-list", "--count", "@{u}..HEAD").stdout.strip() not in (b"", b"0"):
        push()


STAGES = {"analyze": analyze, "score": score, "hooks": hooks, "thread": thread, "inspect": inspect, "virality": virality}
