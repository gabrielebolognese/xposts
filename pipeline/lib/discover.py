"""Discovery: the category rotation, about 5 category searches a day, and the persistent discovery database.

search_one() searches the next category of pipeline/categories.json (in order, remembered across restarts; after
the last one a new cycle starts). Code collects signals first (GitHub search, Hacker News, Reddit, Hugging Face),
then a model searches the web around them and returns candidates. Candidates are deduplicated by identity (GitHub
owner/name, Hugging Face id, website domain, normalized name) and stored in data/discoveries.json as pending.
select() turns the best pending discovery into a run folder for the stages in stages.py.

Files in pipeline/data/: rotation.json (where the rotation stands, the last search date per category),
searches.json (every search), discoveries.json (every discovered tool with its status: pending, analyzing,
rejected, review or published). POSTS_DISCOVER_FAKE=1 (tests) skips GitHub and the web.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ai  # noqa: E402
import core  # noqa: E402

UA = "Mozilla/5.0 (compatible; xposts-discovery/1.0)"
CATEGORIES = core.PIPE / "categories.json"
ROTATION = core.DATA / "rotation.json"
SEARCHES = core.DATA / "searches.json"
DISCOVERIES = core.DATA / "discoveries.json"
TRIAGE = ("problem_solving", "savings", "novelty", "relevance", "hook")
# Sites that host many projects: their domain says nothing about which project it is
HOSTS = {"github.com", "gitlab.com", "huggingface.co", "x.com", "twitter.com", "reddit.com", "www.reddit.com",
         "youtube.com", "producthunt.com", "news.ycombinator.com", "medium.com", "dev.to", "npmjs.com", "pypi.org",
         "alternativeto.net", "chromewebstore.google.com", "marketplace.visualstudio.com", "apps.apple.com"}


def fake() -> bool:
    return bool(os.environ.get("POSTS_DISCOVER_FAKE"))


def fetch(url: str, timeout: int = 30) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    for attempt in range(2):
        if "reddit.com" in url:
            time.sleep(12)  # Reddit answers 429 to requests a few seconds apart
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8-sig", "replace")
        except urllib.error.HTTPError as exc:
            if exc.code != 429 or attempt:
                raise
            time.sleep(60)
    return ""


def gh_api(path: str, *args: str):
    p = subprocess.run([core.gh(), "api", path, *args], capture_output=True, timeout=60)
    if p.returncode:
        raise RuntimeError(p.stderr.decode("utf-8", "replace").strip()[:200])
    return json.loads(p.stdout.decode("utf-8"))


def gh_raw(path: str) -> str:
    p = subprocess.run([core.gh(), "api", path, "-H", "Accept: application/vnd.github.raw"], capture_output=True, timeout=60)
    return p.stdout.decode("utf-8", "replace") if p.returncode == 0 else ""


# Identity ----------------------------------------------------------------------------------------------------------

def norm_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (name or "").lower())


def repo_key(text: str) -> str:
    """owner/name (lowercase) from "owner/name" or any github.com URL, else ""."""
    t = (text or "").strip()
    m = re.search(r"github\.com/([\w.-]+)/([\w.-]+)", t, re.I) or re.fullmatch(r"([\w.-]+)/([\w.-]+)", t)
    if not m:
        return ""
    name = re.sub(r"\.git$", "", m.group(2), flags=re.I)
    return f"{m.group(1)}/{name}".lower()


def host_of(url: str) -> str:
    url = (url or "").strip()
    if not url:
        return ""
    return urllib.parse.urlparse(url if "://" in url else "https://" + url).netloc.lower().removeprefix("www.")


def keys(c: dict) -> list[str]:
    """Every identity a candidate has; two candidates sharing any key are the same project."""
    out = []
    repo = repo_key(c.get("repo", "")) or repo_key(c.get("official_url", ""))
    if repo:
        out.append("gh:" + repo)
    url = c.get("official_url", "")
    m = re.search(r"huggingface\.co/(?!spaces/|datasets/|papers/)([\w.-]+)/([\w.-]+)", url, re.I)
    if m:
        out.append(f"hf:{m.group(1)}/{m.group(2)}".lower())
    host = host_of(url)
    if host and host not in HOSTS:
        out.append("site:" + host)
    name = norm_name(c.get("name", ""))
    if name:
        out.append("name:" + name)
    return out


def canonical(repo: str) -> str:
    """The repo's current owner/name from the GitHub API (renamed repos redirect), or "" when it does not exist."""
    key = repo_key(repo)
    if not key or fake():
        return key
    try:
        return gh_api(f"repos/{key}")["full_name"]
    except (RuntimeError, ValueError, KeyError):
        return ""


