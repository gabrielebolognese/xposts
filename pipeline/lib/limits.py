#!/usr/bin/env python
# Copied unchanged from instagramReels/pipeline/lib/limits.py (the BUILD_SPEC.md and DECISIONS.md references point to that project).
"""Usage limit detection and reset-time parsing (BUILD_SPEC.md section 4.1).

A limit message can arrive in stdout, stderr or the JSON result of a claude -p call. This module finds it and
turns its reset time into an epoch, for every format the spec lists:
  time only              "resets 3:45pm", "resets 3pm", "resets 15:45"
  weekday and time       "resets Mon 12:00am", "resets Monday 9am"
  date and time          "resets Nov 3, 10am", "resets November 3 10:30am"
  a timezone in parens   "resets 3pm (Europe/Rome)", "(UTC)", "(America/New_York)"; default: --tz, else the PC's zone
  an epoch after a |     "Claude AI usage limit reached|1793696400" (13 digits are milliseconds)
  relative (extra)       "try again in 2 hours", "resets in 45 minutes"
A parsed moment that is already past rolls over: +1 day (time only), +7 days (weekday), +1 year (date).

Time zones go through Python's zoneinfo, not GNU date: the GNU date shipped with Git Bash has no zoneinfo
database (there is no /usr/share/zoneinfo), so `TZ=Europe/Rome date -d 3pm` silently computes 3pm UTC
(DECISIONS.md, M3). Aware datetime arithmetic keeps the wall clock across a DST change.

Usage:
  limits.py detect [--tz ZONE] [--now EPOCH] [--margin S] (TEXT | --stdin)
      prints JSON {limit, kind, reset, target, parsed, when, zone, message, text}
      exit 0: a limit with a parsed reset time; 2: a limit but nothing parses; 1: no limit in the text
  limits.py parse-when [--tz ZONE] [--now EPOCH] "resets 3:45pm (Europe/Rome)"
      the same, for one phrase (unit tests)
  limits.py fmt EPOCH [--now EPOCH] [--tz ZONE]   "15:47" when it is today, "Mon 00:02" otherwise
  limits.py left EPOCH [--now EPOCH]              "5h41m", "12m", "0m"
Exit 0 on success unless stated. JSON and text on stdout, LF line endings.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import datetime, timedelta, timezone

try:
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
except ImportError:  # pragma: no cover
    ZoneInfo = None  # type: ignore[assignment]
    ZoneInfoNotFoundError = Exception  # type: ignore[assignment,misc]

LIMIT_PATTERNS = [
    r"hit your (?:session |weekly |5[- ]hour |7[- ]day |daily |usage |extra )?(?:usage )?limit",
    r"(?:usage|session|weekly) limit(?: has been)? reached",
    r"\blimit reached\b",
    r"\busage limit\b",
    r"reached your (?:session |weekly |usage )?limit",
    r"out of extra usage",
]
LIMIT_RE = re.compile("|".join(f"(?:{p})" for p in LIMIT_PATTERNS), re.IGNORECASE)
EPOCH_RE = re.compile(r"\|\s*(\d{10}|\d{13})\b")
WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
WHEN_RE = re.compile(
    r"resets?(?:\s+at|\s+on)?\s+"
    r"(?:(?P<wd>mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+)?"
    r"(?:(?P<mon>jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(?P<day>\d{1,2})(?:st|nd|rd|th)?,?\s+(?:at\s+)?)?"
    r"(?P<h>\d{1,2})(?::(?P<m>\d{2}))?\s*(?P<ap>[ap]\.?m\.?)?"
    r"(?:\s*\((?P<tz>[^)]{2,40})\))?",
    re.IGNORECASE,
)
RELATIVE_RE = re.compile(
    r"(?:try again|resets?|available|back)\s+in\s+(?:about\s+|~\s*)?(?P<n>\d+)\s*(?P<unit>hours?|hrs?|h|minutes?|mins?|m)\b",
    re.IGNORECASE,
)
ZONE_ALIASES = {
    "utc": "UTC", "gmt": "UTC", "z": "UTC",
    "cet": "Europe/Rome", "cest": "Europe/Rome", "rome": "Europe/Rome", "italy": "Europe/Rome",
    "bst": "Europe/London", "london": "Europe/London",
    "est": "America/New_York", "edt": "America/New_York", "et": "America/New_York",
    "cst": "America/Chicago", "cdt": "America/Chicago", "ct": "America/Chicago",
    "mst": "America/Denver", "mdt": "America/Denver", "mt": "America/Denver",
    "pst": "America/Los_Angeles", "pdt": "America/Los_Angeles", "pt": "America/Los_Angeles",
    "jst": "Asia/Tokyo", "ist": "Asia/Kolkata", "aest": "Australia/Sydney", "aedt": "Australia/Sydney",
}


def setup_streams() -> None:
    for stream in (sys.stdout, sys.stderr):  # Windows Python writes CRLF to pipes otherwise
        try:
            stream.reconfigure(encoding="utf-8", newline="\n")
        except (AttributeError, ValueError):
            pass


WINDOWS_ZONES = {  # the PC's zone name as the C runtime reports it -> an IANA zone with the same rules
    "w. europe standard time": "Europe/Rome", "w. europe daylight time": "Europe/Rome",
    "central europe standard time": "Europe/Rome", "central european standard time": "Europe/Rome",
    "romance standard time": "Europe/Paris", "gmt standard time": "Europe/London",
    "greenwich standard time": "UTC", "utc": "UTC", "coordinated universal time": "UTC",
    "eastern standard time": "America/New_York", "eastern daylight time": "America/New_York",
    "central standard time": "America/Chicago", "mountain standard time": "America/Denver",
    "pacific standard time": "America/Los_Angeles", "pacific daylight time": "America/Los_Angeles",
}


def local_zone():
    """The PC's zone as a rule-based zoneinfo when its name is known (a fixed offset would be wrong across a DST
    change); otherwise the fixed offset the C runtime reports now."""
    name = (time.tzname[0] or "").lower() if time.tzname else ""
    iana = WINDOWS_ZONES.get(name)
    if iana and ZoneInfo is not None:
        try:
            return ZoneInfo(iana)
        except (ZoneInfoNotFoundError, ValueError, OSError):
            pass
    return datetime.now().astimezone().tzinfo or timezone.utc


def zone_for(name: str | None, fallback):
    """The tzinfo for a zone name (IANA, UTC or a common abbreviation); the fallback when unknown or empty."""
    if not name:
        return fallback, False
    key = name.strip()
    if not key:
        return fallback, False
    candidates = [key, key.replace(" ", "_"), ZONE_ALIASES.get(key.lower(), "")]
    for cand in candidates:
        if not cand or ZoneInfo is None:
            continue
        try:
            return ZoneInfo(cand), True
        except (ZoneInfoNotFoundError, ValueError, OSError):
            continue
    return fallback, False


def limit_line(text: str) -> str | None:
    """The line of the text that mentions a usage limit, or None."""
    for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if LIMIT_RE.search(line):
            return line.strip()
    return None


def limit_kind(line: str) -> str:
    low = line.lower()
    if "weekly" in low or "7-day" in low or "7 day" in low or "week" in low:
        return "weekly"
    if "session" in low or "5-hour" in low or "5 hour" in low:
        return "session"
    return "usage"


def parse_when(phrase: str, now: datetime, default_zone):
    """Parse the reset moment out of a phrase. Returns (reset datetime or None, how, zone name, note)."""
    m = EPOCH_RE.search(phrase)
    if m:
        value = int(m.group(1))
        if value > 10**12:
            value //= 1000
        return datetime.fromtimestamp(value, tz=timezone.utc), "epoch", "UTC", ""
    m = WHEN_RE.search(phrase)
    if m:
        zone, known = zone_for(m.group("tz"), default_zone)
        note = "" if known or not m.group("tz") else f"unknown zone ({m.group('tz')}), using {zone_name(default_zone)}"
        hour = int(m.group("h"))
        minute = int(m.group("m") or 0)
        ap = (m.group("ap") or "").lower().replace(".", "")
        if ap == "pm" and hour < 12:
            hour += 12
        elif ap == "am" and hour == 12:
            hour = 0
        if hour > 23 or minute > 59:
            return None, "", zone_name(zone), "hour or minute out of range"
        if not ap and not m.group("m"):
            return None, "", zone_name(zone), "a bare number without am/pm or minutes"
        local_now = now.astimezone(zone)
        if m.group("mon"):
            month = MONTHS.index(m.group("mon").lower()[:3]) + 1
            day = int(m.group("day"))
            try:
                reset = datetime(local_now.year, month, day, hour, minute, tzinfo=zone)
            except ValueError:
                return None, "", zone_name(zone), "invalid date"
            if reset <= local_now:
                try:
                    reset = reset.replace(year=reset.year + 1)
                except ValueError:
                    reset = reset + timedelta(days=365)
            return reset, "date", zone_name(zone), note
        if m.group("wd"):
            wanted = WEEKDAYS.index(m.group("wd").lower()[:3])
            ahead = (wanted - local_now.weekday()) % 7
            base = local_now.replace(hour=hour, minute=minute, second=0, microsecond=0) + timedelta(days=ahead)
            if base <= local_now:
                base = base + timedelta(days=7)
            return base, "weekday", zone_name(zone), note
        reset = local_now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if reset <= local_now:
            reset = reset + timedelta(days=1)
        return reset, "time", zone_name(zone), note
    m = RELATIVE_RE.search(phrase)
    if m:
        n = int(m.group("n"))
        unit = m.group("unit").lower()
        seconds = n * 3600 if unit.startswith("h") else n * 60
        return now + timedelta(seconds=seconds), "relative", zone_name(default_zone), ""
    return None, "", zone_name(default_zone), "no reset time found"


def zone_name(zone) -> str:
    key = getattr(zone, "key", None)
    if key:
        return key
    try:
        return str(zone.tzname(datetime.now(zone)))
    except Exception:  # pragma: no cover
        return str(zone)


def detect(text: str, now: datetime, default_zone, margin: int) -> dict:
    line = limit_line(text)
    if line is None:
        return {"limit": False}
    reset, how, zone, note = parse_when(line, now, default_zone)
    if reset is None:
        # the time may sit on another line (a JSON result split over lines); try the whole text once
        reset, how, zone, note = parse_when(text, now, default_zone)
    out = {
        "limit": True,
        "kind": limit_kind(line),
        "message": line[:300],
        "parsed": how or None,
        "zone": zone,
        "note": note,
    }
    if reset is None:
        out.update({"reset": None, "target": None, "when": None})
        return out
    epoch = int(reset.timestamp())
    out.update({
        "reset": epoch,
        "reset_iso": datetime.fromtimestamp(epoch).strftime("%Y-%m-%d %H:%M"),
        "target": epoch + margin,
        "target_iso": datetime.fromtimestamp(epoch + margin).strftime("%Y-%m-%d %H:%M:%S"),
        "when": fmt_when(epoch, int(now.timestamp())),
        "left": fmt_left(epoch + margin - int(now.timestamp())),
    })
    return out


def fmt_when(epoch: int, now: int) -> str:
    """15:47 when it is today (local time), Mon 00:02 otherwise, Nov 3 10:00 when more than 6 days away."""
    dt = datetime.fromtimestamp(epoch)
    today = datetime.fromtimestamp(now)
    if dt.date() == today.date():
        return dt.strftime("%H:%M")
    if (dt.date() - today.date()).days < 7:
        return dt.strftime("%a %H:%M")
    return dt.strftime("%b %d %H:%M").replace(" 0", " ")


def fmt_left(seconds: int) -> str:
    seconds = max(0, int(seconds))
    hours, rem = divmod(seconds, 3600)
    minutes = rem // 60
    if hours > 0:
        return f"{hours}h{minutes:02d}m"
    return f"{minutes}m"


def main(argv=None) -> int:
    setup_streams()
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)

    def common(sp):
        sp.add_argument("--tz", default="", help="default zone for times without one (default: the PC's zone)")
        sp.add_argument("--now", type=int, default=None, help="the current epoch (tests)")

    sp = sub.add_parser("detect"); common(sp)
    sp.add_argument("--margin", type=int, default=120)
    sp.add_argument("--stdin", action="store_true")
    sp.add_argument("text", nargs="?", default="")
    sp = sub.add_parser("parse-when"); common(sp)
    sp.add_argument("--margin", type=int, default=120)
    sp.add_argument("phrase")
    sp = sub.add_parser("fmt"); common(sp); sp.add_argument("epoch", type=int)
    sp = sub.add_parser("left"); common(sp); sp.add_argument("epoch", type=int)
    args = parser.parse_args(argv)

    now_epoch = args.now if args.now is not None else int(time.time())
    default_zone, _ = zone_for(args.tz, local_zone())
    now = datetime.fromtimestamp(now_epoch, tz=timezone.utc)

    if args.cmd == "fmt":
        print(fmt_when(args.epoch, now_epoch))
        return 0
    if args.cmd == "left":
        print(fmt_left(args.epoch - now_epoch))
        return 0
    if args.cmd == "parse-when":
        text = args.phrase
        if not LIMIT_RE.search(text):
            text = "You've hit your limit " + text
    else:
        text = sys.stdin.buffer.read().decode("utf-8", "replace") if args.stdin else args.text
    out = detect(text, now, default_zone, args.margin)
    print(json.dumps(out, ensure_ascii=False))
    if not out.get("limit"):
        return 1
    return 0 if out.get("reset") is not None else 2


if __name__ == "__main__":
    sys.exit(main())
