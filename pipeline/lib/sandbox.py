"""Run a hands-on check script in the public sandbox repo (a fresh GitHub VM with no secrets) and read its log.

run(script, out_base) dispatches .github/workflows/check.yml of config sandbox_repo with the script base64 encoded,
finds the run by its title ("check <id>"), waits for it, and saves the log to <out_base>.log.
Returns {"ok", "conclusion", "url", "log"} where log is the check step's output, cut to the last 6000 characters.
POSTS_SANDBOX_FAKE=1 (tests) returns a passing result without calling GitHub.
"""
from __future__ import annotations

import base64
import json
import os
import re
import subprocess
import sys
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import core  # noqa: E402


def gh(*args: str, timeout: int = 120) -> str:
    p = subprocess.run([core.gh(), *args], capture_output=True, timeout=timeout)
    if p.returncode:
        raise RuntimeError(f"gh {args[0]} {args[1] if len(args) > 1 else ''}: "
                           + p.stderr.decode("utf-8", "replace").strip()[:300])
    return p.stdout.decode("utf-8", "replace")


def step_output(raw: str) -> str:
    """Keep the 'run check' step: gh prints "job<TAB>step<TAB>timestamp text" per line."""
    lines = []
    for line in raw.splitlines():
        parts = line.split("\t", 2)
        if len(parts) == 3 and "run check" in parts[1]:
            lines.append(re.sub(r"^\S+Z ", "", parts[2]))
    text = re.sub(r"\x1b\[[0-9;]*m", "", "\n".join(lines) or raw)
    return text.split("##[endgroup]", 1)[-1].strip("\n")  # drop the step header that echoes the encoded script


def run(script: str, out_base: Path) -> dict:
    if os.environ.get("POSTS_SANDBOX_FAKE"):
        result = {"ok": True, "conclusion": "success", "url": "https://example.invalid/run", "log": "+ echo fake\nfake ok"}
        core.write_text(out_base.with_suffix(".log"), result["log"])
        return result
    repo = core.cfg("sandbox_repo")
    rid = uuid.uuid4().hex[:10]
    encoded = base64.b64encode(script.encode("utf-8")).decode()
    if len(encoded) > 60000:
        return {"ok": False, "conclusion": "too long", "url": "", "log": "the script is over the 60 KB dispatch limit"}
    gh("workflow", "run", "check.yml", "-R", repo, "-f", f"id={rid}", "-f", f"script={encoded}")
    run_id = url = None
    for _ in range(40):  # the run shows up a few seconds after the dispatch
        time.sleep(3)
        rows = json.loads(gh("run", "list", "-R", repo, "--workflow", "check.yml", "-L", "20",
                             "--json", "databaseId,displayTitle,url"))
        hit = next((r for r in rows if r["displayTitle"] == f"check {rid}"), None)
        if hit:
            run_id, url = str(hit["databaseId"]), hit["url"]
            break
    if not run_id:
        return {"ok": False, "conclusion": "not started", "url": "", "log": "the sandbox run never appeared"}
    deadline = time.time() + core.cfg("timeouts.sandbox_seconds", 1200)
    status = {}
    while time.time() < deadline:
        time.sleep(10)
        status = json.loads(gh("run", "view", run_id, "-R", repo, "--json", "status,conclusion"))
        if status["status"] == "completed":
            break
    if status.get("status") != "completed":
        return {"ok": False, "conclusion": "timed out", "url": url, "log": "the sandbox run did not finish in time"}
    try:
        log = step_output(gh("run", "view", run_id, "-R", repo, "--log", timeout=180))
    except RuntimeError as exc:
        log = f"(log unavailable: {exc})"
    log = core.undash(log)[-6000:]
    core.write_text(out_base.with_suffix(".log"), f"{url}\n\n{log}")
    return {"ok": status["conclusion"] == "success", "conclusion": status["conclusion"], "url": url, "log": log}


if __name__ == "__main__":  # python pipeline/lib/sandbox.py: a trivial live check
    res = run("set -euo pipefail\nnode -v\npython3 --version\necho ok\n", core.LOGS / "sandbox-selftest")
    print(json.dumps(res, indent=1))
