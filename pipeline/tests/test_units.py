"""python -m unittest discover -s pipeline/tests -p "test_*.py"   (code-only parts of the pipeline, no model calls)"""
import json
import subprocess
import sys
import tempfile
import unittest
import unittest.mock
from datetime import date, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
import core  # noqa: E402
import discover  # noqa: E402
import stages  # noqa: E402
import virality  # noqa: E402
from datetime import datetime  # noqa: E402



def with_cfg(over: dict):
    """core.cfg with some keys replaced, for mechanisms the live config switches off."""
    real = core.cfg
    return unittest.mock.patch.object(core, "cfg", lambda key, default=None: over[key] if key in over else real(key, default))


OLD_SCHEDULE = {"article.days": ["mon", "wed", "sun"], "teaser.day": "fri"}  # switched off since 2026-11-21

CHECKER = core.ROOT / ".claude" / "skills" / "x-threads" / "check.mjs"
CATS = [{"id": i, "name": f"cat {i}"} for i in (1, 2, 3)]


def ago(days):
    return (core.now_rome() - timedelta(days=days)).isoformat(timespec="seconds")


def cand(name, repo="", url="", update=False, note=""):
    return {"name": name, "repo": repo, "official_url": url, "update_of_known": update, "update_note": note,
            "triage": {k: 2 for k in discover.TRIAGE}}


class Rotation(unittest.TestCase):
    def test_sequential_and_wraps_into_a_new_cycle(self):
        self.assertEqual(discover.next_category(CATS, {}), (0, 1))
        self.assertEqual(discover.next_category(CATS, {"last_id": 1, "cycle": 1}), (1, 1))
        self.assertEqual(discover.next_category(CATS, {"last_id": 3, "cycle": 1}), (0, 2))

    def test_appended_categories_keep_the_place(self):
        more = CATS + [{"id": 4, "name": "cat 4"}]
        self.assertEqual(discover.next_category(more, {"last_id": 3, "cycle": 1}), (3, 1))
        self.assertEqual(discover.next_category(more, {"last_id": 99, "next_index": 2, "cycle": 1}), (2, 1))


class Identity(unittest.TestCase):
    def test_repo_variants_are_one_key(self):
        for t in ("Owner/Tool", "https://github.com/owner/tool", "https://github.com/owner/tool.git",
                  "github.com/OWNER/tool/tree/main/src"):
            self.assertEqual(discover.repo_key(t), "owner/tool", t)
        self.assertEqual(discover.repo_key("just a name"), "")

    def test_keys(self):
        self.assertEqual(discover.keys(cand("Tool X", "owner/tool", "https://www.toolx.dev/pricing")),
                         ["gh:owner/tool", "site:toolx.dev", "name:toolx"])
        self.assertEqual(discover.keys(cand("Qwen Coder", url="https://huggingface.co/Qwen/Qwen-Coder")),
                         ["hf:qwen/qwen-coder", "name:qwencoder"])
        self.assertEqual(discover.keys(cand("Repo", url="https://github.com/a/b")), ["gh:a/b", "name:repo"])

    def test_merge_new_known_and_revisit(self):
        db, cat = {}, {"id": 1, "name": "cat 1"}
        self.assertEqual(discover.merge(db, cand("Tool X", "owner/tool"), cat, ago(0)), "new")
        self.assertEqual(discover.merge(db, cand("Other name", "https://github.com/OWNER/tool.git"), cat, ago(0)), "known")
        self.assertEqual(discover.merge(db, cand("tool x"), cat, ago(0)), "known")
        self.assertEqual(len(db), 1)
        e = next(iter(db.values()))
        e.update(status="published", published_at=ago(5), last_release_seen="v1")
        news = cand("Tool X", "owner/tool", update=True, note="v2 adds a GUI")
        self.assertEqual(discover.merge(db, news, cat, ago(0), lambda r: "v2"), "known")  # too soon after posting
        e["published_at"] = ago(90)
        self.assertEqual(discover.merge(db, news, cat, ago(0), lambda r: "v1"), "known")  # no new release
        self.assertEqual(discover.merge(db, cand("Tool X", "owner/tool"), cat, ago(0), lambda r: "v2"), "known")  # no change reported
        self.assertEqual(discover.merge(db, news, cat, ago(0), lambda r: "v2"), "revisit")
        self.assertEqual(e["status"], "pending")


