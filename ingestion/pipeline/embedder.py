"""Generate text embeddings for normalized transactions via OpenAI."""

import logging

import openai

from ingestion.config import settings
from .normalizer import NormalizedTransaction

log = logging.getLogger(__name__)

_EMBEDDING_MODEL = "text-embedding-3-small"
_DIMENSIONS = 1536
_BATCH_SIZE = 100


def _get_openai_embedder() -> openai.AsyncOpenAI:
    return openai.AsyncOpenAI(api_key=settings.openai_api_key)


def get_embedder():
    """Always use OpenAI for embeddings.

    Titan Embed V2 max dimension is 1024 but schema uses 1536.
    Bedrock used for normalization only via normalizer_provider.
    """
    return _get_openai_embedder()


async def _openai_embed(texts: list[str]) -> list[list[float]]:
    """Embed texts using OpenAI, batched in groups of _BATCH_SIZE."""
    client = _get_openai_embedder()
    embeddings: list[list[float]] = [[0.0] * _DIMENSIONS for _ in texts]

    for start in range(0, len(texts), _BATCH_SIZE):
        batch_texts = texts[start: start + _BATCH_SIZE]
        try:
            response = await client.embeddings.create(
                model=_EMBEDDING_MODEL,
                input=batch_texts,
                dimensions=_DIMENSIONS,
            )
            for item in response.data:
                embeddings[start + item.index] = item.embedding
        except Exception as exc:
            log.error(
                "OpenAI embedding batch [%d:%d] failed: %s — using zero vectors",
                start, start + len(batch_texts), exc,
            )

    return embeddings


async def generate_embeddings(
    transactions: list[NormalizedTransaction],
    embedder=None,
) -> list[list[float]]:
    """Generate embeddings for each transaction via OpenAI."""
    if not transactions:
        return []

    if embedder is None:
        embedder = get_embedder()

    texts = [
        f"{txn['normalized_merchant']} {txn['category']} {txn['raw_description'][:100]}"
        for txn in transactions
    ]

    log.info("Generating embeddings", extra={
        "count": len(transactions),
        "model": _EMBEDDING_MODEL,
    })

    return await _openai_embed(texts)
