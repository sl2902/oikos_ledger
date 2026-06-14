"""AWS Lambda entry point — receives invocation payload and runs the full ingestion pipeline."""

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from ingestion.config import settings
from ingestion.db.client import (
    get_session,
    get_upload,
    update_upload_status,
    write_transactions,
)
from ingestion.pipeline.balance_verifier import verify_balance
from ingestion.models.users import BankAccount
from ingestion.pipeline import embedder as embedder_module
from ingestion.pipeline import normalizer as normalizer_module
from ingestion.pipeline import parser as parser_module
from ingestion.pipeline.normalizer import get_normalizer_client

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)


async def _normalize_with_fallback(rows: list, parser) -> list:
    """Normalize with Bedrock primary, OpenAI fallback."""
    client = get_normalizer_client()
    log.info("Normalizer client: %s", type(client).__name__)
    try:
        return await normalizer_module.normalize_batch(rows, client, parser=parser)
    except Exception as e:
        log.warning("Primary normalizer failed: %s — falling back to OpenAI", e)
        import openai as _openai
        from ingestion.pipeline.normalizer import OpenAINormalizerClient
        fallback = OpenAINormalizerClient(
            client=_openai.AsyncOpenAI(api_key=settings.openai_api_key),
            model=settings.normalizer_model,
        )
        return await normalizer_module.normalize_batch(rows, fallback, parser=parser)


async def _run_pipeline(
    upload_id: uuid.UUID,
    account_id: uuid.UUID,
    user_id: uuid.UUID,
    s3_key: str,
    bank_name: str,
    local_file_path: str | None = None,
) -> dict:
    """Core async pipeline. Separated from handler() so it can be tested directly."""
    stage = "init"
    log.info("Pipeline started", extra={
        "upload_id": str(upload_id),
        "account_id": str(account_id),
        "user_id": str(user_id),
        "bank_name": bank_name,
        "s3_key": s3_key,
    })

    log.setLevel(logging.DEBUG)
    log.info("Lambda handler loaded — log level: %s", log.level)

    try:
        with get_session() as session:
            # 1. Fetch upload and verify state
            stage = "fetch_upload"
            upload = get_upload(session, upload_id)
            if upload is None:
                raise ValueError(f"Upload {upload_id} not found")
            if upload.status in ("processing", "complete", "cancelled"):
                log.info(
                    "Upload %s already processed or cancelled (status=%s) — aborting",
                    upload_id, upload.status,
                )
                return {"status": "aborted", "reason": upload.status}

            # 2. Mark processing
            stage = "mark_processing"
            update_upload_status(session, upload_id, "processing")
            session.flush()

            # 3. Look up bank account for currency
            account = session.get(BankAccount, account_id)
            currency = account.currency if account else "INR"

            # 4. Get CSV content
            stage = "download_csv"
            if local_file_path:
                with open(local_file_path, encoding="utf-8", errors="replace") as f:
                    file_content = f.read()
            else:
                import boto3

                s3 = boto3.client("s3", region_name=settings.aws_region)
                resp = s3.get_object(Bucket=settings.aws_s3_bucket, Key=s3_key)
                file_content = resp["Body"].read().decode("utf-8", errors="replace")

            log.info("CSV downloaded", extra={
                "upload_id": str(upload_id),
                "size_bytes": len(file_content),
                "size_kb": round(len(file_content) / 1024, 2),
            })

            # 5. Parse
            stage = "parse"
            try:
                parsed_rows, skipped_rows, parser = parser_module.parse_csv(bank_name, file_content)
            except ValueError as exc:
                user_message = (
                    f"This file doesn't appear to be a valid {bank_name} statement. "
                    f"Please download your statement from {bank_name} NetBanking "
                    f"under Statements → Download → CSV and try again."
                )
                log.error("Parser validation failed: %s", str(exc))
                update_upload_status(
                    session,
                    upload_id,
                    status="failed",
                    error_message=user_message,
                )
                return {"statusCode": 400, "body": user_message}
            
            log.info("CSV parsed", extra={
                "upload_id": str(upload_id),
                "bank_name": bank_name,
                "parsed_rows": len(parsed_rows),
                "skipped_rows": len(skipped_rows),
                "sample_narrations": [r["raw_description"][:50] for r in parsed_rows[:3]],
            })
            if skipped_rows:
                log.warning(
                    "Rows skipped during parsing: %d",
                    len(skipped_rows),
                    extra={"skipped": [s["reason"] for s in skipped_rows]},
                )
            update_upload_status(
                session,
                upload_id,
                status="processing",
                row_count=len(parsed_rows),
                dropped_rows=[dict(s) for s in skipped_rows] if skipped_rows else None,
            )
            session.flush()

            # 5b. Balance verification
            stage = "balance_verification"
            verification = verify_balance(parsed_rows)
            log.info("Balance verification complete", extra={
                "upload_id": str(upload_id),
                "is_valid": verification.is_valid,
                "opening_balance": str(verification.opening_balance),
                "closing_balance": str(verification.closing_balance),
                "total_debits": str(verification.total_debits),
                "total_credits": str(verification.total_credits),
                "mismatched_rows": len(verification.mismatched_rows),
                "discrepancy": str(verification.discrepancy),
            })
            update_upload_status(
                session,
                upload_id,
                status="processing",
                opening_balance=verification.opening_balance,
                closing_balance=verification.closing_balance,
                balance_verified=verification.is_valid,
                balance_discrepancy=verification.discrepancy if not verification.is_valid else None,
            )
            session.flush()

            # 6. Normalize
            stage = "normalize"
            normalized = await _normalize_with_fallback(parsed_rows, parser)
            log.info("Normalization complete", extra={
                "upload_id": str(upload_id),
                "total": len(normalized),
                "sample_results": [
                    {
                        "raw": n["raw_description"][:40],
                        "merchant": n["normalized_merchant"],
                        "category": n["category"],
                        "subcategory": n["subcategory"],
                        "method": n["payment_method"],
                    }
                    for n in normalized[:5]
                ],
            })

            # 7. Embed
            stage = "embed"
            embeddings = await embedder_module.generate_embeddings(normalized)
            log.info("Embeddings generated", extra={
                "upload_id": str(upload_id),
                "count": len(embeddings),
            })

            # 8. Write (idempotent)
            stage = "write"
            inserted, skipped_count, write_skipped = write_transactions(
                session, normalized, embeddings, account_id, user_id, upload_id, currency
            )
            log.info("Transactions written", extra={
                "upload_id": str(upload_id),
                "inserted": inserted,
                "skipped": skipped_count,
                "write_skipped_details": len(write_skipped),
                "total_attempted": inserted + skipped_count,
            })

            if write_skipped:
                log.warning(
                    "Transactions skipped due to duplicates: %d",
                    len(write_skipped),
                )

            # Merge parse-level and write-level skipped rows
            all_skipped = skipped_rows + write_skipped

            # 9. Complete — single update with full state and all skipped rows
            stage = "complete"
            update_upload_status(
                session,
                upload_id,
                status="complete",
                row_count=inserted,
                completed_at=datetime.now(timezone.utc),
                opening_balance=verification.opening_balance,
                closing_balance=verification.closing_balance,
                balance_verified=verification.is_valid,
                balance_discrepancy=verification.discrepancy
                    if not verification.is_valid else None,
                dropped_rows=all_skipped if all_skipped else None,
            )
            log.info("Pipeline complete", extra={
                "upload_id": str(upload_id),
                "status": "complete",
                "inserted": inserted,
                "skipped": skipped_count,
                "balance_verified": verification.is_valid,
            })

    except Exception as e:
        log.error("Pipeline failed", extra={
            "upload_id": str(upload_id),
            "error": str(e),
            "stage": stage,
        }, exc_info=True)
        raise

    return {
        "status": "complete",
        "upload_id": str(upload_id),
        "parsed": len(parsed_rows),
        "skipped_parsing": len(skipped_rows),
        "inserted": inserted,
        "skipped_db": skipped_count,
    }


