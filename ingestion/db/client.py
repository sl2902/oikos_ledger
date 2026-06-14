"""Aurora/Supabase engine, session factory, and pipeline write helpers."""

import logging
import uuid
from contextlib import contextmanager
from datetime import datetime
from decimal import Decimal
from typing import Generator

log = logging.getLogger(__name__)

import ingestion.config as _config
import sqlalchemy as sa
from sqlalchemy import Engine, create_engine
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlmodel import Session, select

from ingestion.models.transactions import Transaction
from ingestion.models.users import Upload

_engine: Engine | None = None


def _get_engine() -> Engine:
    global _engine
    if _engine is None:
        _engine = create_engine(_config.settings.database_url)
    return _engine


@contextmanager
def get_session() -> Generator[Session, None, None]:
    """Yield a SQLModel session, committing on success and rolling back on exception."""
    with Session(_get_engine()) as session:
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise


def get_upload(session: Session, upload_id: uuid.UUID) -> Upload | None:
    """Fetch an upload row by ID."""
    return session.get(Upload, upload_id)


def update_upload_status(
    session: Session,
    upload_id: uuid.UUID,
    status: str,
    row_count: int | None = None,
    error_message: str | None = None,
    completed_at: datetime | None = None,
    opening_balance: Decimal | None = None,
    closing_balance: Decimal | None = None,
    balance_verified: bool | None = None,
    balance_discrepancy: Decimal | None = None,
    dropped_rows: list | None = None,
) -> None:
    """Update upload status and optionally row_count / error_message / completed_at / balance / dropped_rows."""
    upload = session.get(Upload, upload_id)
    if upload is None:
        return
    upload.status = status  # type: ignore[assignment]
    if row_count is not None:
        upload.row_count = row_count
    if error_message is not None:
        upload.error_message = error_message
    if completed_at is not None:
        upload.completed_at = completed_at
    if opening_balance is not None:
        upload.opening_balance = opening_balance
    if closing_balance is not None:
        upload.closing_balance = closing_balance
    if balance_verified is not None:
        upload.balance_verified = balance_verified
    if balance_discrepancy is not None:
        upload.balance_discrepancy = balance_discrepancy
    if dropped_rows is not None:
        upload.dropped_rows = dropped_rows
    session.add(upload)
    session.commit()


def write_transactions(
    session: Session,
    transactions: list,  # list[NormalizedTransaction]
    embeddings: list[list[float]],
    account_id: uuid.UUID,
    user_id: uuid.UUID,
    upload_id: uuid.UUID,
    currency: str,
) -> tuple[int, int, list[dict]]:
    """Write normalized transactions to Aurora using INSERT … ON CONFLICT DO NOTHING.

    Handles both unique constraints:
    - (user_id, account_id, reference_number) WHERE reference_number IS NOT NULL
    - (user_id, account_id, transaction_date, amount, normalized_merchant)

    Returns (inserted_count, skipped_count, skipped_details) where skipped_details
    contains rows dropped due to unique constraint conflicts.
    """
    log.info("Writing transactions", extra={
        "count": len(transactions),
        "account_id": str(account_id),
        "upload_id": str(upload_id),
    })

    inserted = 0
    skipped = 0
    skipped_details: list[dict] = []

    for txn, embedding in zip(transactions, embeddings):
        values = {
            "id": uuid.uuid4(),
            "user_id": user_id,
            "account_id": account_id,
            "upload_id": upload_id,
            "merchant_id": None,
            "row_number": txn.get("row_number"),
            "transaction_date": txn["transaction_date"],
            "raw_description": txn["raw_description"],
            "normalized_merchant": txn["normalized_merchant"],
            "amount": txn["amount"],
            "closing_balance": txn.get("closing_balance"),
            "currency": currency,
            "transaction_type": txn["transaction_type"],
            "reference_number": txn["reference_number"],
            "category": txn["category"],
            "subcategory": txn["subcategory"],
            "location": None,
            "embedding": embedding,
        }

        stmt = pg_insert(Transaction).values(**values).on_conflict_do_nothing()
        result = session.execute(stmt)
        was_inserted = bool(result.rowcount and result.rowcount > 0)
        if was_inserted:
            inserted += 1
        else:
            skipped += 1
            skipped_details.append({
                "row_number": txn.get("row_number"),
                "date": str(txn["transaction_date"]),
                "narration": txn["raw_description"][:100],
                "debit": str(txn["amount"])
                    if txn["transaction_type"] == "debit"
                    else "0.00",
                "credit": str(txn["amount"])
                    if txn["transaction_type"] == "credit"
                    else "0.00",
                "reference": txn.get("reference_number") or "",
                "reason": "duplicate_transaction",
            })
        log.debug("Transaction write result", extra={
            "merchant": txn["normalized_merchant"][:40],
            "date": str(txn["transaction_date"]),
            "amount": str(txn["amount"]),
            "result": "inserted" if was_inserted else "skipped",
        })

    log.info("Write complete", extra={
        "inserted": inserted,
        "skipped": skipped,
        "upload_id": str(upload_id),
    })

    return inserted, skipped, skipped_details
