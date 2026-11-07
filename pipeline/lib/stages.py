"""Stages 3 to 8 for one run folder: research, expand, gate, write, inspect, queue.

Each stage takes the run folder and returns the next stage, or an outcome: "queued", "review" or
"dropped: <reason>". Everything a stage produces is saved in the run folder, so a stopped runner resumes at the
stage that was interrupted.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ai  # noqa: E402
import core  # noqa: E402
import sandbox  # noqa: E402

CHECKER = core.ROOT / ".claude" / "skills" / "x-long-form-posts" / "check.mjs"
DETECT = core.PIPE / "vendor" / "ig-agent-skill" / "detect.py"
HUMANIZE = core.PIPE / "vendor" / "ig-agent-skill" / "humanize.py"
EMOJI_DASH_STAR = re.compile("[%s-%s%s-%s%s*`]" % tuple(map(chr, (0x1F000, 0x1FAFF, 0x2600, 0x27BF, 0x2014))))


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
        else:
            tags = ", ".join(t for t, on in (("primary", f.get("primary")), ("core", f.get("core"))) if on)
            out.append(f"{f['id']} [{tags or 'secondary'}] {f['claim']}\n   {f['url']} ({f['date']})\n   \"{f['quote']}\"")
    return "\n".join(out)


def post_text(d: dict) -> str:
    return f"{d['audience'].strip()}\n{d['grabber'].strip()}\n\n{d['body'].strip()}"


# 3. Research and verify ------------------------------------------------------------------------------------------

def results_of(log: str) -> str:
    lines = [l for l in log.splitlines() if l.startswith("RESULT ")]
    return ("\n".join(lines) if lines else log[-600:])[-600:]


def research(run: Path) -> str:
    stage = run / "03-research"
    idea = load(run, "idea")
    out = ai.call("research", stage, "research", core.render("research", TODAY=today(), IDEA=idea), schema="research",
                  tools=["WebSearch", "WebFetch"], timeout=core.cfg("timeouts.research_seconds", 2700))
    save(run, "research", out)
    if not out["verifiable"]:
        return f"dropped: research: {out['reason']}"
    facts = [{**f, "kind": "source"} for f in out["facts"]]
    checks = []
    for c in out["checks"]:
        script, res = c["script"], None
        for rnd in range(core.cfg("caps.sandbox_fix_rounds", 2) + 1):
            core.say("CHECK", f"{c['id']} in the sandbox: {c['purpose'][:80]}")
            res = sandbox.run(script, stage / "checks" / f"{c['id']}-{rnd}")
            if res["ok"] or rnd == core.cfg("caps.sandbox_fix_rounds", 2):
                break
            fix = ai.call("research", stage, f"fix-{c['id']}", core.render(
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
                          "core": False, "kind": "measured", "check_id": c["id"], "command": script})
    save(run, "checks", checks)
    save(run, "facts", facts)
    core.write_text(run / "facts.md", facts_md(facts))
    core.say("FACTS", f"{len(facts)} facts, {sum(c['ok'] for c in checks)}/{len(checks)} sandbox checks passed")
    return "expand"


# 4. Expansion -----------------------------------------------------------------------------------------------------

def expand(run: Path) -> str:
    notes = state(run).get("gate_notes")
    extra = f"A reviewer rejected the previous outline. Fix these points in this version:\n{notes}" if notes else ""
    out = ai.call("expand", run / "04-expand", f"expand-{state(run).get('reworks', 0)}", core.render(
        "expand", IDEA=load(run, "idea"), FACTS=(run / "facts.md").read_text(encoding="utf-8"), GATE_NOTES=extra),
        schema="expand")
    save(run, "outline", out)
    return "gate"


# 5. Value gate (a fresh session that sees only the outline and the facts) ---------------------------------------

def gate(run: Path) -> str:
    outline, facts = load(run, "outline"), load(run, "facts")
    ids = {f["id"] for f in facts}
    st = state(run)
    out = ai.call("gate", run / "05-gate", f"gate-{st.get('reworks', 0)}", core.render(
        "gate", OUTLINE=outline, FACTS=(run / "facts.md").read_text(encoding="utf-8")), schema="gate",
        tools=["WebSearch"])
    target = outline["target_persona"]
    unsupported = out["unmapped"] + [c["text"] for c in out["claims"] if not c["supported"]]
    unsupported += [c["text"] for c in outline["claims"] if not c["fact_ids"] or set(c["fact_ids"]) - ids]
    reasons = []
    if out["matches_obvious"]:
        reasons.append(f"matches an obvious version ({out['obvious_note']})")
    if out["personas"][target]["score"] < 2:
        reasons.append(f"the target reader ({target}) learns too little")
    if unsupported:
        reasons.append(f"{len(set(unsupported))} claims without support: " + "; ".join(sorted(set(unsupported)))[:400])
    if out["search"]["already_said"] and not out["search"]["original_angle_present"]:
        reasons.append("the top search results already say this and there is no original angle")
    save(run, f"gate-{st.get('reworks', 0)}", {**out, "reasons": reasons})
    if not reasons:
        core.say("GATE", f"pass ({target} learns: {out['personas'][target]['learns'][:80]})")
        return "write"
    core.say("GATE", "fail: " + "; ".join(reasons)[:160])
    if st.get("reworks", 0) < core.cfg("caps.gate_reworks", 1):
        set_state(run, reworks=st.get("reworks", 0) + 1, gate_notes="\n".join(f"- {r}" for r in reasons) + "\n" + out["notes"])
        return "expand"
    return "dropped: value gate: " + "; ".join(reasons)


# 6. Write ---------------------------------------------------------------------------------------------------------

def hook_ok(h: dict) -> bool:
    a, g = h["audience"].strip(), h["grabber"].strip()
    caps = bool(re.search(r"[A-Za-z]{2}", g)) and g == g.upper()
    return (a == a.lower() and 2 < len(a) < 90 and 5 < len(g) and not (caps and len(g) > 50)
            and not EMOJI_DASH_STAR.search(a + g))


def write(run: Path) -> str:
    stage, outline = run / "06-write", load(run, "outline")
    good = []
    for attempt in range(2):
        pairs = ai.call("write", stage, f"hooks-{attempt}", core.render(
            "hooks", CONTRACT=outline["reader_contract"], OUTLINE=outline), schema="hooks")["pairs"]
        good = [h for h in pairs if hook_ok(h)]
        if good:
            break
    good = good or pairs  # none passed twice: the inspect and fix loop deals with it
    out = ai.call("write", stage, "body", core.render(
        "write", CONTRACT=outline["reader_contract"], HOOKS=good, OUTLINE=outline,
        FACTS=(run / "facts.md").read_text(encoding="utf-8"), RULEBOOK=core.rulebook()), schema="write")
    h = good[min(out["hook_index"], len(good) - 1)]
    save(run, "draft", {"audience": h["audience"].strip(), "grabber": h["grabber"].strip(), "body": out["body"].strip(),
                        "snippets": out["snippets"], "numbers": out["numbers"]})
    return "inspect"


# 7. Inspect -------------------------------------------------------------------------------------------------------

def untraced_numbers(text: str, snippets: list[dict], facts: list[dict]) -> list[str]:
    """Numbers in the post that appear nowhere in the facts (list markers, code and small counts excepted)."""
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


def dead_links(text: str) -> list[str]:
    bad = []
    for url in re.findall(r"https?://[^\s)\]]+", text):
        url = url.rstrip(".,;:!?'\"")
        status = None
        for method in ("HEAD", "GET"):
            try:
                req = urllib.request.Request(url, method=method, headers={"User-Agent": "Mozilla/5.0 (xposts link check)"})
                with urllib.request.urlopen(req, timeout=core.cfg("inspect.link_timeout_seconds", 15)) as r:
                    status = r.status
            except urllib.error.HTTPError as exc:
                status = exc.code
            except Exception as exc:  # DNS, timeout, TLS
                status = type(exc).__name__
            if status in range(200, 400):
                break
        if status not in range(200, 400):
            bad.append(f"{url} ({status})")
    return bad


def code_problems(run: Path, draft: dict, rnd: int) -> tuple[list[str], str]:
    post = post_text(draft)
    file = run / "07-inspect" / f"post-{rnd}.txt"
    core.write_text(file, post)
    res = subprocess.run(["node", str(CHECKER), str(file), "--json"], capture_output=True, timeout=60)
    problems = json.loads(res.stdout.decode("utf-8"))[0]["problems"]
    facts = load(run, "facts", [])
    problems += [f"number not found in the facts: {n}" for n in untraced_numbers(post, draft["snippets"], facts)]
    problems += [f"link does not answer: {u}" for u in dead_links(post)]
    passed = {c["id"] for c in load(run, "checks", []) if c["ok"]}
    for s in draft["snippets"]:
        if s["text"] not in post:
            problems.append(f"snippet listed but not in the post verbatim: {s['text'][:60]}")
        elif s["check_id"] not in passed:
            problems.append(f"code that no sandbox check ran successfully: {s['text'][:60]}")
    det = json.loads(subprocess.run([sys.executable, "-I", "-X", "utf8", str(DETECT), str(file), "--json"],
                                    capture_output=True, timeout=60).stdout.decode("utf-8"))["checks"]
    hum = json.loads(subprocess.run([sys.executable, "-I", "-X", "utf8", str(HUMANIZE), str(file), "--json"],
                                    capture_output=True, timeout=60).stdout.decode("utf-8"))
    report = {k: v for k, v in hum.items() if k != "text"}
    if det["SLOP DENSITY"]["score"] < core.cfg("inspect.min_slop_score", 70):
        problems.append(f"stock AI phrasing ({det['SLOP DENSITY']['detail']}): {json.dumps(report, ensure_ascii=False)[:400]}")
    if det["FINGERPRINT"]["score"] < core.cfg("inspect.min_fingerprint_score", 100):
        problems.append(f"typographic fingerprint: {det['FINGERPRINT']['detail']} (use straight quotes, no hard spaces)")
    detector = "; ".join(f"{k} {v['score']}: {v['detail']}" for k, v in det.items())
    return problems, detector


def inspect(run: Path) -> str:
    stage = run / "07-inspect"
    draft = load(run, "draft")
    rnd = state(run).get("fix_round", 0)
    facts_text = (run / "facts.md").read_text(encoding="utf-8")
    while True:
        problems, detector = code_problems(run, draft, rnd)
        ed = ai.call("editor", stage, f"editor-{rnd}", core.render(
            "editor", DETECTOR=detector, POST=post_text(draft), FACTS=facts_text), schema="editor")
        for kind in ("repeats", "deletions", "slop", "accuracy", "privacy"):
            problems += [f"editor ({kind}): {x}" for x in ed[kind]]
        save(run, f"inspect-{rnd}", {"problems": problems, "editor": ed, "detector": detector})
        if not problems:
            core.say("PASS", f"inspect round {rnd}: no problems left")
            return "queue"
        core.say("FIX", f"inspect round {rnd}: {len(problems)} problems, e.g. {problems[0][:100]}")
        if rnd >= core.cfg("caps.inspect_fix_rounds", 3):
            core.write_text(core.REVIEW / f"{run.name}.txt", "NEEDS REVIEW\n\nOpen problems after "
                            f"{rnd} fix rounds:\n" + "\n".join(f"- {p}" for p in problems)
                            + f"\n\nFacts: {run / 'facts.md'}\n\n---\n\n{post_text(draft)}\n")
            return "review"
        fixed = ai.call("fixer", stage, f"fix-{rnd}", core.render(
            "fix", PROBLEMS="\n".join(f"- {p}" for p in problems), POST=post_text(draft),
            LISTS={"snippets": draft["snippets"], "numbers": draft["numbers"]}, FACTS=facts_text,
            RULEBOOK=core.rulebook()), schema="fix")
        draft = {k: fixed[k] for k in ("audience", "grabber", "body", "snippets", "numbers")}
        rnd += 1
        save(run, "draft", draft)
        set_state(run, fix_round=rnd)


# 8. Queue ---------------------------------------------------------------------------------------------------------

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


def queue(run: Path) -> str:
    draft, idea, outline = load(run, "draft"), load(run, "idea"), load(run, "outline")
    slot = subprocess.run(["node", str(core.PIPE / "bin" / "next-slot.mjs")], capture_output=True,
                          timeout=60).stdout.decode().strip()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}_\d{4}", slot):
        raise RuntimeError(f"next-slot.mjs printed '{slot}'")
    folder = core.ROOT / "queue" / slot
    folder.mkdir(parents=True)
    core.write_text(folder / "post.txt", post_text(draft))
    rel = f"queue/{slot}"
    for args in (("add", "--", rel), ("commit", "-q", "-m", "pipeline: queue 1 post", "--", rel)):
        p = git(*args)
        if p.returncode:
            raise RuntimeError(f"git {args[0]}: {p.stderr.decode('utf-8', 'replace').strip()[:200]}")
    if core.cfg("push", True):
        push()
    core.add_history({"status": "queued", "slot": slot, "run": run.name, "niche": idea["niche"], "tool": idea["tool"],
                      "post_type": idea["post_type"], "audience": idea["audience"], "problem": idea["problem"],
                      "takeaway": idea["takeaway"], "contract": outline["reader_contract"],
                      "sources": [s.get("url") for s in idea.get("sources", [])]})
    core.say("QUEUED", f"{slot}  {draft['audience']} / {draft['grabber']}")
    return "queued"


STAGES = {"research": research, "expand": expand, "gate": gate, "write": write, "inspect": inspect, "queue": queue}
