"""Value guardrails: no negatives, sane floors, and manual-review flags for outliers.

Guardrails never fabricate a value; they clamp obvious impossibilities and flag
extreme outputs for human review rather than publishing them blindly (US-6.9)."""

from __future__ import annotations

VALUE_FLOOR_EUR = 250_000.0
OUTLIER_CEILING_EUR = 300_000_000.0
OUTLIER_ASKING_RATIO = 3.0  # asking mid vs model mid


def clamp_value(value: float) -> float:
    """No negatives; apply a small floor for a live prospect."""
    if value is None:
        return value
    return max(VALUE_FLOOR_EUR, value)


def needs_manual_review(model_mid: float, asking_mid: float) -> tuple[bool, list[str]]:
    reasons: list[str] = []
    if asking_mid > OUTLIER_CEILING_EUR or model_mid > OUTLIER_CEILING_EUR:
        reasons.append(f"value exceeds €{OUTLIER_CEILING_EUR/1e6:.0f}M ceiling")
    if model_mid > 0 and (asking_mid / model_mid) > OUTLIER_ASKING_RATIO:
        reasons.append(f"asking price is >{OUTLIER_ASKING_RATIO:.0f}× model value")
    return (len(reasons) > 0, reasons)