def repo_data(repo: str) -> dict:
    """Hard facts about a GitHub repo, from the API. {} when there is no such repo."""
    if not repo:
        return {}
    if fake():
        return {"full_name": repo, "html_url": f"https://github.com/{repo}", "description": "A fake repo for the tests.",
                "stars": 1234, "forks": 56, "archived": bool(os.environ.get("FAKE_ARCHIVED")), "disabled": False,
                "license": "MIT", "pushed_at": core.now_rome().isoformat(timespec="seconds"), "created_at": "2025-01-01",
                "homepage": "", "topics": [], "latest_release": {"tag": "v1.2.0", "date": "2026-11-01"},
                "recent_commits": [], "readme": "Fake README."}
    try:
        r = gh_api(f"repos/{repo}")
    except (RuntimeError, ValueError):
        return {}
    full = r["full_name"]
    try:
        rel = gh_api(f"repos/{full}/releases/latest")
        release = {"tag": rel.get("tag_name"), "date": rel.get("published_at"), "name": rel.get("name") or ""}
    except (RuntimeError, ValueError):
        release = {}
    try:
        commits = [c["commit"]["committer"]["date"] for c in gh_api(f"repos/{full}/commits?per_page=5")]
    except (RuntimeError, ValueError, KeyError, TypeError):
        commits = []
    return {"full_name": full, "html_url": r["html_url"], "description": r.get("description") or "",
            "stars": r.get("stargazers_count", 0), "forks": r.get("forks_count", 0), "archived": r.get("archived", False),
            "disabled": r.get("disabled", False), "license": (r.get("license") or {}).get("spdx_id") or "none",
            "pushed_at": r.get("pushed_at"), "created_at": r.get("created_at"), "homepage": r.get("homepage") or "",
            "topics": r.get("topics", []), "open_issues": r.get("open_issues_count", 0), "latest_release": release,
            "recent_commits": commits, "readme": gh_raw(f"repos/{full}/readme")[:8000]}


# Database ----------------------------------------------------------------------------------------------------------

def load_db() -> dict:
    return core.load_json(DISCOVERIES, {})


def find(db: dict, ks: list[str]) -> str | None:
    wanted = set(ks)
    return next((i for i, e in db.items() if wanted & set(e["keys"])), None)


def triage_total(c: dict) -> int:
    return sum(int(c["triage"].get(k, 0)) for k in TRIAGE)


def revisit_ok(e: dict, cand: dict, latest_tag: str | None = None) -> bool:
    """A published or rejected tool comes back only for a meaningful change, and not too soon."""
    if not cand.get("update_of_known") or not cand.get("update_note", "").strip():
        return False
    since = e.get("published_at") or e.get("closed_at") or e.get("found_at")
    if core.days_ago(since) < core.cfg("discovery.revisit_min_days", 60):
        return False
    seen = e.get("last_release_seen")
    return not (seen and latest_tag is not None and latest_tag == seen)


