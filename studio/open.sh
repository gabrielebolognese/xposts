#!/usr/bin/env bash
# Opens a Claude Studio project in the browser, live, with the real numbers of this PC. Ctrl+C stops it.
#   bash studio/open.sh               the latest project
#   bash studio/open.sh 2026-11-16    a given one
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
p="${1:-$(ls studio/projects 2>/dev/null | grep -v '^_' | tail -1)}"
node studio/tools/server.mjs "$p"
