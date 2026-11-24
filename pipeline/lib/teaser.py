"""The daily article post: every day, about 1,000 characters that make people open and read the latest X Article (the
Monday one, lib/article.py), not a summary of it. It quotes the article, so the article card shows right under the
text. run.sh runs this every minute. On teaser.days (every day), from teaser.start (16:00) until teaser.give_up
(23:00), once:
  1. the latest article made (ready or opened); none yet: no post
  2. its post id: kept in the article's state once found; until then a Claude in Chrome session
     (prompts/teaser_find.md) reads the owner's profile when xAutoReply is not using Chrome (the same waiting as
     lib/trend.py). Read only, no X API. Not there yet (on Monday the article is posted by hand from its page): read
     again every teaser.find_every_minutes until the give-up time
  3. Opus writes the post (prompts/teaser_write.md), seeing the posts already made about the same article so each day
     takes a new angle. Checked in code: lib/longform-check.mjs (the hook, paragraphs, no emojis, dashes or markdown),
     teaser.min_chars to teaser.max_chars, no links or hashtags, a hook not used on an earlier day, the AI-tells
     detector; up to teaser.fix_rounds fixes, else review/teaser-<date>.txt
  4. queue/<date>_1800 (teaser.time, or the next free minute when later) with post.txt and quote.txt (the article's
     post id)
A failed try runs once more after 10 minutes. State: pipeline/data/teaser/<date>.json.
  python pipeline/lib/teaser.py --now --dry    find and write now without queueing (to see one)
"""
from __future__ import annotations

import json
import os
import re
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
    fake = os.environ.get("POSTS_TEASER_NOW")  # tests: a fixed Rome wall clock time, like 2029-12-31T16:00
    return datetime.fromisoformat(fake).replace(tzinfo=core.ROME) if fake else core.now_rome()


def load(d: date) -> dict:
    return core.load_json(DIR / f"{d}.json", {})


def save(d: date, **values) -> dict:
    st = {**load(d), **values}
    core.save_json(DIR / f"{d}.json", st)
    return st


def teaser_day(d: date) -> bool:
    return article.DAYS[d.weekday()] in core.cfg("teaser.days", list(article.DAYS))


def latest_article() -> tuple[str, dict] | None:
    """The newest X Article made (ready or opened): its key and its article.json."""
    for f in sorted(article.DIR.glob("20*.json"), reverse=True):
        art = core.load_json(article.DIR / f.stem / "article.json", {})
        if core.load_json(f, {}).get("status") in ("ready", "opened") and art.get("title"):
            return f.stem, art
    return None


def past_posts(key: str, d: date) -> list[str]:
    """The posts queued about this article on the days before d, oldest first."""
    out = []
    for f in sorted(DIR.glob("20*.json")):
        st = core.load_json(f, {})
        if f.stem < str(d) and st.get("article") == key and st.get("status") == "queued" and st.get("text"):
            out.append(st["text"])
    return out


def due(t: datetime, st: dict) -> bool:
    d = t.date()
    if not teaser_day(d) or st.get("status") in DONE:
        return False
    if not trend.at(d, core.cfg("teaser.start", "16:00")) <= t < trend.at(d, core.cfg("teaser.give_up", "23:00")):
        return False
    if st.get("status") == "error":
        return t.timestamp() - st.get("failed_at", 0) >= 600
    if st.get("status") == "waiting":
        return t.timestamp() - st.get("find_at", 0) >= core.cfg("teaser.find_every_minutes", 60) * 60
    return True


def find(work: Path, key: str, title: str) -> str:
    """The article's post id on the owner's profile, read with Claude in Chrome; "" when it is not there yet."""
    if not trend.wait_for_chrome():
        raise RuntimeError(f"Chrome stayed busy with xAutoReply for {core.cfg('trend.chrome_wait_minutes', 45)} minutes")
    started = trend.start_chrome()
    try:
        core.say("ARTICLE", f"article post: looking for the X Article \"{title}\" on your profile")
        out = ai.call("teaser_find", work, f"find-{int(time.time())}", core.render(
            "teaser_find", DEVICE=core.cfg("trend.chrome_device"), HANDLE=core.cfg("x_handle"),
            ARTICLES=f"- {key[:10]}: \"{title}\""), schema="teaser_find", tools=["ToolSearch"], chrome=True,
            timeout=core.cfg("teaser.read_minutes", 20) * 60)
    finally:
        if started:
            trend.close_chrome()
    if out["status"] not in ("ok", "not_found"):
        raise RuntimeError(trend.STATUS.get(out["status"], out["status"]) + (f": {out['note']}" if out.get("note") else ""))
    core.save_json(work / "find.json", out)
    hit = next((a for a in out["articles"] if re.fullmatch(r"\d{1,25}", a.get("post_id", ""))), None)
    return hit["post_id"] if hit else ""


def hook_line(text: str) -> str:
    """The hook's second sentence (its second line), normalized."""
    lines = text.strip().splitlines()
    return re.sub(r"\W+", " ", lines[1] if len(lines) > 1 else "").strip().lower()


def problems(text: str, work: Path, rnd: int, past: list[str]) -> list[str]:
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
    if hook_line(text) and hook_line(text) in {hook_line(p) for p in past}:
        probs.append("the hook's second line was already used by an earlier post about this article: write a new one")
    found, _ = stages.ai_tells(file)
    return probs + found


