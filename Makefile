# ScoutBoy — task runner
# All Python commands run inside the local venv with PYTHONPATH pointing at the
# monorepo packages. No global installs required.

SHELL := /bin/bash
VENV := .venv
PY := $(VENV)/bin/python
PIP := $(VENV)/bin/pip
export PYTHONPATH := packages:packages/rating_engine:packages/shared/python:apps/api
# Default DB is a local SQLite file; override with e.g.
#   DATABASE_URL=postgresql+psycopg://scoutboy:scoutboy@localhost:5432/scoutboy
export DATABASE_URL ?= sqlite:///$(CURDIR)/db/scoutboy.db
export SCOUTBOY_MIN_MINUTES ?= 450
API_HOST ?= 127.0.0.1
API_PORT ?= 8000

.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------
.PHONY: install
install: install-py install-web ## Install all backend + frontend dependencies

.PHONY: install-py
install-py: $(VENV) ## Create venv and install Python deps (dev extras)
	$(PIP) install --upgrade pip >/dev/null
	$(PIP) install -e ".[dev]"

$(VENV):
	python3 -m venv $(VENV)

.PHONY: install-web
install-web: ## Install frontend deps via pnpm
	pnpm install

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
.PHONY: db-up
db-up: ## Start Postgres via docker compose (optional; SQLite is the default)
	docker compose up -d db

.PHONY: db-migrate
db-migrate: ## Apply Alembic migrations (creates tables)
	$(VENV)/bin/alembic upgrade head

.PHONY: db-reset
db-reset: ## Drop + recreate schema (destructive)
	$(VENV)/bin/alembic downgrade base || true
	$(VENV)/bin/alembic upgrade head

.PHONY: seed
seed: db-migrate ## Load sample players (Phase 1 fixtures) into the DB
	$(PY) -m data_pipeline.jobs.ingest --source sample

# ---------------------------------------------------------------------------
# Pipeline / recompute
# ---------------------------------------------------------------------------
TM_SAMPLE ?= data/sample/transfermarkt_sample
PERF_SAMPLE ?= data/sample/performance_metrics_sample.csv
TM_RAW ?= data/raw/transfermarkt
STATSBOMB_RAW ?= data/raw/statsbomb
PILOT_COMPETITION_ID ?= L1
PILOT_TARGET_SEASON ?= 2023
PILOT_AS_OF_DATE ?= 2024-06-30

.PHONY: ingest-sample
ingest-sample: ## Ingest the synthetic all-in-one sample source
	$(PY) -m data_pipeline.jobs.ingest --source sample

.PHONY: ingest-transfermarkt
ingest-transfermarkt: ## Ingest a Transfermarkt-style CSV dir (INPUT=... ; defaults to the sample dir)
	$(PY) -m data_pipeline.jobs.ingest --source transfermarkt --input-path $(or $(INPUT),$(TM_SAMPLE))

.PHONY: ingest-performance-csv
ingest-performance-csv: ## Ingest a performance-metrics CSV (INPUT=... ; defaults to the sample CSV)
	$(PY) -m data_pipeline.jobs.ingest --source performance_csv --input-path $(or $(INPUT),$(PERF_SAMPLE))

.PHONY: seed-real
seed-real: db-migrate ## Real-data-v0 path: transfermarkt + performance CSV + recompute (sample fixtures)
	$(PY) -m data_pipeline.jobs.ingest --source transfermarkt --input-path $(TM_SAMPLE)
	$(PY) -m data_pipeline.jobs.ingest --source performance_csv --input-path $(PERF_SAMPLE)
	$(MAKE) recompute-ratings

.PHONY: seed-pilot
seed-pilot: db-migrate ## Milestone 3: ingest pinned TM + StatsBomb snapshots and recompute
	$(PY) -m data_pipeline.jobs.ingest --source transfermarkt --input-path $(TM_RAW) --competition-id $(PILOT_COMPETITION_ID) --target-season $(PILOT_TARGET_SEASON) --as-of-date $(PILOT_AS_OF_DATE)
	$(PY) -m data_pipeline.jobs.ingest --source statsbomb_pilot --input-path $(STATSBOMB_RAW)
	$(MAKE) recompute-ratings

.PHONY: cohort-report
cohort-report: ## Write and print the Milestone 3 coverage report
	$(PY) -m data_pipeline.quality.cohort_report --output data/reports/milestone3_cohort_report.json

.PHONY: verify-milestone-3
verify-milestone-3: ## Verify the honest real-data vertical-slice acceptance gates
	$(PY) -m data_pipeline.quality.cohort_report --verify --output data/reports/milestone3_cohort_report.json

.PHONY: data-quality
data-quality: ## Alias for quality-report (Milestone 2 name)
	$(PY) -m data_pipeline.quality.report

.PHONY: recompute-ratings
recompute-ratings: ## Recompute RoleFit ratings + playstyles + market values
	$(PY) -m data_pipeline.jobs.recompute --ratings --playstyles --market

.PHONY: quality-report
quality-report: ## Run data-quality checks and print/store a report
	$(PY) -m data_pipeline.quality.report

# ---------------------------------------------------------------------------
# Dev servers
# ---------------------------------------------------------------------------
.PHONY: dev
dev: ## Start API + web + (best-effort) DB locally
	@echo ">> Ensuring DB schema + seed data..."
	@$(MAKE) seed
	@echo ">> Starting API on http://$(API_HOST):$(API_PORT) and web on http://localhost:3000"
	@( $(MAKE) dev-api & $(MAKE) dev-web & wait )

.PHONY: dev-api
dev-api: ## Start the FastAPI server only
	$(VENV)/bin/uvicorn app.main:app --app-dir apps/api --reload --host $(API_HOST) --port $(API_PORT)

.PHONY: dev-web
dev-web: ## Start the Next.js dev server only
	pnpm --filter @scoutboy/web dev

.PHONY: dev-pilot
dev-pilot: db-migrate ## Start API + web without replacing the real pilot with sample data
	@echo ">> Starting real pilot API on http://$(API_HOST):$(API_PORT) and web on http://localhost:3000"
	@( $(MAKE) dev-api & $(MAKE) dev-web & wait )

# ---------------------------------------------------------------------------
# Quality gates
# ---------------------------------------------------------------------------
.PHONY: test
test: test-py test-web ## Run all backend + frontend unit tests

.PHONY: test-py
test-py: ## Run pytest (backend, rating engine, market, pipeline)
	$(VENV)/bin/pytest

.PHONY: test-web
test-web: ## Run Vitest frontend utility tests
	pnpm --filter @scoutboy/web test run

.PHONY: e2e
e2e: seed recompute-ratings ## Build web + run Playwright E2E against the production build
	pnpm --filter @scoutboy/web build
	pnpm exec playwright test

.PHONY: lint
lint: lint-py lint-web ## Lint Python + TypeScript

.PHONY: lint-py
lint-py: ## Ruff + black --check
	$(VENV)/bin/ruff check .
	$(VENV)/bin/black --check .

.PHONY: format
format: ## Auto-format Python
	$(VENV)/bin/ruff check --fix .
	$(VENV)/bin/black .

.PHONY: lint-web
lint-web: ## ESLint the frontend
	pnpm --filter @scoutboy/web lint

.PHONY: openapi
openapi: ## Export the OpenAPI schema to docs/api_contracts/openapi.json
	$(PY) -m app.export_openapi

.PHONY: clean
clean: ## Remove caches and the local SQLite DB
	rm -rf $(VENV) .pytest_cache **/__pycache__ db/scoutboy.db
