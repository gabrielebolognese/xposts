#!/usr/bin/env bash
# End-to-end test of the runner with a fake claude and a fake sandbox, in a throwaway copy of the project that
# pushes to a local bare repo. No network, no model calls, nothing touches the real queue or GitHub.
#   bash pipeline/tests/e2e.sh
set -u
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
T="$(cygpath -m "$(mktemp -d)")"
W="$T/work"
pass=0
ok() { pass=$((pass + 1)); echo "ok $pass $1"; }
fail() { echo "FAIL: $1"; echo "--- output:"; printf '%s\n' "${2:-}" | tail -30; exit 1; }

mkdir -p "$W/.claude/skills" "$W/pipeline"
cp "$SRC/scheduler.js" "$SRC/package.json" "$W/"
cp -r "$SRC/.claude/skills/x-long-form-posts" "$W/.claude/skills/"
for d in lib bin prompts schemas vendor tests sandbox; do cp -r "$SRC/pipeline/$d" "$W/pipeline/"; done
cp "$SRC/pipeline/run.sh" "$W/pipeline/"
printf '# no sources in the test\n' > "$W/pipeline/sources.txt"
python - "$SRC/pipeline/config.json" "$W/pipeline/config.json" <<'EOF'
import json, sys
c = json.load(open(sys.argv[1], encoding="utf-8"))
c.update(dispatch=False)
c["runner"].update(idle_minutes=1, error_pause_minutes=0)
c["retries"]["transient_backoff_seconds"] = []
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

export POSTS_CLAUDE="$W/pipeline/tests/fake_claude.py" POSTS_SANDBOX_FAKE=1 FAKE_LOG="$T/calls.log"
cd "$W" || exit 1

seed() {  # seed <title>: two fresh unused pool items, and a harvest that is not due
  python - "$1" <<'EOF'
import sys, time, json, hashlib
sys.path.insert(0, "pipeline/lib")
import core
pool = core.load_json(core.DATA / "pool.json", {})
for n in (1, 2):
    title = f"{sys.argv[1]} part {n}"
    iid = hashlib.sha1(title.encode()).hexdigest()[:12]
    pool[iid] = {"id": iid, "title": title, "url": f"https://example.invalid/{iid}", "date": core.now_rome().isoformat(),
                 "text": f"Details about {title}.", "kind": "feed", "source": f"rss:test{n}", "niche": "mixed",
                 "used": False, "harvested": core.now_rome().isoformat()}
core.save_json(core.DATA / "pool.json", pool)
core.save_json(core.DATA / "harvest-state.json", {"last_run": time.time()})
EOF
}
calls() { tr '\n' ' ' < "$FAKE_LOG"; : > "$FAKE_LOG"; }
history_status() { python -c 'import json,sys; print(json.load(open("pipeline/data/history.json"))[-1]["status"])'; }

# A: one post from start to finish, queued, committed and pushed; --once stops with the summary
seed "Webhook retries duplicate payments when idempotency keys are missing"
out="$(bash pipeline/run.sh --once 2>&1)"
slot="$(ls queue 2>/dev/null | head -1)"
[ -n "$slot" ] && [ -f "queue/$slot/post.txt" ] || fail "no queue folder" "$out"
head -2 "queue/$slot/post.txt" | grep -q "^developers using claude code hooks$" || fail "wrong post text" "$(cat "queue/$slot/post.txt")"
node .claude/skills/x-long-form-posts/check.mjs "queue/$slot/post.txt" >/dev/null || fail "queued post breaks the rulebook" "$out"
hhmm="${slot:11:4}"; { [ "$hhmm" -ge 0930 ] && [ "$hhmm" -le 1030 ]; } || { [ "$hhmm" -ge 1330 ] && [ "$hhmm" -le 1430 ]; } || fail "slot $slot outside the windows"
[ "$(git --git-dir="$T/remote.git" log -1 --format=%s main)" = "pipeline: queue 1 post" ] || fail "not pushed" "$out"
printf '%s' "$out" | grep -q "Stopped. This session: 1 posts queued, 0 sent to review/, 0 dropped. 1 auto posts are waiting" || fail "stop summary" "$out"
[ ! -f pipeline/.lock ] || fail "lock left behind"
c="$(calls)"; [ "$c" = "ideate score research expand gate hooks write editor " ] || fail "unexpected call order" "calls: $c"
ok "queued $slot, pushed to the remote, summary printed, lock removed"

# B: the value gate fails twice: one rework, then dropped with the reason
seed "Image CDNs serve stale thumbnails after a cache purge race"
FAKE_GATE_FAIL=1 python pipeline/lib/step.py >/dev/null 2>&1; rc=$?
[ $rc = 10 ] || fail "gate path exit $rc"
c="$(calls)"; [ "$c" = "ideate score research expand gate expand gate " ] || fail "gate rework order" "calls: $c"
[ "$(history_status)" = dropped ] || fail "dropped not recorded"
grep -q '"reason": "value gate: matches an obvious version' pipeline/data/backlog.json || fail "drop reason missing"
ok "gate fail: reworked once, then dropped with the reason in the backlog"

# C: the editor never passes: 3 fix rounds, then NEEDS REVIEW in review/, nothing queued
before="$(ls queue | wc -l)"
seed "Server components leak secrets into client bundles through props"
FAKE_EDITOR_FAIL=1 python pipeline/lib/step.py >/dev/null 2>&1; rc=$?
[ $rc = 11 ] || fail "review path exit $rc"
c="$(calls)"; [ "$c" = "ideate score research expand gate hooks write editor fix editor fix editor fix editor " ] \
  || fail "review path order" "calls: $c"
ls pipeline/review/*.txt >/dev/null 2>&1 || fail "no review file"
head -1 pipeline/review/*.txt | grep -q "NEEDS REVIEW" || fail "review header"
[ "$(ls queue | wc -l)" = "$before" ] || fail "a review post was queued"
ok "editor fail: 3 fix rounds, then review/ with NEEDS REVIEW, not queued"

# D: a call breaks in the write stage; the next step resumes at write without redoing research
: > "$FAKE_LOG"
seed "Feature flags drift between staging and production after manual edits"
FAKE_FAIL_STAGE=write python pipeline/lib/step.py >/dev/null 2>&1; rc=$?
[ $rc = 1 ] || fail "failure exit $rc"
run="$(ls -d pipeline/runs/* | tail -1)"
grep -q '"stage": "write"' "$run/state.json" || fail "state not at write" "$(cat "$run/state.json")"
: > "$FAKE_LOG"
python pipeline/lib/step.py >/dev/null 2>&1; rc=$?
[ $rc = 0 ] || fail "resume exit $rc"
c="$(calls)"; [ "$c" = "hooks write editor " ] || fail "resume redid earlier stages" "calls: $c"
ok "failure in write: error logged, the next step resumed at write and queued the post"

# E: nothing left to scout: the runner waits; Ctrl+C (SIGINT) stops it with the summary
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
printf '%s' "$out" | grep -q "Stopped. This session: 0 posts queued, 0 sent to review/, 0 dropped. 2 auto posts are waiting, scheduled through" \
  || fail "summary after Ctrl+C" "$out"
[ ! -f pipeline/.lock ] || fail "lock left after Ctrl+C"
ok "idle runner stopped by Ctrl+C: $(printf '%s' "$out" | grep Stopped | sed 's/^Stopped. //')"

echo "all $pass passed"
rm -rf "$T"
