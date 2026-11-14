"""python -m unittest discover -s pipeline/tests -p "test_*.py"   (code-only parts of the pipeline, no model calls)"""
import json
import subprocess
import sys
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
import core  # noqa: E402
import discover  # noqa: E402
import stages  # noqa: E402
import virality  # noqa: E402
from datetime import datetime  # noqa: E402

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

    def test_slots_three_a_day_four_days_ahead(self):
        at = lambda s: datetime.fromisoformat(s).replace(tzinfo=core.ROME)
        slots = virality.upcoming_slots(at("2026-11-14T12:00"), ["06:00", "10:00", "14:00"], 4, 15)
        self.assertEqual(len(slots), 12)
        self.assertEqual((slots[0], slots[-1]), ("2026-11-14_1400", "2026-11-18_1000"))
        early = virality.upcoming_slots(at("2026-11-14T05:50"), ["06:00", "10:00", "14:00"], 4, 15)
        self.assertEqual(early[0], "2026-11-14_1000")  # 06:00 is inside the 15 minute lead
        dst = virality.upcoming_slots(at("2026-10-24T20:00"), ["06:00", "10:00", "14:00"], 1, 15)
        self.assertEqual(dst, ["2026-10-25_0600", "2026-10-25_1000", "2026-10-25_1400"])


class Checker(unittest.TestCase):
    MAIN = "this free tool replaces a paid one\n\nhow it works and where to get it:"
    REPLIES = ["1. It does the job.", "2. It is open source.", "3. It installs in a minute.",
               "4. Go to GitHub and search for: owner/tool"]

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
            "has 290 characters": [self.MAIN, "1. " + "x" * 287, *r[1:]],
            'must start with "2."': [self.MAIN, r[0], "It is open source.", *r[2:]],
            "contains a link": [self.MAIN, *r[:3], "4. Get it at https://example.com, search for it"],
            "contains an emoji": [self.MAIN, "1. It does the job \U0001F680", *r[1:]],
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


if __name__ == "__main__":
    unittest.main()
