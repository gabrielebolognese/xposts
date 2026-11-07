"""python -m unittest discover -s pipeline/tests -p "test_*.py"   (code-only parts of the pipeline, no model calls)"""
import sys
import unittest
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
import core  # noqa: E402
import harvest  # noqa: E402
import scout  # noqa: E402

CONF = {"hard_min": {"value": 2, "credibility": 2, "novelty": 2}, "similar_ratio": 0.8, "similar_words": 0.3, "min_total": 15,
        "cooldown_days": 7, "quota_window": 6, "quota_max": {"ai": 2, "saas": 1, "webdev": 1, "video": 1, "design": 1}}


def cand(problem, niche="ai", tool="claude code", total=17, **scores):
    s = {k: 2 for k in scout.CRITERIA} | scores
    return {"audience": "devs", "problem": problem, "takeaway": f"takeaway for {problem}", "niche": niche,
            "tool": tool, "scores": s, "substance_800": "pass", "total": total, "release_dates": []}


def ago(days):
    return (core.now_rome() - timedelta(days=days)).isoformat(timespec="seconds")


class Decide(unittest.TestCase):
    def test_best_total_wins(self):
        chosen, backlog, rejected = scout.decide([cand("alpha problem", total=16), cand("beta problem", total=19)], [], CONF)
        self.assertEqual(chosen["problem"], "beta problem")
        self.assertEqual([b["problem"] for b in backlog], ["alpha problem"])
        self.assertEqual(rejected, [])

    def test_hard_fails(self):
        c1 = cand("weak value", value=1)
        c2 = cand("no substance")
        c2["substance_800"] = "fail"
        c3 = cand("low total", total=12)
        chosen, backlog, rejected = scout.decide([c1, c2, c3], [], CONF)
        self.assertIsNone(chosen)
        reasons = [r["reason"] for r in rejected]
        self.assertIn("hard fail: value", reasons[0])
        self.assertIn("800 test", reasons[1])
        self.assertIn("below 15", reasons[2])

    def test_similar_to_history_is_rejected(self):
        hist = [{"status": "queued", "problem": "rls policies leak tenant data", "takeaway": "takeaway for rls policies leak tenant data",
                 "slot": "2026-11-01_0950", "at": ago(5), "niche": "saas", "tool": "postgres"}]
        chosen, _, rejected = scout.decide([cand("rls policies leak tenant data!")], hist, CONF)
        self.assertIsNone(chosen)
        self.assertIn("too similar to 2026-11-01_0950", rejected[0]["reason"])

    def test_same_idea_in_other_words_is_rejected(self):
        dropped = {"status": "dropped", "run": "2026-11-07_1507_gsap", "audience": "developers animating with gsap in frame-seeked renderers",
                   "problem": "Count-ups and typing effects driven by GSAP onUpdate callbacks freeze when the renderer seeks frames silently.",
                   "takeaway": "Drive them with tweened properties or setters so every seeked frame renders the right value."}
        twin = cand("Animations driven by onUpdate callbacks, such as count-ups and typing effects, freeze in frame-seeked GSAP renders.")
        twin["takeaway"] = "Use tweened properties or pure setters so seeked frames render correctly."
        other = cand("Stripe webhooks retry and create duplicate charges when idempotency keys are missing.", tool="stripe")
        chosen, _, rejected = scout.decide([twin, other], [dropped], CONF)
        self.assertIn("too similar to 2026-11-07_1507_gsap", rejected[0]["reason"])
        self.assertEqual(chosen["tool"], "stripe")

    def test_tool_cooldown_and_new_release(self):
        hist = [{"status": "queued", "problem": "x", "takeaway": "y", "tool": "Claude Code", "at": ago(3), "niche": "ai"}]
        chosen, backlog, _ = scout.decide([cand("hooks for claude code")], hist, CONF)
        self.assertIsNone(chosen)
        self.assertIn("posted less than 7 days ago", backlog[0]["reason"])
        c = cand("hooks for claude code")
        c["release_dates"] = [ago(1)]
        chosen, _, _ = scout.decide([c], hist, CONF)
        self.assertEqual(chosen["problem"], "hooks for claude code")
        old = [{**hist[0], "at": ago(8)}]
        self.assertIsNotNone(scout.decide([cand("hooks for claude code")], old, CONF)[0])

    def test_quota_prefers_niches_under_their_share(self):
        hist = [{"status": "queued", "problem": f"p{i}", "takeaway": "t", "tool": f"t{i}", "at": ago(10), "niche": "ai"} for i in range(2)]
        chosen, _, _ = scout.decide([cand("another ai idea", total=20, tool="a"), cand("a design idea", niche="design", total=16, tool="b")], hist, CONF)
        self.assertEqual(chosen["niche"], "design")
        chosen, _, _ = scout.decide([cand("only ai idea", total=20, tool="a")], hist, CONF)
        self.assertEqual(chosen["problem"], "only ai idea")  # nothing under quota: the best one anyway


class Harvest(unittest.TestCase):
    def test_rss_and_atom(self):
        rss = """<?xml version="1.0"?><rss><channel><item><title>A &amp; B</title><link>https://a.example/1</link>
        <pubDate>Fri, 06 Nov 2026 10:00:00 GMT</pubDate><description>&lt;p&gt;Hello&lt;/p&gt;</description></item></channel></rss>"""
        atom = """<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom one</title>
        <link rel="alternate" href="https://b.example/2"/><updated>2026-11-05T09:00:00Z</updated><summary>Sum</summary></entry></feed>"""
        r = harvest.parse_feed(rss)[0]
        self.assertEqual((r["title"], r["url"], r["date"], r["text"]), ("A & B", "https://a.example/1", "2026-11-06T10:00:00+00:00", "Hello"))
        a = harvest.parse_feed("\n" + atom)[0]
        self.assertEqual((a["title"], a["url"], a["date"]), ("Atom one", "https://b.example/2", "2026-11-05T09:00:00+00:00"))

    def test_decisions_new_and_edited_entries(self):
        tmp = Path(core.DATA.parent / "tests" / "tmp-decisions.md")
        tmp.write_text("# DECISIONS\n\n## M1 Start (2026-10-01)\n\n1. **First.** body one\n    more body\n2. **Second.** two\n", encoding="utf-8")
        st = {}
        try:
            first = harvest.decisions(tmp, "proj", st)
            self.assertEqual([i["title"] for i in first], ["First.", "Second."])
            self.assertEqual(first[0]["text"], "First. body one more body")
            self.assertEqual(harvest.decisions(tmp, "proj", st), [])
            tmp.write_text(tmp.read_text(encoding="utf-8") + "3. **Third.** three\n", encoding="utf-8")
            self.assertEqual([i["title"] for i in harvest.decisions(tmp, "proj", st)], ["Third."])
        finally:
            tmp.unlink()

    def test_bot_commits_are_skipped(self):
        for s in ("autopost: update queue", "schedule 3 posts", "pipeline: queue 1 post"):
            self.assertTrue(harvest.BOT_COMMITS.match(s))
        self.assertFalse(harvest.BOT_COMMITS.match("Fix the scheduler slot math"))


if __name__ == "__main__":
    unittest.main()
