"""Stage 1, harvest (code only, no model): pull what is new from pipeline/sources.txt into data/pool.json.

sources.txt has one source per line, the niche last (ai, saas, webdev, video, design or mixed), # starts a comment:
  rss <feed url> <niche>                 RSS or Atom (changelogs, blogs, subreddits, Product Hunt)
  gh-releases <owner/repo> <niche>       GitHub releases
  gh-file <owner/repo> <path> <niche>    new "## " sections of a changelog file in a GitHub repo
  hn <front|show> <niche>                Hacker News front page or Show HN (Algolia API)
  gh-trending - <niche>                  repos created in the last 7 days with the most stars (GitHub search)
  repo <local path> <niche>              your own repo: new DECISIONS.md entries, known-issues.md lines, commits
Items are deduped by URL and normalized title and kept pool_keep_days days. Ids already seen are never re-added.
Usage: python pipeline/lib/harvest.py [--force]   (without --force it only runs when the last harvest is old enough)
"""
from __future__ import annotations

import base64
import hashlib
import html
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import core  # noqa: E402

UA = "Mozilla/5.0 (compatible; xposts-harvester/1.0)"
BOT_COMMITS = re.compile(r"^(autopost: |schedule \d+ |pipeline: queue |merge |revert \")", re.I)


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


def gh_api(path: str, *args: str):
    p = subprocess.run([core.gh(), "api", path, *args], capture_output=True, timeout=60)
    if p.returncode:
        raise RuntimeError(p.stderr.decode("utf-8", "replace").strip()[:200])
    return json.loads(p.stdout.decode("utf-8"))


def clean(text: str | None, limit: int | None = None) -> str:
    text = re.sub(r"<[^>]+>", " ", html.unescape(text or ""))
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n", text).strip()
    return text[: limit or core.cfg("harvest.item_text_chars", 1500)]


def norm_title(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()


def item_id(url: str, title: str) -> str:
    return hashlib.sha1((url or norm_title(title)).strip().lower().encode()).hexdigest()[:12]


def iso(value: str | None) -> str:
    """Any feed date as ISO 8601 UTC; now when missing or unreadable."""
    if value:
        for parse in (lambda v: datetime.fromisoformat(v.replace("Z", "+00:00")), parsedate_to_datetime):
            try:
                dt = parse(value.strip())
                return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).astimezone(timezone.utc).isoformat(timespec="seconds")
            except (ValueError, TypeError):
                pass
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def item(title, url, date, text, kind) -> dict:
    return {"title": clean(title, 300), "url": url or "", "date": iso(date), "dated": bool(date), "text": clean(text),
            "kind": kind}


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def parse_feed(xml_text: str) -> list[dict]:
    """RSS 2.0 items and Atom entries."""
    root = ET.fromstring(xml_text.lstrip().encode("utf-8"))
    out = []
    for node in root.iter():
        if local(node.tag) not in ("item", "entry"):
            continue
        f = {local(c.tag): c for c in node}
        link = f.get("link")
        url = (link.get("href") or link.text or "") if link is not None else ""
        if local(node.tag) == "entry":  # Atom: prefer rel="alternate"
            for c in node:
                if local(c.tag) == "link" and c.get("rel", "alternate") == "alternate":
                    url = c.get("href", url)
        date = next((f[k].text for k in ("pubDate", "published", "updated", "date") if k in f), None)
        body = next((f[k].text for k in ("description", "summary", "content", "encoded") if k in f and f[k].text), "")
        title = f["title"].text if "title" in f else ""
        out.append(item(title, url.strip(), date, body, "feed"))
    return out


def src_rss(args, st):
    return parse_feed(fetch(args[0]))


def src_gh_releases(args, st):
    rows = gh_api(f"repos/{args[0]}/releases?per_page=10")
    return [item(f"{args[0]} {r.get('tag_name')}: {r.get('name') or ''}", r.get("html_url"), r.get("published_at"),
                 r.get("body"), "release") for r in rows if not r.get("draft") and not r.get("prerelease")]


