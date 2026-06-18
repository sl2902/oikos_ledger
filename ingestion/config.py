"""Centralised, validated settings for the Oikos Ledger ingestion layer.

Import the shared `settings` instance — never instantiate Settings() directly:

    from ingestion.config import settings
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env.local",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ── Database ──────────────────────────────────────────────────────────────
    database_url: str               # pooled — used by Lambda and Next.js Route Handlers
    database_url_direct: str = ""   # direct — used by scripts and SQLModel create_all
    db_provider: str = "supabase"

    # ── AWS ───────────────────────────────────────────────────────────────────
    aws_region: str = "us-east-1"
    aws_s3_bucket: str                  # required — empty string allowed until S3 is provisioned
    aws_lambda_function_name: str       # required — empty string allowed until Lambda is deployed

    # ── LLM APIs ─────────────────────────────────────────────────────────────
    anthropic_api_key: str = ""   # optional — reserved for future recommendations feature
    openai_api_key: str
    openai_base_url: str

    # ── Bedrock ───────────────────────────────────────────────────────────────
    bedrock_region: str = "ap-south-1"
    bedrock_normalizer_model: str = "anthropic.claude-3-haiku-20240307-v1:0"
    bedrock_embedding_model: str = "amazon.titan-embed-text-v2:0"

    # ── Retry ─────────────────────────────────────────────────────────────────
    max_retries: int = 3
    retry_backoff_seconds: float = 1.0

    # ── LLM Normalization ─────────────────────────────────────────────────────
    normalizer_provider: str = "openai"        # openai | bedrock
    normalizer_model: str = "gpt-4o-mini"       # model name for the chosen provider
    normalizer_max_concurrency: int = 5         # max concurrent LLM calls

    # ── Geocoding ─────────────────────────────────────────────────────────────
    geocoding_api_key: str = ""   # optional — stub for Iteration 5

    # ── Auth ──────────────────────────────────────────────────────────────────
    auth_secret: str = ""          # optional - required by Next.js

    # ── App ───────────────────────────────────────────────────────────────────
    next_public_app_url: str = "http://localhost:3000"


settings = Settings()
