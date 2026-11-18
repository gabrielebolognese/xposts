"""The trending post: one long-form post about X's Explore > Trending tab on trend.days (Tuesday, Thursday, Saturday)
at trend.time (09:00). run.sh runs this every minute. On a post day, from trend.read_at (06:20) until trend.give_up
(10:30), once:
  1. read: when xAutoReply is not using Chrome, a Claude in Chrome session (prompts/trend_read.md) reads the Trending
     tab in the owner's logged-in Chrome and the top posts of up to 3 trends that fit the niche. Read only, no X API.
  2. write: Opus writes one long-form post about the best one (prompts/trend_write.md, rulebook
     x_long_form_post_writing_rules.txt), checked in code: lib/longform-check.mjs, no links, the AI-tells detector.
     Still failing after trend.fix_rounds fixes: review/trend-<date>.txt, not posted.
  3. screenshot: lib/trend-shot.mjs renders one of the trend's posts from X's public embed (no login) as 1.png
  4. queue/<date>_0900 (the next free minute when it is later); the posting loop posts it
Nothing on the tab fits the niche: no post that day. A failed try runs once more after 10 minutes.
State: pipeline/data/trend/<date>.json; work files and model calls: pipeline/data/trend/<date>/.
  python pipeline/lib/trend.py --now          make today's post now, whatever the day and time (once a day)
  python pipeline/lib/trend.py --now --dry    read, write and screenshot now without queueing (to see one)
"""
from __future__ import annotations

import base64
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ai  # noqa: E402
import core  # noqa: E402
import stages  # noqa: E402

DIR = core.DATA / "trend"
RULES = core.ROOT / "x_long_form_post_writing_rules.txt"
CHECKER = core.PIPE / "lib" / "longform-check.mjs"
SHOT = core.PIPE / "lib" / "trend-shot.mjs"
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
AUTOMATION_FLAGS = ("--disable-extensions", "--remote-debugging", "--headless", "--user-data-dir")
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
DONE = ("queued", "skipped", "review", "gave_up")
FAKE = bool(os.environ.get("POSTS_TREND_FAKE"))  # tests: no Chrome, a placeholder screenshot
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")
STATUS = {"no_browser": "the Claude extension in Chrome is not connected", "logged_out": "X is logged out in Chrome",
          "limited": "X limited the reading (rate limit or an error page)"}


def now() -> datetime:
    fake = os.environ.get("POSTS_TREND_NOW")  # tests: a fixed Rome wall clock time, like 2030-01-01T06:20
    return datetime.fromisoformat(fake).replace(tzinfo=core.ROME) if fake else core.now_rome()


def at(d: date, hhmm: str) -> datetime:
    return datetime.fromisoformat(f"{d}T{hhmm}").replace(tzinfo=core.ROME)


def post_day(d: date) -> bool:
    return DAYS[d.weekday()] in core.cfg("trend.days", ["tue", "thu", "sat"])


def load(d: date) -> dict:
    return core.load_json(DIR / f"{d}.json", {})


def save(d: date, **values) -> dict:
    st = {**load(d), **values}
    core.save_json(DIR / f"{d}.json", st)
    return st


def due(t: datetime, st: dict) -> bool:
    """A post day, between read_at and give_up, not done yet; a failed try runs once more after 10 minutes."""
    d = t.date()
    if not post_day(d) or st.get("status") in DONE:
        return False
    if not at(d, core.cfg("trend.read_at", "06:20")) <= t < at(d, core.cfg("trend.give_up", "10:30")):
        return False
    if st.get("status") == "error":
        return t.timestamp() - st.get("failed_at", 0) >= 600
    return True


def recent_trends(d: date) -> list[str]:
    """The trends posted about in the last trend.avoid_days days."""
    days = core.cfg("trend.avoid_days", 14)
    return [st["trend"] for i in range(1, days + 1)
            if (st := load(d - timedelta(days=i))).get("status") == "queued" and st.get("trend")]


