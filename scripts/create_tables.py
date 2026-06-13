"""Create all SQLModel tables in Aurora/Supabase using the direct connection string."""

import sys

from sqlalchemy import create_engine, inspect
from sqlmodel import SQLModel

from ingestion.config import settings

# Import all models so SQLModel registers them in metadata before create_all
import ingestion.models  # noqa: F401


def main() -> None:
    print(f"Creating tables on {settings.db_provider} …\n")

    engine = create_engine(settings.database_url_direct)
    SQLModel.metadata.create_all(engine)

    inspector = inspect(engine)
    tables = sorted(inspector.get_table_names())
    for table in tables:
        print(f"  ✓ {table}")

    print(f"\nDone — {len(tables)} tables ready.")


if __name__ == "__main__":
    main()
