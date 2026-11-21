"""Viral posts: 3 times a day, at random times, find outliers in the X timeline and repurpose the best one. run.sh
runs this every minute.
  1. times: viral.runs_per_day random times between viral.window (08:00 to 21:30), at least viral.min_gap_minutes
     apart, picked once a day
  2. read: at each time, when xAutoReply is not using Chrome (the signals lib/trend.py checks; a run still blocked
     viral.give_up_minutes after its time is skipped), a Claude in Chrome session (prompts/viral_read.md) scrolls the
     For you timeline of the Chrome account, keeps posts over viral.min_views views and opens their authors' profiles.
     Read only, no X API.
  3. pick: a viral post has over viral.min_views views and at least viral.ratio_small (15) times its author's
     followers in views when the author has under viral.small_followers (800), else at least viral.ratio_large (20)
     times; it fits the niche and was not used before. The most views per follower wins. None: no post this time.
  4. a normal post: Opus repurposes it (prompts/viral_write.md): the same hook in different words, checked in code (no
     links, hashtags, mentions, emojis or dashes, not a near copy, the AI-tells detector; up to viral.fix_rounds fixes,
     else review/viral-<date>-<n>.txt), queued at the next free minute at least viral.post_gap_minutes from other posts
  5. an X Article: with this week's budget left (viral.articles_per_week, Monday to Sunday), lib/article.py writes an
     article on the same hook and opens its page to post by hand; with the budget used, the post quotes the closest
     existing article instead. The post waits until the article is on the owner's profile (x_handle; a Claude in
     Chrome read every viral.find_every_minutes, for up to viral.find_give_up_hours), then goes out quoting it.
A failed run tries once more after 10 minutes. State: pipeline/data/viral/<date>.json; model calls and work files:
pipeline/data/viral/<date>-<n>/.
  python pipeline/lib/viral.py --now     run a check now (it takes the place of today's next one)
  python pipeline/lib/viral.py --now --dry    read, pick and write now without saving or queueing (to see one)
"""
from __future__ import annotations

import difflib
import json
import os
import random
import re
import socket
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

DIR = core.DATA / "viral"
DONE = ("none", "queued", "waiting", "review", "skipped", "gave_up")
FAKE = bool(os.environ.get("POSTS_VIRAL_FAKE"))  # tests: Chrome is never busy, never started


def now() -> datetime:
    fake = os.environ.get("POSTS_VIRAL_NOW")  # tests: a fixed Rome wall clock time, like 2030-01-01T10:00
    return datetime.fromisoformat(fake).replace(tzinfo=core.ROME) if fake else core.now_rome()


def load(d: date) -> dict:
    return core.load_json(DIR / f"{d}.json", {})


def put(d: date, n: int, **values) -> dict:
    """Update run n (0 based) of day d."""
    st = load(d)
    runs = st.setdefault("runs", {})
    runs[str(n)] = {**runs.get(str(n), {}), **values}
    core.save_json(DIR / f"{d}.json", st)
    return runs[str(n)]


def minutes(hhmm: str) -> int:
    return int(hhmm[:2]) * 60 + int(hhmm[3:])