class Decisions(unittest.TestCase):
    CONF = {"min_total": 16, "hard_min": {"problem_solving": 2, "usefulness": 2, "reliability": 2}}

    def scores(self, **low):
        return {k: 3 for k in ("problem_solving", "savings", "usefulness", "novelty", "ease", "relevance", "reliability",
                               "hook_strength")} | low

    def test_score(self):
        self.assertEqual(stages.score_reasons(self.scores(), self.CONF), [])
        self.assertIn("reliability 1", stages.score_reasons(self.scores(reliability=1), self.CONF)[0])
        low_total = self.scores(savings=0, novelty=0, ease=0, hook_strength=1)  # 13
        self.assertEqual(stages.score_reasons(low_total, self.CONF), ["total 13 below 16"])

    def test_hook_problems(self):
        facts = [{"claim": "It cuts token use by 30%", "quote": "reduces token usage by 30%", "date": "2026-11-01"}]
        self.assertEqual(stages.hook_problems("This tool cuts token use by 30%", facts, set()), [])
        self.assertIn("numbers not in the facts: 90%", stages.hook_problems("This tool cuts token use by 90%", facts, set()))
        self.assertIn("a link or web address", stages.hook_problems("Try toolx.dev today", facts, set()))
        self.assertTrue(stages.hook_problems("Stop paying for it", facts, {"stop paying for"}))
        self.assertTrue(stages.hook_problems("x" * 181, facts, set()))

    def test_editor_blocking_settles(self):
        ok = {k: {"pass": True, "note": ""} for k in stages.CRITICAL | {"no_repetition", "sounds_natural",
                                                                        "every_reply_valuable", "mobile_readable"}}
        polish = {"kind": "sounds_natural", "quote": "q", "fix": "f", "blocking": True, "earlier": False}
        self.assertEqual(len(stages.editor_problems({"checks": ok, "issues": [polish]}, 0)[0]), 1)
        self.assertEqual(stages.editor_problems({"checks": ok, "issues": [polish]}, 1)[0], [])
        self.assertEqual(len(stages.editor_problems({"checks": ok, "issues": [{**polish, "earlier": True}]}, 1)[0]), 1)
        bad = {**ok, "pricing_correct": {"pass": False, "note": "a trial is not free"}}
        self.assertIn("pricing_correct", stages.editor_problems({"checks": bad, "issues": []}, 2)[0][0])

    def test_thread_parts(self):
        d = {"hook": "the hook", "promise": "the promise:", "replies": ["one", "two"]}
        self.assertEqual(stages.thread_parts(d), ["the hook\n\nthe promise:", "1. one", "2. two"])
        self.assertEqual(stages.unnumber("3. Install it"), "Install it")
        self.assertEqual(stages.unnumber("3.5 Sonnet is fast"), "3.5 Sonnet is fast")


class Virality(unittest.TestCase):
    EV = {"criteria": {"financial": 17, "brand": 12, "hook": 17, "curiosity": 8, "problem": 9, "shareability": 9,
                       "audience": 4, "delivery": 4}, "bonuses": {"combination": 4, "recognition": 1, "novelty": 0},
          "penalties": []}

    def test_classes_and_final_score(self):
        self.assertEqual([stages.classify(s) for s in (95, 85, 79, 60, 59, 39)],
                         ["Exceptional", "Excellent", "Good", "Average", "Weak", "Reject"])
        self.assertEqual(stages.final_score(90, 70), 83)  # hook x 0.65 + thread x 0.35

    def test_thread_score_penalties(self):
        self.assertEqual(stages.thread_score(self.EV), 85)
        pen = lambda *p: {**self.EV, "penalties": [{"kind": k, "points": n, "reason": ""} for k, n in p]}
        self.assertEqual(stages.thread_score(pen(("weak_hook", 2))), 80)  # held to the 5 to 15 range
        self.assertEqual(stages.thread_score(pen(("unverified", 40))), 60)  # at most 25
        self.assertEqual(stages.thread_score(pen(("overused", 5), ("overused", 8))), 77)  # one kind counts once
        self.assertEqual(stages.thread_score(pen(("misleading_financial", 30), ("unverified", 25), ("weak_delivery", 15),
                                                 ("weak_hook", 15))), 0)
        full = {"criteria": {k: 20 for k in self.EV["criteria"]}, "bonuses": {"combination": 8, "recognition": 3,
                                                                              "novelty": 3}, "penalties": []}
        self.assertEqual(stages.thread_score(full), 100)

    def test_highest_score_takes_the_earliest_slot(self):
        e = lambda run, score, created: {"run": run, "score": score, "created": created}
        slots = ["2026-11-15_0600", "2026-11-15_1000", "2026-11-14_1400"]
        old = [e("a", 85, "2026-11-13T09:00"), e("b", 85, "2026-11-13T10:00"), e("c", 76, "2026-11-13T11:00")]
        self.assertEqual(virality.assign(old, slots), {"2026-11-14_1400": "a", "2026-11-15_0600": "b", "2026-11-15_1000": "c"})
        new = old + [e("d", 94, "2026-11-14T08:00")]  # a newer thread that scores higher goes first, c no longer fits
        self.assertEqual(virality.assign(new, slots), {"2026-11-14_1400": "d", "2026-11-15_0600": "a", "2026-11-15_1000": "b"})

    def test_threads_expire_after_seven_days(self):
        now = datetime.fromisoformat("2026-11-20T09:55").replace(tzinfo=core.ROME)
        e = lambda status, created, slot=None: {"status": status, "created": created, "slot": slot, "score": 75, "name": "x"}
        pool = {"old": e("waiting", "2026-11-12T08:00+01:00"), "new": e("waiting", "2026-11-18T08:00+01:00"),
                "due": e("scheduled", "2026-11-12T08:00+01:00", "2026-11-20_1000"),
                "later": e("scheduled", "2026-11-12T09:00+01:00", "2026-11-21_1000"),
                "posted": e("posted", "2026-11-01T08:00+01:00")}
        with unittest.mock.patch.object(core, "LOGS", Path(tempfile.mkdtemp())):  # its DROP lines stay out of runner.log
            self.assertEqual(virality.expire(pool, now, 7, 15), ["2026-11-21_1000"])
        self.assertEqual({k: v["status"] for k, v in pool.items()},
                         {"old": "expired", "new": "waiting", "due": "scheduled", "later": "expired", "posted": "posted"})

    def test_slots_three_a_day_four_days_ahead(self):
        at = lambda s: datetime.fromisoformat(s).replace(tzinfo=core.ROME)
        slots = virality.upcoming_slots(at("2026-11-14T12:00"), ["06:00", "10:00", "14:00"], 4, 15)
        self.assertEqual(len(slots), 12)
        self.assertEqual((slots[0], slots[-1]), ("2026-11-14_1400", "2026-11-18_1000"))
        early = virality.upcoming_slots(at("2026-11-14T05:50"), ["06:00", "10:00", "14:00"], 4, 15)
        self.assertEqual(early[0], "2026-11-14_1000")  # 06:00 is inside the 15 minute lead
        dst = virality.upcoming_slots(at("2026-10-24T20:00"), ["06:00", "10:00", "14:00"], 1, 15)
        self.assertEqual(dst, ["2026-10-25_0600", "2026-10-25_1000", "2026-10-25_1400"])


