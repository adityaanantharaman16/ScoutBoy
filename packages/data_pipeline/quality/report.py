"""Data-quality report CLI.

    python -m data_pipeline.quality.report [--source sample]

Re-runs bundle checks against a source and DB-level checks (rating outliers) against the
current database, prints a summary, and stores a DataQualityReport row.
"""

from __future__ import annotations

import argparse
import sys

from app.core.db import SessionLocal
from app.models.orm import DataQualityReport, RoleRating
from sqlalchemy import select

from ..adapters import get_adapter
from .checks import run_bundle_checks, run_rating_outlier_check


def build_report(source: str = "sample") -> dict:
    bundle = get_adapter(source).fetch()
    report = run_bundle_checks(bundle)

    with SessionLocal() as session:
        scores = list(session.scalars(select(RoleRating.final_score)))
        report["findings"].append(run_rating_outlier_check(scores))
        report["has_errors"] = report["has_errors"] or any(
            f["severity"] == "error" and f["count"] for f in report["findings"]
        )
        session.add(DataQualityReport(source_name=source, run_id=None, report_json=report))
        session.commit()
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="ScoutBoy data-quality report")
    parser.add_argument("--source", default="sample")
    args = parser.parse_args(argv)

    report = build_report(args.source)
    print(
        f"Data-quality report for source='{args.source}' "
        f"({report['player_count']} players, {report['metric_rows']} metric rows):"
    )
    for f in report["findings"]:
        flag = "OK " if f["count"] == 0 or f["severity"] == "ok" else f["severity"].upper()
        print(
            f"  [{flag:5}] {f['check']}: {f['count']}"
            + (f" -> {f['details']}" if f["count"] and f["details"] else "")
        )
    print("ERRORS PRESENT" if report["has_errors"] else "No blocking errors.")
    return 1 if report["has_errors"] else 0


if __name__ == "__main__":
    sys.exit(main())
