#!/usr/bin/env bash
# End-to-end test of the runner with a fake claude, fake discovery signals and a fake X client, in a throwaway copy
# of the project that pushes to a local bare repo. No network, no model calls, no posts, nothing touches the real queue.
#   bash pipeline/tests/e2e.sh
set -u
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
T="$(cygpath -m "$(mktemp -d)")"
W="$T/work"
pass=0
ok() { pass=$((pass + 1)); echo "ok $pass $1"; }
fail() { echo "FAIL: $1"; echo "--- output:"; printf '%s\n' "${2:-}" | tail -30; exit 1; }

mkdir -p "$W/.claude/skills" "$W/pipeline"
cp "$SRC/scheduler.js" "$SRC/post.js" "$SRC/post-now.js" "$SRC/package.json" "$W/"
cp -r "$SRC/.claude/skills/x-threads" "$W/.claude/skills/"
for d in lib prompts schemas vendor tests; do cp -r "$SRC/pipeline/$d" "$W/pipeline/"; done
cp "$SRC/pipeline/run.sh" "$SRC/pipeline/categories.json" "$W/pipeline/"
python - "$SRC/pipeline/config.json" "$W/pipeline/config.json" <<'EOF'
import json, sys
c = json.load(open(sys.argv[1], encoding="utf-8"))
c["poster"]["interval_seconds"] = 2
c["runner"].update(idle_minutes=1, error_pause_minutes=0)
c["retries"]["transient_backoff_seconds"] = []
c["discovery"]["searches_per_day"] = 1
json.dump(c, open(sys.argv[2], "w", encoding="utf-8"), indent=1)
EOF
printf 'pipeline/data/\npipeline/runs/\npipeline/review/\npipeline/logs/\npipeline/.lock\n__pycache__/\n' > "$W/.gitignore"
git init -q --bare "$T/remote.git"
git -C "$W" init -q -b main
git -C "$W" config user.name test
git -C "$W" config user.email test@example.invalid
git -C "$W" config core.autocrlf false
git -C "$W" add -A && git -C "$W" commit -qm init
git -C "$W" remote add origin "$T/remote.git" && git -C "$W" push -q -u origin main 2>/dev/null

export POSTS_CLAUDE="$W/pipeline/tests/fake_claude.py" POSTS_FAKE_X=1 POSTS_DISCOVER_FAKE=1 FAKE_LOG="$T/calls.log"
cd "$W" || exit 1

seed() {  # seed <tool name>: a pending discovery, as a category search would leave it
  python - "$1" <<'EOF'
import re, sys
sys.path.insert(0, "pipeline/lib")
import core, discover
name = sys.argv[1]
repo = "fakeorg/" + re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
cand = {"name": name, "repo": repo, "official_url": f"https://github.com/{repo}", "what_it_does": "Does a thing.",
        "problem": f"{name} problem.", "why_now": "New.", "pricing_guess": "free", "update_of_known": False,
        "update_note": "", "sources": [], "triage": {k: 3 for k in discover.TRIAGE}}
db = discover.load_db()
discover.merge(db, cand, {"id": 99, "name": "Test category"}, core.now_rome().isoformat(timespec="seconds"))
core.save_json(discover.DISCOVERIES, db)
EOF
}
backdate_searches() {  # today's searches count as yesterday's, so a new search is due
  python -c 'import json; p="pipeline/data/searches.json"; s=json.load(open(p)); [x.update(at="2000-01-01T00:00:00+01:00") for x in s]; json.dump(s, open(p, "w"))'
}
calls() { tr '\n' ' ' < "$FAKE_LOG"; : > "$FAKE_LOG"; }
status_of() { python -c 'import json,sys; print(next(e["status"] for e in json.load(open("pipeline/data/discoveries.json")).values() if e["name"] == sys.argv[1]))' "$1"; }
reason_of() { python -c 'import json,sys; print(next(e.get("reason", "") for e in json.load(open("pipeline/data/discoveries.json")).values() if e["name"] == sys.argv[1]))' "$1"; }
rotation_last() { python -c 'import json; print(json.load(open("pipeline/data/rotation.json"))["last_id"])'; }
slot_of() { python -c 'import json,sys; print(next(e["slot"] or "waiting" for e in json.load(open("pipeline/data/virality.json")).values() if e["name"] == sys.argv[1]))' "$1"; }
nth_slot() { ls queue | sed -n "${1}p"; }

