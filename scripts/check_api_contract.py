"""Regenerate both API contract artifacts and fail only when their content was stale."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    artifacts = (
        root / "docs" / "api_contracts" / "openapi.json",
        root / "apps" / "web" / "src" / "lib" / "api" / "schema.gen.ts",
    )
    before = {path: path.read_bytes() if path.exists() else None for path in artifacts}

    subprocess.run([sys.executable, "-m", "app.export_openapi"], cwd=root, check=True)
    subprocess.run(["pnpm", "--filter", "@scoutboy/web", "gen:api"], cwd=root, check=True)

    stale = [path for path in artifacts if before[path] != path.read_bytes()]
    if stale:
        print("API contract artifacts were stale and have been regenerated:", file=sys.stderr)
        for path in stale:
            print(f"- {path.relative_to(root)}", file=sys.stderr)
        return 1

    print("API contract artifacts are current.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
