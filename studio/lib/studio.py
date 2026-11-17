"""Claude Studio: one edge-pushing project a day, built overnight by Claude Code (on the Claude subscription), recorded
as a video and queued as one long post at studio.post_time (11:00).

run.sh runs this every studio.check_minutes. Each run does what is due:
  - a project half done (a restart, a crash): it resumes at its stage
  - from studio.start (22:30) on: tomorrow's project (brief, build, review, record, post, queue: hours), so it is
    ready for tomorrow's 11:00; before 22:30, today's project if today has none (the PC was off at 22:30)
  - otherwise nothing
  python studio/lib/studio.py --now    starts today's project at once if today has none (the first build, tests)

Stages, each saved in studio/projects/<YYYY-MM-DD>/state.json so a restart resumes:
  brief    Opus picks the subject and designs the screen, the real science and the camera (brief.json)
  build    Claude Code builds it in the project folder, looking at its own screenshots (index.html, NOTES.md)
  review   a separate critic scores frames; below studio.min_score the builder fixes and it is reviewed again
  record   a live run with real resource sampling, then a frame-by-frame render (metrics.json, video.mp4)
  post     the long post from the measured numbers (post.txt)
  queue    post.txt and video.mp4 into queue/<date>_1100, committed and pushed (the video stays on this PC)
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import time
import traceback
import uuid
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "pipeline" / "lib"))
import ai  # noqa: E402
import core  # noqa: E402
import errors  # noqa: E402
import stages  # noqa: E402

STUDIO = core.ROOT / "studio"
PROJECTS = STUDIO / "projects"
LOCK = STUDIO / ".lock"
STAGES = ["brief", "build", "review", "record", "post", "queue"]
DONE = ("queued", "held", "failed")
IDEAS = """- the brain of a chess engine: a real alpha-beta search with move ordering on a real position, the move tree growing, node counts, nodes per second, eval graph, best line
- a full PC architecture with every component: cores, L1/L2/L3 caches, memory controller, RAM, PCIe, GPU, SSD, buses carrying a real memory-access trace with latencies and hit rates
- a CPU simulated at gate level running a real program: registers, ALU, buses lighting up, clock, instruction trace
- a semiconductor fab: a wafer through lithography, etching and doping, a die map with a yield heatmap
- a neural network training live on real data: weight heatmaps, activations, loss and accuracy curves, confusion matrix
- a tiny transformer running inference: attention maps per head, token probabilities
- a 3D particle accelerator: the ring, bunches, magnets, collisions in a detector event display with real relativistic kinematics
- an atom built from real hydrogen wavefunctions: orbitals, energy levels, spectral lines
- the heart: electrical waves across tissue (an excitable-media model) generating a live ECG
- a drug moving through the body over 24 hours: a compartment model, organs, plasma curves, doses
- DNA to protein: transcription and translation, ribosome, codons, the chain folding
- a black hole with real gravitational lensing and an accretion disk
- a quantum computer running Grover's algorithm: state vector amplitudes, Bloch spheres, gates
- a nuclear reactor: neutron population, control rods, criticality
- a packet's trip across the internet: routing tables, TCP handshake, congestion window
- a compiler live: source, tokens, syntax tree, IR, assembly"""


# Helpers -------------------------------------------------------------------------------------------------------------

def render(name: str, **values) -> str:
    text = (STUDIO / "prompts" / f"{name}.md").read_text(encoding="utf-8")
    return re.sub(r"\{\{([A-Z_]+)\}\}", lambda m: str(values[m.group(1)]), text)


def load(p: Path, name: str, default=None):
    return core.load_json(p / name, default)


def state(p: Path) -> dict:
    return core.load_json(p / "state.json", {})


def save_state(p: Path, **changes) -> dict:
    st = {**state(p), **changes}
    core.save_json(p / "state.json", st)
    return st


def system() -> dict:
    f = STUDIO / "data" / "system.json"
    if not f.exists():
        subprocess.run(["node", "-e", "import('./studio/tools/server.mjs').then((m) => m.system())"], cwd=core.ROOT,
                       capture_output=True, timeout=60)
    return core.load_json(f, {})


def system_line() -> str:
    s = system()
    return (f"{s.get('cpu', '?')} ({s.get('cores', '?')} cores, {s.get('threads', '?')} threads), {s.get('ramGB', '?')} GB RAM, "
            f"{s.get('gpu', '?')}, {s.get('os', '')}").strip()


def kit_doc() -> str:
    lines = (STUDIO / "kit" / "studio-kit.js").read_text(encoding="utf-8").splitlines()
    out = []
    for line in lines:
        if line.startswith("(() =>"):
            break
        out.append(line[3:] if line.startswith("// ") else line.lstrip("/"))
    return "\n".join(out).strip()


def model_name(model_id: str) -> str:
    """claude-opus-5-5 -> Claude Opus 5.5"""
    m = re.match(r"claude-([a-z]+)-(\d+)(?:-(\d+))?", model_id or "")
    if not m:
        return model_id or "Claude"
    return f"Claude {m.group(1).capitalize()} {m.group(2)}{'.' + m.group(3) if m.group(3) else ''}"


def lines_of_code(p: Path) -> int:
    return sum(len(f.read_text(encoding="utf-8", errors="replace").splitlines())
               for f in p.iterdir() if f.suffix in (".html", ".js", ".css") and f.is_file())


class Lock:
    """One studio run at a time (the runner's loop and a manual --now). A lock older than the longest build is stale."""
    def __enter__(self):
        try:
            LOCK.mkdir(parents=True)
        except FileExistsError:
            if time.time() - LOCK.stat().st_mtime < (core.cfg("studio.build_hours", 4) + 3) * 3600:
                return None
            shutil.rmtree(LOCK, ignore_errors=True)
            LOCK.mkdir(parents=True)
        return self

    def __exit__(self, *exc):
        shutil.rmtree(LOCK, ignore_errors=True)


# Claude Code sessions (the build and the fixes) ----------------------------------------------------------------------

def claude_code(p: Path, prompt: str, session: str, resume: bool, name: str) -> dict:
    """One Claude Code session in the project folder, with file tools and the screenshot tool only. Waits through
    usage limits. Returns the result JSON (cost, duration, turns) and adds them to state.json."""
    model = core.cfg("models.studio_build.model", "opus")
    effort = core.cfg("models.studio_build.effort", "max")
    timeout = int(core.cfg("studio.build_hours", 4) * 3600)
    calls = p / "calls"
    calls.mkdir(exist_ok=True)
    text, started = prompt, time.time()
    while True:
        cmd = ai.claude_cmd() + ["-p", "--model", model, "--effort", effort, "--output-format", "json",
                                 "--permission-mode", "auto", "--permission-prompts", "none",
                                 "--tools", "Read,Write,Edit,Glob,Grep,Bash",
                                 "--allowedTools", "Read", "Write", "Edit", "Glob", "Grep", "Bash(node ../../tools/shot.mjs *)",
                                 "--disallowedTools", "WebSearch", "WebFetch",
                                 "--max-budget-usd", str(core.cfg("studio.build_budget_usd", 80))]
        cmd += ["--resume", session] if resume else ["--session-id", session]
        core.write_text(calls / f"{name}.prompt.md", text)
        try:
            pr = subprocess.run(cmd, input=text.encode("utf-8"), capture_output=True, cwd=p, timeout=timeout)
            rc, out, err = pr.returncode, pr.stdout.decode("utf-8", "replace"), pr.stderr.decode("utf-8", "replace")
        except subprocess.TimeoutExpired:
            rc, out, err = 124, "", f"timed out after {timeout} s"
        core.write_text(calls / f"{name}.json", out)
        core.write_text(calls / f"{name}.err", err)
        cls = errors.classify(rc, out, err, "Europe/Rome", int(time.time()), core.cfg("retries.limit_margin_seconds", 120))
        try:
            data = json.loads(out)
        except ValueError:
            data = {}
        if data:  # count what the session cost, whatever its outcome
            st = state(p)
            usage = data.get("modelUsage") or {}
            top = max(usage, key=lambda k: usage[k].get("costUSD", 0), default=None)
            save_state(p, cost_usd=round(st.get("cost_usd", 0) + float(data.get("total_cost_usd") or 0), 4),
                       build_seconds=round(st.get("build_seconds", 0) + (data.get("duration_ms") or 0) / 1000),
                       turns=st.get("turns", 0) + int(data.get("num_turns") or 0), model_id=top or st.get("model_id"))
        if cls["class"] == "limit":
            lim = cls.get("limit") or {}
            wait = max(60, (lim.get("target") or time.time() + 1800) - time.time())
            core.say("LIMIT", f"studio build: usage limit, waiting until {time.strftime('%H:%M', time.localtime(time.time() + wait))}")
            time.sleep(wait)
            resume, text = True, "Continue the build where you left off, following the original instructions. Reply with one line: done."
            continue
        if rc == 124:
            core.say("WARN", f"studio build: stopped after {core.cfg('studio.build_hours', 4)} hours")
            return data
        if cls["class"] != "ok" and not (p / "index.html").exists():
            raise RuntimeError(f"studio build failed: {cls['message'] or err.strip()[:200]}")
        return data


# Stages ----------------------------------------------------------------------------------------------------------------

def stage_brief(p: Path) -> str:
    past = []
    for d in sorted(PROJECTS.iterdir()):
        b = load(d, "brief.json") if d.is_dir() and not d.name.startswith("_") else None
        if d != p and b and "title" in b:
            past.append(f"- {d.name}: {b['title']}: {b['subject']} | {b['design']['mode']}, {b['design']['layout'][:120]}")
    number = len(past) + 1
    angle = ("Week 1 of the series (projects 1 to 7): build with Opus at maximum effort and no libraries at all: raw "
             "canvas 2D, WebGL or SVG written by hand. The first week must be visually complete and effortful, the most "
             "ambitious screens of the series." if number <= 7 else
             "Default: Opus at maximum effort, no libraries. About once a week (not two days in a row) choose an angle that "
             "tests a model instead: built entirely by a smaller model, or built from a single prompt with no review. "
             "Name the angle in the angle field.")
    sysinfo = system()
    brief = ai.call("studio_brief", p, "brief", render(
        "brief", TODAY=p.name, NUMBER=str(number), SYSTEM=system_line(), ANGLE=angle, THREADS=str(sysinfo.get("threads", 16)),
        PAST="\n".join(past) or "(none yet: this is the first project)", IDEAS=IDEAS),
        schema=STUDIO / "schemas" / "brief.json", timeout=2700)
    v = brief["video_seconds"]
    cam = sorted(({**k, "t": max(0.0, min(float(k["t"]), v)), "cx": min(1.0, max(0.0, k["cx"])), "cy": min(1.0, max(0.0, k["cy"])),
                   "zoom": min(2.0, max(1.0, k["zoom"]))} for k in brief["camera"]), key=lambda k: k["t"])
    brief["camera"] = cam
    core.save_json(p / "brief.json", brief)
    save_state(p, number=number)
    core.say("STUDIO", f"brief: {brief['title']}: {brief['subject'][:150]}")
    return "build"


def stage_build(p: Path) -> str:
    brief, st = load(p, "brief.json"), state(p)
    session = st.get("session") or str(uuid.uuid4())
    resume = bool(st.get("session"))
    save_state(p, session=session, build_started=st.get("build_started") or core.now_rome().isoformat(timespec="seconds"))
    core.say("STEP", f"studio build ({'resumed' if resume else 'new'} session): {brief['title']}")
    prompt = (render("build", NUMBER=str(st.get("number", 1)), ID=p.name, BRIEF=json.dumps(brief, indent=1, ensure_ascii=False),
                     LIBRARIES="No libraries at all: write every line yourself (raw canvas 2D, WebGL or SVG).",
                     SYSTEM=system_line(), KIT=kit_doc(), HEADLINE=", ".join(h["key"] for h in brief["headline_numbers"]))
              if not resume else
              "Continue the build where you left off, following the original instructions. Reply with one line: done.")
    claude_code(p, prompt, session, resume, f"build-{int(time.time())}")
    if not (p / "index.html").exists():
        raise RuntimeError("the build left no index.html")
    return "review"


def shots(p: Path, brief: dict) -> dict:
    v = brief["video_seconds"]
    times = sorted({2, round(v * 0.35), round(v * 0.65), max(3, v - 3)})
    zoomed = sorted(brief["camera"], key=lambda k: -k["zoom"])[:2]
    cmd = ["node", str(STUDIO / "tools" / "shot.mjs"), ".", "--at", ",".join(map(str, times))]
    for k in zoomed:
        cmd += ["--view", f"{k['cx']:.3f},{k['cy']:.3f},{max(1.5, k['zoom']):.2f}"]
    shutil.rmtree(p / "shots", ignore_errors=True)
    out = subprocess.run(cmd, cwd=p, capture_output=True, timeout=1800).stdout.decode("utf-8", "replace")
    try:
        res = json.loads(out[out.index("{"):])
    except ValueError:
        res = {"shots": [], "errors": [out[-300:] or "the screenshot tool printed nothing"], "frameMs": None}
    res["times"] = times
    return res


def stage_review(p: Path) -> str:
    brief, st = load(p, "brief.json"), state(p)
    rnd = st.get("review_round", 0)
    shot = shots(p, brief)
    notes = (p / "NOTES.md").read_text(encoding="utf-8") if (p / "NOTES.md").exists() else "(no notes)"
    crit = ai.call("studio_critic", p, f"critic-{rnd}", render(
        "critic", TIMES=", ".join(f"{t} s" for t in shot["times"]),
        SHOTS="\n".join(f"- {(p / s).as_posix()}" for s in shot["shots"]) or "(no screenshots: the page failed to render)",
        BRIEF=json.dumps({k: brief[k] for k in ("title", "subject", "design", "panels", "controls", "mid_work")}, indent=1, ensure_ascii=False),
        NOTES=notes[:4000], ERRORS=json.dumps(shot.get("errors", [])[:10]), FRAME_MS=json.dumps(shot.get("frameMs"))),
        schema=STUDIO / "schemas" / "critic.json", tools=["Read"], add_dirs=[str(p)], timeout=1800)
    score = round(sum(crit["scores"].values()) / len(crit["scores"]), 1)
    critical = [i for i in crit["issues"] if i["severity"] == "critical"]
    major = [i for i in crit["issues"] if i["severity"] == "major"]
    core.save_json(p / f"review-{rnd}.json", {"score": score, "critic": crit, "shots": shot})
    save_state(p, review_score=score, review_round=rnd)
    good = score >= core.cfg("studio.min_score", 8) and not critical and not major  # majors show in the video: fixed first
    core.say("PASS" if good else "REVIEW",
             f"studio review {rnd}: {score}/10, {len(critical)} critical, {len(major)} major, {len(crit['issues'])} issues: "
             f"{crit['summary'][:150]}")
    if good:
        return "record"
    if rnd >= core.cfg("studio.review_rounds", 2):
        if score < 6 or critical:
            core.say("WARN", f"studio: {brief['title']} is held, not posted ({score}/10 after {rnd} fix rounds). "
                             f"Look at it: bash studio/open.sh {p.name}")
            return "held"
        return "record"
    issues = "\n".join(f"{i + 1}. [{x['severity']}] {x['where']}: {x['problem']} Fix: {x['fix']}" for i, x in enumerate(crit["issues"]))
    claude_code(p, render("fix", SCORE=str(score), MIN=str(core.cfg("studio.min_score", 8)), ISSUES=issues),
                st["session"], True, f"fix-{rnd + 1}")
    save_state(p, review_round=rnd + 1)
    return "review"


def stage_record(p: Path) -> str:
    core.say("STEP", "studio record: live run with real resource sampling, then the frame-by-frame render")
    pr = subprocess.run(["node", str(STUDIO / "tools" / "record.mjs"), str(p), "--fps", str(core.cfg("studio.fps", 60)),
                         "--scale", str(core.cfg("studio.scale", 2))], cwd=core.ROOT, capture_output=True, timeout=4 * 3600)
    core.write_text(p / "calls" / "record.log", pr.stdout.decode("utf-8", "replace") + pr.stderr.decode("utf-8", "replace"))
    rec = load(p, "record.json", {})
    if pr.returncode or not (p / "video.mp4").exists():
        raise RuntimeError(f"recording failed: {(rec.get('errors') or ['no video'])[-1][:200]}")
    if rec.get("mb", 0) > 500:
        raise RuntimeError(f"the video is {rec['mb']} MB, over X's 512 MB limit")
    core.say("STUDIO", f"video recorded: {rec['seconds']} s at {rec['fps']} fps, {rec['mb']} MB, rendered in {rec['render_seconds']} s")
    return "post"


def facts(p: Path) -> tuple[str, str, str]:
    brief, st, rec, m = load(p, "brief.json"), state(p), load(p, "record.json", {}), load(p, "metrics.json", {})
    sysinfo = m.get("system") or system()
    samples = [s for s in m.get("samples", []) if s["t"] >= 0]
    fpsv = [x["fps"] for x in m.get("perf", []) if x.get("fps")]
    avg = lambda xs: round(sum(xs) / len(xs), 1) if xs else None
    cpu = [s["cpuTotal"] for s in samples]
    gpu = [s["gpu"] for s in samples if s.get("gpu") is not None]
    ram = [s["ramUsed"] for s in samples]
    cost = f"${st.get('cost_usd', 0):.2f}"
    model = model_name(st.get("model_id", ""))
    report = rec.get("report") or m.get("report") or {}
    meanings = {h["key"]: h["meaning"] for h in brief["headline_numbers"]}
    lines = [
        f"Project: {brief['title']}: {brief['subject']}",
        f"Why it is hard: {brief['why_hard']}",
        f"The science: {brief['science'][:1500]}",
        f"Built by {model} in Claude Code, alone, no libraries, effort {core.cfg('models.studio_build.effort', 'xhigh')}",
        f"Build time: {round(st.get('build_seconds', 0) / 60)} minutes of Claude Code work, {st.get('turns', 0)} turns",
        f"Build cost: {cost} (the cost Claude Code reports for these sessions at API prices)",
        f"Review rounds by a separate critic: {st.get('review_round', 0)}; final critic score {st.get('review_score', '?')} out of 10",
        f"Lines of code: {lines_of_code(p)}",
        f"Live run on {system_line()}: page at {min(fpsv) if fpsv else '?'} to {max(fpsv) if fpsv else '?'} fps, "
        f"CPU {avg(cpu)}% average (max {max(cpu) if cpu else '?'}%), RAM {max(ram) if ram else '?'} of {sysinfo.get('ramGB', '?')} GB in use, "
        f"GPU {avg(gpu) if gpu else '?'}% average",
        f"Video: {rec.get('seconds')} s at {rec.get('fps')} fps, 1080p, rendered frame by frame at 2x in {rec.get('render_seconds')} s",
        "Headline numbers from the run:",
        *[f"- {k} = {v} ({meanings.get(k, '')})" for k, v in report.items()],
    ]
    return "\n".join(lines), cost, model


def post_problems(text: str, hook: str, promise: str, cost: str, fact_text: str) -> list[str]:
    probs = []
    if "\n" in hook.strip() or len(hook.strip()) > 100:
        probs.append(f"the hook must be one line of at most 100 characters (it has {len(hook.strip())})")
    if "\n" in promise.strip() or len(promise.strip()) > 120:
        probs.append("the promise must be one line of at most 120 characters")
    if len(text) > 2400:
        probs.append(f"the post has {len(text)} characters, max 2400")
    if cost not in text:
        probs.append(f"the build cost {cost} is missing")
    if stages.EMOJI_DASH_STAR.search(text):
        probs.append("an emoji, em dash, asterisk or backtick")
    if stages.links(text):
        probs.append("a link or web address: " + ", ".join(stages.links(text)))
    if "#" in text:
        probs.append("a hashtag")
    nums = stages.untraced_numbers(text, [], [{"claim": fact_text, "quote": "", "date": ""}])
    if nums:
        probs.append("numbers not in the facts: " + ", ".join(nums))
    return probs


def stage_post(p: Path) -> str:
    fact_text, cost, model = facts(p)
    core.write_text(p / "facts.txt", fact_text)
    notes = (p / "NOTES.md").read_text(encoding="utf-8") if (p / "NOTES.md").exists() else "(no notes)"
    retry = ""
    for attempt in range(2):
        out = ai.call("studio_post", p, f"post-{attempt}", render(
            "post", COST=cost, MODEL=model, RETRY=retry, FACTS=fact_text, NOTES=notes[:4000]),
            schema=STUDIO / "schemas" / "post.json", timeout=1800)
        text = "\n\n".join([out["hook"].strip(), out["promise"].strip()]
                           + [f"{i}. {stages.unnumber(s)}" for i, s in enumerate(out["sections"], 1)])
        probs = post_problems(text, out["hook"], out["promise"], cost, fact_text + "\n" + notes)
        if not probs:
            core.write_text(p / "post.txt", text + "\n")
            core.say("STUDIO", f"post written: {out['hook']}")
            return "queue"
        retry = "\nYour previous version had these problems, fix them:\n" + "\n".join(f"- {x}" for x in probs) + "\n"
    raise RuntimeError("the post still breaks the rules after a retry: " + "; ".join(probs))


def next_slot() -> str:
    t = core.cfg("studio.post_time", "11:00")
    now = core.now_rome()
    day = now.date()
    for _ in range(30):
        at = datetime.fromisoformat(f"{day}T{t}").replace(tzinfo=core.ROME)
        name = core.slot_name(at)
        if at > now + timedelta(minutes=core.cfg("lead_minutes", 15)) and not (core.ROOT / "queue" / name).exists():
            return name
        day += timedelta(days=1)
    raise RuntimeError("no free studio slot in the next 30 days")


def stage_queue(p: Path) -> str:
    brief = load(p, "brief.json")
    with core.queue_lock():
        slot = state(p).get("slot")  # a retry reuses the slot it already took, so the post is never queued twice
        if not slot or not (core.ROOT / "queue" / slot).exists():
            slot = next_slot()
            save_state(p, slot=slot)
        q = core.ROOT / "queue" / slot
        q.mkdir(parents=True, exist_ok=True)
        shutil.copy2(p / "post.txt", q / "post.txt")
        shutil.copy2(p / "video.mp4", q / "video.mp4")
        paths = [f"queue/{slot}/post.txt", f"studio/projects/{p.name}"]  # the project's code too; .gitignore keeps the video out
        stages.git("add", "--", *paths)
        stages.git("commit", "-q", "-m", f"studio: queue {brief['title']}", "--", *paths)
        if core.cfg("push", True):
            stages.push()  # a failed push only warns: the posting loop pushes pending commits later
    core.say("STUDIO", f"today's build is ready: {brief['title']}, posts {slot}. Look at it: bash studio/open.sh {p.name}")
    return "queued"


RUN = {"brief": stage_brief, "build": stage_build, "review": stage_review, "record": stage_record, "post": stage_post,
       "queue": stage_queue}


def due(now_flag: bool) -> Path | None:
    PROJECTS.mkdir(parents=True, exist_ok=True)
    for d in sorted(PROJECTS.iterdir()):
        if d.is_dir() and not d.name.startswith("_") and state(d).get("stage") not in DONE + (None,):
            return d
    now = core.now_rome()
    start = datetime.fromisoformat(f"{now.date()}T{core.cfg('studio.start', '22:30')}").replace(tzinfo=core.ROME)
    day = (now.date() + timedelta(days=1) if now >= start and not now_flag else now.date()).isoformat()
    if not covered(day):
        p = PROJECTS / day
        p.mkdir(parents=True)
        save_state(p, stage="brief", created=now.isoformat(timespec="seconds"))
        return p
    return None


def covered(day: str) -> bool:
    """The day has its project: a folder named after it, or a project that holds its post slot (a late build)."""
    return any(d.name == day or str(state(d).get("slot", "")).startswith(day)
               for d in PROJECTS.iterdir() if d.is_dir() and not d.name.startswith("_"))


def main(now_flag: bool = False) -> None:
    with Lock() as held:
        if held is None:
            return
        p = due(now_flag)
        while p is not None:
            st = state(p)
            stage = st.get("stage", "brief")
            if stage in DONE:
                return
            try:
                nxt = RUN[stage](p)
                save_state(p, stage=nxt, errors=0)
            except Exception as exc:
                n = st.get("errors", 0) + 1
                core.LOGS.mkdir(parents=True, exist_ok=True)
                with open(core.LOGS / "errors.log", "a", encoding="utf-8", newline="\n") as f:
                    f.write(f"\n[{core.now_rome():%Y-%m-%d %H:%M}] studio {p.name} {stage}\n{traceback.format_exc()}")
                core.say("ERROR", f"studio {stage}: {core.undash(str(exc))[:200]}")
                save_state(p, errors=n, stage="failed" if n >= 3 else stage)
                return


if __name__ == "__main__":
    main("--now" in sys.argv)