class QueueLock(unittest.TestCase):
    def test_one_holder_at_a_time_and_stale_takeover(self):
        lock = core.PIPE / ".queue-lock"
        self.assertFalse(lock.exists(), "a queue lock is held right now: stop the runner before the unit tests")
        with core.queue_lock():
            self.assertTrue(lock.exists())
            with self.assertRaises(TimeoutError):
                with core.queue_lock(wait_seconds=1):
                    pass
        self.assertFalse(lock.exists())
        lock.mkdir()  # left behind by a crashed process
        import os, time
        old = time.time() - 3600
        os.utime(lock, (old, old))
        with core.queue_lock(wait_seconds=2, stale_seconds=60):
            self.assertTrue(lock.exists())
        self.assertFalse(lock.exists())


class Checker(unittest.TestCase):
    MAIN = "this free tool replaces a paid one\n\nhow it works and where to get it:"
    REPLIES = ["1. It cuts tokens by 30%.", "2. It has 4,200 stars.", "3. It installs in 1 minute.",
               "4. Go to GitHub and search for: owner/tool, then run step 1"]

    def run_check(self, parts):
        with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as f:
            f.write("\n#--#\n".join(parts))
        try:
            p = subprocess.run(["node", str(CHECKER), f.name, "--json"], capture_output=True, timeout=60)
            return json.loads(p.stdout.decode("utf-8"))["problems"]
        finally:
            Path(f.name).unlink()

    def test_good_thread(self):
        self.assertEqual(self.run_check([self.MAIN, *self.REPLIES]), [])

    def test_bad_threads(self):
        r = self.REPLIES
        cases = {
            "3 replies, needs 4 to 7": [self.MAIN, *r[:2], r[3].replace("4.", "3.")],
            "8 replies": [self.MAIN] + [f"{i}. point {i}" for i in range(1, 8)] + ["8. search for owner/tool"],
            "has 570 characters": [self.MAIN, "1. 5 " + "x" * 565, *r[1:]],
            "has 1010 characters, max 1000": [self.MAIN, *r[:3], "4. search for owner/tool 1 " + "x" * 983],
            "main post has 160 characters, max 150": ["a short hook\n\n" + "p" * 146, *r],
            "hook line has 101 characters, max 100": ["h" * 101 + "\n\nshort promise", *r],
            "reply 2 has no number": [self.MAIN, r[0], "2. It is open source.", *r[2:]],
            'must start with "2."': [self.MAIN, r[0], "It has 4,200 stars.", *r[2:]],
            "contains a link": [self.MAIN, *r[:3], "4. Get it at https://example.com, search for it"],
            "contains an emoji": [self.MAIN, "1. It saves 2 hours \U0001F680", *r[1:]],
            "hook line, an empty line": ["just one line", *r],
            "how to find the tool": [self.MAIN, *r[:3], "4. That is all."],
        }
        for expected, parts in cases.items():
            problems = self.run_check(parts)
            self.assertTrue(any(expected in p for p in problems), f"{expected}: {problems}")


