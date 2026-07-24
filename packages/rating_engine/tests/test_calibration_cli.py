"""Milestone 6 — CLI, reporting, and read-only pilot completeness coverage.

These exercise the calibration CLI (json/markdown/file output, gate-aware --fail-on-fail, all
suites), the Markdown renderer's benchmark/scenario/pilot/limitations sections, the lazy package
re-exports, and the read-only pilot resolver's pass / fail / inconclusive branches — including the
completeness checks (eligible-role coverage + rating-audit evidence) — against **isolated**
fixture-backed databases, never the developer's local pilot database.
"""

from __future__ import annotations

import json

import evaluation
import pytest
from evaluation import CalibrationContract
from evaluation.__main__ import main
from evaluation.database_evaluator import PILOT_COVERAGE_NOTE, evaluate_pilot
from evaluation.evaluator import evaluate_fixtures
from evaluation.reporting import render_markdown
from rolefit import RATING_VERSION

MIN = 450


# --- lazy package re-exports --------------------------------------------------
def test_package_lazy_exports():
    assert evaluation.evaluate_fixtures is not None
    assert evaluation.evaluate_pilot is not None
    assert evaluation.render_json is not None
    assert evaluation.render_markdown is not None
    assert evaluation.FixtureSuite is not None
    assert evaluation.CalibrationContract is not None
    with pytest.raises(AttributeError):
        _ = evaluation.does_not_exist


# --- CLI ----------------------------------------------------------------------
def test_cli_fixtures_markdown_to_stdout(capsys):
    assert main(["fixtures", "--format", "markdown"]) == 0
    out = capsys.readouterr().out
    assert "# RoleFit calibration report" in out
    assert "## Benchmarks" in out and "## Guardrail scenarios" in out


def test_cli_pilot_json(capsys):
    assert main(["pilot"]) == 0
    parsed = json.loads(capsys.readouterr().out)
    assert parsed["suite"] == "pilot" and parsed["read_only"] is True
    assert parsed["totals"]["fail"] == 0


def test_cli_all_writes_output_file(tmp_path, capsys):
    out_file = tmp_path / "report.md"
    assert main(["all", "--format", "markdown", "--output", str(out_file)]) == 0
    assert capsys.readouterr().out == ""  # nothing on stdout when writing a file
    text = out_file.read_text()
    assert "## Pilot (read-only)" in text
    assert "## Limitations" in text


def test_cli_fixtures_fail_on_fail_green_gate(capsys):
    # committed suite passes -> gate green -> exit 0
    assert main(["fixtures", "--fail-on-fail"]) == 0
    capsys.readouterr()


def test_cli_all_fail_on_fail_is_ok_when_no_fail(capsys):
    assert main(["all", "--fail-on-fail"]) == 0
    capsys.readouterr()


# --- reporting ----------------------------------------------------------------
def test_render_markdown_combined_has_all_sections():
    fixtures = evaluate_fixtures(min_minutes=MIN)
    combined = dict(fixtures)
    combined["suite"] = "all"
    combined["pilot"] = evaluate_pilot()
    md = render_markdown(combined)
    for heading in (
        "## Benchmarks",
        "## Guardrail scenarios",
        "## Pilot (read-only)",
        "## Limitations",
    ):
        assert heading in md


# --- pilot contracts + isolated fixture-backed database -----------------------
def _pilot_contract(benchmark: dict) -> CalibrationContract:
    base = {
        "kind": "pilot",
        "evidence_level": "pilot",
        "description": "x",
        "inconclusive_allowed": True,
        "season_label": "2023/24",
    }
    base.update(benchmark)
    return CalibrationContract.parse(
        {
            "suite": {"id": "t", "version": "v1", "rating_version": RATING_VERSION},
            "benchmarks": [base],
        }
    )


