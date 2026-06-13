# ADR 011: Row Number for Intra-Day Transaction Ordering

## Status
Accepted

## Context
Transactions sorted by transaction_date alone lose intra-day
ordering. Multiple transactions on the same day have no
reliable secondary sort:
- closing_balance ASC only works for pure debit days
- reference_number not always sequential within a day
- created_at reflects pipeline processing order not bank order

Correct intra-day order matters for:
- Balance verification (closing balance chain depends on order)
- User expectation (matches bank statement order)
- Audit trail integrity

## Decision
Add row_number field to transactions table — the original
sequential position of the transaction in the CSV file.

Sort order: transaction_date DESC, row_number DESC
- transaction_date DESC: newest day first
- row_number DESC: within same day, highest row number first
  (bank statement is oldest-first, so highest row = most recent
  within the day when viewing newest-first)

## Implementation
- ParsedRow TypedDict includes row_number: int
- BaseCSVParser.parse_csv() assigns row_number = enumerate index
- NormalizedTransaction carries row_number through pipeline
- write_transactions() writes row_number to Aurora
- balance_verifier sorts by row_number when available

## Consequences
- Intra-day ordering matches bank statement exactly
- Balance verification uses correct row sequence
- Works for mixed debit/credit days
- row_number is CSV-specific — different uploads of same period
  may have different row numbers for same transaction (handled
  by idempotency constraints, not row_number)
