# ADR 0002: Provider-agnostic data provenance

## Context

ScoutBoy combines identity, market, and limited performance evidence from sources with different
licenses and coverage. Future licensed providers must not force provider-specific fields through
the API, rating engine, or frontend.

## Decision

Provider adapters map source payloads into canonical records before domain processing. Persist
source snapshots, stable source identifiers, checksums, versions, license references, and coverage
metadata. Quarantine ambiguous identities instead of silently merging them. Raw snapshots remain
local and gitignored.

## Consequences

Outputs remain traceable and provider integrations are replaceable. Adapter code carries the
mapping cost, and incomplete evidence must be represented explicitly in coverage and confidence.
The current StatsBomb slice cannot be described as full Bundesliga coverage.

## Alternatives considered

- Persist provider schemas directly: fast initially, but leaks vendor coupling everywhere.
- Normalize only in the frontend: rejected because scoring and audit data would be inconsistent.
- Auto-merge uncertain identities: rejected because false joins corrupt every downstream output.
