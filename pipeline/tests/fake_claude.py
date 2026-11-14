"""A stand-in for `claude -p` in tests (POSTS_CLAUDE points here). It reads the prompt on stdin, finds its
"# Stage: <name>" line and answers like the real CLI with --output-format json, taking structured_output from
fixtures.json, where {NAME} and {REPO} become the tool the prompt is about. Environment switches: FAKE_LOG (append
each stage name), FAKE_TOOL (the name a category search finds), FAKE_EDITOR_FAIL, FAKE_VIRAL=<score> (the virality
evaluation lands near that final score instead of 85), FAKE_FAIL_STAGE=<stage> (that stage fails like a broken call).
"""
import json
import os
import re
import sys
from pathlib import Path

prompt = sys.stdin.buffer.read().decode("utf-8")
m = re.search(r"^# Stage: (\w+)", prompt, re.M)
stage = m.group(1) if m else ("retry" if "did not match the required JSON schema" in prompt else "unknown")
if os.environ.get("FAKE_LOG"):
    with open(os.environ["FAKE_LOG"], "ab") as f:  # bytes: no CRLF translation on Windows
        f.write(stage.encode() + b"\n")
if os.environ.get("FAKE_FAIL_STAGE") == stage:
    print(json.dumps({"type": "result", "subtype": "error_during_execution", "is_error": True,
                      "result": "boom: simulated failure", "session_id": "fake"}))
    sys.exit(1)


def found(pattern: str, default: str) -> str:
    hit = re.search(pattern, prompt, re.M)
    return hit.group(1) if hit else default


if stage == "discover":  # a new tool per category, unless FAKE_TOOL names one
    name = os.environ.get("FAKE_TOOL") or found(r"^Your category for this search: (.+?) \(group", "Some") + " Tool"
elif stage == "analyze":
    name = found(r'"name": "([^"]+)"', "Some Tool")
else:
    name = found(r'"project_name": "([^"]+)"', "Some Tool")
repo = "fakeorg/" + re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")

fx = json.loads((Path(__file__).parent / "fixtures.json").read_text(encoding="utf-8"))
text = json.dumps(fx.get(stage, {}), ensure_ascii=False).replace("{NAME}", name).replace("{REPO}", repo)
out = json.loads(text)
if stage == "virality" and os.environ.get("FAKE_VIRAL"):  # scale the 85 point fixture to the wanted score
    want = int(os.environ["FAKE_VIRAL"])
    top = {"financial": 20, "brand": 15, "hook": 20, "curiosity": 10, "problem": 10, "shareability": 10, "audience": 5,
           "delivery": 5, "combination": 8, "recognition": 3, "novelty": 3}
    for group in ("criteria", "bonuses"):
        out[group] = {k: min(top[k], round(v * want / 85)) for k, v in out[group].items()}
    out["hook_score"] = want
if stage == "editor" and os.environ.get("FAKE_EDITOR_FAIL"):  # the same issue every round, still open on re-checks
    out["issues"] = [{"kind": "claims_supported", "quote": "It is MIT licensed", "fix": "cite the license",
                      "blocking": True, "earlier": "This is a re-check" in prompt}]
print(json.dumps({"type": "result", "subtype": "success", "is_error": False, "duration_ms": 5, "num_turns": 1,
                  "result": json.dumps(out), "session_id": "fake-session", "structured_output": out}))
