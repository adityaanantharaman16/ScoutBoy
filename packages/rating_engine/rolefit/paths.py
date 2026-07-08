from __future__ import annotations

import os
from pathlib import Path


def repo_root() -> Path:
    """Resolve the monorepo root. Overridable with SCOUTBOY_REPO_ROOT for tests."""
    override = os.environ.get("SCOUTBOY_REPO_ROOT")
    if override:
        return Path(override).resolve()
    # packages/rating_engine/rolefit/paths.py -> parents[3] == repo root
    return Path(__file__).resolve().parents[3]


def config_dir() -> Path:
    """Root of the YAML config tree (configs/). Overridable with SCOUTBOY_CONFIG_DIR."""
    override = os.environ.get("SCOUTBOY_CONFIG_DIR")
    if override:
        return Path(override).resolve()
    return repo_root() / "configs"
