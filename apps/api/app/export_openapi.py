"""Export the OpenAPI schema so the frontend can generate a typed client.

python -m app.export_openapi   ->   docs/api_contracts/openapi.json
"""

from __future__ import annotations

import json

from rolefit.paths import repo_root

from app.main import app


def main() -> None:
    out = repo_root() / "docs" / "api_contracts" / "openapi.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(app.openapi(), indent=2))
    print(f"Wrote OpenAPI schema to {out}")


if __name__ == "__main__":
    main()
