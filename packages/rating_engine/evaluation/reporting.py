"""Deterministic calibration reports (JSON + Markdown).

Reports are intentionally free of timestamps, hostnames, or run ids so two evaluations of the
same configuration produce byte-identical output — that is what makes calibration a usable
regression gate. The Markdown report is for human review; the JSON is the machine contract.
"""

from __future__ import annotations

import json

_STATUS_EMOJI = {"pass": "✅", "warn": "⚠️", "fail": "❌", "inconclusive": "❔"}


def render_json(result: dict) -> str:
    """Byte-stable JSON (sorted keys, trailing newline)."""
    return json.dumps(result, sort_keys=True, indent=2, ensure_ascii=False) + "\n"


def _status(s: str) -> str:
    return f"{_STATUS_EMOJI.get(s, '')} {s}"


def _totals_line(totals: dict) -> str:
    return " · ".join(f"{k}: {v}" for k, v in totals.items())


def render_markdown(result: dict) -> str:
    lines: list = []
    suite = result.get("suite", "calibration")
    lines.append(f"# RoleFit calibration report — {suite}")
    lines.append("")
    lines.append(
        f"- **Suite:** `{result.get('suite_id', '?')}` "
        f"contract `{result.get('contract_version', '?')}`"
    )
    lines.append(f"- **Calibration version:** `{result.get('calibration_version', '?')}`")
    lines.append(f"- **Rating version:** `{result.get('rating_version', '?')}`")
    lines.append(f"- **Overall status:** {_status(result.get('overall_status', 'inconclusive'))}")
    if result.get("coverage_note"):
        lines.append(f"- **Pilot coverage:** {result['coverage_note']}")
    hashes = result.get("config_hashes", {})
    if hashes:
        role_hashes = hashes.get("roles", {})
        lines.append(
            f"- **Config hashes:** context `{hashes.get('context', '?')}` · "
            f"playstyles `{hashes.get('playstyles', '?')}` · "
            f"fixtures `{hashes.get('fixtures', '?')}` · "
            f"contract `{hashes.get('contract', '?')}` · "
            f"{len(role_hashes)} role configs"
        )
    lines.append("")

    benches = result.get("benchmarks", [])
    if benches:
        lines.append("## Benchmarks")
        lines.append("")
        _t = result.get("totals", {})
        lines.append(f"Totals — {_totals_line(_t.get('benchmarks', _t))}")
        lines.append("")
        lines.append("| Benchmark | Evidence | Status | Primary role | Explanation |")
        lines.append("| --- | --- | --- | --- | --- |")
        for b in benches:
            primary = b.get("actual_primary_role") or "—"
            expl = (b.get("explanation") or "").replace("|", "\\|").replace("\n", " ")
            lines.append(
                f"| `{b['benchmark_id']}` | {b.get('evidence_level', '?')} | "
                f"{_status(b['status'])} | {primary} | {expl} |"
            )
        lines.append("")

    scenarios = result.get("scenarios", [])
    if scenarios:
        lines.append("## Guardrail scenarios")
        lines.append("")
        lines.append(f"Totals — {_totals_line(result.get('totals', {}).get('scenarios', {}))}")
        lines.append("")
        lines.append("| Scenario | Status | Detail |")
        lines.append("| --- | --- | --- |")
        for s in scenarios:
            detail = (s.get("detail") or "").replace("|", "\\|").replace("\n", " ")
            lines.append(f"| `{s['scenario_id']}` | {_status(s['status'])} | {detail} |")
        lines.append("")

    pilot = result.get("pilot")
    if pilot is not None:
        lines.append("## Pilot (read-only)")
        lines.append("")
        lines.append(f"- **Coverage:** {pilot.get('coverage_note', 'n/a')}")
        lines.append(f"- Totals — {_totals_line(pilot.get('totals', {}))}")
        lines.append("")
        lines.append("| Pilot benchmark | Status | Detail |")
        lines.append("| --- | --- | --- |")
        for b in pilot.get("benchmarks", []):
            detail = (b.get("explanation") or "").replace("|", "\\|").replace("\n", " ")
            lines.append(f"| `{b['benchmark_id']}` | {_status(b['status'])} | {detail} |")
        lines.append("")

    limitations = result.get("limitations") or []
    if limitations:
        lines.append("## Limitations")
        lines.append("")
        for lim in limitations:
            lines.append(f"- {lim.strip()}")
        lines.append("")

    return "\n".join(lines) + "\n"
