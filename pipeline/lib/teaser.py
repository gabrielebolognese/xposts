"""The Friday post about the week's X Article: about 1,000 characters that make people open and read the article,
not a summary of it. It quotes the article, so the article card shows right under the text. run.sh runs this every
minute. On teaser.day (Friday), from teaser.read_at (06:20) until teaser.give_up (16:00), once:
  1. this week's article (written on Wednesday by lib/article.py); none: no Friday post
  2. find it on the owner's profile: a Claude in Chrome session (prompts/teaser_find.md) reads the profile and returns
     the article's post id, when xAutoReply is not using Chrome (the same waiting as lib/trend.py). Read only, no X API.
     Not on the profile (not posted): no Friday post.
  3. Opus writes the post (prompts/teaser_write.md), checked in code: lib/longform-check.mjs (the hook, paragraphs, no
     emojis, dashes or markdown), teaser.min_chars to teaser.max_chars, no links or hashtags, the AI-tells detector;
     up to teaser.fix_rounds fixes, else review/teaser-<date>.txt
  4. queue/<date>_0900 (or the next free minute when later) with post.txt and quote.txt (the article's post id)
A failed try runs once more after 10 minutes. State: pipeline/data/teaser/<date>.json.
  python pipeline/lib/teaser.py --now --dry    find and write now without queueing (to see one)
"""
from __future__ import annotations

import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ai  # noqa: E402
import article  # noqa: E402
import core  # noqa: E402
import stages  # noqa: E402
import trend  # noqa: E402

DIR = core.DATA / "teaser"
DONE = ("queued", "skipped", "review", "gave_up")


def now() -> datetime:
    fake = os.environ.get("POSTS_TEASER_NOW")  # tests: a fixed Rome wall clock time, like 2030-01-04T06:20
    return datetime.fromisoformat(fake).replace(tzinfo=core.ROME) if fake else core.now_rome()


def load(d: date) -> dict:
    return core.load_json(DIR / f"{d}.json", {})


def save(d: date, **values) -> dict:
    st = {**load(d), **values}
    core.save_json(DIR / f"{d}.json", st)
    return st


def teaser_day(d: date) -> bool:
    return article.DAYS[d.weekday()] == core.cfg("teaser.day", "fri")


def week_article(d: date) -> tuple[date, dict] | None:
    """This week's X Article: the one from the latest article day on or before d, when it was made."""
    back = (d.weekday() - article.DAYS.index(core.cfg("article.day", "wed"))) % 7
    wed = d - timedelta(days=back)
    st, art = article.load(wed), core.load_json(article.DIR / str(wed) / "article.json", {})
    if st.get("status") in ("ready", "opened") and art.get("title"):
        return wed, art
    return None


def due(t: datetime, st: dict) -> bool:
    d = t.date()
    if not teaser_day(d) or st.get("status") in DONE:
        return False
    if not trend.at(d, core.cfg("teaser.read_at", "06:20")) <= t < trend.at(d, core.cfg("teaser.give_up", "16:00")):
        return False
    if st.get("status") == "error":
        return t.timestamp() - st.get("failed_at", 0) >= 600
    return True


def find(work: Path, wed: date, art: dict) -> dict:
    """The article's post on the owner's profile, read with Claude in Chrome."""
    if not trend.wait_for_chrome():
        raise RuntimeError(f"Chrome stayed busy with xAutoReply for {core.cfg('trend.chrome_wait_minutes', 45)} minutes")
    started = trend.start_chrome()
    try:
        core.say("TREND", "Friday post: looking for this week's X Article on your profile")
        out = ai.call("teaser_find", work, "find", core.render(
            "teaser_find", DEVICE=core.cfg("trend.chrome_device"), TITLE=art["title"].strip(), DATE=f"{wed:%A %d %B %Y}"),
            schema="teaser_find", tools=["ToolSearch"], chrome=True, timeout=core.cfg("teaser.read_minutes", 20) * 60)
    finally:
        if started:
            trend.close_chrome()
    if out["status"] not in ("ok", "not_found"):
        raise RuntimeError(trend.STATUS.get(out["status"], out["status"]) + (f": {out['note']}" if out.get("note") else ""))
    core.save_json(work / "find.json", out)
    return out


def problems(text: str, work: Path, rnd: int) -> list[str]:
    file = work / f"post-{rnd}.txt"
    core.write_text(file, text)
    res = subprocess.run(["node", str(trend.CHECKER), str(file), "--json"], capture_output=True, timeout=60)
    probs = json.loads(res.stdout.decode("utf-8"))["problems"]
    lo, hi = core.cfg("teaser.min_chars", 800), core.cfg("teaser.max_chars", 1300)
    if not lo <= len(text) <= hi:
        probs.append(f"{len(text)} characters, needs {lo} to {hi} (about 1,000)")
    if re.search(r"https?://|www\.", text):
        probs.append("no links: the article is quoted under the post")
    if re.search(r"(^|\s)#\w", text):
        probs.append("no hashtags")
    if chr(0x2013) in text:
        probs.append("no en dashes")
    found, _ = stages.ai_tells(file)
    return probs + found