class Links(unittest.TestCase):
    def test_what_x_would_link_is_found(self):
        for t in ("see https://nextjs.org/docs.", "www.example.com", "ffmpeg.org", "on GitHub (github.com/remotion-dev).",
                  "docs.claude.ai", "claude.ai/code", "t.co", "v0.dev", "Xcode.app"):
            self.assertTrue(stages.links(t), t)
        self.assertEqual(stages.links("read ffmpeg.org."), ["ffmpeg.org"])

    def test_plain_names_stay_text(self):
        for t in ("Node.js and Next.js 15.2", "edit next.config.js", "README.md", "run setup.sh", "claude.ai", "Socket.IO",
                  "e.g. this", "version 2.1.0", "docs/setup.md", "it works. Then", "search for owner/tool on GitHub"):
            self.assertEqual(stages.links(t), [], t)



class BuildInPublic(unittest.TestCase):
    GOOD = {"hook": "Today Claude Opus 5.5 proved to be EXTREMELY capable even with tight time and budget.",
            "done": "Big day for the video tool.\n\n- Fixed the posting queue\n- Added a stats tab\n\n"
                    "The thread writer got stricter. Every reply now needs a number."}

    def test_good_post_passes_and_assembles(self):
        import bip
        self.assertEqual(bip.problems(self.GOOD), [])
        self.assertEqual(bip.assemble(self.GOOD, 5, "20", "1,234"), "\n\n".join([
            self.GOOD["hook"], "This is day 5 of building in public.",
            "On X today: 20 replies written and 1,234 views.", self.GOOD["done"], "See you on day 6",
            f"1000 followers {chr(0x274C)}\nmonetization {chr(0x274C)}"]))

    def test_rules(self):
        import bip
        bad = {"hook": "One. Two.",
               "done": "- " + "x" * 61 + "\n" + ("A sentence. Another one.\n" * 4) + "Long " * 40 + "." + chr(0x2014)}
        probs = " | ".join(bip.problems(bad))
        for want in ("hook: exactly one sentence", "list item over 60", "4 paragraphs",
                     "sentence over 150", "no em or en dashes"):
            self.assertIn(want, probs)

    def test_day_number(self):
        import bip
        from datetime import date
        self.assertEqual(bip.day_number(date(2026, 11, 17)), 5)
        self.assertEqual(bip.day_number(date(2026, 11, 20)), 8)


class Trend(unittest.TestCase):
    def at(self, iso):
        return datetime.fromisoformat(iso).replace(tzinfo=core.ROME)

    def test_when_it_runs(self):
        import trend
        tue = "2030-01-01"
        self.assertFalse(trend.due(self.at(f"{tue}T06:19"), {}))
        self.assertTrue(trend.due(self.at(f"{tue}T06:20"), {}))
        self.assertTrue(trend.due(self.at(f"{tue}T09:40"), {"status": "working"}))  # cut short by a restart
        self.assertFalse(trend.due(self.at(f"{tue}T10:30"), {}))
        self.assertFalse(trend.due(self.at("2029-12-31T07:00"), {}))  # Monday
        for done in trend.DONE:
            self.assertFalse(trend.due(self.at(f"{tue}T07:00"), {"status": done}))
        failed = self.at(f"{tue}T07:00").timestamp()
        self.assertFalse(trend.due(self.at(f"{tue}T07:05"), {"status": "error", "failed_at": failed}))
        self.assertTrue(trend.due(self.at(f"{tue}T07:10"), {"status": "error", "failed_at": failed}))

    def test_longform_checker(self):
        import trend
        good = ("people building with coding agents\nthe new review mode changes how you ship.\n\n"
                + "\n\n".join(["A paragraph that explains one idea clearly, with a number like 400 lines in it."] * 12))
        bad = "People Building\nTHIS SECOND HOOK LINE IS FAR TOO LONG FOR THE RULEBOOK LIMIT\n\n**bold** " + "x" * 300
        with tempfile.TemporaryDirectory() as tmp:
            f = Path(tmp) / "p.txt"
            f.write_text(good, encoding="utf-8")
            res = json.loads(subprocess.run(["node", str(trend.CHECKER), str(f), "--json"], capture_output=True).stdout)
            self.assertEqual(res["problems"], [])
            f.write_text(bad, encoding="utf-8")
            probs = " | ".join(json.loads(subprocess.run(["node", str(trend.CHECKER), str(f), "--json"],
                                                         capture_output=True).stdout)["problems"])
        for want in ("needs 800 to 3,000", "hook line 1 must be lowercase", "uppercase hook line 2", "paragraph of",
                     "markdown"):
            self.assertIn(want, probs)

    def test_chrome_busy(self):
        import trend
        with tempfile.TemporaryDirectory() as tmp:
            peer = Path(tmp)
            (peer / "jarvis-status").mkdir()
            conf = {**core.cfg("trend"), "chrome_ports": [], "xautoreply": str(peer)}
            with unittest.mock.patch.object(core, "cfg", lambda k, d=None: conf.get(k[6:], d) if k.startswith("trend.") else d):
                self.assertEqual(trend.chrome_busy(), "")
                fresh = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                core.save_json(peer / "jarvis-status" / "session.json", {"state": "running", "updatedAt": fresh})
                self.assertIn("reply session is running", trend.chrome_busy())
                core.save_json(peer / "jarvis-status" / "session.json", {"state": "idle", "updatedAt": fresh})
                soon = (datetime.now() + timedelta(minutes=10)).strftime("%H:%M")
                core.save_json(peer / "data" / "plan.json", {"date": datetime.now().date().isoformat(),
                                                             "sessions": [{"start": soon, "status": "pending"}]})
                self.assertIn(f"starts at {soon}", trend.chrome_busy())
                import socket
                held = socket.socket()
                held.bind(("127.0.0.1", 0))
                conf["chrome_ports"] = [held.getsockname()[1]]
                self.assertIn("holds port", trend.chrome_busy())
                held.close()


