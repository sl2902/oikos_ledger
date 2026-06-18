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
                amount, "transaction_type", "raw_description",
                "closing_balance"
            )
        """))

        # Insights query cache: simple key-value cache keyed by account+user+question
        # The SQLModel QueryCache uses embeddings (different purpose); this table
        # supports the /api/insights/query 1-hour response cache.
        session.exec(text("""
            DROP TABLE IF EXISTS query_cache CASCADE
        """))
        
        session.exec(text("""
            CREATE TABLE query_cache (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                account_id UUID NOT NULL REFERENCES bank_accounts(id),
                user_id UUID NOT NULL REFERENCES users(id),
                query_hash TEXT NOT NULL,
                query_text TEXT NOT NULL,
                query_embedding VECTOR(1536),
                result JSONB NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE (user_id, account_id, query_hash)
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
