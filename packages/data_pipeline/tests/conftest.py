"""Fixtures for real-data-v0 pipeline tests: fresh, empty databases independent of
the root conftest's sample-seeded DB."""

from __future__ import annotations

import pytest
from app.models.orm import Base
from rolefit.paths import repo_root
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


@pytest.fixture
def fresh_sessions(tmp_path):
    url = f"sqlite:///{tmp_path / 'pipeline_test.db'}"
    engine = create_engine(url, connect_args={"check_same_thread": False}, future=True)
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, future=True), engine


@pytest.fixture
def tm_dir():
    return repo_root() / "data" / "sample" / "transfermarkt_sample"


@pytest.fixture
def perf_csv():
    return repo_root() / "data" / "sample" / "performance_metrics_sample.csv"