class Article(unittest.TestCase):
    def test_markdown(self):
        import article
        md = "\n".join(["Intro with **bold** and *italic*.", "", "## Steps", "", "1. One", "2. Two", "", "- a", "- b",
                        "", "> A quote", "", "### Sub", "See https://example.com/x."])
        self.assertEqual(article.to_html(md), "\n".join([
            "<p>Intro with <strong>bold</strong> and <em>italic</em>.</p>", "<h2>Steps</h2>",
            "<ol><li>One</li><li>Two</li></ol>", "<ul><li>a</li><li>b</li></ul>", "<blockquote>A quote</blockquote>",
            "<h3>Sub</h3>", '<p>See <a href="https://example.com/x">https://example.com/x</a>.</p>']))
        self.assertEqual(article.to_plain(md), "\n".join([
            "Intro with bold and italic.", "", "Steps", "", "1. One", "2. Two", "", "- a", "- b", "", "A quote", "",
            "Sub", "See https://example.com/x."]))
        self.assertEqual(article.to_html("a < b & c"), "<p>a &lt; b &amp; c</p>")

    def test_rules(self):
        import article
        bad = {"title": "Short", "cover_text": "two words", "topic": "x", "sources": [],
               "body": "# Title\n\n" + "word " * 120 + chr(0x2014) + " `code` #hashtag\n\n| a | b |"}
        with tempfile.TemporaryDirectory() as tmp:
            probs = " | ".join(article.problems(bad, Path(tmp), 0))
        for want in ("title: one line of 20 to 100", "cover_text: 3 to 8 words", "words, needs", "at least 3 ## sections",
                     "no # heading", "no backticks", "no tables", "paragraph of", "body: no em or en dashes",
                     "body: no hashtags"):
            self.assertIn(want, probs)

    def test_three_a_week_pillars_take_turns(self):
        import article
        from datetime import date
        self.enterContext(with_cfg(OLD_SCHEDULE))
        days = [date(2026, 11, 22) + timedelta(days=i) for i in range(9)]  # Sunday 22 to Monday 30
        self.assertEqual([d.day for d in days if article.article_day(d)], [22, 23, 25, 29, 30])
        keys = [article.pillar_for(d)["key"] for d in days if article.article_day(d)]
        self.assertEqual(keys, ["automation", "free_alternative", "viral_breakdown", "growth_myth", "automation"])


