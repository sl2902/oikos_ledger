"""Bedrock-based normalization client using Claude Haiku."""

import json
import logging
import time

import boto3
from botocore.exceptions import ClientError

from ingestion.config import settings
from ingestion.pipeline.normalizer import NormalizationResult

log = logging.getLogger(__name__)


class BedrockNormalizerClient:
    """Normalizer using Anthropic Claude Haiku via AWS Bedrock."""

    def __init__(self) -> None:
        self._client = boto3.client(
            "bedrock-runtime",
            region_name=settings.bedrock_region,
        )

    async def normalize(self, raw: str) -> NormalizationResult:
        """Normalize a raw narration string via Bedrock Claude Haiku.

        Retries up to max_retries on 429 and 500 errors.
        Raises on other errors — caller handles fallback.
        """
        prompt = _build_prompt(raw)
        model_id = settings.bedrock_normalizer_model

        log.info("Bedrock normalizer invoking model: %s", model_id)

        for attempt in range(settings.max_retries):
            try:
                # response = self._client.invoke_model(
                #     modelId=model_id,
                #     contentType="application/json",
                #     accept="application/json",
                #     body=json.dumps({
                #         "anthropic_version": "bedrock-2023-05-31",
                #         "max_tokens": 200,
                #         "temperature": 0,
                #         "messages": [
                #             {"role": "user", "content": prompt}
                #         ],
                #     }),
                # )
                # body = json.loads(response["body"].read())
                # text = body["content"][0]["text"].strip()

                response = self._client.converse(
                    modelId=model_id,
                    messages=[
                        {
                            "role": "user",
                            "content": [{"text": prompt}]
                        }
                    ],
                    inferenceConfig={
                        "maxTokens": 200,
                        "temperature": 0.0
                    }
                )
                
                # Cleanly extract text response from the standardized Bedrock output
                text = response["output"]["message"]["content"][0]["text"].strip()
                return _parse_response(text)

            except ClientError as e:
                code = e.response["Error"]["Code"]
                status = e.response["ResponseMetadata"]["HTTPStatusCode"]

                if status in (429, 500, 502, 503) and attempt < settings.max_retries - 1:
                    wait = settings.retry_backoff_seconds * (2 ** attempt)
                    log.warning(
                        "Bedrock normalizer error %s (attempt %d/%d) — retrying in %.1fs",
                        code, attempt + 1, settings.max_retries, wait,
                    )
                    time.sleep(wait)
                    continue

                log.error("Bedrock normalizer %s failed: %s — %s", model_id, code, str(e))
                raise

        raise RuntimeError("Bedrock normalizer max retries exceeded")


def _build_prompt(raw: str) -> str:
    return f"""You are a bank transaction normalizer.
Clean the merchant name from this bank narration string.

Rules:
- Fix capitalization only (title case)
- Remove payment codes, reference numbers, and bank codes
- Do NOT expand abbreviations or correct partial names
- Do NOT guess the full name if it is truncated
- Return the merchant name exactly as it appears, just cleaned

Category must be exactly one of:
Food, Shopping, Groceries, Transport, Fuel, Rent, EMI,
Salary, Investment, Insurance, Utilities, Recharge,
Entertainment, Medical, Education, Transfer, ATM Withdrawal,
Interest, Charges, Government, Other

Subcategory must be exactly one of these per category,
or null if none apply:
- Food: Food Delivery, Dining Out, Cafe, Bakery
- Groceries: Supermarket, Local Market, Online Grocery
- Transport: Ride Share, Public Transport, Parking, Toll
- Fuel: Petrol, Diesel
- Medical: Pharmacy, Doctor, Hospital, Lab, Insurance
- Utilities: Electricity, Water, Gas, Internet
- Recharge: Mobile Recharge, DTH
- Entertainment: Streaming, Movies, Gaming, Events
- Shopping: Online Shopping, Clothing, Electronics,
            Home, Personal Care
- EMI: Home Loan, Car Loan, Personal Loan, Education Loan
- Investment: Mutual Fund, Stocks, Fixed Deposit
- Finance: Credit Card, Bank Charges, Tax

Narration: {raw}

Respond with JSON only, no other text:
{{
  "merchant_name": "...",
  "category": "...",
  "subcategory": "..." or null
}}"""


def _parse_response(text: str) -> NormalizationResult:
    """Parse LLM JSON response into NormalizationResult."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    text = text.strip()

    data = json.loads(text)
    return NormalizationResult(
        merchant_name=data.get("merchant_name", "Unknown"),
        category=data.get("category", "Other"),
        subcategory=data.get("subcategory"),
    )
