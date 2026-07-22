"""Shared adapter conformance checks for current and future providers."""

from __future__ import annotations

from dataclasses import fields

from scoutboy_shared import is_performance_metric, resolve_metric

from .adapters.base import CanonicalPlayer, IngestBundle, SourceAdapter

MARKET_METRICS = {
    "public_value_eur",
    "contract_until",
    "international_caps",
    "hype_index",
    "recent_form_index",
}


def validate_adapter(adapter: SourceAdapter, bundle: IngestBundle | None = None) -> dict:
    """Return a deterministic, machine-readable provider conformance report."""
    errors = list(adapter.validate_contract())
    warnings: list[str] = []
    capabilities = adapter.capabilities
    if bundle is not None:
        if not bundle.source_name or not bundle.source_snapshot_id:
            errors.append("bundle must report source_name and source_snapshot_id")
        if bundle.source_name != adapter.name:
            errors.append("bundle source_name must match adapter name")
        if not capabilities.metric_only and not bundle.players:
            warnings.append("bundle contains no players for this selected scope")
        if capabilities.metric_only and bundle.players:
            errors.append("metric-only adapter emitted canonical players")
        for player in bundle.players:
            if not player.source_name or not player.source_player_id:
                errors.append("canonical player is missing provider identity provenance")
                break
        canonical_player_fields = {field.name for field in fields(CanonicalPlayer)}
        for player in bundle.players:
            unknown = set(vars(player)) - canonical_player_fields
            if unknown:
                errors.append(f"provider-specific player fields leaked: {sorted(unknown)}")
                break
        for metric in bundle.metrics:
            canonical = resolve_metric(metric.metric_name)
            family_supported = (
                canonical is not None
                and is_performance_metric(canonical)
                and "performance" in capabilities.supported_metric_families
            ) or (
                metric.metric_name in MARKET_METRICS
                and "market" in capabilities.supported_metric_families
            )
            if (
                metric.metric_name not in capabilities.supported_metric_keys
                and not family_supported
            ):
                errors.append(f"undeclared emitted metric: {metric.metric_name}")
                break
    return {
        "provider": capabilities.provider_id,
        "valid": not errors,
        "errors": sorted(set(errors)),
        "warnings": sorted(set(warnings)),
        "capabilities": capabilities.to_dict(),
        "snapshot": bundle.source_snapshot_id if bundle else None,
    }


def require_adapter_conformance(adapter: SourceAdapter, bundle: IngestBundle | None = None) -> dict:
    report = validate_adapter(adapter, bundle)
    if not report["valid"]:
        raise ValueError(
            f"Provider contract failed for {report['provider']}: {', '.join(report['errors'])}"
        )
    return report