def pick_times(rng: random.Random | None = None) -> list[str]:
    """viral.runs_per_day random times in viral.window, at least viral.min_gap_minutes apart, sorted."""
    rng = rng or random.Random()
    lo, hi = (minutes(x) for x in core.cfg("viral.window", ["08:00", "21:30"]))
    n, gap = core.cfg("viral.runs_per_day", 3), core.cfg("viral.min_gap_minutes", 120)
    for _ in range(2000):
        ts = sorted(rng.randint(lo, hi) for _ in range(n))
        if all(b - a >= gap for a, b in zip(ts, ts[1:])):
            break
    else:  # the window is too small for random gaps: spread evenly
        ts = [lo + i * (hi - lo) // max(1, n - 1) for i in range(n)]
    return [f"{t // 60:02d}:{t % 60:02d}" for t in ts]


def times(d: date) -> list[str]:
    st = load(d)
    if not st.get("times"):
        st["times"] = pick_times()
        core.save_json(DIR / f"{d}.json", st)
    return st["times"]


def due_run(t: datetime) -> int | None:
    """Today's first run whose time has come and is not done; runs blocked too long are skipped on the way."""
    d = t.date()
    runs = load(d).get("runs", {})
    for n, hhmm in enumerate(times(d)):
        run = runs.get(str(n), {})
        start = trend.at(d, hhmm)
        if run.get("status") in DONE or t < start:
            continue
        if t >= start + timedelta(minutes=core.cfg("viral.give_up_minutes", 120)):
            why = run.get("waiting_for") or "the PC was off or busy"
            put(d, n, status="skipped", reason=why)
            core.say("WARN", f"viral check {n + 1} of {hhmm}: skipped, {why}")
            continue
        if run.get("status") == "error" and t.timestamp() - run.get("failed_at", 0) < 600:
            return None
        return n
    return None


def chrome_free(d: date, n: int) -> bool:
    if FAKE:
        return True
    why = trend.chrome_busy()
    if why and load(d).get("runs", {}).get(str(n), {}).get("waiting_for") != why:
        put(d, n, waiting_for=why)
        core.say("VIRAL", f"viral check {n + 1}: waiting for Chrome, {why}")
    return not why


# Reading ----------------------------------------------------------------------------------------------------------------

def used_ids() -> set[str]:
    """The viral posts already repurposed or looked at as the pick, in the last 30 days."""
    out = set()
    for f in sorted(DIR.glob("20*.json"))[-30:]:
        for run in core.load_json(f, {}).get("runs", {}).values():
            if run.get("source", {}).get("id"):
                out.add(run["source"]["id"])
    return out


def read(work: Path) -> dict:
    started = False if FAKE else trend.start_chrome()
    try:
        core.say("VIRAL", "viral check: scrolling the timeline in Chrome")
        seen = "\n".join(f"- {i}" for i in sorted(used_ids())) or "(none)"
        out = ai.call("viral_read", work, "read", core.render(
            "viral_read", DEVICE=core.cfg("trend.chrome_device"), MIN_VIEWS=str(core.cfg("viral.min_views", 5000)),
            SMALL=str(core.cfg("viral.small_followers", 800)), RATIO_SMALL=str(core.cfg("viral.ratio_small", 15)),
            RATIO_LARGE=str(core.cfg("viral.ratio_large", 20)), MAX_PROFILES=str(core.cfg("viral.max_profiles", 20)),
            SEEN=seen), schema="viral_read", tools=["ToolSearch"], chrome=True,
            timeout=core.cfg("viral.read_minutes", 30) * 60)
    finally:
        if started:
            trend.close_chrome()
    if out["status"] != "ok":
        raise RuntimeError(trend.STATUS.get(out["status"], out["status"]) + (f": {out['note']}" if out.get("note") else ""))
    core.save_json(work / "read.json", out)
    return out


def needed_views(followers: int) -> int:
    """Views a post needs to count as viral: min_views, and ratio_small times the followers under small_followers,
    else ratio_large times."""
    small = followers < core.cfg("viral.small_followers", 800)
    ratio = core.cfg("viral.ratio_small", 15) if small else core.cfg("viral.ratio_large", 20)
    return max(core.cfg("viral.min_views", 5000), ratio * followers)


def viral(posts: list[dict], used: set[str]) -> list[dict]:
    """The outliers: enough views for the author's followers (needed_views), in the niche, not used before; the most
    views per follower first. Authors whose profile was not read (followers -1) never count."""
    hits = [p for p in posts if p["followers"] >= 0 and p["views"] >= needed_views(p["followers"]) and p["niche"]
            and p["id"] not in used and p["text"].strip()]
    return sorted(hits, key=lambda p: p["views"] / (p["followers"] + 1), reverse=True)


# Articles ---------------------------------------------------------------------------------------------------------------

def week_articles(d: date) -> list[str]:
    """The keys of the articles made or being made this week (Monday to Sunday)."""
    monday = d - timedelta(days=d.weekday())
    out = []
    for f in sorted(article.DIR.glob("20*.json")):
        try:
            day = date.fromisoformat(f.stem[:10])
        except ValueError:
            continue
        if monday <= day <= monday + timedelta(days=6) and core.load_json(f, {}).get("status") in ("working", "ready", "opened"):
            out.append(f.stem)
    return out


def budget_left(d: date) -> int:
    return core.cfg("viral.articles_per_week", 3) - len(week_articles(d))


def existing_articles() -> dict[str, dict]:
    """Every article made so far, by key: title, topic and the post id once it was found on the profile."""
    out = {}
    for f in sorted(article.DIR.glob("20*.json")):
        st = core.load_json(f, {})
        if st.get("title") and st.get("status") in ("ready", "opened"):
            out[f.stem] = {"title": st["title"], "topic": st.get("topic", ""), "post_id": st.get("post_id", "")}
    return out


def article_key(d: date) -> str:
    key, k = str(d), 1
    while (article.DIR / f"{key}.json").exists():
        k += 1
        key = f"{d}-{k}"
    return key


def find_article(work: Path, key: str, title: str) -> str:
    """The article's post id on the owner's profile (a Claude in Chrome read), or "" when it is not there yet."""
    started = False if FAKE else trend.start_chrome()
    try:
        core.say("VIRAL", f"viral post: looking for the X Article \"{title}\" on your profile")
        out = ai.call("teaser_find", work, f"find-{int(time.time())}", core.render(
            "teaser_find", DEVICE=core.cfg("trend.chrome_device"), HANDLE=core.cfg("x_handle"),
            ARTICLES=f"- {key[:10]}: \"{title}\""), schema="teaser_find", tools=["ToolSearch"], chrome=True,
            timeout=core.cfg("teaser.read_minutes", 20) * 60)
    finally:
        if started:
            trend.close_chrome()
    if out["status"] not in ("ok", "not_found"):
        raise RuntimeError(trend.STATUS.get(out["status"], out["status"]) + (f": {out['note']}" if out.get("note") else ""))
    hit = next((a for a in out["articles"] if re.fullmatch(r"\d{1,25}", a.get("post_id", ""))), None)
    return hit["post_id"] if hit else ""


# Writing ----------------------------------------------------------------------------------------------------------------

def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip().lower()


def problems(post: dict, src: dict, work: Path, rnd: int, keys: list[str]) -> list[str]:
    text = post["post"].strip()
    probs = []
    cap = min(3000, max(280, int(len(src["text"]) * 1.5)))
    if not 20 <= len(text) <= cap:
        probs.append(f"{len(text)} characters: keep it between 20 and {cap} (about as long as the original)")
    if re.search(r"https?://|www\.", text):
        probs.append("no links")
    if re.search(r"(^|\s)#\w", text):
        probs.append("no hashtags")
    if re.search(r"(^|\s)@\w", text):
        probs.append("no @mentions")
    if stages.EMOJI_DASH_STAR.search(text) or chr(0x2013) in text:
        probs.append("no emojis, em or en dashes, asterisks or backticks")
    if difflib.SequenceMatcher(None, norm(text), norm(src["text"])).ratio() >= 0.6:
        probs.append("too close to the original: keep the hook's shape but say everything in your own words")
    if keys and post.get("quote_article") not in keys:
        probs.append("quote_article must be one of: " + ", ".join(keys))
    file = work / f"post-{rnd}.txt"
    core.write_text(file, text)
    found, _ = stages.ai_tells(file)
    return probs + found


def recent_posts() -> list[str]:
    out = []
    for f in sorted(DIR.glob("20*.json"))[-7:]:
        out += [r["text"].splitlines()[0][:120] for r in core.load_json(f, {}).get("runs", {}).values() if r.get("text")]
    return out


def write_post(d: date, n: int, src: dict, mode: str, work: Path, articles: dict | None = None) -> dict | None:
    """The repurposed post, checked; None when it still breaks the rules after the fix rounds (it waits in review/)."""
    modes = {
        "post": lambda: "One post for the owner's account with the same hook. It goes out on its own.",
        "article": lambda: ("The owner just wrote an X Article on this viral article's topic, with the same hook: "
                            f"\"{articles['title']}\". Write the post that goes out quoting it (the article card shows "
                            "under the post): the viral post's hook in your words, and a reason to open the article. "
                            "Not a summary."),
        "quote": lambda: ("The owner has no new article for this, so the post quotes one of the owner's existing X "
                          "Articles (its card shows under the post). Pick the one closest to this topic and give its key "
                          "in quote_article. Write the post with the viral post's hook in your words, leading into that "
                          "article. The owner's articles (key: title [topic]):\n"
                          + "\n".join(f"- {k}: {a['title']} [{a['topic']}]" for k, a in articles.items())),
    }
    art = (f"\nIt is an X Article titled \"{src['article_title']}\". What it says:\n{src['article_body'][:2500]}\n"
           if src.get("is_article") else "")
    base = dict(DATE=f"{d:%A %d %B %Y}", VIEWS=f"{src['views']:,}", FOLLOWERS=f"{src['followers']:,}",
                AUTHOR=src["author"], MEDIA=src.get("media") or "none", TEXT=src["text"].strip(), ARTICLE=art,
                MODE=modes[mode](), RECENT="\n".join(f"- {r}" for r in recent_posts()) or "(none yet)")
    keys = list(articles) if mode == "quote" else []
    tools, retry = ["WebSearch", "WebFetch"], ""
    rounds = core.cfg("viral.fix_rounds", 2)
    for rnd in range(rounds + 1):
        post = ai.call("viral_write", work, f"write-{rnd}", core.render("viral_write", RETRY=retry, **base),
                       schema="viral_post", tools=tools)
        probs = problems(post, src, work, rnd, keys)
        if not probs:
            core.write_text(work / "post.txt", post["post"].strip())
            core.save_json(work / "post.json", post)
            return post
        if rnd < rounds:
            core.say("FIX", f"viral post round {rnd}: {len(probs)} problems, e.g. {probs[0][:100]}")
            retry = (f"\nYour last answer:\n{json.dumps(post, ensure_ascii=False, indent=1)}\n\nIt breaks these rules. "
                     "Fix them and return the whole answer again:\n" + "\n".join(f"- {p}" for p in probs) + "\n")
    core.write_text(core.REVIEW / f"viral-{d}-{n + 1}.txt", "NEEDS REVIEW\n\nOpen problems after "
                    f"{rounds} fix rounds:\n" + "\n".join(f"- {p}" for p in probs) + f"\n\n---\n\n{post['post'].strip()}\n")
    core.say("REVIEW", f"viral post: still breaks the rules after {rounds} fixes, see pipeline/review/viral-{d}-{n + 1}.txt")
    return None


# Queueing ---------------------------------------------------------------------------------------------------------------

def queue_post(text: str, quote: str = "") -> str:
    """The next free minute from now that is at least viral.post_gap_minutes from every other queued post."""
    gap = timedelta(minutes=core.cfg("viral.post_gap_minutes", 30))
    with core.queue_lock():
        q_dir = core.ROOT / "queue"
        taken = [s for p in (q_dir.iterdir() if q_dir.exists() else []) if (s := core.slot_time(p.name))]
        slot = now().replace(second=0, microsecond=0) + timedelta(minutes=1)
        while any(abs(slot - s) < gap for s in taken):
            slot += timedelta(minutes=1)
        q = q_dir / core.slot_name(slot)
        q.mkdir(parents=True)
        core.write_text(q / "post.txt", text)
        if quote:
            core.write_text(q / "quote.txt", quote)
    return q.name


# The run ----------------------------------------------------------------------------------------------------------------

def summary(p: dict) -> dict:
    return {k: p[k] for k in ("id", "author", "followers", "views", "is_article", "article_title")} | {"text": p["text"][:600]}


def make(d: date, n: int, dry: bool = False) -> None:
    work = DIR / (f"{d}-dry" if dry else f"{d}-{n + 1}")
    save = (lambda *a, **v: {}) if dry else put  # a dry run saves nothing: it does not count, the post stays unused
    try:
        save(d, n, status="working", started_at=time.time(), error=None)
        out = read(work)
        hits = viral(out["posts"], used_ids())
        if not hits:
            save(d, n, status="none", scanned=out["scanned"], big=len(out["posts"]))
            core.say("VIRAL", f"viral check {n + 1}: {out['scanned']} timeline posts, {len(out['posts'])} over "
                              f"{core.cfg('viral.min_views', 5000):,} views, none in the niche with "
                              f"{core.cfg('viral.ratio_small', 15)}x its followers (under "
                              f"{core.cfg('viral.small_followers', 800)}) or {core.cfg('viral.ratio_large', 20)}x (more): no post")
            return
        src = hits[0]
        save(d, n, source=summary(src))
        core.say("VIRAL", f"viral check {n + 1}: @{src['author']} ({src['followers']} followers) got {src['views']:,} views"
                          + (" with an X Article" if src["is_article"] else "") + f": \"{src['text'][:80]}\"")
        if dry:
            if src["is_article"]:
                core.say("VIRAL", f"viral check (dry run): an X Article, \"{src['article_title']}\"; a real run writes "
                                  f"an article ({budget_left(d)} left this week) or quotes an existing one")
            post = write_post(d, n, src, "post", work)
            if post:
                core.say("VIRAL", f"viral check (dry run): the repurposed post is in {work / 'post.txt'}")
                print(f"\nORIGINAL (@{src['author']}, {src['followers']} followers, {src['views']:,} views):\n"
                      f"{src['text']}\n\nREPURPOSED:\n{post['post'].strip()}\n")
            return
        if not src["is_article"]:
            post = write_post(d, n, src, "post", work)
            if post is None:
                save(d, n, status="review")
                return
            slot = queue_post(post["post"].strip())
            save(d, n, status="queued", slot=slot, text=post["post"].strip(), hook=post["hook"])
            core.say("POST", f"viral post repurposed from @{src['author']}: queued {slot}")
            return
        if budget_left(d) > 0:
            key = article_key(d)
            core.say("ARTICLE", f"X article from the viral article \"{src['article_title']}\" "
                                f"({budget_left(d)} of {core.cfg('viral.articles_per_week', 3)} left this week)")
            st = article.make_viral(key, d, src)
            if st is None:
                save(d, n, status="review", article=key)
                return
            post = write_post(d, n, src, "article", work, {"title": st["title"]})
            if post is None:
                save(d, n, status="review", article=key)
                return
            save(d, n, status="waiting", article=key, text=post["post"].strip(), hook=post["hook"], waiting_since=now().timestamp())
            core.say("POST", f"viral X Article: post \"{st['title']}\" now from the open page (Post, then X: Articles, "
                             "Write). The post quoting it goes out once it is on your profile")
            return
        arts = existing_articles()
        mode = "quote" if arts else "post"
        post = write_post(d, n, src, mode, work, arts)
        if post is None:
            save(d, n, status="review")
            return
        if mode == "post":
            slot = queue_post(post["post"].strip())
            save(d, n, status="queued", slot=slot, text=post["post"].strip(), hook=post["hook"])
            core.say("POST", f"viral post repurposed from @{src['author']} (no article to quote yet): queued {slot}")
            return
        key = post["quote_article"]
        save(d, n, status="waiting", article=key, text=post["post"].strip(), hook=post["hook"], waiting_since=now().timestamp())
        core.say("VIRAL", f"viral post: this week's {core.cfg('viral.articles_per_week', 3)} articles are used, it quotes "
                          f"your article \"{arts[key]['title']}\"")
    except Exception as exc:  # noqa: BLE001  every failure is logged; the next minute's run decides on a retry
        msg = core.undash(str(exc))[:300]
        if dry:
            core.say("ERROR", f"viral check (dry run): {msg}")
            return
        tries = load(d).get("runs", {}).get(str(n), {}).get("tries", 0) + 1
        last = tries >= 2
        save(d, n, status="gave_up" if last else "error", tries=tries, failed_at=now().timestamp(), error=msg)
        core.say("ERROR", f"viral check {n + 1}: {msg}" + (", skipped" if last else ", trying again in 10 minutes"))


def follow_ups(t: datetime) -> None:
    """Posts waiting for their article: queued quoting it once it is on the profile."""
    every = core.cfg("viral.find_every_minutes", 30) * 60
    for f in sorted(DIR.glob("20*.json"))[-4:]:
        d = date.fromisoformat(f.stem)
        for k, run in core.load_json(f, {}).get("runs", {}).items():
            if run.get("status") != "waiting":
                continue
            n, key = int(k), run["article"]
            st = article.load(key)
            pid = st.get("post_id", "")
            if not pid:
                if t.timestamp() - run.get("waiting_since", 0) > core.cfg("viral.find_give_up_hours", 48) * 3600:
                    put(d, n, status="gave_up", error="the article never showed up on the profile")
                    core.say("WARN", f"viral post: \"{st.get('title', key)}\" is not on your profile after "
                                     f"{core.cfg('viral.find_give_up_hours', 48)} hours, the post is dropped")
                    continue
                if t.timestamp() - run.get("find_at", 0) < every or (not FAKE and trend.chrome_busy()):
                    continue
                put(d, n, find_at=t.timestamp())
                try:
                    pid = find_article(DIR / f"{d}-{n + 1}", key, st.get("title", ""))
                except Exception as exc:  # noqa: BLE001  tried again at the next find time
                    core.say("WARN", f"viral post: the profile read failed ({core.undash(str(exc))[:120]}), trying again later")
                    continue
                if not pid:
                    continue
                article.save(key, post_id=pid)
            slot = queue_post(run["text"], pid)
            put(d, n, status="queued", slot=slot, quote=pid)
            core.say("POST", f"viral post quoting your X Article \"{st.get('title', key)}\": queued {slot}")


def main() -> None:
    lock = socket.socket()
    try:
        lock.bind(("127.0.0.1", core.cfg("viral.lock_port", 47620)))
    except OSError:
        return  # another viral run is working
    try:
        t = now()
        d = t.date()
        if "--now" in sys.argv:
            ts = times(d)
            runs = load(d).get("runs", {})
            n = next((i for i in range(len(ts)) if runs.get(str(i), {}).get("status") not in DONE), None)
            if n is None:
                print("Today's viral checks are all done.")
                return
            make(d, n, dry="--dry" in sys.argv)
            return
        follow_ups(t)
        n = due_run(t)
        if n is not None and chrome_free(d, n):
            make(d, n)
    finally:
        lock.close()


if __name__ == "__main__":
    main()