class Teaser(unittest.TestCase):
    def test_when_it_runs(self):
        import teaser
        self.enterContext(with_cfg(OLD_SCHEDULE))
        at = lambda iso: datetime.fromisoformat(iso).replace(tzinfo=core.ROME)  # noqa: E731
        fri = "2030-01-04"
        self.assertFalse(teaser.due(at(f"{fri}T06:19"), {}))
        self.assertTrue(teaser.due(at(f"{fri}T06:20"), {}))
        self.assertTrue(teaser.due(at(f"{fri}T15:59"), {}))
        self.assertFalse(teaser.due(at(f"{fri}T16:00"), {}))
        self.assertFalse(teaser.due(at("2030-01-03T07:00"), {}))  # Thursday
        for done in teaser.DONE:
            self.assertFalse(teaser.due(at(f"{fri}T07:00"), {"status": done}))

    def test_week_articles_are_the_sunday_monday_wednesday_before(self):
        import article
        import teaser
        from datetime import date
        self.enterContext(with_cfg(OLD_SCHEDULE))
        with tempfile.TemporaryDirectory() as tmp:
            with unittest.mock.patch.object(article, "DIR", Path(tmp)):
                self.assertEqual(teaser.week_articles(date(2030, 1, 4)), [])
                for day, status in (("2029-12-30", "opened"), ("2029-12-31", "ready"), ("2030-01-02", "review"),
                                    ("2030-01-03", "opened"), ("2029-12-29", "opened")):  # Sun Mon Wed Thu Sat
                    core.save_json(Path(tmp) / f"{day}.json", {"status": status})
                    core.save_json(Path(tmp) / day / "article.json", {"title": f"T {day}", "body": "B"})
                self.assertEqual([str(d) for d, _ in teaser.week_articles(date(2030, 1, 4))], ["2029-12-30", "2029-12-31"])
                self.assertEqual(teaser.week_articles(date(2030, 1, 11)), [])  # the next week has none

    def test_most_viewed(self):
        import teaser
        from datetime import date
        week = [(date(2029, 12, 30), {"title": "Sun"}), (date(2029, 12, 31), {"title": "Mon"}),
                (date(2030, 1, 2), {"title": "Wed"})]
        found = {"articles": [{"date": "2029-12-30", "post_id": "11", "views": 300},
                              {"date": "2029-12-31", "post_id": "22", "views": 4200},
                              {"date": "2029-12-27", "post_id": "33", "views": 90000},  # not this week's
                              {"date": "2030-01-02", "post_id": "", "views": 99000}]}  # no post id
        day, art, hit = teaser.most_viewed(found, week)
        self.assertEqual((str(day), art["title"], hit["post_id"]), ("2029-12-31", "Mon", "22"))
        found["articles"][0]["views"] = 4200  # a tie: the newest wins
        self.assertEqual(teaser.most_viewed(found, week)[2]["post_id"], "22")
        self.assertIsNone(teaser.most_viewed({"articles": []}, week))


class Viral(unittest.TestCase):
    POST = {"id": "1", "author": "a", "followers": 400, "views": 9000, "niche": True, "is_article": False,
            "text": "i automated my whole x account with claude code and now it takes 10 minutes a day"}

    def test_three_random_times_two_hours_apart(self):
        import random
        import viral
        for seed in range(40):
            ts = viral.pick_times(random.Random(seed))
            mins = [viral.minutes(t) for t in ts]
            self.assertEqual(len(ts), 3)
            self.assertEqual(mins, sorted(mins))
            self.assertTrue(all(8 * 60 <= m <= 21 * 60 + 30 for m in mins), ts)
            self.assertTrue(all(b - a >= 120 for a, b in zip(mins, mins[1:])), ts)

    def test_outliers(self):
        import viral
        p = self.POST  # 400 followers, 9,000 views: 22x
        posts = [p, {**p, "id": "2", "followers": 700, "views": 10000},  # under 800 followers: 14x, needs 15x
                 {**p, "id": "8", "followers": 700, "views": 10500},  # exactly 15x
                 {**p, "id": "9", "followers": 2400, "views": 47000},  # 800 or more: 19.6x, needs 20x
                 {**p, "id": "10", "followers": 2400, "views": 318000},  # 132x
                 {**p, "id": "3", "followers": 100, "views": 4000},  # 40x but under 5,000 views
                 {**p, "id": "4", "niche": False},  # off topic
                 {**p, "id": "5", "followers": -1},  # profile not checked
                 {**p, "id": "7"}]  # used before
        self.assertEqual([x["id"] for x in viral.viral(posts, {"7"})], ["10", "1", "8"])
        self.assertEqual((viral.needed_views(100), viral.needed_views(799), viral.needed_views(800)), (5000, 11985, 16000))

    def test_due_runs_and_late_ones_skipped(self):
        import viral
        at = lambda iso: datetime.fromisoformat(iso).replace(tzinfo=core.ROME)  # noqa: E731
        with tempfile.TemporaryDirectory() as tmp, unittest.mock.patch.object(viral, "DIR", Path(tmp)), \
                unittest.mock.patch.object(core, "LOGS", Path(tmp) / "logs"):
            core.save_json(Path(tmp) / "2030-01-01.json", {"times": ["10:00", "13:00", "18:00"]})
            self.assertIsNone(viral.due_run(at("2030-01-01T09:59")))
            self.assertEqual(viral.due_run(at("2030-01-01T10:00")), 0)
            viral.put(date(2030, 1, 1), 0, status="queued")
            self.assertIsNone(viral.due_run(at("2030-01-01T12:59")))
            self.assertIsNone(viral.due_run(at("2030-01-01T15:00")))  # 13:00 blocked for 2 hours: skipped
            self.assertEqual(viral.load(date(2030, 1, 1))["runs"]["1"]["status"], "skipped")
            self.assertEqual(viral.due_run(at("2030-01-01T18:30")), 2)

    def test_post_rules(self):
        import viral
        good = {"post": "claude code runs my x account now. ten minutes a day from me, the rest is a script i set up "
                        "once. it is a lot simpler than people make it sound", "hook": "h", "quote_article": ""}
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(viral.problems(good, self.POST, Path(tmp), 0, []), [])
            bad = {**good, "post": self.POST["text"] + " https://x.com #ai @someone " + chr(0x2014)}
            probs = " | ".join(viral.problems(bad, self.POST, Path(tmp), 1, []))
            for want in ("no links", "no hashtags", "no @mentions", "dashes", "too close to the original"):
                self.assertIn(want, probs)
            self.assertIn("quote_article must be one of", " | ".join(viral.problems(good, self.POST, Path(tmp), 2, ["2030-01-01"])))

    def test_queue_keeps_a_gap_from_other_posts(self):
        import viral
        with tempfile.TemporaryDirectory() as tmp, unittest.mock.patch.object(core, "ROOT", Path(tmp)), \
                unittest.mock.patch.object(viral, "now", lambda: datetime(2030, 1, 1, 10, 0, tzinfo=core.ROME)):
            (Path(tmp) / "queue" / "2030-01-01_1010").mkdir(parents=True)
            self.assertEqual(viral.queue_post("text", "123"), "2030-01-01_1040")
            self.assertEqual((Path(tmp) / "queue" / "2030-01-01_1040" / "quote.txt").read_text(), "123")

    def test_three_articles_a_week(self):
        import article
        import viral
        with tempfile.TemporaryDirectory() as tmp, unittest.mock.patch.object(article, "DIR", Path(tmp)):
            for key, status in (("2030-01-06", "opened"), ("2030-01-07", "opened"), ("2030-01-08", "review"),
                                ("2030-01-09-2", "ready"), ("2030-01-14", "opened")):  # Sun before, Mon, Tue, Wed, next Mon
                core.save_json(Path(tmp) / f"{key}.json", {"status": status, "title": f"T {key}"})
            self.assertEqual(viral.week_articles(date(2030, 1, 10)), ["2030-01-07", "2030-01-09-2"])
            self.assertEqual(viral.budget_left(date(2030, 1, 10)), 1)
            self.assertEqual(viral.article_key(date(2030, 1, 9)), "2030-01-09")
            self.assertEqual(viral.article_key(date(2030, 1, 7)), "2030-01-07-2")


