# Security Policy

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's private
**Report a vulnerability** / Security Advisory feature for this repository and include:

- the affected component and revision;
- reproduction steps or a minimal proof of concept;
- the likely impact and any known mitigations;
- whether the report contains secrets or personal/provider data.

The maintainer will acknowledge reports and coordinate validation and disclosure on a best-effort
basis. This portfolio project does not promise a commercial support SLA. Do not test against
systems, accounts, or data you do not own or have permission to use.

## Supported code

Security fixes target the current `main` branch. Historical commits, local modifications, and
unmaintained deployments are not supported releases.

## Baseline controls

Pull requests run secret scanning plus Python and production JavaScript dependency audits.
Dependabot proposes dependency and GitHub Actions updates. Production mode refuses to start without
an admin token and rejects wildcard CORS origins. These controls reduce common risks; they are not
a claim of penetration testing, uptime guarantees, or commercial production readiness.

The Python audit checks the declared project dependency graph rather than the audit tool's own
environment. Temporary upstream exceptions, if needed because no compatible fixed release exists,
must be listed explicitly in the workflow with an explanation and revisited by Dependabot updates.

### Temporary Python audit exceptions

As of 2026-07-22, `PYSEC-2026-161`, `PYSEC-2026-248`, `PYSEC-2026-249`,
`PYSEC-2026-2280`, and `PYSEC-2026-2281` list Starlette 1.x fixes while the newest published
Starlette is 0.49.3 and FastAPI's published compatible range remains below 0.50.
`PYSEC-2026-2132` and `PYSEC-2026-2270` similarly list Click 8.3.3 and python-dotenv 1.2.2,
which are not yet published on the configured PyPI index. CI ignores only these exact ids and
continues to fail on any other finding. Remove each exception as soon as a compatible fixed release
is published; Dependabot's weekly run is the review trigger.

Never commit credentials, `.env` files, database dumps, raw provider payloads, or licensed data.
Rotate any credential immediately if it is exposed, even if a later commit removes it.
