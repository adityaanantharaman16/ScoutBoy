"""ScoutBoy RoleFit calibration & evaluation package (v1).

A versioned, config-driven framework that measures whether the *existing* RoleFit engine
produces credible, role-specific, context-aware, evidence-honest outputs. It reuses the
production scoring modules (``rolefit``) verbatim — it never re-implements the formula and it
never claims ScoutBoy produces objective scouting truth.

Public surface:

    CalibrationContract.load()   -> parsed, validated calibration contract
    FixtureSuite.load()          -> committed deterministic calibration fixtures
    evaluate_fixtures(...)       -> deterministic fixture-suite results
    evaluate_pilot(...)          -> read-only, honest real-pilot results (inconclusive if absent)
    render_json / render_markdown-> deterministic reports
"""

from __future__ import annotations

CALIBRATION_VERSION = "rolefit-calibration-v1"


def __getattr__(name: str):
    # Lazy re-exports so importing the package (e.g. for the fixture-only path) never pulls in
    # the FastAPI backend used by pilot evaluation.
    if name in ("CalibrationContract", "ContractError"):
        from .contract import CalibrationContract, ContractError

        return {"CalibrationContract": CalibrationContract, "ContractError": ContractError}[name]
    if name == "FixtureSuite":
        from .fixtures import FixtureSuite

        return FixtureSuite
    if name == "evaluate_fixtures":
        from .evaluator import evaluate_fixtures

        return evaluate_fixtures
    if name == "evaluate_pilot":
        from .database_evaluator import evaluate_pilot

        return evaluate_pilot
    if name in ("render_json", "render_markdown"):
        from .reporting import render_json, render_markdown

        return {"render_json": render_json, "render_markdown": render_markdown}[name]
    raise AttributeError(f"module 'evaluation' has no attribute '{name}'")


__all__ = [
    "CALIBRATION_VERSION",
    "CalibrationContract",
    "ContractError",
    "FixtureSuite",
    "evaluate_fixtures",
    "evaluate_pilot",
    "render_json",
    "render_markdown",
]