def merge(db: dict, cand: dict, cat: dict, now: str, tag_of=None) -> str:
    """Add a candidate: "new", "revisit" (a known tool with a meaningful change) or "known".
    tag_of(repo) gives the repo's latest release tag, or None when unknown."""
    ks = keys(cand)
    if not ks:
        return "known"
    hit = find(db, ks)
    if hit is None:
        db[ks[0]] = {"id": ks[0], "keys": ks, "name": cand["name"], "repo": cand.get("repo", ""),
                     "official_url": cand.get("official_url", ""), "category": cat["id"], "category_name": cat["name"],
                     "found_at": now, "last_seen": now, "seen": 1, "status": "pending",
                     "triage_total": triage_total(cand), "candidate": cand}
        return "new"
    e = db[hit]
    e["keys"] = sorted(set(e["keys"]) | set(ks))
    e["last_seen"], e["seen"] = now, e.get("seen", 1) + 1
    if e["status"] in ("published", "rejected") and cand.get("update_of_known"):
        tag = tag_of(e.get("repo", "")) if tag_of else None
        if revisit_ok(e, cand, tag):
            e.update(status="pending", candidate=cand, triage_total=triage_total(cand), revisit=cand["update_note"])
            return "revisit"
    if e["status"] == "pending" and triage_total(cand) > e["triage_total"]:
        e.update(candidate=cand, triage_total=triage_total(cand))
    return "known"


def set_status(disc_id: str | None, status: str, **extra) -> None:
    if not disc_id:
        return
    db = load_db()
    if disc_id in db:
        db[disc_id].update(status=status, **extra)
        core.save_json(DISCOVERIES, db)


def latest_tag(repo: str) -> str | None:
    if not repo or fake():
        return None
    try:
        return gh_api(f"repos/{repo}/releases/latest").get("tag_name")
    except (RuntimeError, ValueError):
        return None


# Rotation ----------------------------------------------------------------------------------------------------------

def categories() -> list[dict]:
    return core.load_json(CATEGORIES)["categories"]


def next_category(cats: list[dict], rot: dict) -> tuple[int, int]:
    """(index, cycle) of the category to search next: the one after the last searched, wrapping into a new cycle.
    Following the last id (not a stored position) keeps the place when categories are added."""
    ids = [c["id"] for c in cats]
    cycle = rot.get("cycle", 1)
    i = ids.index(rot["last_id"]) + 1 if rot.get("last_id") in ids else rot.get("next_index", 0)
    if i >= len(cats):
        i, cycle = 0, cycle + 1
    return i, cycle


def searches_today() -> int:
    today = core.now_rome().strftime("%Y-%m-%d")
    return sum(1 for s in core.load_json(SEARCHES, []) if s.get("at", "")[:10] == today)


def has_pending() -> bool:
    bar = core.cfg("discovery.triage_min", 9)
    return any(e["status"] == "pending" and e["triage_total"] >= bar for e in load_db().values())


def search_due(made_today: int, min_per_day: int) -> bool:
    """searches_per_day searches a day; more (up to max_searches_per_day) only while fewer than min_per_day threads
    are ready today and no pending discovery is good enough."""
    done = searches_today()
    if done < core.cfg("discovery.searches_per_day", 5):
        return True
    return (made_today < min_per_day and done < core.cfg("discovery.max_searches_per_day", 15)
            and not has_pending())


# Signals (code only) -------------------------------------------------------------------------------------------------

def clean(text: str | None, limit: int = 300) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text or "")).strip()[:limit]


def feed_items(xml_text: str) -> list[dict]:
    out = []
    for node in ET.fromstring(xml_text.lstrip().encode("utf-8")).iter():
        if node.tag.rsplit("}", 1)[-1] not in ("item", "entry"):
            continue
        f = {c.tag.rsplit("}", 1)[-1]: c for c in node}
        link = f.get("link")
        url = (link.get("href") or link.text or "") if link is not None else ""
        title = f["title"].text if "title" in f else ""
        body = next((f[k].text for k in ("description", "summary", "content") if k in f and f[k].text), "")
        date = next((f[k].text for k in ("pubDate", "published", "updated") if k in f), "")
        out.append({"title": clean(title), "url": url.strip(), "date": date, "text": clean(body)})
    return out


