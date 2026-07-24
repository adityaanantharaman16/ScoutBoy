"""Calibration CLI.

    python -m evaluation fixtures      # deterministic; no DB writes, no network
    python -m evaluation pilot         # read-only real-pilot evaluation
    python -m evaluation all           # both suites in one report

Options:
    --format json|markdown   output format (default: json)
    --output PATH            write to a file instead of stdout
    --fail-on-fail           exit non-zero when the calibration gate is blocked: any FAIL, or any
                             *unexpected* inconclusive (an inconclusive-allowed pilot absence stays
                             non-blocking). An unexpected inconclusive never returns a green gate.

Fixture and pilot outputs are deterministic; running fixtures twice yields byte-identical JSON.
"""

from __future__ import annotations

import argparse
import sys

from .database_evaluator import evaluate_pilot
from .evaluator import evaluate_fixtures
from .reporting import render_json, render_markdown


def _combined() -> dict:
    fixtures = evaluate_fixtures()
    pilot = evaluate_pilot()
    combined = dict(fixtures)
    combined["suite"] = "all"
    combined["pilot"] = pilot
    # overall status folds the fixture verdict with pilot fails (pilot inconclusive is expected)
    statuses = [fixtures["overall_status"]]
    if pilot["totals"]["fail"]:
        statuses.append("fail")
    order = {"pass": 0, "inconclusive": 1, "warn": 2, "fail": 3}
    combined["overall_status"] = max(statuses, key=lambda s: order[s])
    # gate folds the fixture gate with any pilot fail (an inconclusive pilot is expected/allowed)
    combined["gate_passed"] = bool(fixtures.get("gate_passed")) and not pilot["totals"]["fail"]
    return combined


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="evaluation", description="ScoutBoy RoleFit calibration")
    parser.add_argument("suite", choices=["fixtures", "pilot", "all"])
    parser.add_argument("--format", choices=["json", "markdown"], default="json")
    parser.add_argument("--output")
    parser.add_argument("--fail-on-fail", action="store_true")
    args = parser.parse_args(argv)

    if args.suite == "fixtures":
        result = evaluate_fixtures()
    elif args.suite == "pilot":
        result = evaluate_pilot()
    else:
        result = _combined()

    text = render_json(result) if args.format == "json" else render_markdown(result)
    if args.output:
        with open(args.output, "w") as f:
            f.write(text)
    else:
        sys.stdout.write(text)

    if args.fail_on_fail:
        if args.suite == "pilot":
            # a pilot FAIL blocks; an (allowed) inconclusive pilot does not
            return 1 if result.get("totals", {}).get("fail") else 0
        # fixtures / all: block on any unexpected inconclusive or fail via the operational gate
        return 0 if result.get("gate_passed", False) else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
