"""The images of a thread: one 4:5 image (images.size, 1080x1350, rendered at 2x) for every part, the main post and each
reply, all in the owner's house style: a diagram on white, black only, cards with the text inside them joined by
arrows, three fonts (sans titles, serif text, mono commands), zero decorative text or graphics. The last stage of a
thread, after virality, when the text is final:
  1. Opus draws every part's diagram (prompts/thread_images.md); for the reply that introduces the tool, a real
     screenshot of its GitHub page (lib/github-shot.mjs, light theme) is one of the cards
  2. code puts each diagram on the page (pipeline/thread-card.html, pipeline/thread-style.css) and renders it with
     lib/article-shot.mjs (no network; nothing outside the frame or taller than the page; no text outside a card or
     an arrow; no overlapping cards)
  3. code checks each diagram: at least 2 cards and an arrow, black, white and greys only, no shadows, gradients or
     images, no dashes, emojis or web addresses, at most CARD_WORDS words, every number found in the thread or facts
  4. an Opus critic looks at every image (prompts/thread_images_critic.md): readable on a phone, true to its part, no
     defects, the house style; under images.min_score it is redone
Problems get up to images.fix_rounds fixes; a part still failing gets a plain two-card diagram made by code, so every
part always has an image. Output: runs/<run>/images/post.png, reply1.png ... (the queue folder copies them); work files in
runs/<run>/08-images/. POSTS_IMAGES_FAKE=1 (tests) writes placeholder images instead of rendering.
  python pipeline/lib/thread_images.py --run <run folder name>    make (or remake) one thread's images
"""
from __future__ import annotations

import base64
import html
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ai  # noqa: E402
import core  # noqa: E402
import stages  # noqa: E402

WORK = "08-images"
OUT = "images"
FAKE = bool(os.environ.get("POSTS_IMAGES_FAKE"))
SHOT = core.PIPE / "lib" / "article-shot.mjs"
GITHUB = core.PIPE / "lib" / "github-shot.mjs"
FRAME = core.PIPE / "thread-card.html"
STYLE = core.PIPE / "thread-style.css"
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")
DASHES = f"[{chr(0x2014)}{chr(0x2013)}]"
EMOJI = f"[{chr(0x1F000)}-{chr(0x1FAFF)}{chr(0x2600)}-{chr(0x27BF)}]"
CARD_WORDS = 70
MAX_BYTES = 4_800_000  # X takes images up to 5 MB
SHOT_SIZE = (520, 900)  # the GitHub capture (its one-column layout), at most this, cut under the About section
SCREENSHOT = "[[SCREENSHOT]]"  # where the GitHub screenshot goes in the diagram
COLOR = re.compile(r"#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\([^)]*\)|\b(?:red|blue|green|yellow|orange|purple|pink|"
                   r"cyan|magenta|teal|navy|maroon|olive|lime|aqua|fuchsia|violet|indigo|gold|coral|crimson|salmon|"
                   r"tomato|turquoise|skyblue|royalblue|steelblue)\b", re.I)


def part_names(n: int) -> list[str]:
    return ["post"] + [f"reply{i}" for i in range(1, n)]


def image_of(folder: Path, name: str) -> Path | None:
    for ext in (".png", ".jpg"):
        if (folder / f"{name}{ext}").exists():
            return folder / f"{name}{ext}"
    return None


def complete(run: Path) -> bool:
    """True when every part of the thread has its image."""
    draft = core.load_json(run / "draft.json")
    if not draft:
        return False
    return all(image_of(run / OUT, name) for name in part_names(len(stages.thread_parts(draft))))


def pending(pool: dict) -> Path | None:
    """The next thread in the virality queue without its images: scheduled ones first (earliest slot), then the
    waiting ones by score. A thread whose images failed images.max_tries times is left alone."""
    found = []
    for e in pool.values():
        run = core.RUNS / e["run"]
        if e.get("status") not in ("waiting", "scheduled") or not (run / "draft.json").exists() or complete(run):
            continue
        if stages.state(run).get("image_tries", 0) >= core.cfg("images.max_tries", 2):
            continue
        found.append(((0, e["slot"] or "") if e["status"] == "scheduled" else (1, -e["score"]), run))
    return min(found, key=lambda f: f[0])[1] if found else None


# The house frame and the checks -----------------------------------------------------------------------------------------

def esc(s: str) -> str:
    return html.escape(str(s), quote=False)