# A: a category search finds a tool; it goes through every stage, joins the virality queue and is arranged into
#    the first free slot, committed and pushed
out="$(bash pipeline/run.sh --once 2>&1)"
slot="$(ls queue 2>/dev/null | head -1)"
[ -n "$slot" ] && [ -f "queue/$slot/post.txt" ] || fail "no queue folder" "$out"
[ "$(ls queue/$slot | grep -c '^reply[0-9]*\.txt$')" = 5 ] || fail "not 5 reply files" "$(ls queue/$slot)"
grep -q "^5\. Go to GitHub and search for: fakeorg/" "queue/$slot/reply5.txt" || fail "no access reply" "$(cat "queue/$slot/reply5.txt")"
(cat "queue/$slot/post.txt"; for i in 1 2 3 4 5; do printf '\n#--#\n'; cat "queue/$slot/reply$i.txt"; done) > "$T/thread.txt"
node .claude/skills/x-threads/check.mjs "$T/thread.txt" >/dev/null || fail "queued thread breaks the rulebook" "$(node .claude/skills/x-threads/check.mjs "$T/thread.txt")"
case "${slot:11:4}" in 0600|1000|1400) ;; *) fail "slot $slot is not 06:00, 10:00 or 14:00";; esac
[ "$(git --git-dir="$T/remote.git" log -1 --format=%s main)" = "pipeline: arrange the thread queue" ] || fail "not pushed" "$out"
printf '%s' "$out" | grep -q "Stopped. This session: 1 threads ready, 0 sent to review/, 0 dropped, 1 category searches. 1 threads are scheduled, through" || fail "stop summary" "$out"
[ ! -f pipeline/.lock ] || fail "lock left behind"
c="$(calls)"; [ "$c" = "discover analyze score hooks hook_critic thread editor virality " ] || fail "unexpected call order" "calls: $c"
[ "$(rotation_last)" = 1 ] || fail "rotation not at category 1"
[ "$(status_of "Open-source LLMs Tool")" = ready ] || fail "discovery not marked ready"
ok "search, analyze ... virality: thread arranged into $slot and pushed, summary printed, rotation at category 1"

# B: an archived repository is dropped before any model call, with the reason
seed "Archived thing"
FAKE_ARCHIVED=1 python pipeline/lib/step.py >/dev/null 2>&1; rc=$?
[ $rc = 10 ] || fail "archived path exit $rc"
c="$(calls)"; [ "$c" = "" ] || fail "model called for an archived repo" "calls: $c"
[ "$(status_of "Archived thing")" = rejected ] || fail "archived not rejected"
reason_of "Archived thing" | grep -q "archived" || fail "archived reason missing"
ok "archived repo: rejected with the reason, no model call (today's search was already used)"

# C: quality control never passes: 3 fix rounds, then review/ with NEEDS REVIEW, nothing queued
before="$(ls queue | wc -l)"
seed "Leaky helper"
FAKE_EDITOR_FAIL=1 python pipeline/lib/step.py >/dev/null 2>&1; rc=$?
[ $rc = 11 ] || fail "review path exit $rc"
c="$(calls)"; [ "$c" = "analyze score hooks hook_critic thread editor fix editor fix editor fix editor " ] \
  || fail "review path order" "calls: $c"
