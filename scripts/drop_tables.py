"""Drop all SQLModel tables from Aurora/Supabase — destructive, dev only."""

import sys

from sqlalchemy import create_engine
from sqlmodel import SQLModel

from ingestion.config import settings

# Import all models so SQLModel registers them in metadata before drop_all
import ingestion.models  # noqa: F401


def main() -> None:
    print("─" * 60)
    print(f"WARNING: This will DROP all Oikos Ledger tables on {settings.db_provider}.")
    print("All data will be permanently deleted.")
    print("─" * 60)

    answer = input("\nType 'y' to confirm: ").strip().lower()
    if answer != "y":
        print("Aborted — no tables dropped.")
        sys.exit(0)

    print(f"\nDropping tables on {settings.db_provider} …\n")
    engine = create_engine(settings.database_url_direct)
    SQLModel.metadata.drop_all(engine)

    print("Done — all tables dropped.")


if __name__ == "__main__":
    main()
