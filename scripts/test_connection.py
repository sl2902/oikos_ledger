"""Verify database connectivity and confirm pgvector and PostGIS extensions are active."""

import sys

import psycopg2

from ingestion.config import settings


def check(label: str, ok: bool, detail: str = "") -> bool:
    mark = "✓" if ok else "✗"
    line = f"{mark} {label}"
    if detail:
        line += f" ({detail})"
    print(line)
    return ok


def main() -> None:
    print(f"Connecting to {settings.db_provider} …\n")

    try:
        conn = psycopg2.connect(settings.database_url_direct)
    except Exception as exc:
        print(f"✗ Connection failed: {exc}")
        sys.exit(1)

    cur = conn.cursor()
    all_ok = True

    # Basic connectivity
    cur.execute("SELECT version()")
    version = cur.fetchone()[0]
    all_ok &= check("Connection", True, version.split(",")[0])

    # pgvector
    cur.execute("SELECT extversion FROM pg_extension WHERE extname = 'vector'")
    row = cur.fetchone()
    all_ok &= check(
        "pgvector extension",
        bool(row),
        f"version {row[0]}" if row else "run: CREATE EXTENSION vector;",
    )

    # PostGIS
    cur.execute("SELECT extversion FROM pg_extension WHERE extname = 'postgis'")
    row = cur.fetchone()
    all_ok &= check(
        "PostGIS extension",
        bool(row),
        f"version {row[0]}" if row else "run: CREATE EXTENSION postgis;",
    )

    cur.close()
    conn.close()

    print()
    if all_ok:
        print("All checks passed.")
    else:
        print("One or more checks failed — see above.")
        sys.exit(1)


if __name__ == "__main__":
    main()
