# Runbook: Failed ingestion or recompute

1. Stop further admin-triggered jobs and record the failed run id, source snapshot id, adapter,
   configuration hashes, and sanitized error message.
2. Confirm the database is ready at `/readyz`; handle migration/connectivity failures first.
3. Run `make quality-report` and review quarantine, provenance, identity, missing-metric, and
   coverage findings. Do not replace missing values with zero or weaken gates to force completion.
4. Verify source version, checksum, license metadata, target season, reference date, and input path.
   Keep raw payloads private and out of logs/issues.
5. Reproduce against a disposable database or fixture. Fix the adapter/canonical mapping or
   config, add a regression test, then rerun ingestion followed by `make recompute-ratings`.
6. Confirm the new run is completed, affected-player counts are plausible, API reads work, and
   audit/config version metadata matches the intended inputs.

If a partial real-data source cannot satisfy coverage gates, publish a blocker/coverage report. Do
not claim full-league completion or fabricate ratings.
