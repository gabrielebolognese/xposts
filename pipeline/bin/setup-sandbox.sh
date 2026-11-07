#!/usr/bin/env bash
# Create the public sandbox repo (once) and upload pipeline/sandbox/check.yml to it. Safe to run again: it only
# updates the workflow when it changed. The repo name comes from pipeline/config.json (sandbox_repo).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GH="$(command -v gh || echo "/c/Program Files/GitHub CLI/gh.exe")"
REPO="$(python -c 'import json,sys; print(json.load(open(sys.argv[1]))["sandbox_repo"])' "$HERE/../config.json")"
FILE=.github/workflows/check.yml
if ! "$GH" repo view "$REPO" --json name >/dev/null 2>&1; then
  "$GH" repo create "$REPO" --public --add-readme \
    --description "Throwaway sandbox for hands-on checks of an auto post pipeline. No secrets."
fi
content="$(base64 -w0 "$HERE/../sandbox/check.yml")"
sha="$("$GH" api "repos/$REPO/contents/$FILE" --jq .sha 2>/dev/null || true)"
current="$("$GH" api "repos/$REPO/contents/$FILE" --jq .content 2>/dev/null | tr -d '\n' || true)"
if [ "$current" = "$content" ]; then echo "setup-sandbox: $REPO is up to date"; exit 0; fi
"$GH" api -X PUT "repos/$REPO/contents/$FILE" -f message="check workflow" -f content="$content" \
  ${sha:+-f sha="$sha"} --jq .commit.sha >/dev/null
echo "setup-sandbox: $REPO ready (https://github.com/$REPO)"