@pytest.fixture()
def pilot_db(tmp_path):
    """A fresh, isolated SQLite DB seeded with the deterministic sample source + recompute.
    Returns a session factory the pilot evaluator can be pointed at (no shared/local DB)."""
    from app.models.orm import Base
    from data_pipeline.adapters import get_adapter
    from data_pipeline.jobs.ingest import ingest_bundle
    from data_pipeline.jobs.recompute import recompute
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    engine = create_engine(
        f"sqlite:///{tmp_path/'pilot.db'}", connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    with factory() as s:
        ingest_bundle(s, get_adapter("sample").fetch())
    with factory() as s:
        recompute(s)
    return factory


def _resolvable(factory):
    """Pick a real (source id, top role, season, a non-top role) from the isolated DB."""
    from app.models.orm import PlayerSourceId, RoleRating, Season
    from rolefit import RATING_VERSION, load_role_configs
    from sqlalchemy import select

    with factory() as s:
        top = next(
            iter(
                s.scalars(
                    select(RoleRating)
                    .where(RoleRating.version == RATING_VERSION)
                    .order_by(RoleRating.final_score.desc())
                )
            )
        )
        sid = s.scalar(select(PlayerSourceId).where(PlayerSourceId.player_id == top.player_id))
        season = s.get(Season, top.season_id)
        other_role = next(k for k in load_role_configs() if k != top.role_key)
        return {
            "player_id": top.player_id,
            "season_id": top.season_id,
            "source_name": sid.source_name,
            "source_player_id": sid.source_player_id,
            "top_role": top.role_key,
            "season_label": season.label,
            "other_role": other_role,
        }


def _count_ratings(factory):
    from app.models.orm import RoleRating
    from sqlalchemy import func, select

    with factory() as s:
        return s.scalar(select(func.count()).select_from(RoleRating))


def test_pilot_pass_is_read_only(pilot_db):
    info = _resolvable(pilot_db)
    before = _count_ratings(pilot_db)
    out = evaluate_pilot(
        contract=_pilot_contract(
            {
                "id": "p_pass",
                "source_ids": [
                    {
                        "source_name": info["source_name"],
                        "source_player_id": info["source_player_id"],
                    }
                ],
                "season_label": info["season_label"],
                "expected_primary_role": info["top_role"],
            }
        ),
        session_factory=pilot_db,
    )["benchmarks"][0]
    assert out["status"] == "pass"
    assert out["resolved_player_id"] == info["player_id"]
    assert out["actual_primary_role"] == info["top_role"]
    assert _count_ratings(pilot_db) == before  # strictly read-only


def test_pilot_fail_on_complete_evidence(pilot_db):
    info = _resolvable(pilot_db)
    out = evaluate_pilot(
        contract=_pilot_contract(
            {
                "id": "p_fail",
                "source_ids": [
                    {
                        "source_name": info["source_name"],
                        "source_player_id": info["source_player_id"],
                    }
                ],
                "season_label": info["season_label"],
                "expected_primary_role": [info["other_role"]],
            }
        ),
        session_factory=pilot_db,
    )["benchmarks"][0]
    assert out["status"] == "fail"


def test_pilot_partial_role_coverage_is_inconclusive(pilot_db):
    from app.models.orm import RoleRating
    from rolefit import RATING_VERSION
    from sqlalchemy import select

    info = _resolvable(pilot_db)
    # delete one eligible current-version rating -> coverage becomes partial
    with pilot_db() as s:
        row = s.scalar(
            select(RoleRating).where(
                RoleRating.player_id == info["player_id"],
                RoleRating.season_id == info["season_id"],
                RoleRating.version == RATING_VERSION,
            )
        )
        s.delete(row)
        s.commit()
    out = evaluate_pilot(
        contract=_pilot_contract(
            {
                "id": "p_partial",
                "source_ids": [
                    {
                        "source_name": info["source_name"],
                        "source_player_id": info["source_player_id"],
                    }
                ],
                "season_label": info["season_label"],
                "expected_primary_role": info["top_role"],
            }
        ),
        session_factory=pilot_db,
    )["benchmarks"][0]
    assert out["status"] == "inconclusive"
    assert "coverage" in out["explanation"]


def test_pilot_missing_audit_is_inconclusive(pilot_db):
    from app.models.orm import RatingAudit, RoleRating
    from rolefit import RATING_VERSION
    from sqlalchemy import select

    info = _resolvable(pilot_db)
    with pilot_db() as s:
        rid = s.scalar(
            select(RoleRating.id).where(
                RoleRating.player_id == info["player_id"],
                RoleRating.season_id == info["season_id"],
                RoleRating.version == RATING_VERSION,
            )
        )
        audit = s.scalar(select(RatingAudit).where(RatingAudit.role_rating_id == rid))
        s.delete(audit)
        s.commit()
    out = evaluate_pilot(
        contract=_pilot_contract(
            {
                "id": "p_no_audit",
                "source_ids": [
                    {
                        "source_name": info["source_name"],
                        "source_player_id": info["source_player_id"],
                    }
                ],
                "season_label": info["season_label"],
                "expected_primary_role": info["top_role"],
            }
        ),
        session_factory=pilot_db,
    )["benchmarks"][0]
    assert out["status"] == "inconclusive"
    assert "audit" in out["explanation"]


def test_pilot_absent_player_and_season_are_inconclusive(pilot_db):
    info = _resolvable(pilot_db)
    unknown = evaluate_pilot(
        contract=_pilot_contract(
            {
                "id": "p_unknown",
                "source_ids": [{"source_name": "transfermarkt", "source_player_id": "no-such-id"}],
                "expected_primary_role": "touchline_winger",
            }
        ),
        session_factory=pilot_db,
    )["benchmarks"][0]
    assert unknown["status"] == "inconclusive"

    no_season = evaluate_pilot(
        contract=_pilot_contract(
            {
                "id": "p_no_season",
                "source_ids": [
                    {
                        "source_name": info["source_name"],
                        "source_player_id": info["source_player_id"],
                    }
                ],
                "season_label": "9999/99",
                "expected_primary_role": "touchline_winger",
            }
        ),
        session_factory=pilot_db,
    )["benchmarks"][0]
    assert no_season["status"] == "inconclusive"


def test_pilot_no_expected_role_is_inconclusive(pilot_db):
    info = _resolvable(pilot_db)
    out = evaluate_pilot(
        contract=_pilot_contract(
            {
                "id": "p_no_expect",
                "source_ids": [
                    {
                        "source_name": info["source_name"],
                        "source_player_id": info["source_player_id"],
                    }
                ],
                "season_label": info["season_label"],
            }
        ),
        session_factory=pilot_db,
    )["benchmarks"][0]
    assert out["status"] == "inconclusive"


def test_pilot_no_schema_is_inconclusive(tmp_path):
    """An empty database (no tables) must degrade to inconclusive, never raise or fail."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    engine = create_engine(f"sqlite:///{tmp_path/'empty.db'}")
    factory = sessionmaker(bind=engine, future=True)
    out = evaluate_pilot(
        contract=_pilot_contract(
            {
                "id": "p_empty",
                "source_ids": [{"source_name": "transfermarkt", "source_player_id": "1"}],
                "expected_primary_role": "touchline_winger",
            }
        ),
        session_factory=factory,
    )
    assert out["totals"]["fail"] == 0
    assert all(b["status"] == "inconclusive" for b in out["benchmarks"])


def test_pilot_backend_unavailable_is_inconclusive():
    """If the session cannot be opened at all, pilot degrades to inconclusive — never raises."""

    def boom():
        raise RuntimeError("backend unavailable in this environment")

    out = evaluate_pilot(
        contract=_pilot_contract(
            {
                "id": "p_boom",
                "source_ids": [{"source_name": "x", "source_player_id": "1"}],
                "expected_primary_role": "touchline_winger",
            }
        ),
        session_factory=boom,
    )
    assert out["totals"]["fail"] == 0
    assert all(b["status"] == "inconclusive" for b in out["benchmarks"])
    assert "unavailable" in out["coverage_note"].lower()


def test_pilot_inconclusive_without_local_data():
    """With the default backend and no matching pilot ids the suite is inconclusive, never fail."""
    out = evaluate_pilot()
    assert out["read_only"] is True
    assert out["totals"]["fail"] == 0
    assert all(b["status"] in ("pass", "inconclusive") for b in out["benchmarks"])
    assert "Leverkusen" in out["coverage_note"]


def test_pilot_coverage_note_constant_is_honest():
    assert "Leverkusen" in PILOT_COVERAGE_NOTE
    assert "cannot validate full Bundesliga" in PILOT_COVERAGE_NOTE