def src_gh_file(args, st):
    repo, path = args[0], args[1]
    data = gh_api(f"repos/{repo}/contents/{path}")
    if data.get("content"):
        text = base64.b64decode(data["content"]).decode("utf-8", "replace")
    else:  # over 1 MB the contents API sends no content, only the raw download link
        text = fetch(data["download_url"])
    parts = re.split(r"^## ", text, flags=re.M)[1:]
    out = []
    for part in parts[:10]:  # newest sections first in every common changelog
        head = part.splitlines()[0].strip()
        url = f"https://github.com/{repo}/blob/HEAD/{path}#{norm_title(head).replace(' ', '-')}"
        out.append(item(f"{repo} changelog {head}", url, None, part, "changelog"))
    return out


def src_hn(args, st):
    if args[0] == "show":
        api = "https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&numericFilters=points%3E30&hitsPerPage=30"
    else:
        api = "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30"
    out = []
    for h in json.loads(fetch(api))["hits"]:
        link = h.get("url") or f"https://news.ycombinator.com/item?id={h['objectID']}"
        note = f"{h.get('points', 0)} points and {h.get('num_comments', 0)} comments on Hacker News " \
               f"(https://news.ycombinator.com/item?id={h['objectID']}). {h.get('story_text') or ''}"
        out.append(item(h.get("title"), link, h.get("created_at"), note, "hn"))
    return out


def src_gh_trending(args, st):
    since = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d")
    rows = gh_api("search/repositories", "-X", "GET", "-f", f"q=created:>{since} stars:>100", "-f", "sort=stars",
                  "-f", "order=desc", "-f", "per_page=20")["items"]
    return [item(f"{r['full_name']}: {r.get('description') or ''}", r["html_url"], r.get("created_at"),
                 f"{r.get('stargazers_count')} stars, {r.get('language') or 'no language'}, topics: "
                 f"{', '.join(r.get('topics') or [])}. {r.get('description') or ''}", "trending") for r in rows]


def decisions(path: Path, name: str, st: dict) -> list[dict]:
    """New or edited entries of a DECISIONS.md: `N. **summary.** body` with a hanging indent."""
    out, section_date = [], None
    seen = st.setdefault("decisions", {})
    first = not seen
    entries = []
    cur = None
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        m = re.match(r"^##\s.*\((\d{4}-\d{2}-\d{2})\)", line)
        if m:
            section_date = m.group(1)
        m = re.match(r"^(\d+)\.\s+\*\*(.+?)\*\*\s*(.*)", line)
        if m:
            cur = {"n": m.group(1), "summary": m.group(2), "body": [m.group(3)], "date": section_date}
            entries.append(cur)
        elif cur and (line.startswith("    ") or not line.strip()):
            cur["body"].append(line.strip())
        else:
            cur = None
    for e in entries:
        body = " ".join(e["body"]).strip()
        h = hashlib.sha1(body.encode()).hexdigest()[:10]
        if seen.get(e["n"]) != h:
            seen[e["n"]] = h
            out.append(item(e["summary"], f"repo:{name}/DECISIONS.md#{e['n']}-{h}", e["date"], f"{e['summary']} {body}",
                            "decision"))
    return out[-core.cfg("harvest.first_run_items", 20):] if first else out


def known_issues(path: Path, name: str, st: dict) -> list[dict]:
    """`- date | stage | symptom -> fix (commit sha)` lines (the reels writer also ends them with (F<n>, runs/...))."""
    seen = set(st.setdefault("known", []))
    first = not seen
    out = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        m = re.match(r"^- (\d{4}-\d{2}-\d{2}) \| ([^|]+) \| (.+)$", line.strip())
        if not m:
            continue
        h = hashlib.sha1(line.encode()).hexdigest()[:10]
        if h in seen:
            continue
        seen.add(h)
        symptom = m.group(3).split(" -> ")[0]
        out.append(item(f"{name}: {symptom}", f"repo:{name}/known-issues#{h}", m.group(1), m.group(3), "known-issue"))
    st["known"] = sorted(seen)
    return out[-core.cfg("harvest.first_run_items", 20):] if first else out