def write_post(d: date, art: dict, work: Path) -> str | None:
    """The post, checked; None when it still breaks the rules after the fix rounds (then it waits in review/)."""
    core.say("TREND", "Friday post: writing it")
    prompt = core.render("teaser_write", TITLE=art["title"].strip(), ARTICLE=art["body"].strip(),
                         MIN=str(core.cfg("teaser.min_chars", 800)), MAX=str(core.cfg("teaser.max_chars", 1300)))
    text = ai.call("teaser_write", work, "write", prompt, schema="teaser_post")["post"].strip()
    rounds = core.cfg("teaser.fix_rounds", 2)
    for rnd in range(rounds + 1):
        probs = problems(text, work, rnd)
        if not probs:
            core.write_text(work / "post.txt", text)
            return text
        if rnd == rounds:
            break
        core.say("FIX", f"Friday post round {rnd}: {len(probs)} problems, e.g. {probs[0][:100]}")
        text = ai.call("teaser_write", work, f"fix-{rnd + 1}", f"{prompt}\n\nYour last post:\n{text}\n\nIt breaks these "
                       "rules. Fix them and return the whole post again:\n" + "\n".join(f"- {p}" for p in probs),
                       schema="teaser_post")["post"].strip()
    core.write_text(core.REVIEW / f"teaser-{d}.txt", "NEEDS REVIEW\n\nOpen problems after "
                    f"{rounds} fix rounds:\n" + "\n".join(f"- {p}" for p in probs) + f"\n\n---\n\n{text}\n")
    core.say("REVIEW", f"Friday post: still breaks the rules after {rounds} fixes, see pipeline/review/teaser-{d}.txt")
    return None


def queue_post(d: date, text: str, quote: str) -> str:
    with core.queue_lock():
        slot = max(trend.at(d, core.cfg("teaser.time", "09:00")), now().replace(second=0, microsecond=0))
        while (core.ROOT / "queue" / core.slot_name(slot)).exists():
            slot += timedelta(minutes=1)
        q = core.ROOT / "queue" / core.slot_name(slot)
        q.mkdir(parents=True)
        core.write_text(q / "post.txt", text)
        core.write_text(q / "quote.txt", quote)
    return q.name


def make(d: date, dry: bool = False) -> None:
    lock = socket.socket()
    try:
        lock.bind(("127.0.0.1", core.cfg("teaser.lock_port", 47618)))
    except OSError:
        return  # another Friday post run is working
    work = DIR / (f"{d}-dry" if dry else str(d))
    put = (lambda **v: None) if dry else (lambda **v: save(d, **v))
    try:
        put(status="working", started_at=time.time(), error=None)
        week = week_article(d)
        if not week:
            put(status="skipped", reason="no X Article this week")
            core.say("WARN", "Friday post: no X Article was made this week, no post")
            return
        wed, art = week
        found = find(work, wed, art)
        if found["status"] != "ok" or not re.fullmatch(r"\d{1,25}", found.get("post_id", "")):
            put(status="skipped", reason="the article is not on the profile")
            core.say("WARN", f"Friday post: \"{art['title'].strip()}\" is not on your profile (not posted yet?), no post")
            return
        put(article=str(wed), title=art["title"].strip(), quote=found["post_id"])
        text = write_post(d, art, work)
        if text is None:
            put(status="review")
            return
        if dry:
            core.say("TREND", f"Friday post (dry run), quoting post {found['post_id']}: {work / 'post.txt'}")
            print(text)
            return
        if now() >= trend.at(d, core.cfg("teaser.give_up", "16:00")):
            put(status="gave_up", error="ready after the give-up time")
            core.say("WARN", "Friday post: ready after the give-up time, not posted")
            return
        slot = queue_post(d, text, found["post_id"])
        put(status="queued", slot=slot, text=text)
        core.say("POST", f"Friday post about the X Article \"{art['title'].strip()}\": queued {slot}")
    except Exception as exc:  # noqa: BLE001  every failure is logged; the next minute's run decides on a retry
        msg = core.undash(str(exc))[:300]
        if dry:
            core.say("ERROR", f"Friday post (dry run): {msg}")
            return
        tries = load(d).get("tries", 0) + 1
        last = tries >= 2
        save(d, status="gave_up" if last else "error", tries=tries, failed_at=now().timestamp(), error=msg)
        core.say("ERROR", f"Friday post: {msg}" + (", skipped this week" if last else ", trying again in 10 minutes"))
    finally:
        lock.close()


def main() -> None:
    t = now()
    d = t.date()
    st = load(d)
    if "--now" in sys.argv:
        if st.get("status") in DONE and "--dry" not in sys.argv:
            print(f"Today's Friday post is already done ({st['status']}). Add --dry to make one without queueing it.")
            return
        make(d, dry="--dry" in sys.argv)
        return
    if not teaser_day(d) or st.get("status") in DONE:
        return
    give_up = core.cfg("teaser.give_up", "16:00")
    if t >= trend.at(d, give_up):
        save(d, status="gave_up", error=st.get("error") or f"not made by {give_up} (the PC was off or busy)")
        core.say("WARN", f"Friday post: skipped this week, not made by {give_up}")
        return
    if due(t, st):
        make(d)


if __name__ == "__main__":
    main()