class ThreadImages(unittest.TestCase):
    FACTS = [{"claim": "It cut startup tokens by 64.3% in a test.", "quote": "64.3%"}]

    def test_card_checks(self):
        import thread_images as ti
        good = ('<div class="col"><div class="card bold"><div class="n">64.3<small>%</small></div>'
                '<div class="b">fewer startup tokens</div></div><div class="arrow down"><span>3 steps</span></div>'
                '<div class="card"><div class="c">npx tool scan</div></div></div>')
        self.assertEqual(ti.card_problems(good, "1. it saves 64.3%", self.FACTS), [])
        bad = ('<script>x()</script><div class="card" style="color:#4f8cff; box-shadow: 0 0 4px #000">' + "word " * 80
               + chr(0x2014) + " 999 users at example.com/x " + chr(0x1F680) + '</div><img src="https://cdn.example.com/a.png">')
        probs = " | ".join(ti.card_problems(bad, "no numbers here", self.FACTS))
        for want in ("self-contained", "no images", "no colours: #4f8cff", "no gradients, shadows", "at least 2 cards",
                     "arrows joining", "at most 70", "dashes", "emojis", "web addresses", "999"):
            self.assertIn(want, probs)
        self.assertNotIn("no colours", " | ".join(ti.card_problems('<div class="card" style="border-color:#333">x</div>', "", [])))
        self.assertIn("the diagram has no text", ti.card_problems("<div></div>", "", []))
        self.assertEqual(ti.visible_text("<style>.a{}</style><div>One</div><div>Two &amp; three</div>"), "One\nTwo & three")

    def test_fallback_card_and_stars(self):
        import thread_images as ti
        body = ti.fallback_body("3. The plugin moves dead skills aside. You can bring them back. Third one.", "claude-slim")
        self.assertEqual(ti.card_problems(body, "", []), [])
        self.assertIn("The plugin moves dead skills aside.", body)
        self.assertIn("You can bring them back.", body)
        self.assertNotIn("Third one", body)  # the first two sentences only
        self.assertNotIn("3.", body)
        with tempfile.TemporaryDirectory() as tmp:
            shot = Path(tmp) / "github.png"
            shot.write_bytes(ti.PNG)
            with_shot = ti.fallback_body("It routes requests.", "opencodex", shot, "owner/opencodex")
        self.assertIn("data:image/png;base64,", with_shot)
        self.assertIn("owner/opencodex", with_shot)
        self.assertNotIn(ti.SCREENSHOT, with_shot)
        self.assertEqual((ti.stars(18696), ti.stars(43), ti.stars(2000)), ("18.7k stars", "43 stars", "2k stars"))

    def test_complete_pending_and_queue_copy(self):
        import thread_images as ti
        import virality
        with tempfile.TemporaryDirectory() as tmp:
            runs, queue = Path(tmp) / "runs", Path(tmp) / "queue"
            draft = {"hook": "h", "promise": "p", "replies": ["one 1", "two 2"]}
            for name in ("a", "b", "c"):
                core.save_json(runs / name / "draft.json", draft)
                core.save_json(runs / name / "state.json", {"stage": "ready"})
            for img in ("post.png", "reply1.png", "reply2.jpg"):
                core.write_text(runs / "a" / "images" / img, "x")
            core.save_json(runs / "c" / "state.json", {"stage": "ready", "image_tries": 2})
            pool = {"a": {"run": "a", "status": "waiting", "score": 90, "slot": None},
                    "b": {"run": "b", "status": "waiting", "score": 80, "slot": None},
                    "c": {"run": "c", "status": "scheduled", "score": 70, "slot": "2030-01-01_0700"}}
            with unittest.mock.patch.object(core, "RUNS", runs), unittest.mock.patch.object(virality, "QUEUE", queue):
                self.assertTrue(ti.complete(runs / "a"))
                self.assertFalse(ti.complete(runs / "b"))
                self.assertEqual(ti.pending(pool), runs / "b")  # a is done, c failed twice
                pool["c"]["status"], pool["b"]["status"] = "waiting", "posted"
                self.assertIsNone(ti.pending(pool))
                core.write_text(queue / "2030-01-01_0700" / "reply1.png", "stale")
                self.assertTrue(virality.write_folder("2030-01-01_0700", "a"))
                self.assertEqual(sorted(p.name for p in (queue / "2030-01-01_0700").iterdir()),
                                 ["post.png", "post.txt", "reply1.png", "reply1.txt", "reply2.jpg", "reply2.txt"])
                self.assertEqual((queue / "2030-01-01_0700" / "reply1.png").read_text(), "x")
                self.assertTrue(virality.write_folder("2030-01-01_1200", "b"))  # no images yet: text only
                self.assertEqual(sorted(p.name for p in (queue / "2030-01-01_1200").iterdir()),
                                 ["post.txt", "reply1.txt", "reply2.txt"])

    def test_two_slots_a_day(self):
        start = datetime(2030, 1, 1, 8, 0, tzinfo=core.ROME)
        self.assertEqual(virality.upcoming_slots(start, ["07:00", "12:00"], 2, 15),
                         ["2030-01-01_1200", "2030-01-02_0700", "2030-01-02_1200", "2030-01-03_0700"])