def commits(path: Path, name: str, st: dict) -> list[dict]:
    last = st.get("last_commit")
    span = [f"{last}..HEAD"] if last else ["-n", str(core.cfg("harvest.first_run_items", 20))]
    p = subprocess.run(["git", "-C", str(path), "log", "--no-merges", "--date=iso-strict",
                        "--format=%H%x1f%ad%x1f%s%x1f%b%x1e", *span], capture_output=True, timeout=60)
    if p.returncode:  # an unknown last commit (history rewritten): start over from the recent ones
        if last:
            st.pop("last_commit")
            return commits(path, name, st)
        raise RuntimeError(p.stderr.decode("utf-8", "replace").strip()[:200])
    out = []
    for rec in p.stdout.decode("utf-8", "replace").split("\x1e"):
        parts = rec.strip().split("\x1f")
        if len(parts) < 4:
            continue
        sha, date, subject, body = parts
        if not st.get("newest"):
            st["newest"] = sha
        if BOT_COMMITS.match(subject):
            continue
        out.append(item(f"{name}: {subject}", f"repo:{name}@{sha[:10]}", date, f"{subject}\n{body}", "commit"))
    if st.get("newest"):
        st["last_commit"] = st.pop("newest")
    return out


def src_repo(args, st):
    path = Path(args[0])
    name = path.name
    out = []
    if (path / "DECISIONS.md").exists():
        out += decisions(path / "DECISIONS.md", name, st)
    for ki in sorted(path.glob("**/known-issues.md")):
        if "node_modules" not in ki.parts and len(ki.relative_to(path).parts) <= 4:
            out += known_issues(ki, name, st)
    return out + commits(path, name, st)


SOURCES = {"rss": src_rss, "gh-releases": src_gh_releases, "gh-file": src_gh_file, "hn": src_hn,
           "gh-trending": src_gh_trending, "repo": src_repo}


def read_sources(path: Path | None = None) -> list[tuple[str, list[str], str]]:
    rows = []
    for line in (path or core.PIPE / "sources.txt").read_text(encoding="utf-8").splitlines():
        line = line.split(" #")[0].strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if parts[0] not in SOURCES or len(parts) < 3:
            raise ValueError(f"sources.txt: cannot read '{line}'")
        rows.append((parts[0], parts[1:-1], parts[-1]))
    return rows


def due() -> bool:
    st = core.load_json(core.DATA / "harvest-state.json", {})
    return time.time() - st.get("last_run", 0) >= core.cfg("runner.harvest_every_minutes", 120) * 60


def harvest(sources: list | None = None) -> int:
    st = core.load_json(core.DATA / "harvest-state.json", {})
    pool = core.load_json(core.DATA / "pool.json", {})
    seen = set(st.get("seen", []))
    titles = {norm_title(i["title"]) for i in pool.values()}
    max_age = core.cfg("scout.pool_days", 14)
    new = failed = 0
    for kind, args, niche in sources or read_sources():
        key = f"{kind}:{' '.join(args)}"
        sst = st.setdefault("sources", {}).setdefault(key, {})
        try:
            items = SOURCES[kind](args, sst)
            sst.pop("error", None)
        except Exception as exc:  # one broken source never stops the harvest
            failed += 1
            sst["error"] = core.undash(str(exc))[:300]
            core.say("WARN", f"harvest {key}: {sst['error']}")
            continue
        first, undated = not sst.get("init"), 0
        sst["init"] = True
        for it in items:
            iid = item_id(it["url"], it["title"])
            nt = norm_title(it["title"])
            if iid in seen or nt in titles:
                continue
            seen.add(iid)
            if kind != "repo" and core.days_ago(it["date"]) > max_age:
                continue  # old entries of a feed seen for the first time
            if kind != "repo" and first and not it.pop("dated"):
                undated += 1
                if undated > 3:
                    continue  # a feed without dates: on its first run only its newest entries count as new
            titles.add(nt)
            pool[iid] = {**it, "id": iid, "source": key, "niche": niche, "used": False,
                         "harvested": core.now_rome().isoformat(timespec="seconds")}
            new += 1
    keep = core.cfg("harvest.pool_keep_days", 30)
    pool = {k: v for k, v in pool.items() if core.days_ago(v["harvested"]) <= keep}
    st["seen"] = sorted(seen)[-50000:]
    st["last_run"] = time.time()
    core.save_json(core.DATA / "pool.json", pool)
    core.save_json(core.DATA / "harvest-state.json", st)
    core.say("HARVST", f"{new} new items, {sum(not v['used'] for v in pool.values())} unused in the pool"
             + (f", {failed} sources failed" if failed else ""))
    return new


if __name__ == "__main__":
    if "--force" in sys.argv or due():
        harvest()