def write_post(d: date, art: dict, work: Path, past: list[str]) -> str | None:
    """The post, checked; None when it still breaks the rules after the fix rounds (then it waits in review/)."""
    core.say("ARTICLE", "article post: writing it")
    before = "\n\n---\n\n".join(past[-6:]) if past else "(none: this is the first post about this article)"
    prompt = core.render("teaser_write", TITLE=art["title"].strip(), ARTICLE=art["body"].strip(), PAST=before,
                         MIN=str(core.cfg("teaser.min_chars", 800)), MAX=str(core.cfg("teaser.max_chars", 1300)))
    text = ai.call("teaser_write", work, "write", prompt, schema="teaser_post")["post"].strip()
    rounds = core.cfg("teaser.fix_rounds", 2)
    for rnd in range(rounds + 1):
        probs = problems(text, work, rnd, past)
        if not probs:
            core.write_text(work / "post.txt", text)
            return text
        if rnd == rounds:
            break
        core.say("FIX", f"article post round {rnd}: {len(probs)} problems, e.g. {probs[0][:100]}")
        text = ai.call("teaser_write", work, f"fix-{rnd + 1}", f"{prompt}\n\nYour last post:\n{text}\n\nIt breaks these "
                       "rules. Fix them and return the whole post again:\n" + "\n".join(f"- {p}" for p in probs),
                       schema="teaser_post")["post"].strip()
    core.write_text(core.REVIEW / f"teaser-{d}.txt", "NEEDS REVIEW\n\nOpen problems after "
                    f"{rounds} fix rounds:\n" + "\n".join(f"- {p}" for p in probs) + f"\n\n---\n\n{text}\n")
    core.say("REVIEW", f"article post: still breaks the rules after {rounds} fixes, see pipeline/review/teaser-{d}.txt")
    return None


def queue_post(d: date, text: str, quote: str) -> str:
    with core.queue_lock():
        slot = max(trend.at(d, core.cfg("teaser.time", "18:00")), now().replace(second=0, microsecond=0))
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
        lock.bind(("127.0.0.1", core.cfg("teaser.lock_port", 47632)))
    except OSError:
        return  # another article post run is working
    work = DIR / (f"{d}-dry" if dry else str(d))
    put = (lambda **v: None) if dry else (lambda **v: save(d, **v))
    try:
        put(status="working", started_at=time.time(), error=None)
        latest = latest_article()
        if not latest:
            put(status="skipped", reason="no X Article yet")
            core.say("WARN", "article post: no X Article was made yet, no post today")
            return
        key, art = latest
        title = art["title"].strip()
        put(article=key, title=title)
        pid = article.load(key).get("post_id", "")
        if not pid:
            pid = find(work, key, title)
            if not pid:
                every = core.cfg("teaser.find_every_minutes", 60)
                put(status="waiting", find_at=now().timestamp())
                core.say("WARN", f"article post: \"{title}\" is not on your profile yet (post it from its page), "
                                 f"looking again in {every} minutes")
                return
            if not dry:
                article.save(key, post_id=pid)
        put(quote=pid)
        text = write_post(d, art, work, past_posts(key, d))
        if text is None:
            put(status="review")
            return
        if dry:
            core.say("ARTICLE", f"article post (dry run), quoting post {pid}: {work / 'post.txt'}")
            print(text)
            return
        if now() >= trend.at(d, core.cfg("teaser.give_up", "23:00")):
            put(status="gave_up", error="ready after the give-up time")
            core.say("WARN", "article post: ready after the give-up time, not posted")
            return
        slot = queue_post(d, text, pid)
        put(status="queued", slot=slot, text=text)
        core.say("POST", f"article post about the X Article \"{title}\": queued {slot}")
    except Exception as exc:  # noqa: BLE001  every failure is logged; the next minute's run decides on a retry
        msg = core.undash(str(exc))[:300]
        if dry:
            core.say("ERROR", f"article post (dry run): {msg}")
            return
        tries = load(d).get("tries", 0) + 1
        last = tries >= 2
        save(d, status="gave_up" if last else "error", tries=tries, failed_at=now().timestamp(), error=msg)
        core.say("ERROR", f"article post: {msg}" + (", skipped today" if last else ", trying again in 10 minutes"))
    finally:
        lock.close()


def main() -> None:
    t = now()
    d = t.date()
    st = load(d)
    if "--now" in sys.argv:
        if st.get("status") in DONE and "--dry" not in sys.argv:
            print(f"Today's article post is already done ({st['status']}). Add --dry to make one without queueing it.")
            return
        make(d, dry="--dry" in sys.argv)
        return
    if not teaser_day(d) or st.get("status") in DONE:
        return
    give_up = core.cfg("teaser.give_up", "23:00")
    if t >= trend.at(d, give_up):
        why = (f"\"{st.get('title')}\" was not on your profile by {give_up}" if st.get("status") == "waiting"
               else f"not made by {give_up} (the PC was off or busy)")
        save(d, status="gave_up", error=st.get("error") or why)
        core.say("WARN", f"article post: skipped today, {why}")
        return
    if due(t, st):
        make(d)


if __name__ == "__main__":
    main()