head -1 pipeline/review/*.txt | grep -q "NEEDS REVIEW" || fail "review header"
[ "$(ls queue | wc -l)" = "$before" ] || fail "a review thread was queued"
[ "$(status_of "Leaky helper")" = review ] || fail "discovery not marked review"
ok "QC fail: 3 fix rounds, then review/ with NEEDS REVIEW, not queued"

# D: a call breaks in the thread stage; the next step resumes there without redoing the analysis
seed "Resumable tool"
FAKE_FAIL_STAGE=thread python pipeline/lib/step.py >/dev/null 2>&1; rc=$?
[ $rc = 1 ] || fail "failure exit $rc"
run="$(ls -td pipeline/runs/* | head -1)"
grep -q '"stage": "thread"' "$run/state.json" || fail "state not at thread" "$(cat "$run/state.json")"
: > "$FAKE_LOG"
python pipeline/lib/step.py >/dev/null 2>&1; rc=$?
[ $rc = 0 ] || fail "resume exit $rc"
c="$(calls)"; [ "$c" = "thread editor virality " ] || fail "resume redid earlier stages" "calls: $c"
[ "$(slot_of "Resumable tool")" = "$(nth_slot 2)" ] || fail "second thread not in the second slot"
ok "failure in thread: the next step resumed at thread; the thread took the second slot"

# V1: a newer thread with a higher virality score takes the earliest slot and pushes the others back
seed "Viral winner"
FAKE_VIRAL=95 python pipeline/lib/step.py >/dev/null 2>&1; rc=$?
[ $rc = 0 ] || fail "viral winner exit $rc"
[ "$(slot_of "Viral winner")" = "$(nth_slot 1)" ] || fail "the best thread is not first" "$(ls queue)"
grep -q "Viral winner" "queue/$(nth_slot 1)/post.txt" || fail "first slot does not hold the winner"
[ "$(slot_of "Open-source LLMs Tool")" = "$(nth_slot 2)" ] && [ "$(slot_of "Resumable tool")" = "$(nth_slot 3)" ] \
  || fail "the older threads were not pushed back in order" "$(cat pipeline/data/virality.json)"
: > "$FAKE_LOG"
ok "virality 94 beats 85: it took $(nth_slot 1), the others moved back one slot each"

# V2: under 80 the hook is improved first; the better scored alternative replaces it
seed "Weak hook tool"
FAKE_VIRAL=75 python pipeline/lib/step.py >/dev/null 2>&1; rc=$?
[ $rc = 0 ] || fail "weak hook exit $rc"
c="$(calls)"; [ "$c" = "analyze score hooks hook_critic thread editor virality virality_hooks hook_score virality " ] \
  || fail "hook optimization order" "calls: $c"
python -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d["hook"].startswith("Stop overpaying"), d["hook"]' \
  "$(ls -td pipeline/runs/* | head -1)/draft.json" || fail "the hook was not replaced"
[ "$(slot_of "Weak hook tool")" = "$(nth_slot 4)" ] || fail "the 76 thread is not after the 85s"
ok "virality 76: hook replaced by the better alternative, arranged after the stronger threads"

# V3: still under 70 after the hook step: rejected
seed "Dull tool"
FAKE_VIRAL=50 python pipeline/lib/step.py >/dev/null 2>&1; rc=$?
[ $rc = 10 ] || fail "dull exit $rc"
reason_of "Dull tool" | grep -q "virality 50" || fail "virality reason missing" "$(reason_of "Dull tool")"
: > "$FAKE_LOG"
ok "virality 50 after the hook step: rejected with the reason"

# F: the daily search quota: a new day allows the next search, which moves on to the next category
backdate_searches
python pipeline/lib/step.py >/dev/null 2>&1; rc=$?
[ $rc = 13 ] || fail "search exit $rc"
c="$(calls)"; [ "$c" = "discover " ] || fail "search order" "calls: $c"
[ "$(rotation_last)" = 2 ] || fail "rotation did not move to category 2"
python pipeline/lib/step.py >/dev/null 2>&1; rc=$?
c="$(calls)"; case "$c" in discover*) fail "searched twice in one day" "calls: $c";; esac
ok "quota: one search a day here, then selection; the rotation moved to category 2"

# H: a tool found again is merged, not added twice, and the rotation goes on
backdate_searches
n="$(python -c 'import json; print(len(json.load(open("pipeline/data/discoveries.json"))))')"
FAKE_TOOL="Open-source LLMs Tool" python pipeline/lib/step.py >/dev/null 2>&1; rc=$?
[ $rc = 13 ] || fail "duplicate search exit $rc"
[ "$(python -c 'import json; print(len(json.load(open("pipeline/data/discoveries.json"))))')" = "$n" ] || fail "duplicate added"
python -c 'import json; s=json.load(open("pipeline/data/searches.json"))[-1]; assert (s["new"], s["known"]) == (0, 1), s' || fail "not counted as known"
[ "$(rotation_last)" = 3 ] || fail "rotation did not move to category 3"
: > "$FAKE_LOG"
ok "duplicate discovery merged; rotation at category 3"

# G: --posts N stops by itself once N threads are queued
seed "Posts limit tool"
out="$(timeout 300 bash pipeline/run.sh --posts 1 2>&1)"; rc=$?
[ $rc = 0 ] || fail "--posts exit $rc" "$out"
printf '%s' "$out" | grep -q "Stopped. This session: 1 threads ready" || fail "--posts summary" "$out"
bash pipeline/run.sh --posts x >/dev/null 2>&1 && fail "--posts accepted a non-number"
[ ! -f pipeline/.lock ] || fail "lock left after --posts"
: > "$FAKE_LOG"
ok "--posts 1 made one thread and stopped with the summary"

# P: "Post thread now" leaves a request; the posting loop posts it (fake X), records it and removes its queue/ folder;
#    the next arrangement gives the slot to the next best thread
first="$(nth_slot 1)"; count="$(ls queue | wc -l)"
python - <<'EOF'
import json, os
pool = json.load(open("pipeline/data/virality.json"))
run = next(e["run"] for e in pool.values() if e["name"] == "Viral winner")
os.makedirs("pipeline/data/post-now", exist_ok=True)
json.dump({"run": run, "at": "2026-11-14T08:00:00Z"}, open(f"pipeline/data/post-now/{run}.json", "w"))
EOF
python pipeline/lib/poster.py
python -c 'import json; p=json.load(open("pipeline/data/posted-now.json")); assert p[-1]["url"].startswith("https://x.com/i/status/fake") and p[-1]["complete"], p' \
  || fail "post-now not recorded" "$(tail -5 pipeline/logs/runner.log)"
[ -z "$(ls pipeline/data/post-now)" ] || fail "request not cleared" "$(ls pipeline/data/post-now)"
[ ! -d "queue/$first" ] || fail "the posted thread's folder is still in queue/"
[ "$(git --git-dir="$T/remote.git" log -1 --format=%s main)" = "autopost: update queue" ] || fail "post-now removal not pushed"
python pipeline/lib/step.py >/dev/null 2>&1
python -c 'import json; e=[x for x in json.load(open("pipeline/data/virality.json")).values() if x["name"]=="Viral winner"][0]; assert e["status"]=="posted" and e["posted_now"], e' \
  || fail "posted-now thread not marked posted"
grep -q "Viral winner" queue/*/post.txt && fail "the posted thread is back in queue/"
[ "$(slot_of "Open-source LLMs Tool")" = "$first" ] || fail "the next best thread did not take the freed slot"
[ "$(ls queue | wc -l)" = $((count - 1)) ] || fail "queue size after post-now" "$(ls queue)"
ok "post now: posted by the posting loop, folder removed and pushed, $first went to the next best thread"

