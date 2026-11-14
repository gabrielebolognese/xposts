#!/usr/bin/env bash
# The auto post runner: this PC posts everything in queue/ (GitHub only stores the repo) and makes the threads.
# Start it in Git Bash from the x-autopost folder:
#   bash pipeline/run.sh          posts what is due every 30 seconds (the X keys come from .env), searches categories
#                                 for tools, turns the best ones into threads scored for virality, and keeps queue/
#                                 filled with the highest scored ones (3 a day, 4 days ahead) until you press Ctrl+C,
#                                 then prints what it did. Nothing posts while it is stopped.
#   bash pipeline/run.sh --once   stops after one thread (ready or sent to review)
#   bash pipeline/run.sh --posts N  stops once N threads are ready (threads sent to review do not count); it searches
#                                 more categories than the daily 5 when it needs them to reach N (the first fill)
# A stopped run resumes at the stage it was in. Settings: pipeline/config.json. Categories: pipeline/categories.json.
set -u
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
export PYTHONUTF8=1
PY=python
LOCK=pipeline/.lock
once=0
max=0
made=0
case "${1:-}" in
  --once) once=1 ;;
  --posts) max="${2:-}"
           [[ "$max" =~ ^[1-9][0-9]*$ ]] || { echo "Usage: bash pipeline/run.sh --posts N   (N = how many threads to make)"; exit 1; }
           export POSTS_DAY_TARGET="$max" ;;   # step.py searches more categories while fewer threads are ready today
esac

if [ -f "$LOCK" ] && kill -0 "$(cat "$LOCK" 2>/dev/null)" 2>/dev/null; then
  echo "The runner is already running (pid $(cat "$LOCK")). Stop that one first."
  exit 1
fi
echo $$ > "$LOCK"

cfg() {
  $PY -c 'import functools, json, os, sys
c = json.load(open(os.environ.get("POSTS_CONFIG", "pipeline/config.json"), encoding="utf-8"))
print(functools.reduce(lambda d, k: d[k], sys.argv[1].split("."), c))' "$1"
}
idle=$(( $(cfg runner.idle_minutes) * 60 ))
pause=$(( $(cfg runner.error_pause_minutes) * 60 ))

$PY pipeline/lib/summary.py start
[ -f .env ] || [ -n "${POSTS_FAKE_X:-}" ] || echo "WARNING: no .env file in this folder, so nothing can be posted. Create it with the 4 X keys (see README)."
every=$(cfg poster.interval_seconds)
( while :; do $PY pipeline/lib/poster.py; sleep "$every"; done ) &   # the posting loop, independent of the steps
poster=$!

napper=""
nap() { sleep "$1" & napper=$!; wait "$napper"; }   # wait returns at once when Ctrl+C arrives

stop() {
  trap - INT TERM
  kill "$poster" $napper 2>/dev/null
  wait "$poster" 2>/dev/null
  echo
  $PY pipeline/lib/summary.py stop
  rm -f "$LOCK"
  exit 0
}
trap stop INT TERM

echo "Auto post runner started. Press Ctrl+C to stop."
[ "$max" -gt 0 ] && echo "It stops by itself once $max threads are ready."
while :; do
  $PY pipeline/lib/step.py
  rc=$?
  [ "$rc" = 0 ] && made=$((made + 1))
  case $rc in
    0|11) [ "$once" = 1 ] && stop                  # ready (in the virality queue), or sent to review/
          [ "$max" -gt 0 ] && [ "$made" -ge "$max" ] && stop ;;
    10|13) ;;                                       # dropped, or a category searched: go on right away
    12) [ "$once" = 1 ] && stop; nap "$idle" ;;     # nothing to do: wait (searches reset at midnight)
    *) [ "$once" = 1 ] && stop; nap "$pause" ;;     # an error: logged, try again shortly
  esac
done
