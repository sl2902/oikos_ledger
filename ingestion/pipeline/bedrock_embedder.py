"""Bedrock-based embedding client using Titan Embed V2."""

import json
import logging
import time

import boto3
from botocore.exceptions import ClientError

from ingestion.config import settings

log = logging.getLogger(__name__)


class BedrockEmbedder:
    """Embedder using Amazon Titan Embed Text V2 via Bedrock.

    Titan Embed V2 produces 1536-dimensional embeddings —
    matches the existing pgvector column dimension.
    """

    DIMENSIONS = 1536

    def __init__(self) -> None:
        self._client = boto3.client(
            "bedrock-runtime",
            region_name=settings.bedrock_region,
        )

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Embed a batch of texts.

        Titan Embed V2 processes one text at a time.
        Retries on 429 and 500 errors with exponential backoff.
        Raises on other errors — caller handles fallback.
        """
        embeddings = []
        for text in texts:
            embedding = self._embed_one(text)
            embeddings.append(embedding)
        return embeddings

    def _embed_one(self, text: str) -> list[float]:
        for attempt in range(settings.max_retries):
            try:
                response = self._client.invoke_model(
                    modelId=settings.bedrock_embedding_model,
                    contentType="application/json",
                    accept="application/json",
                    body=json.dumps({
                        "inputText": text[:8000],  # Titan V2 max input
                        "dimensions": self.DIMENSIONS,
                        "normalize": True,
                    }),
                )
                body = json.loads(response["body"].read())
                return body["embedding"]

            except ClientError as e:
                status = e.response["ResponseMetadata"]["HTTPStatusCode"]
                code = e.response["Error"]["Code"]

                if status in (429, 500, 502, 503) and attempt < settings.max_retries - 1:
                    wait = settings.retry_backoff_seconds * (2 ** attempt)
                    log.warning(
                        "Bedrock embedder error %s (attempt %d/%d) — retrying in %.1fs",
                        code, attempt + 1, settings.max_retries, wait,
                    )
                    time.sleep(wait)
                    continue

                log.error("Bedrock embedder failed: %s", code)
                raise

        raise RuntimeError("Bedrock embedder max retries exceeded")
