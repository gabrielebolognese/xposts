"""Every model call goes through call(): claude -p with a JSON schema, logged, classified, retried.

Mirrors instagramReels/pipeline/lib/ai.sh: model and effort per role from config.json, the prompt on stdin,
--output-format json, --permission-mode auto --permission-prompts none, the structured output validated with
jsonschema and one retry in the same session when it does not match. Failures are classified by errors.py (copied
from the reels project): a usage limit waits for the reset, a temporary error backs off, anything else raises.

Calls run in a neutral folder outside every git repo, so no project memory or CLAUDE.md leaks into a prompt, and
the models get only the tools named per call (no Bash, no file tools): they answer with JSON and code does the rest.
Each call leaves calls/NNN-name.{prompt.md,json,err,meta} in the stage folder.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import core  # noqa: E402
import errors  # noqa: E402


class AIError(Exception):
    pass


def claude_cmd() -> list[str]:
    fake = os.environ.get("POSTS_CLAUDE")  # tests: a python script that answers from fixtures
    if fake:
        return [sys.executable, fake]
    shim = shutil.which("claude")
    if shim:  # the npm shim is a .CMD file; cmd.exe would mangle the JSON schema argument, so call the exe itself
        exe = Path(shim).parent / "node_modules" / "@anthropic-ai" / "claude-code" / "bin" / "claude.exe"
        if exe.exists():
            return [str(exe)]
        return [shim]
    return ["claude"]


def workdir() -> str:
    d = Path(tempfile.gettempdir()) / "xposts-pipeline"
    d.mkdir(exist_ok=True)
    return str(d)


def next_number(calls: Path) -> str:
    nums = [int(p.name[:3]) for p in calls.glob("[0-9][0-9][0-9]*.json") if p.name[:3].isdigit()]
    return f"{max(nums, default=0) + 1:03d}"


def schema_errors(schema: dict, data) -> list[str]:
    import jsonschema
    v = jsonschema.validators.validator_for(schema)(schema)
    return [f"{'/'.join(map(str, e.absolute_path)) or '$'}: {e.message}" for e in v.iter_errors(data)][:8]


def call(role: str, stage_dir: Path, name: str, prompt: str, schema: str | None = None,
         tools: list[str] | None = None, timeout: int | None = None):
    """Run one model call. Returns the structured output (schema given) or the result text. Raises AIError."""
    calls = Path(stage_dir) / "calls"
    calls.mkdir(parents=True, exist_ok=True)
    model = core.cfg(f"models.{role}.model")
    effort = core.cfg(f"models.{role}.effort", "medium")
    timeout = timeout or core.cfg("timeouts.call_seconds", 1800)
    schema_obj = None
    if schema:
        schema_obj = core.load_json(core.PIPE / "schemas" / f"{schema}.json")
        cli_schema = {k: v for k, v in schema_obj.items() if k not in ("$schema", "$id")}
    tools = tools or []
    resume, schema_retry, tries = None, False, 0
    backoff = core.cfg("retries.transient_backoff_seconds", [60, 240, 960])
    margin = core.cfg("retries.limit_margin_seconds", 120)
    fallback = core.cfg("models.limit_fallback.model", "opus")
    text = prompt
    while True:
        base = calls / f"{next_number(calls)}-{name}"
        core.write_text(base.with_suffix(".prompt.md"), text)
        cmd = claude_cmd() + ["-p", "--model", model, "--effort", effort, "--output-format", "json",
                              "--permission-mode", "auto", "--permission-prompts", "none",
                              "--tools", ",".join(tools)]
        if tools:
            cmd += ["--allowedTools", *tools]
        cmd += ["--disallowedTools", "Bash", "Edit", "Write", "Read(.env)", "Read(.env.*)"]
        if resume:
            cmd += ["--resume", resume]
        if schema_obj:
            cmd += ["--json-schema", json.dumps(cli_schema, ensure_ascii=False, separators=(",", ":"))]
        started = time.time()
        try:
            p = subprocess.run(cmd, input=text.encode("utf-8"), capture_output=True, timeout=timeout, cwd=workdir())
            rc, out, err = p.returncode, p.stdout.decode("utf-8", "replace"), p.stderr.decode("utf-8", "replace")
        except subprocess.TimeoutExpired:
            rc, out, err = 124, "", f"timed out after {timeout} s"
        core.write_text(base.with_suffix(".json"), out)
        core.write_text(base.with_suffix(".err"), err)
        cls = errors.classify(rc, out, err, "Europe/Rome", int(time.time()), margin)
        core.write_text(base.with_suffix(".meta"), f"role: {role}\nmodel: {model}\neffort: {effort}\nrc: {rc}\n"
                        f"seconds: {time.time() - started:.0f}\nclass: {cls['class']}\nmessage: {cls['message']}\n")
        kind, message = cls["class"], cls["message"]
        if kind in ("error", "transient") and model != fallback and re.search(
                r"reached your [a-z0-9 ._-]+ limit|switch to another model", message, re.I):
            core.say("WARN", f"{role}: {model} is at its own usage limit, carrying on with {fallback}")
            model, effort = fallback, core.cfg("models.limit_fallback.effort", effort)
            continue
        if kind == "ok":
            data = json.loads(out)
            if not schema_obj:
                return data.get("result") or ""
            result = data.get("structured_output")
            if result is None:
                try:
                    result = json.loads(data.get("result") or "")
                except ValueError:
                    result = None
            errs = ["no JSON object in the answer"] if result is None else schema_errors(schema_obj, result)
            if not errs:
                core.save_json(base.with_suffix(".out.json"), result)
                return result
            if not schema_retry and cls.get("session_id"):
                schema_retry, resume = True, cls["session_id"]
                text = ("Your previous answer did not match the required JSON schema:\n" + "\n".join(errs)
                        + "\n\nAnswer again with only the JSON object that matches the schema, nothing else.")
                core.say("WARN", f"{role}: output did not match the schema, asking once more")
                continue
            raise AIError(f"{role}: output did not match the schema after one retry: {errs[0]}")
        if kind == "limit":
            lim = cls.get("limit") or {}
            target = lim.get("target")
            wait = max(60, target - time.time()) if target else 1800
            core.say("LIMIT", f"usage limit ({lim.get('kind', 'usage')}), waiting until "
                     f"{time.strftime('%H:%M', time.localtime(time.time() + wait))}")
            time.sleep(wait)
            continue
        if kind == "transient" and tries < len(backoff):
            delay = max(backoff[tries], int(cls.get("retry_after") or 0))
            tries += 1
            core.say("RETRY", f"{role}: temporary error ({cls.get('detail')}), retrying in {delay} s")
            time.sleep(delay)
            continue
        raise AIError(f"{role}: {message or kind} (call {base.name})")