def frame(body: str) -> str:
    page = FRAME.read_text(encoding="utf-8").replace("/*STYLE*/", STYLE.read_text(encoding="utf-8"))
    return page.replace("/*BODY*/", body)


def grey(token: str) -> bool:
    """True for black, white and greys (a colour token with equal channels)."""
    t = token.lower()
    if t.startswith("#"):
        h = t[1:]
        h = "".join(c * 2 for c in h[:3]) if len(h) in (3, 4) else h[:6]
        return len(h) == 6 and h[0:2] == h[2:4] == h[4:6]
    nums = re.findall(r"[\d.]+", t)
    if t.startswith("rgb") and len(nums) >= 3:
        return nums[0] == nums[1] == nums[2]
    if t.startswith("hsl") and len(nums) >= 3:
        return float(nums[1]) == 0
    return False


def visible_text(body: str) -> str:
    text = re.sub(r"(?is)<(style|script|title)\b.*?</\1>", " ", body)
    text = re.sub(r"(?i)<br\s*/?>|</(div|p|li|h\d|pre|tr)>", "\n", text)
    text = html.unescape(re.sub(r"<[^>]+>", " ", text))
    return "\n".join(re.sub(r"[ \t]+", " ", ln).strip() for ln in text.splitlines() if ln.strip())


def card_problems(body: str, thread_text: str, facts: list[dict]) -> list[str]:
    probs = []
    if re.search(r"(?i)<script|<link|@import|<iframe|url\(\s*['\"]?https?:|\ssrc\s*=\s*['\"]?https?:", body):
        probs.append("no scripts, external files or remote images: the card must be self-contained")
    if re.search(r"(?i)<img\b", body):
        probs.append("no images: the only picture is the GitHub screenshot, placed with " + SCREENSHOT)
    if colours := sorted({m.group(0) for m in COLOR.finditer(body) if not grey(m.group(0))}):
        probs.append(f"black, white and greys only, no colours: {', '.join(colours[:4])}")
    if re.search(r"(?i)gradient|shadow|opacity|blur\(", body):
        probs.append("no gradients, shadows, transparency or blur: nothing decorative")
    if re.search(r"(?i)<[a-z][^>]*\sstyle\s*=", body):
        probs.append("no style attributes: use only the classes, code sets the sizes")
    if len(re.findall(r"class\s*=\s*['\"][^'\"]*\bcard\b", body)) < 2:
        probs.append("a diagram needs at least 2 cards (class \"card\") with the text inside them")
    if not re.search(r"class\s*=\s*['\"][^'\"]*\barrow\b", body) and not re.search(r"(?i)<marker\b|<polygon\b", body):
        probs.append("a diagram needs arrows joining its cards (class \"arrow down\", \"arrow right\" ...)")
    text = visible_text(body)
    if not text:
        probs.append("the diagram has no text")
    if len(text.split()) > CARD_WORDS:
        probs.append(f"{len(text.split())} words on the card, at most {CARD_WORDS}: it must read at a glance")
    if re.search(DASHES, text):
        probs.append("no em or en dashes")
    if re.search(EMOJI, text):
        probs.append("no emojis")
    if found := stages.links(text):
        probs.append(f"no web addresses on the card: {', '.join(found[:3])}")
    if untraced := stages.untraced_numbers(text, [], facts + [{"claim": thread_text, "quote": ""}]):
        probs.append(f"numbers that are not in the thread or the facts: {', '.join(untraced[:5])}")
    return probs


def render(page: str, out: Path, size: tuple[int, int]) -> tuple[Path, list[str]]:
    """The page as an image: out (PNG), or a JPEG next to it when the PNG is over X's 5 MB."""
    src = out.with_suffix(".html")
    core.write_text(src, page)
    if FAKE:
        out.write_bytes(PNG)
        return out, []

    def shoot(target: Path) -> list[str]:
        p = subprocess.run(["node", str(SHOT), str(src), str(target), str(size[0]), str(size[1])],
                           capture_output=True, timeout=180)
        try:
            return json.loads(p.stdout.decode("utf-8").strip().splitlines()[-1])["problems"]
        except (ValueError, IndexError, KeyError):
            return [f"the image did not render: {p.stderr.decode('utf-8', 'replace').strip()[-200:]}"]

    probs = shoot(out)
    if out.exists() and out.stat().st_size > MAX_BYTES:
        jpg = out.with_suffix(".jpg")
        shoot(jpg)
        out.unlink()
        return jpg, probs
    return out, probs


