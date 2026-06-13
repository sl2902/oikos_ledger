"""Generate 1536-dimension text embeddings for normalized transactions via OpenAI."""

import logging

import openai

from .normalizer import NormalizedTransaction

log = logging.getLogger(__name__)

_EMBEDDING_MODEL = "text-embedding-3-small"
_DIMENSIONS = 1536
_BATCH_SIZE = 100
_ZERO_VECTOR = [0.0] * _DIMENSIONS


async def generate_embeddings(
    transactions: list[NormalizedTransaction],
    client: openai.AsyncOpenAI,
) -> list[list[float]]:
    """Generate embeddings for each transaction.

    Input text: "{normalized_merchant} {category} {raw_description}"
    Batched in groups of _BATCH_SIZE. Returns zero vector for any failed batch.
    """
    if not transactions:
        return []

    texts = [
        f"{txn['normalized_merchant']} {txn['category']} {txn['raw_description']}"
        for txn in transactions
    ]

    log.info("Generating embeddings", extra={
        "count": len(transactions),
        "batch_size": _BATCH_SIZE,
        "model": _EMBEDDING_MODEL,
    })

    embeddings: list[list[float]] = [_ZERO_VECTOR[:] for _ in transactions]
    failed_count = 0

    for start in range(0, len(texts), _BATCH_SIZE):
        batch_texts = texts[start : start + _BATCH_SIZE]
        try:
            response = await client.embeddings.create(
                model=_EMBEDDING_MODEL,
                input=batch_texts,
                dimensions=_DIMENSIONS,
            )
            for item in response.data:
                embeddings[start + item.index] = item.embedding
        except Exception as exc:
            failed_count += len(batch_texts)
            log.error(
                "Embedding batch [%d:%d] failed: %s — using zero vectors",
                start,
                start + len(batch_texts),
                exc,
            )
            for i in range(start, start + len(batch_texts)):
                log.warning("Embedding failed", extra={
                    "index": i,
                    "merchant": transactions[i].get("normalized_merchant", "")[:40],
                    "error": str(exc),
                })

    log.info("Embeddings complete", extra={
        "count": len(embeddings),
        "failed": failed_count,
    })

    return embeddings
