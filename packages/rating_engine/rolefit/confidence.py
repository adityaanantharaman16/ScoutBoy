"""Confidence scoring for a single role rating.

Confidence is a transparent blend of sample size (minutes), required-metric coverage,
and context penalties. Missing required metrics lower confidence and are reported —
they never silently zero the score. Below the minimum-minutes floor, confidence is
capped so small-sample spikes cannot masquerade as reliable.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from scoutboy_shared import ConfidenceLevel, confidence_from_score, label_for_confidence


@dataclass(frozen=True)
class ConfidenceResult:
    score: float  # 0..1
    level: ConfidenceLevel
    label: str
    minutes_factor: float
    coverage_factor: float
    context_penalty: float
    missing_required: tuple[str, ...] = field(default_factory=tuple)
    notes: tuple[str, ...] = field(default_factory=tuple)

    def to_breakdown(self) -> dict:
        return {
            "score": round(self.score, 3),
            "level": self.level.value,
            "label": self.label,
            "minutes_factor": round(self.minutes_factor, 3),
            "coverage_factor": round(self.coverage_factor, 3),
            "context_penalty": round(self.context_penalty, 3),
            "missing_required": list(self.missing_required),
            "notes": list(self.notes),
        }


def compute_confidence(
    *,
    minutes: int,
    min_minutes: int,
    full_confidence_minutes: int,
    required_metrics: list[str],
    present_metrics: set[str],
    context_penalty: float,
) -> ConfidenceResult:
    minutes = minutes or 0
    minutes_factor = min(1.0, minutes / full_confidence_minutes) if full_confidence_minutes else 1.0

    missing_required = tuple(m for m in required_metrics if m not in present_metrics)
    if required_metrics:
        coverage_factor = (len(required_metrics) - len(missing_required)) / len(required_metrics)
    else:
        coverage_factor = 1.0

    notes: list[str] = []
    raw = 0.55 * minutes_factor + 0.45 * coverage_factor
    score = max(0.0, raw - context_penalty)

    if minutes < min_minutes:
        score = min(score, 0.4)
        notes.append(f"Below the {min_minutes}-minute threshold ({minutes}); confidence capped.")
    if missing_required:
        notes.append("Missing required metrics: " + ", ".join(missing_required) + ".")
    if coverage_factor == 0.0:
        score = 0.0
        notes.append("No required metrics available — profile is effectively unknown.")

    level = confidence_from_score(score)
    return ConfidenceResult(
        score=score,
        level=level,
        label=label_for_confidence(level),
        minutes_factor=minutes_factor,
        coverage_factor=coverage_factor,
        context_penalty=context_penalty,
        missing_required=missing_required,
        notes=tuple(notes),
    )