def signals(cat: dict, since: str) -> list[dict]:
    """What GitHub, Hacker News, Reddit and Hugging Face show for the category since the date. Best effort: a source
    that fails is skipped with a warning."""
    if fake():
        return []
    out: list[dict] = []
    stars, new_stars = core.cfg("discovery.gh_min_stars", 30), core.cfg("discovery.gh_new_min_stars", 10)
    queries = [f"{q} pushed:>={since} stars:>={stars}" for q in cat["queries"]]
    queries += [f"{q} created:>={since} stars:>={new_stars}" for q in cat["queries"]]
    queries += [f"topic:{t} pushed:>={since} stars:>={stars}" for t in cat.get("gh_topics", [])]
    for q in queries:
        try:
            rows = gh_api("search/repositories", "-X", "GET", "-f", f"q={q}", "-f", "sort=stars", "-f", "order=desc",
                          "-f", "per_page=8")["items"]
            out += [{"source": "github", "title": r["full_name"], "repo": r["full_name"], "url": r["html_url"],
                     "stars": r.get("stargazers_count"), "date": r.get("pushed_at"), "text": clean(r.get("description"))}
                    for r in rows]
        except (RuntimeError, ValueError, KeyError) as exc:
            core.say("WARN", f"GitHub search skipped ({q[:40]}): {exc}")
        time.sleep(2.5)  # the search API allows 30 requests a minute
    ts = int(datetime.fromisoformat(since).replace(tzinfo=timezone.utc).timestamp())
    for q in cat["queries"]:
        try:
            api = "https://hn.algolia.com/api/v1/search?" + urllib.parse.urlencode(
                {"query": q, "tags": "story", "numericFilters": f"created_at_i>{ts},points>10", "hitsPerPage": 8})
            for h in json.loads(fetch(api))["hits"]:
                item = f"https://news.ycombinator.com/item?id={h['objectID']}"
                out.append({"source": "hackernews", "title": clean(h.get("title")), "url": h.get("url") or item,
                            "date": h.get("created_at"), "text": f"{h.get('points', 0)} points, "
                            f"{h.get('num_comments', 0)} comments on Hacker News ({item})"})
        except (OSError, ValueError, KeyError) as exc:
            core.say("WARN", f"Hacker News skipped: {exc}")
    try:
        rss = fetch("https://www.reddit.com/search.rss?" + urllib.parse.urlencode(
            {"q": cat["queries"][0], "sort": "top", "t": "month"}))
        out += [{"source": "reddit", **i} for i in feed_items(rss)[:8]]
    except (OSError, ValueError, ET.ParseError) as exc:
        core.say("WARN", f"Reddit skipped: {exc}")
    if cat.get("hf"):
        try:
            api = "https://huggingface.co/api/models?" + urllib.parse.urlencode(
                {"search": cat["queries"][0], "sort": "trendingScore", "limit": 8})
            out += [{"source": "huggingface", "title": m["id"], "url": f"https://huggingface.co/{m['id']}",
                     "likes": m.get("likes"), "downloads": m.get("downloads"),
                     "date": m.get("lastModified") or m.get("createdAt"), "text": ", ".join(m.get("tags", [])[:12])}
                    for m in json.loads(fetch(api))]
        except (OSError, ValueError, KeyError) as exc:
            core.say("WARN", f"Hugging Face skipped: {exc}")
    seen, unique = set(), []
    for s in out:
        if s["url"] and s["url"] not in seen:
            seen.add(s["url"])
            unique.append(s)
    return unique[: core.cfg("discovery.signals_max", 40)]


# One category search -------------------------------------------------------------------------------------------------