# L1: the posting loop posts what is due (a single post and a thread), moves them to posted/, commits and pushes
python - <<'EOF'
import sys
from datetime import timedelta
sys.path.insert(0, "pipeline/lib")
import core
due = core.slot_name(core.now_rome() - timedelta(minutes=2))
other = core.slot_name(core.now_rome() - timedelta(minutes=3))
core.write_text(core.ROOT / "queue" / other / "post.txt", "a plain text post")
for i, t in enumerate(["main post", "1. first reply", "2. second reply"]):
    core.write_text(core.ROOT / "queue" / due / ("post.txt" if i == 0 else f"reply{i}.txt"), t)
open("due.txt", "w").write(f"{due} {other}")
EOF
read due other < due.txt; rm due.txt
python pipeline/lib/poster.py
[ -f "posted/$other/post.txt" ] && [ ! -d "queue/$other" ] || fail "the single post was not posted" "$(tail -5 pipeline/logs/runner.log)"
python -c 'import json,sys; assert len(json.load(open(sys.argv[1]))["ids"]) == 3' "posted/$due/thread.json" || fail "the thread was not posted in 3 parts"
[ "$(git --git-dir="$T/remote.git" log -1 --format=%s main)" = "autopost: update queue" ] || fail "posting not pushed"
git --git-dir="$T/remote.git" ls-tree -r --name-only main | grep -q "^posted/$due/thread.json$" || fail "posted/ not on the remote"
grep -q "POSTED .*posted $due -> https://x.com/i/status/fake" pipeline/logs/runner.log || fail "no POSTED line in the log"
ok "posting loop: a due post and a 3-part thread went out (fake X), moved to posted/ and pushed"

