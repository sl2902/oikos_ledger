"""Tests for the embedder — embedding dimensions, batching, and error handling."""

import asyncio
from decimal import Decimal
from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ingestion.pipeline.embedder import _DIMENSIONS, _ZERO_VECTOR, generate_embeddings
from ingestion.pipeline.normalizer import NormalizedTransaction


def _make_txn(merchant: str = "Swiggy", category: str = "Food") -> NormalizedTransaction:
    return NormalizedTransaction(
        transaction_date=date(2026, 5, 1),
        raw_description="UPI-SWIGGY-swiggy@icici-ICIC000001-123-UPI",
        normalized_merchant=merchant,
        amount=Decimal("350.00"),
        transaction_type="debit",
        category=category,
        subcategory=None,
        payment_method="UPI",
        reference_number=None,
        closing_balance=None,
        upi_merchant="Swiggy",
        upi_app="ICICI Bank",
        upi_vpa="swiggy@icici",
        upi_ref="123",
        upi_counterparty_bank="ICICI Bank",
    )


def _mock_openai_client(vectors: list[list[float]]):
    """Build a mock AsyncOpenAI client that returns the given vectors."""
    client = MagicMock()
    embedding_items = [
        MagicMock(index=i, embedding=v) for i, v in enumerate(vectors)
    ]
    response = MagicMock()
    response.data = embedding_items
    client.embeddings = MagicMock()
    client.embeddings.create = AsyncMock(return_value=response)
    return client


@pytest.mark.asyncio
async def test_embedding_dimension():
    txn = _make_txn()
    fake_vector = [0.1] * _DIMENSIONS
    client = _mock_openai_client([fake_vector])
    result = await generate_embeddings([txn], client)
    assert len(result) == 1
    assert len(result[0]) == _DIMENSIONS


@pytest.mark.asyncio
async def test_embedding_batch():
    txns = [_make_txn(f"Merchant{i}") for i in range(3)]
    fake_vectors = [[float(i)] * _DIMENSIONS for i in range(3)]
    client = _mock_openai_client(fake_vectors)
    result = await generate_embeddings(txns, client)
    assert len(result) == 3
    for i, vec in enumerate(result):
        assert len(vec) == _DIMENSIONS


@pytest.mark.asyncio
async def test_empty_input_returns_empty():
    client = MagicMock()
    result = await generate_embeddings([], client)
    assert result == []


@pytest.mark.asyncio
async def test_api_failure_returns_zero_vectors():
    txns = [_make_txn()]
    client = MagicMock()
    client.embeddings = MagicMock()
    client.embeddings.create = AsyncMock(side_effect=Exception("API error"))
    result = await generate_embeddings(txns, client)
    assert len(result) == 1
    assert result[0] == _ZERO_VECTOR


@pytest.mark.asyncio
async def test_embedding_text_format():
    """Verify the text sent to OpenAI includes merchant, category, and raw description."""
    txn = _make_txn(merchant="Swiggy", category="Food")
    fake_vector = [0.0] * _DIMENSIONS
    client = _mock_openai_client([fake_vector])
    await generate_embeddings([txn], client)
    call_args = client.embeddings.create.call_args
    input_texts = call_args.kwargs.get("input", [])
    assert any("Swiggy" in t and "Food" in t for t in input_texts)
