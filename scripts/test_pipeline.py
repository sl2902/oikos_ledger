"""End-to-end pipeline smoke test.

Fast mode (default): zero-vector embeddings, verifies closing_balance.
Full mode (--full):  calls lambda_handler directly with real embeddings.
"""

import argparse
import asyncio
import sys
import uuid
from pathlib import Path

from sqlalchemy import func
from sqlmodel import select

from ingestion.db.client import get_session, write_transactions
from ingestion.models.transactions import Transaction
from ingestion.models.users import BankAccount, Upload, UploadStatus, User
from ingestion.pipeline import normalizer as normalizer_module
from ingestion.pipeline import parser as parser_module
from ingestion.pipeline.normalizer import get_normalizer_client

SCRIPT_DIR = Path(__file__).parent
TEST_CSV = SCRIPT_DIR / "test_hdfc.csv"

# Zero-vector embeddings — diagnostic only, never for production
_ZERO_VECTOR = [0.0] * 1536


def _create_fixtures(suffix: str) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    """Create test User / BankAccount / Upload rows. Returns (user_id, account_id, upload_id)."""
    with get_session() as session:
        user = User(
            email=f"pipeline-test-{suffix}@test.invalid",
            country_code="IN",
            currency="INR",
        )
        session.add(user)
        session.flush()

        account = BankAccount(
            user_id=user.id,
            bank_name="HDFC Bank",
            account_type="checking",
            currency="INR",
        )
        session.add(account)
        session.flush()

        upload = Upload(
            user_id=user.id,
            account_id=account.id,
            filename="test_hdfc.csv",
            file_hash=uuid.uuid4().hex,
            s3_key=f"test/{suffix}/test_hdfc.csv",
            status=UploadStatus.pending,
        )
        session.add(upload)
        session.flush()

        return user.id, account.id, upload.id


def _cleanup_fixtures(upload_id: uuid.UUID, account_id: uuid.UUID, user_id: uuid.UUID) -> None:
    try:
        with get_session() as session:
            txns = session.exec(
                select(Transaction).where(Transaction.upload_id == upload_id)
            ).all()
            for txn in txns:
                session.delete(txn)
            session.flush()

            for model_class, pk in [
                (Upload, upload_id),
                (BankAccount, account_id),
                (User, user_id),
            ]:
                obj = session.get(model_class, pk)
                if obj:
                    session.delete(obj)

        print("\nTest fixtures cleaned up.")
    except Exception as exc:
        print(f"\nWARN: cleanup failed — {exc}")
        print("  Manual cleanup: delete rows with upload_id =", upload_id)


# ── Fast mode ─────────────────────────────────────────────────────────────────

async def run() -> None:
    print("=== Pipeline closing_balance smoke test ===\n")

    if not TEST_CSV.exists():
        print(f"ERROR: {TEST_CSV} not found")
        sys.exit(1)

    file_content = TEST_CSV.read_text(encoding="utf-8", errors="replace")
    rows = parser_module.parse_csv("HDFC Bank", file_content)
    print(f"Parsed {len(rows)} rows from {TEST_CSV.name}")

    print("\nParsed row closing_balance sample:")
    for row in rows[:3]:
        print(f"  {row['transaction_date']} — closing_balance: {row.get('closing_balance')}")

    suffix = uuid.uuid4().hex[:8]
    user_id, account_id, upload_id = _create_fixtures(suffix)

    print(f"\nTest fixtures created:")
    print(f"  user_id:    {user_id}")
    print(f"  account_id: {account_id}")
    print(f"  upload_id:  {upload_id}")

    normalizer_client = get_normalizer_client()
    normalized = await normalizer_module.normalize_batch(rows, normalizer_client)
    print(f"\nNormalized {len(normalized)} transactions")

    print("\nNormalized row closing_balance sample:")
    for txn in normalized[:3]:
        print(f"  {txn['transaction_date']} — closing_balance: {txn.get('closing_balance')}")

    embeddings = [_ZERO_VECTOR[:] for _ in normalized]
    with get_session() as session:
        inserted, skipped = write_transactions(
            session, normalized, embeddings, account_id, user_id, upload_id, "INR"
        )
    print(f"\nWrote {inserted} new transactions, skipped {skipped} duplicates")

    with get_session() as session:
        closing_balance_results = session.exec(
            select(Transaction.closing_balance)
            .where(Transaction.upload_id == upload_id)
            .limit(5)
        ).all()

        print("\nClosing balance verification:")
        for i, cb in enumerate(closing_balance_results):
            print(f"  Row {i + 1}: {cb}")

        non_null_count = session.exec(
            select(func.count())
            .where(Transaction.upload_id == upload_id)
            .where(Transaction.closing_balance.is_not(None))
        ).one()

        print(f"\nTransactions with closing_balance: {non_null_count}")
        if non_null_count == 0:
            print("  FAIL — closing_balance is null for all transactions")
        else:
            print("  PASS — closing_balance populated correctly")

    _cleanup_fixtures(upload_id, account_id, user_id)


# ── Full mode ─────────────────────────────────────────────────────────────────

def run_full() -> None:
    from ingestion.lambda_handler import handler

    print("=== Full pipeline test (real embeddings + normalization) ===\n")

    if not TEST_CSV.exists():
        print(f"ERROR: {TEST_CSV} not found")
        sys.exit(1)

    suffix = uuid.uuid4().hex[:8]
    user_id, account_id, upload_id = _create_fixtures(suffix)

    print(f"Test fixtures created:")
    print(f"  user_id:    {user_id}")
    print(f"  account_id: {account_id}")
    print(f"  upload_id:  {upload_id}")

    event = {
        "upload_id": str(upload_id),
        "account_id": str(account_id),
        "user_id": str(user_id),
        "s3_key": f"test/{suffix}/test_hdfc.csv",
        "bank_name": "HDFC Bank",
        "local_file_path": str(TEST_CSV),
    }

    result = handler(event, None)
    print("\nFull pipeline result:")
    print(result)

    with get_session() as session:
        txns = session.exec(
            select(Transaction)
            .where(Transaction.upload_id == upload_id)
            .limit(5)
        ).all()

        print(f"\nSample transactions:")
        for txn in txns:
            print(f"  {txn.transaction_date} — "
                  f"{txn.normalized_merchant} — "
                  f"{txn.category} — "
                  f"{txn.subcategory} — "
                  f"closing: {txn.closing_balance}")

        upload = session.get(Upload, upload_id)
        print(f"\nBalance verification:")
        print(f"  opening_balance:     {getattr(upload, 'opening_balance', None)}")
        print(f"  closing_balance:     {getattr(upload, 'closing_balance', None)}")
        print(f"  balance_verified:    {getattr(upload, 'balance_verified', None)}")
        print(f"  balance_discrepancy: {getattr(upload, 'balance_discrepancy', None)}")

        merchants = session.exec(
            select(
                Transaction.normalized_merchant,
                Transaction.category,
                Transaction.subcategory,
            )
            .where(Transaction.upload_id == upload_id)
            .distinct()
        ).all()

        print(f"\nNormalized merchants ({len(merchants)} unique):")
        for merchant, category, subcategory in sorted(merchants):
            print(f"  {merchant:<30} {category:<20} {subcategory or '-'}")

    _cleanup_fixtures(upload_id, account_id, user_id)


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Oikos Ledger pipeline smoke test"
    )
    parser.add_argument(
        "--full",
        action="store_true",
        help="Run full pipeline via lambda_handler with real embeddings",
    )
    args = parser.parse_args()

    if args.full:
        run_full()
    else:
        asyncio.run(run())


if __name__ == "__main__":
    main()