def stars(n) -> str:
    n = int(n or 0)
    return f"{n / 1000:.1f}k stars".replace(".0k", "k") if n >= 1000 else f"{n} stars"


def github_shot(repo: dict, work: Path) -> Path | None:
    """The GitHub page, captured once per thread."""
    shot = work / "github.png"
    if shot.exists():
        return shot
    if FAKE:
        shot.write_bytes(PNG)
        return shot
    w, h = SHOT_SIZE
    p = subprocess.run(["node", str(GITHUB), repo["full_name"], str(shot), str(w), str(h)], capture_output=True,
                       timeout=180)
    if p.returncode or not shot.exists():
        core.say("WARN", f"thread images: no GitHub screenshot of {repo['full_name']}: "
                         f"{p.stderr.decode('utf-8', 'replace').strip()[-150:]}")
        shot.unlink(missing_ok=True)
        return None
    return shot


def with_screenshot(body: str, shot: Path) -> str:
    data = base64.b64encode(shot.read_bytes()).decode("ascii")
    return body.replace(SCREENSHOT, f"<img src=\"data:image/png;base64,{data}\" alt=\"\">", 1)


def fallback_body(text: str, tool: str, shot: Path | None = None, repo: str = "") -> str:
    """The plain diagram: the tool's card (or its GitHub screenshot), then the part's first two sentences, each in a
    card, joined by arrows."""
    text = re.sub(r"^\d+\.\s+", "", text.strip()).replace("\n", " ")
    said = [s if len(s) <= 160 else s[:160].rsplit(" ", 1)[0] + "..." for s in re.split(r"(?<=[.!?])\s+", text) if s][:2]
    head = (f"<div class=\"card shot\">{SCREENSHOT}<div class=\"t small\">{esc(repo)}</div></div>" if shot else
            f"<div class=\"card bold\"><div class=\"t\">{esc(tool)}</div></div>")
    cards = "".join(f"<div class=\"arrow down\"></div><div class=\"card\"><div class=\"b\">{esc(s)}</div></div>"
                    for s in said)
    body = f"<div class=\"col\">{head}{cards}</div>"
    return with_screenshot(body, shot) if shot else body


# The stage ---------------------------------------------------------------------------------------------------------------

def review(work: Path, files: dict[int, Path], parts: list[str], rnd: int) -> dict[int, dict]:
    listing = "\n\n".join(f"Part {i} ({'the main post' if i == 0 else f'reply {i}'}): {files[i]}\nIts text:\n"
                          f"{parts[i][:700]}" for i in sorted(files))
    out = ai.call("thread_images_critic", work, f"review-{rnd}", core.render(
        "thread_images_critic", IMAGES=listing, MIN=str(core.cfg("images.min_score", 8))),
        schema="thread_images_critic", tools=["Read"], add_dirs=[str(work)],
        timeout=core.cfg("images.review_minutes", 15) * 60)
    core.save_json(work / f"review-{rnd}.json", out)
    return {r["part"]: r for r in out.get("parts", [])}


