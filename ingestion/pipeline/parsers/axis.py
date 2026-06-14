import re

from .base import BaseCSVParser, NarrationResult


class AxisParser(BaseCSVParser):
    AXIS_NARRATION_CODES: dict[str, tuple[str, str]] = {
        "ICONN": ("NEFT", "Transfer"),
        "VMT-ICON": ("Transfer", "Transfer"),
        "VMT": ("Transfer", "Transfer"),
        "AUTOSWEEP": ("Transfer", "Investment"),
        "REV SWEEP": ("Transfer", "Interest"),
        "SWEEP TRF": ("Transfer", "Transfer"),
        "CWDR": ("ATM", "ATM Withdrawal"),
        "PUR": ("POS", "Shopping"),
        "TIP/SCG": ("Other", "Charges"),
        "RATE.DIFF": ("Other", "Charges"),
        "CLG": ("Cheque", "Transfer"),
        "EDC": ("POS", "Shopping"),
        "SETU": ("IMPS", "Transfer"),
        "INT.PD": ("Other", "Interest"),
    }

    @property
    def bank_name(self) -> str:
        return "Axis Bank"

    @property
    def bank_code(self) -> str:
        return "Axis"

    @property
    def column_map(self) -> dict[str, list[str]]:
        return {
            "date": ["date", "tran date"],
            "narration": ["particulars", "narration", "description"],
            "debit": ["debit", "dr", "withdrawal"],
            "credit": ["credit", "cr", "deposit"],
            "reference": ["chq no", "reference", "ref no"],
            "balance": ["balance"],
        }

    def normalize_narration(self, narration: str) -> NarrationResult | None:
        """Handle Axis Bank narration codes.

        Axis narrations start with a short code indicating the
        transaction type, followed by additional details.
        """
        upper = narration.upper().strip()

        # Sort by length descending to match longest prefix first
        # e.g. VMT-ICON before VMT
        for code, (payment_method, category) in sorted(
            self.AXIS_NARRATION_CODES.items(),
            key=lambda x: len(x[0]),
            reverse=True,
        ):
            if upper.startswith(code.upper()):
                # Extract merchant from remainder of narration
                remainder = narration[len(code):].strip().lstrip("-").strip()
                merchant = remainder[:50].title() if remainder else code.title()

                return NarrationResult(
                    merchant=merchant,
                    payment_method=payment_method,
                    category=category,
                    subcategory=None,
                    needs_llm=False,
                )
        return None
