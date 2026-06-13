"""Pytest configuration and shared fixtures for the ingestion test suite.

Import pattern for tests that need settings:

    import ingestion.config as config
    ...
    def test_something():
        assert config.settings.db_provider == "local"   # sees the patched value

NOT:

    from ingestion.config import settings   # binds to the real object at import time
"""

import pytest

_TEST_DB_URL = "postgresql://postgres:postgres@localhost:5432/oikos_test"

_TEST_VALUES: dict[str, str] = {
    "database_url": _TEST_DB_URL,
    "database_url_direct": _TEST_DB_URL,
    "db_provider": "local",
    "aws_region": "us-east-1",
    "aws_s3_bucket": "test-bucket",
    "aws_lambda_function_name": "test-function",
    "anthropic_api_key": "test-anthropic-key",
    "openai_api_key": "test-openai-key",
    "geocoding_api_key": "test-geocoding-key",
    "auth_secret": "test-auth-secret",
    "next_public_app_url": "http://localhost:3000",
}


@pytest.fixture(autouse=True)
def override_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    """Override settings with test-safe values — uses local Docker PostgreSQL, not Supabase or Aurora."""
    import ingestion.config as config_module

    test_settings = config_module.Settings(**_TEST_VALUES)  # type: ignore[arg-type]
    monkeypatch.setattr(config_module, "settings", test_settings)
