"""A stand-in for `claude -p` in tests (POSTS_CLAUDE points here). It reads the prompt on stdin, finds its
"# Stage: <name>" line and answers like the real CLI with --output-format json, taking structured_output from
fixtures.json. Environment switches: FAKE_LOG (append each stage name), FAKE_GATE_FAIL, FAKE_EDITOR_FAIL,
FAKE_FAIL_STAGE=<stage> (that stage fails like a broken call).
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

fx = json.loads((Path(__file__).parent / "fixtures.json").read_text(encoding="utf-8"))
out = fx.get(stage, {})
if stage == "ideate":  # the source ids must be real pool ids from the prompt
    ids = re.findall(r'"id": "([0-9a-f]{12})"', prompt)
    title = (re.findall(r'"title": "([^"]+)"', prompt) or ["untitled item"])[0]
    for c in out["candidates"]:
        c["source_ids"] = ids[:2]
    first = out["candidates"][0]  # a distinct idea per test scenario: novelty and the tool cooldown never block it
    first.update(problem=f"{title}.", takeaway=f"{title}, solved.", audience=f"{title.split()[0].lower()} users",
                 tool=title.split()[0].lower())
if stage == "gate" and os.environ.get("FAKE_GATE_FAIL"):
    out["matches_obvious"] = True
if stage == "editor" and os.environ.get("FAKE_EDITOR_FAIL"):
    out["issues"] = [{"kind": "deletion", "quote": "Treat a hook like production code.", "fix": "cut it", "blocking": True}]
print(json.dumps({"type": "result", "subtype": "success", "is_error": False, "duration_ms": 5, "num_turns": 1,
                  "result": json.dumps(out), "session_id": "fake-session", "structured_output": out}))
