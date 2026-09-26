"""Independent cross-check of the P0 report's headline source counts.

Deliberately does NOT reuse p0_analysis.py code paths: it re-hashes the pinned files,
counts events by scanning raw decompressed bytes for event ``"id"`` keys and distinct
``"matchId"`` values with a regular expression (no JSON parser), loads matches with the
stdlib JSON parser, and compares every league total with both the report and S1.

    python scripts/wyscout_p0/verify_counts.py --raw data/raw/wyscout \\
        --report data/reports/wyscout_p0_feasibility.json

Exit 0 only if every comparison matches.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path
from typing import Optional

S1 = {  # Pappalardo et al. 2019, Table 1 (publication claims, not measurements)
    "England": (380, 643150),
    "Spain": (380, 628659),
    "Italy": (380, 647372),
    "Germany": (306, 519407),
    "France": (380, 632807),
}
EVENT_KEY = re.compile(rb'"eventSec":\s*')
MATCH_KEY = re.compile(rb'"matchId":\s*(\d+)')


def scan_events(zf: zipfile.ZipFile, name: str, chunk: int = 1 << 22) -> tuple[int, set]:
    """Count keys whose match STARTS before the carry-over boundary, then carry the last
    64 bytes forward, so a key split across two reads is counted exactly once."""
    count, matches, tail = 0, set(), b""
    with zf.open(name) as fh:
        while True:
            block = fh.read(chunk)
            data = tail + block
            cut = len(data) if not block else max(0, len(data) - 64)
            count += sum(1 for m in EVENT_KEY.finditer(data) if m.start() < cut)
            matches.update(int(m.group(1)) for m in MATCH_KEY.finditer(data) if m.start() < cut)
            if not block:
                break
            tail = data[cut:]
    return count, matches


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Independent Wyscout P0 count verifier")
    ap.add_argument("--raw", default="data/raw/wyscout")
    ap.add_argument("--report", required=True)
    args = ap.parse_args(argv)
    raw = Path(args.raw)
    report = json.loads(Path(args.report).read_text(encoding="utf-8"))
    failures = []
    for f in report["inputs"]["files"]:
        digest = hashlib.sha256((raw / f["name"]).read_bytes()).hexdigest()
        ok = digest == f["sha256"]
        print(f"sha256 {f['name']}: {'ok' if ok else 'MISMATCH'}")
        if not ok:
            failures.append(f"sha256:{f['name']}")
    ez = zipfile.ZipFile(raw / "events.zip")
    mz = zipfile.ZipFile(raw / "matches.zip")
    tot_m = tot_e = 0
    for stem, (s1_m, s1_e) in S1.items():
        matches = json.loads(mz.read(f"matches_{stem}.json"))
        match_ids = {int(m["wyId"]) for m in matches}
        n_events, event_match_ids = scan_events(ez, f"events_{stem}.json")
        rep = report["leagues"][stem]
        checks = {
            "matches==S1": len(matches) == s1_m,
            "events==S1": n_events == s1_e,
            "matches==report": len(matches) == rep["match_records"],
            "events==report": n_events == rep["event_records"],
            "event_match_ids==match_ids": event_match_ids == match_ids,
        }
        tot_m += len(matches)
        tot_e += n_events
        print(stem, len(matches), n_events, checks)
        failures += [f"{stem}:{k}" for k, v in checks.items() if not v]
    print("domestic totals", tot_m, tot_e, "(S1 sum 1826 / 3071395)")
    if (tot_m, tot_e) != (1826, 3071395):
        failures.append("totals")
    print("FAILURES:", failures if failures else "none")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