# Chrome, shared with xAutoReply -----------------------------------------------------------------------------------------

def port_held(port: int) -> bool:
    probe = socket.socket()
    try:
        probe.bind(("127.0.0.1", port))
        return False
    except OSError:
        return True
    finally:
        probe.close()


def chrome_busy() -> str:
    """Why xAutoReply needs Chrome right now, else "" (the signals its own lead discovery checks)."""
    for port in core.cfg("trend.chrome_ports", [47614, 47615]):
        if port_held(port):
            return f"an xAutoReply runner holds port {port}"
    peer = core.cfg("trend.xautoreply", "")
    if not peer:
        return ""
    base = (core.ROOT / peer).resolve()
    status = core.load_json(base / "jarvis-status" / "session.json", {}) or {}
    try:
        updated = datetime.strptime(status.get("updatedAt", ""), "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        if status.get("state") == "running" and (datetime.now(timezone.utc) - updated).total_seconds() < 180:
            return "a reply session is running"
    except ValueError:
        pass
    plan = core.load_json(base / "data" / "plan.json", {}) or {}
    t = datetime.now()  # the plan is in this PC's local time
    if plan.get("date") == t.date().isoformat():
        margin = timedelta(minutes=core.cfg("trend.session_margin_minutes", 20))
        for s in plan.get("sessions", []):
            if s.get("status") == "pending" and re.fullmatch(r"\d\d:\d\d", s.get("start") or ""):
                start = t.replace(hour=int(s["start"][:2]), minute=int(s["start"][3:]), second=0, microsecond=0)
                if start - margin <= t <= start + timedelta(minutes=2):
                    return f"a reply session starts at {s['start']}"
    return ""


def wait_for_chrome() -> bool:
    end = time.time() + core.cfg("trend.chrome_wait_minutes", 45) * 60
    said = ""
    while why := chrome_busy():
        if why != said:
            core.say("TREND", f"trending post: waiting for Chrome, {why}")
            said = why
        if time.time() > end:
            return False
        time.sleep(30)
    return True


def my_chrome_pids() -> set[int]:
    """The owner's normal Chrome (the one with the Claude extension): main processes, no automation flags."""
    query = ("Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | "
             "Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress")
    out = subprocess.run(["powershell", "-NoProfile", "-Command", query], capture_output=True, text=True,
                         creationflags=NO_WINDOW, timeout=60).stdout.strip()
    procs = json.loads(out) if out else []
    if isinstance(procs, dict):
        procs = [procs]
    return {p["ProcessId"] for p in procs if "--type=" not in (p["CommandLine"] or "")
            and not any(flag in (p["CommandLine"] or "") for flag in AUTOMATION_FLAGS)}


def start_chrome() -> bool:
    """Start Chrome when it is not open and give the extension a minute to connect. True when started here."""
    if FAKE or my_chrome_pids():
        return False
    subprocess.Popen([CHROME, "about:blank"], creationflags=NO_WINDOW)
    time.sleep(core.cfg("trend.chrome_warmup_seconds", 60))
    return True


def close_chrome() -> None:
    for force in ([], ["/F"]):
        for pid in my_chrome_pids():
            subprocess.run(["taskkill", "/PID", str(pid), "/T", *force], capture_output=True, creationflags=NO_WINDOW)
        time.sleep(5)


# The steps --------------------------------------------------------------------------------------------------------------

def read_trends(work: Path, recent: list[str]) -> dict:
    if not wait_for_chrome():
        raise RuntimeError(f"Chrome stayed busy with xAutoReply for {core.cfg('trend.chrome_wait_minutes', 45)} minutes")
    started = start_chrome()
    try:
        core.say("TREND", "trending post: reading X's Trending tab in Chrome")
        out = ai.call("trend_read", work, "read", core.render(
            "trend_read", DEVICE=core.cfg("trend.chrome_device"), RECENT="\n".join(f"- {t}" for t in recent) or "(none)"),
            schema="trend_read", tools=["ToolSearch"], chrome=True, timeout=core.cfg("trend.read_minutes", 25) * 60)
    finally:
        if started:
            close_chrome()
    if out["status"] != "ok":
        raise RuntimeError(STATUS.get(out["status"], out["status"]) + (f": {out['note']}" if out.get("note") else ""))
    core.save_json(work / "read.json", out)
    return out


def chosen(post: dict, read: dict) -> dict | None:
    return next((c for c in read["candidates"] if c["trend"] == post.get("trend")), None)


def problems(post: dict, read: dict, work: Path, rnd: int) -> list[str]:
    text = post["post"].strip()
    file = work / f"post-{rnd}.txt"
    core.write_text(file, text)
    res = subprocess.run(["node", str(CHECKER), str(file), "--json"], capture_output=True, timeout=60)
    probs = json.loads(res.stdout.decode("utf-8"))["problems"]
    if re.search(r"https?://|www\.", text):
        probs.append("no links, they cut the reach: name things in words")
    if re.search(r"(^|\s)#\w", text):
        probs.append("no hashtags")
    if chr(0x2013) in text:
        probs.append("no en dashes")
    c = chosen(post, read)
    if not c:
        probs.append("trend must be exactly one of: " + ", ".join(x["trend"] for x in read["candidates"]))
    elif not set(post["shot_post_ids"]) & {p["id"] for p in c["posts"]}:
        probs.append("shot_post_ids: use the ids of the chosen trend's posts")
    found, _ = stages.ai_tells(file)
    return probs + found


def write_post(d: date, read: dict, recent: list[str], work: Path) -> dict | None:
    """The post, checked; None when it still breaks the rules after the fix rounds (then it waits in review/)."""
    core.say("TREND", "trending post: writing it")
    prompt = core.render("trend_write", DATE=str(d), CANDIDATES=read["candidates"],
                         RECENT="\n".join(f"- {t}" for t in recent) or "(none yet)",
                         RULES=RULES.read_text(encoding="utf-8").strip())
    tools = ["WebSearch", "WebFetch"]
    post = ai.call("trend_write", work, "write", prompt, schema="trend_post", tools=tools)
    rounds = core.cfg("trend.fix_rounds", 2)
    for rnd in range(rounds + 1):
        probs = problems(post, read, work, rnd)
        if not probs:
            core.write_text(work / "post.txt", post["post"].strip())
            core.save_json(work / "post.json", post)
            return post
        if rnd == rounds:
            break
        core.say("FIX", f"trending post round {rnd}: {len(probs)} problems, e.g. {probs[0][:100]}")
        post = ai.call("trend_write", work, f"fix-{rnd + 1}", f"{prompt}\n\nYour last answer:\n"
                       f"{json.dumps(post, ensure_ascii=False, indent=1)}\n\nIt breaks these rules. Fix them and "
                       "return the whole answer again:\n" + "\n".join(f"- {p}" for p in probs),
                       schema="trend_post", tools=tools)
    core.write_text(core.REVIEW / f"trend-{d}.txt", "NEEDS REVIEW\n\nOpen problems after "
                    f"{rounds} fix rounds:\n" + "\n".join(f"- {p}" for p in probs) + f"\n\n---\n\n{post['post'].strip()}\n")
    core.say("REVIEW", f"trending post: still breaks the rules after {rounds} fixes, see pipeline/review/trend-{d}.txt")
    return None


def screenshot(post: dict, read: dict, work: Path) -> list[Path]:
    """One of the chosen trend's posts from X's public embed: the writer's picks first, then the trend's others."""
    posts = [p["id"] for p in chosen(post, read)["posts"]]
    ids = [i for i in post["shot_post_ids"] if i in posts] + posts
    out = work / "1.png"
    for i in list(dict.fromkeys(ids))[:3]:
        out.unlink(missing_ok=True)
        if FAKE:
            out.write_bytes(PNG)
            return [out]
        p = subprocess.run(["node", str(SHOT), i, str(out)], cwd=core.ROOT, capture_output=True, timeout=180)
        if p.returncode == 0 and out.exists():
            return [out]
    core.say("WARN", "trending post: none of the trend's posts rendered for the screenshot, it goes out as text only")
    return []


def queue_post(d: date, text: str, images: list[Path]) -> str:
    with core.queue_lock():
        slot = max(at(d, core.cfg("trend.time", "09:00")), now().replace(second=0, microsecond=0))
        while (core.ROOT / "queue" / core.slot_name(slot)).exists():
            slot += timedelta(minutes=1)
        q = core.ROOT / "queue" / core.slot_name(slot)
        q.mkdir(parents=True)
        core.write_text(q / "post.txt", text)
        for img in images:
            shutil.copy(img, q / img.name)
    return q.name


def make(d: date, dry: bool = False) -> None:
    lock = socket.socket()
    try:
        lock.bind(("127.0.0.1", core.cfg("trend.lock_port", 47616)))
    except OSError:
        return  # another trend run is working
    work = DIR / (f"{d}-dry" if dry else str(d))
    put = (lambda **v: None) if dry else (lambda **v: save(d, **v))
    try:
        put(status="working", started_at=time.time(), error=None)
        recent = recent_trends(d)
        read = read_trends(work, recent)
        put(trends=[t["name"] for t in read["trends"]], candidates=[c["trend"] for c in read["candidates"]])
        if not read["candidates"]:
            put(status="skipped", reason="no trend fits the niche today")
            core.say("WARN", "trending post: nothing on the Trending tab fits the niche today, no post")
            return
        post = write_post(d, read, recent, work)
        if post is None:
            put(status="review")
            return
        images = screenshot(post, read, work)
        text = post["post"].strip()
        if dry:
            core.say("TREND", f"trending post (dry run) about \"{post['trend']}\": {work / 'post.txt'}"
                     + (f" and {images[0]}" if images else ", no screenshot"))
            print(text)
            return
        if now() >= at(d, core.cfg("trend.give_up", "10:30")):
            put(status="gave_up", error="ready too late, the trends are stale")
            core.say("WARN", "trending post: ready after the give-up time, not posted")
            return
        slot = queue_post(d, text, images)
        put(status="queued", slot=slot, trend=post["trend"], why=post["why"], sources=post["sources"], text=text)
        core.say("POST", f"trending post about \"{post['trend']}\": queued {slot}")
    except Exception as exc:  # noqa: BLE001  every failure is logged; the next minute's run decides on a retry
        msg = core.undash(str(exc))[:300]
        if dry:
            core.say("ERROR", f"trending post (dry run): {msg}")
            return
        tries = load(d).get("tries", 0) + 1
        last = tries >= 2
        save(d, status="gave_up" if last else "error", tries=tries, failed_at=now().timestamp(), error=msg)
        core.say("ERROR", f"trending post: {msg}" + (", skipped today" if last else ", trying again in 10 minutes"))
    finally:
        lock.close()


def main() -> None:
    t = now()
    d = t.date()
    st = load(d)
    if "--now" in sys.argv:
        if st.get("status") in DONE and "--dry" not in sys.argv:
            print(f"Today's trending post is already done ({st['status']}). Add --dry to make one without queueing it.")
            return
        make(d, dry="--dry" in sys.argv)
        return
    if not post_day(d) or st.get("status") in DONE:
        return
    give_up = core.cfg("trend.give_up", "10:30")
    if t >= at(d, give_up):
        save(d, status="gave_up", error=st.get("error") or f"not made by {give_up} (the PC was off or busy)")
        core.say("WARN", f"trending post: skipped today, not made by {give_up}")
        return
    if due(t, st):
        make(d)


if __name__ == "__main__":
    main()
