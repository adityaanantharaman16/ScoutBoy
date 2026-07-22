# ADR 0003: Config-driven rating models

## Context

RoleFit, playstyle, context, and confidence decisions must be explainable, reviewable, and
versioned. Embedding weights and thresholds in route or UI code would make changes hard to audit.

## Decision

Keep role weights, eligible positions, playstyle thresholds, metric definitions, and context
adjustments in versioned configuration. Domain packages load and validate the configuration,
persist hashes/version metadata with recomputation runs, and emit audit breakdowns. The frontend
only displays authoritative backend outputs.

## Consequences

Model policy changes are visible diffs and recomputations are distinguishable. Configuration needs
validation and snapshot tests. Missing required metrics lower confidence and remain missing rather
than becoming zero.

## Alternatives considered

- Hard-code weights in Python: rejected because review and version comparison become opaque.
- Score in the frontend: rejected because clients could disagree and audits would drift.
- Use a black-box model: deferred; it does not meet the current explainability goal.
