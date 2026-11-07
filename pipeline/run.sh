#!/usr/bin/env bash
# The auto post runner. Start it in Git Bash from the x-autopost folder:
#   bash pipeline/run.sh          makes posts and adds them to the queue until you press Ctrl+C,
#                                 then prints how many it made and how far ahead the queue reaches
#   bash pipeline/run.sh --once   stops after one post (queued or sent to review)
# A stopped run resumes at the stage it was in. Settings: pipeline/config.json. Sources: pipeline/sources.txt.
set -u
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
export PYTHONUTF8=1
PY=python
LOCK=pipeline/.lock
once=0
[ "${1:-}" = "--once" ] && once=1

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
( while :; do $PY pipeline/lib/dispatch.py; sleep 60; done ) &
dispatcher=$!

napper=""
nap() { sleep "$1" & napper=$!; wait "$napper"; }   # wait returns at once when Ctrl+C arrives

stop() {
  trap - INT TERM
  kill "$dispatcher" $napper 2>/dev/null
  wait "$dispatcher" 2>/dev/null
  echo
  $PY pipeline/lib/summary.py stop
  rm -f "$LOCK"
  exit 0
}
trap stop INT TERM

echo "Auto post runner started. Press Ctrl+C to stop."
while :; do
  $PY pipeline/lib/step.py
  rc=$?
  case $rc in
    0|11) [ "$once" = 1 ] && stop ;;               # queued, or sent to review/
    10) ;;                                          # dropped: next idea right away
    12) [ "$once" = 1 ] && stop; nap "$idle" ;;     # nothing passed: wait for new items
    *) [ "$once" = 1 ] && stop; nap "$pause" ;;     # an error: logged, try again shortly
  esac
done