# L2: a thread that missed its slot (PC off, post.js moved it to missed/) goes back to the virality queue
python - <<'EOF'
import json, shutil
pool = json.load(open("pipeline/data/virality.json"))
e = next(x for x in pool.values() if x["name"] == "Weak hook tool")
shutil.move(f"queue/{e['slot']}", "missed/2026-01-01_0600")
e["slot"] = "2026-01-01_0600"
json.dump(pool, open("pipeline/data/virality.json", "w"))
EOF
python pipeline/lib/step.py >/dev/null 2>&1
python -c 'import json; e=[x for x in json.load(open("pipeline/data/virality.json")).values() if x["name"]=="Weak hook tool"][0]; assert e["status"]=="scheduled" and e["slot"]!="2026-01-01_0600" and e["missed"]==1, e' \
  || fail "the missed thread did not get a new slot" "$(cat pipeline/data/virality.json)"
[ -d "queue/$(slot_of "Weak hook tool")" ] || fail "no queue folder for the rescheduled thread"
grep -q "missed 2026-01-01_0600 (the PC was off), back in the virality queue" pipeline/logs/runner.log || fail "no log line for the missed thread"
ok "missed slot: the thread went back to the virality queue and got $(slot_of "Weak hook tool")"

# L3: the posting loop and an arrangement at the same time take turns (the queue lock), git stays clean
python pipeline/lib/poster.py & bg=$!
python pipeline/lib/step.py >/dev/null 2>&1
wait $bg
[ ! -d pipeline/.queue-lock ] || fail "queue lock left behind"
[ ! -f .git/index.lock ] || fail "git index lock left behind"
[ -z "$(git status --porcelain -- queue posted missed)" ] || fail "uncommitted queue changes" "$(git status --porcelain)"
[ "$(git rev-parse HEAD)" = "$(git --git-dir="$T/remote.git" rev-parse main)" ] || fail "local and remote differ"
ok "posting loop and arrangement at the same time: they took turns, everything committed and pushed"

# E: nothing left to do: the runner waits; Ctrl+C (SIGINT) stops it with the summary
set -m   # job control: without it a background job starts with SIGINT ignored and cannot trap it
bash pipeline/run.sh > "$T/runner.out" 2>&1 &
runner=$!
set +m
for _ in $(seq 1 30); do grep -q "IDLE" "$T/runner.out" && break; sleep 1; done
sleep 1
kill -INT "$runner"
for _ in $(seq 1 15); do kill -0 "$runner" 2>/dev/null || break; sleep 1; done
out="$(cat "$T/runner.out")"
kill -0 "$runner" 2>/dev/null && { kill "$runner"; fail "runner did not stop on SIGINT" "$out"; }
printf '%s' "$out" | grep -q "Stopped. This session: 0 threads ready, 0 sent to review/, 0 dropped, 0 category searches. [0-9]* threads are scheduled, through" \
  || fail "summary after Ctrl+C" "$out"
[ ! -f pipeline/.lock ] || fail "lock left after Ctrl+C"
ok "idle runner stopped by Ctrl+C: $(printf '%s' "$out" | grep Stopped | sed 's/^Stopped. //')"

# T: --posts N (POSTS_DAY_TARGET) keeps searching past the daily searches while fewer than N threads are ready today
: > "$FAKE_LOG"
python pipeline/lib/step.py >/dev/null 2>&1; rc=$?
[ $rc = 12 ] || fail "without a target the runner should wait, exit $rc"
POSTS_DAY_TARGET=20 python pipeline/lib/step.py >/dev/null 2>&1; rc=$?
[ $rc = 13 ] || fail "with a target of 20 the runner should search, exit $rc"
c="$(calls)"; [ "$c" = "discover " ] || fail "target search order" "calls: $c"
ok "first fill: with --posts 20 it searches beyond the daily searches; without it waits"

echo "all $pass passed"
rm -rf "$T"
