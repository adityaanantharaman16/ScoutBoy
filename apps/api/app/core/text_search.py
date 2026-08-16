"""Python-equivalent Unicode lowercasing, evaluated inside the database.

Discovery matches free text, clubs, leagues and nationalities case-insensitively, and
orders results by a lowercased canonical name. Before Phase 8.1B all of that ran in
Python, so the reference behaviour is exactly `str.lower()`: the full Unicode lowercase
mapping, including the one mapping that expands (`İ` -> `i` + U+0307) and the
context-sensitive Greek final-sigma rule (`ΟΔΟΣ` -> `οδος`).

Phase 8.1B moved the work into SQL, and neither supported database reproduces that with
its own `lower()`:

* **SQLite's `lower()` is ASCII-only.** `lower('Étienne')` is `'Étienne'`.
* **PostgreSQL's `lower()` follows the database's LC_CTYPE**, so it is not even stable
  across deployments. Measured on this project's PostgreSQL 16 cluster, which initdb
  created with `LC_CTYPE=C`, `lower()` differs from `str.lower()` for 1,407 of the
  1,433 code points Python lowercases - it too is ASCII-only. A cluster created with a
  UTF-8 locale instead applies libc's *simple* mapping, which still cannot produce the
  two-code-point `İ` result and has no final-sigma rule.

An earlier attempt folded the needle's uppercase forms into the haystack with bounded
`replace()` calls. That only works where a character's lowercase round-trips through
`.upper()`, which is not true in general: `İ` lowercases to two code points, `ß`
uppercases to `SS`, and the Kelvin and Ohm signs lowercase to letters whose uppercase is
a *different* code point. It also could not help the ordering key, which has to lowercase
whole stored names rather than a known needle.

So the lowering is done explicitly, by one expression with a per-dialect compilation:

* **SQLite** calls :data:`SQLITE_LOWER_FUNCTION`, a deterministic connection function
  that is literally Python's `str.lower()`. Registration is a global SQLAlchemy
  ``connect`` listener, so every engine this project creates - the application engine,
  the isolated engines the tests build, an Alembic engine - gets it on every connection
  in the pool, including ones handed out after a reconnect.
* **PostgreSQL** uses `lower(x COLLATE "unicode")`. `"unicode"` is PostgreSQL 16's
  built-in ICU root collation, and ICU applies Unicode *full* case mapping, so it
  reproduces both the `İ` expansion and the final-sigma rule regardless of the
  database's own LC_CTYPE. This is the reason the project's PostgreSQL floor is 16
  (ADR 0001 already pinned that version).

Both sides therefore implement the same thing - Unicode full lowercase mapping - and the
shared parity assertions in ``app.tests.discovery_parity`` hold them to it on both
dialects.

The one measured residual is that ICU ships its own Unicode tables, which can lag
CPython's. Measured with this expression on PostgreSQL 16.15 (ICU collation version
153.14, Unicode 15.0) against CPython 3.13.14 (Unicode 15.1), 40 of the 1,433 cased code
points diverge. All 40 diverge the same way - ICU does not recognise the character and
returns it unchanged, rather than lowercasing it differently - and they are 35 Vithkuqi
letters (U+10570..U+10595), four recent Latin additions (U+A7C0..U+A7D8) and one
Glagolitic letter (U+2C2F). None lie in the Latin, Latin-1, Latin Extended, Greek or
Cyrillic ranges a player, club or competition name is written in, and the count there is
zero. ``test_postgres_smoke`` re-measures this on the live server and fails if any
divergence reaches those ranges, so the residual cannot quietly grow into names;
``docs/milestone_8_discovery_contract.md`` records it as a stated limitation.
"""

from __future__ import annotations

import sqlite3
from typing import Optional

from sqlalchemy import String, event
from sqlalchemy.engine import Engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.sql.functions import FunctionElement

#: Name the deterministic `str.lower()` is registered under on SQLite connections.
SQLITE_LOWER_FUNCTION = "scoutboy_unicode_lower"

#: PostgreSQL 16's built-in ICU root collation, quoted for direct SQL emission.
POSTGRESQL_ICU_COLLATION = '"unicode"'


class unicode_lower(FunctionElement):  # noqa: N801 - a SQL function, named like one
    """Python's ``str.lower()`` semantics, evaluated by the database.

    Wraps any string expression. Filtering and ordering keep happening database-side;
    this only changes *how* the database spells "lowercase".
    """

    type = String()
    name = "unicode_lower"
    inherit_cache = True


@compiles(unicode_lower)
def _compile_unicode_lower(element, compiler, **kw) -> str:
    """Fallback for dialects this project does not support.

    ADR 0001 supports SQLite and PostgreSQL only. Rendering plain ``lower()`` keeps
    ``str(statement)`` and generic-dialect debugging working; it is not a supported
    execution path, and no parity assertion is made for it.
    """
    return f"lower({compiler.process(element.clauses, **kw)})"


@compiles(unicode_lower, "sqlite")
def _compile_unicode_lower_sqlite(element, compiler, **kw) -> str:
    return f"{SQLITE_LOWER_FUNCTION}({compiler.process(element.clauses, **kw)})"


@compiles(unicode_lower, "postgresql")
def _compile_unicode_lower_postgresql(element, compiler, **kw) -> str:
    return f"lower(({compiler.process(element.clauses, **kw)}) COLLATE {POSTGRESQL_ICU_COLLATION})"


def python_lower(value: Optional[str]) -> Optional[str]:
    """The reference lowercase, and the body of the SQLite connection function.

    Non-string inputs (NULL, and anything SQLite hands over untyped) pass through, so
    the SQL function behaves like `lower()` does for a NULL column.
    """
    return value.lower() if isinstance(value, str) else value


def register_sqlite_functions(dbapi_connection) -> bool:
    """Attach the deterministic lowercase to one SQLite DBAPI connection.

    ``deterministic=True`` is what lets SQLite use the function in a WHERE clause or an
    ORDER BY without re-evaluating it unpredictably. It needs SQLite 3.8.3 or newer;
    the non-deterministic registration is kept as a fallback so an ancient library
    still answers correctly rather than failing to start.
    """
    if not isinstance(dbapi_connection, sqlite3.Connection):
        return False
    try:
        dbapi_connection.create_function(SQLITE_LOWER_FUNCTION, 1, python_lower, deterministic=True)
    except (sqlite3.NotSupportedError, TypeError):  # pragma: no cover - very old SQLite
        dbapi_connection.create_function(SQLITE_LOWER_FUNCTION, 1, python_lower)
    return True


@event.listens_for(Engine, "connect")
def _register_on_connect(dbapi_connection, connection_record) -> None:
    """Every SQLite connection any engine opens, for the life of the process.

    Listening on the ``Engine`` class rather than one engine instance is deliberate:
    tests build their own engines, and a listener attached per engine would silently
    miss them and fail only on the connection a pool happened to hand out.
    """
    register_sqlite_functions(dbapi_connection)