class OwnPosts(unittest.TestCase):
    def test_original_posts_are_told_to_xautoreply(self):
        import poster
        with tempfile.TemporaryDirectory() as tmp:
            root, inbox = Path(tmp) / "repo", Path(tmp) / "xar" / "data" / "own_posts.jsonl"
            core.write_text(root / "posted" / "2030-01-01_0700" / "post.txt", "main post")
            core.write_text(root / "posted" / "2030-01-01_0900" / "post.txt", "a quote post")
            core.write_text(root / "posted" / "2030-01-01_0900" / "quote.txt", "123")
            conf = {"own_posts.file": str(inbox), "own_posts.check_minutes": [60, 240], "x_handle": "someone"}
            with unittest.mock.patch.object(core, "ROOT", root), \
                    unittest.mock.patch.object(core, "cfg", lambda k, d=None: conf.get(k, d)):
                poster.told_from_line("posted 2030-01-01_0700 -> https://x.com/i/status/111 (thread, 3 replies)")
                self.assertFalse(inbox.exists())  # no xAutoReply data folder: nothing written
                inbox.parent.mkdir(parents=True)
                poster.told_from_line("posted 2030-01-01_0700 -> https://x.com/i/status/111 (thread, 3 replies)")
                poster.told_from_line("posted 2030-01-01_0900 -> https://x.com/i/status/222")
                poster.told_from_line("missed 2030-01-01_1100 (200 min late), moved to missed/")
            lines = [json.loads(line) for line in inbox.read_text(encoding="utf-8").splitlines()]
        self.assertEqual([(e["id"], e["kind"], e["text"]) for e in lines],
                         [("111", "thread", "main post"), ("222", "quote", "a quote post")])
        first = lines[0]
        self.assertEqual(first["url"], "https://x.com/someone/status/111")
        posted = datetime.fromisoformat(first["posted_at"].replace("Z", "+00:00"))
        self.assertEqual([datetime.fromisoformat(c.replace("Z", "+00:00")) - posted for c in first["checks_at"]],
                         [timedelta(minutes=60), timedelta(minutes=240)])


if __name__ == "__main__":
    unittest.main()