def search_one() -> dict:
    """Search the next category and store what it finds. Returns the counts {new, revisit, known}."""
    cats, rot = categories(), core.load_json(ROTATION, {})
    i, cycle = next_category(cats, rot)
    cat = cats[i]
    first = core.now_rome() - timedelta(days=core.cfg("discovery.first_since_days", 120))
    since = rot.get("since", {}).get(str(cat["id"])) or first.strftime("%Y-%m-%d")
    core.say("SEARCH", f"category {i + 1} of {len(cats)} (cycle {cycle}): {cat['name']}, new since {since}")
    sig = signals(cat, since)
    db = load_db()
    known = sorted({e["name"] for e in db.values() if e.get("category") == cat["id"]})[:150]
    count = core.cfg("discovery.candidates_per_search", 10)
    stage = core.DATA / "searches" / f"{time.strftime('%Y-%m-%d_%H%M%S')}_c{cat['id']}"
    try:
        out = ai.call("discover", stage, "discover", core.render(
            "discover", TODAY=core.now_rome().strftime("%Y-%m-%d"), CATEGORY=f"{cat['name']} (group: {cat['group']})",
            SINCE=since, COUNT=str(count), KNOWN="\n".join(f"- {k}" for k in known) or "- (none yet)",
            SIGNALS=sig or "(none)"), schema="discover", tools=["WebSearch", "WebFetch"],
            timeout=core.cfg("timeouts.discover_seconds", 1800))
    except Exception:
        fails = rot.setdefault("fails", {})
        fails[str(cat["id"])] = fails.get(str(cat["id"]), 0) + 1
        if fails[str(cat["id"])] >= 2:  # a category that keeps failing must not block the rotation
            rot.update(last_id=cat["id"], next_index=i + 1, cycle=cycle)
            fails.pop(str(cat["id"]))
            core.say("WARN", f"category {cat['name']} failed twice, moving on to the next one")
        core.save_json(ROTATION, rot)
        raise
    now = core.now_rome().isoformat(timespec="seconds")
    counts = {"new": 0, "revisit": 0, "known": 0}
    for c in out["candidates"][:count]:
        if c.get("repo"):
            c["repo"] = canonical(c["repo"])
        counts[merge(db, c, cat, now, latest_tag)] += 1
    core.save_json(DISCOVERIES, db)
    rot.update(last_id=cat["id"], next_index=i + 1, cycle=cycle, last_category=cat["name"], last_search_at=now)
    rot.setdefault("since", {})[str(cat["id"])] = now[:10]
    rot.get("fails", {}).pop(str(cat["id"]), None)
    core.save_json(ROTATION, rot)
    history = core.load_json(SEARCHES, [])
    history.append({"category": cat["id"], "name": cat["name"], "at": now, "cycle": cycle, "since": since,
                    "signals": len(sig), "candidates": len(out["candidates"]), **counts})
    core.save_json(SEARCHES, history)
    core.say("FOUND", f"{counts['new']} new, {counts['revisit']} worth a second look, {counts['known']} already known")
    return counts


# Selection -----------------------------------------------------------------------------------------------------------

def select() -> Path | None:
    """The best pending discovery above the triage bar becomes a run folder, or None."""
    db = load_db()
    bar = core.cfg("discovery.triage_min", 9)
    pending = sorted((e for e in db.values() if e["status"] == "pending" and e["triage_total"] >= bar),
                     key=lambda e: (-e["triage_total"], e["found_at"]))
    if not pending:
        return None
    e = pending[0]
    slug = re.sub(r"[^a-z0-9]+", "-", e["name"].lower()).strip("-")[:40] or "tool"
    run = core.RUNS / f"{core.slot_name(core.now_rome())}_{slug}"
    run.mkdir(parents=True, exist_ok=True)
    core.save_json(run / "discovery.json", e)
    core.save_json(run / "state.json", {"stage": "analyze", "created": time.time(), "errors": 0, "discovery": e["id"]})
    e.update(status="analyzing", run=run.name)
    core.save_json(DISCOVERIES, db)
    core.say("PICK", f"[triage {e['triage_total']} of 15] {e['name']}: {e['candidate']['problem'][:90]}")
    return run


if __name__ == "__main__":
    print(search_one())