def handler(event: dict, context: Any) -> dict:
    """Lambda entry point.

    Event payload:
    {
        "upload_id": "uuid-string",
        "account_id": "uuid-string",
        "user_id": "uuid-string",
        "s3_key": "string",
        "bank_name": "string",
        "local_file_path": "string"   # optional — for local testing without S3
    }
    """
    try:
        upload_id = uuid.UUID(event["upload_id"])
        account_id = uuid.UUID(event["account_id"])
        user_id = uuid.UUID(event["user_id"])
        s3_key = event["s3_key"]
        bank_name = event["bank_name"]
        local_file_path = event.get("local_file_path")
    except (KeyError, ValueError) as e:
        log.error("Invalid event payload: %s", e)
        raise

    try:
        return asyncio.run(
            _run_pipeline(upload_id, account_id, user_id, s3_key, bank_name, local_file_path)
        )
    except Exception as exc:
        log.error("Pipeline failed for upload %s: %s", event.get("upload_id"), exc)
        try:
            with get_session() as session:
                update_upload_status(session, upload_id, "failed", error_message=str(exc)[:500])
        except Exception:
            pass
        raise


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 5:
        print(
            "Usage: python -m ingestion.lambda_handler "
            "<upload_id> <account_id> <user_id> <bank_name> <local_csv_path>"
        )
        sys.exit(1)

    result = handler(
        {
            "upload_id": sys.argv[1],
            "account_id": sys.argv[2],
            "user_id": sys.argv[3],
            "bank_name": sys.argv[4],
            "s3_key": "",
            "local_file_path": sys.argv[5] if len(sys.argv) > 5 else None,
        },
        None,
    )
    print(result)