def make(run: Path) -> None:
    work = run / WORK
    work.mkdir(parents=True, exist_ok=True)
    draft = core.load_json(run / "draft.json")
    parts = stages.thread_parts(draft)
    total = len(parts)
    a, repo = stages.load(run, "analysis", {}) or {}, stages.load(run, "repo", {}) or {}
    facts, disc = stages.load(run, "facts", []) or [], stages.load(run, "discovery", {}) or {}
    tool = a.get("project_name") or disc.get("name") or run.name
    gh = repo if re.fullmatch(r"[\w.-]+/[\w.-]+", str(repo.get("full_name") or "")) else {}
    size = tuple(core.cfg("images.size", [1080, 1350]))
    thread_text = "\n\n".join(parts)
    core.say("IMAGES", f"thread images: planning {total} images for {tool}")
    prompt = core.render(
        "thread_images", TOOL=tool, TOTAL=str(total), MAX_PART=str(total - 1), WORDS=str(CARD_WORDS),
        REPO=f"{gh['full_name']} ({stars(gh.get('stars'))})" if gh else "none: no GitHub repository, so no screenshot",
        PARTS="\n\n".join(f"Part {i} ({'the main post' if i == 0 else f'reply {i}'}):\n{p}" for i, p in enumerate(parts)),
        NUMBERS="\n".join(f"- {n['text']} ({n.get('fact_id', '')})" for n in draft.get("numbers", [])) or "(none)",
        BRIEF=json.dumps(stages.brief(run), ensure_ascii=False, indent=1)[:6000], FACTS=stages.facts_text(run)[:8000])
    timeout = core.cfg("images.plan_minutes", 25) * 60
    plan = ai.call("thread_images", work, "plan", prompt, schema="thread_images", timeout=timeout)
    core.save_json(work / "plan.json", plan)
    entries = {e["part"]: e for e in plan.get("parts", []) if 0 <= e["part"] < total}

    def build(i: int) -> tuple[Path | None, list[str]]:
        e = entries.get(i)
        if not e:
            return None, [f"part {i} is missing from your answer"]
        body, probs = e["body_html"], card_problems(e["body_html"], thread_text, facts)
        if e["kind"] == "github":
            github_parts = sorted(k for k, v in entries.items() if v["kind"] == "github")
            if not gh:
                probs.append("this tool has no GitHub repository: make this part a card")
            elif github_parts[0] != i:
                probs.append(f"only one part can be the GitHub screenshot (part {github_parts[0]} already is): make "
                             "this part a card")
            elif body.count(SCREENSHOT) != 1:
                probs.append(f"put {SCREENSHOT} exactly once, inside the card that shows the GitHub page")
            elif shot := github_shot(gh, work):
                body = with_screenshot(body, shot)
            else:
                probs.append("the GitHub page could not be captured: make this part a diagram without it")
        elif SCREENSHOT in body:
            probs.append(f"{SCREENSHOT} belongs only in the one part of kind github")
        path, render_probs = render(frame(body), work / f"part-{i}.png", size)
        return path, probs + render_probs

    files, done, todo = {}, {}, list(range(total))
    rounds = core.cfg("images.fix_rounds", 2)
    for rnd in range(rounds + 1):
        bad = {}
        for i in todo:
            files[i], probs = build(i)
            if probs:
                bad[i] = probs
        clean = [i for i in todo if i not in bad]
        if clean:
            verdicts = review(work, {i: files[i] for i in clean}, parts, rnd)
            for i in clean:
                v = verdicts.get(i)
                if v and v["score"] >= core.cfg("images.min_score", 8):
                    done[i] = files[i]
                else:
                    bad[i] = [f"the critic scored it {v['score']}/10: " + "; ".join(v.get("issues", []))] if v else \
                        ["the critic did not review this image"]
        todo = sorted(bad)
        if not todo or rnd == rounds:
            break
        core.say("FIX", f"thread images round {rnd}: {len(todo)} to fix, e.g. part {todo[0]}: {bad[todo[0]][0][:100]}")
        fix = ai.call("thread_images", work, f"fix-{rnd + 1}", f"{prompt}\n\nYour last answer:\n"
                      f"{json.dumps({'parts': [entries[i] for i in sorted(entries)]}, ensure_ascii=False, indent=1)}"
                      "\n\nThese parts have problems. Fix them and return the whole answer again (the parts without "
                      "problems may stay as they are):\n" + "\n".join(f"- part {i}: " + "; ".join(bad[i]) for i in todo),
                      schema="thread_images", timeout=timeout)
        for e in fix.get("parts", []):
            if e["part"] in bad:
                entries[e["part"]] = e
    for i in todo:  # still failing: the plain house card
        github = (entries.get(i) or {}).get("kind") == "github" and (work / "github.png").exists()
        files[i], _ = render(frame(fallback_body(parts[i], tool, work / "github.png" if github else None,
                                                 gh.get("full_name", ""))), work / f"part-{i}-plain.png", size)
        done[i] = files[i]
        core.say("WARN", f"thread images: part {i} of {tool} used the plain card")
    out = run / OUT
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    for i, name in enumerate(part_names(total)):
        shutil.copy(done[i], out / f"{name}{done[i].suffix}")
    core.save_json(work / "final.json", {"parts": [entries.get(i) for i in range(total)], "plain": todo})
    stages.set_state(run, images="done", image_plain=len(todo))
    core.say("IMAGES", f"thread images ready: {total} for {tool}" + (f", {len(todo)} plain" if todo else ""))


if __name__ == "__main__":
    if "--run" in sys.argv:
        target = core.RUNS / sys.argv[sys.argv.index("--run") + 1]
        if not (target / "draft.json").exists():
            sys.exit(f"no finished thread in {target}")
        make(target)
        print(f"{target / OUT}")
    else:
        print(__doc__)
