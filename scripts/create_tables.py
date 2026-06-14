"""Create all SQLModel tables in Aurora/Supabase using the direct connection string."""

import sys

from sqlalchemy import create_engine, inspect, text
from sqlmodel import Session, SQLModel

from ingestion.config import settings

# Import all models so SQLModel registers them in metadata before create_all
import ingestion.models  # noqa: F401


def main() -> None:
    print(f"Creating tables on {settings.db_provider} …\n")

    engine = create_engine(settings.database_url_direct)
    SQLModel.metadata.create_all(engine)

    with Session(engine) as session:
        # Unique constraint 1: reference number (partial — only when not null)
        session.exec(text("""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_ref
            ON transactions (user_id, account_id, reference_number)
            WHERE reference_number IS NOT NULL
        """))

        # Unique constraint 2: composite for transactions without reference numbers
        # closing_balance added as tiebreaker for same-merchant sequential transactions
        session.exec(text("""
            DROP INDEX IF EXISTS uq_transactions_composite
        """))

        session.exec(text("""
            CREATE UNIQUE INDEX uq_transactions_composite
            ON transactions (
                user_id, account_id, transaction_date,
                amount, normalized_merchant, closing_balance
            )
        """))

        session.commit()

    inspector = inspect(engine)
    tables = sorted(inspector.get_table_names())
    for table in tables:
        print(f"  ✓ {table}")

    print(f"\nDone — {len(tables)} tables ready.")


if __name__ == "__main__":
    main()
