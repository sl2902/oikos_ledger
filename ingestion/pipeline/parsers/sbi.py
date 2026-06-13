from .base import BaseCSVParser


class SBIParser(BaseCSVParser):
    @property
    def bank_name(self) -> str:
        return "State Bank of India"

    @property
    def bank_code(self) -> str:
        return "SBI"

    @property
    def column_map(self) -> dict[str, list[str]]:
        return {
            "date": ["txn date", "date"],
            "narration": ["description", "narration", "particulars"],
            "debit": ["withdrawal amt", "debit", "withdrawal"],
            "credit": ["deposit amt", "credit", "deposit"],
            "reference": ["ref no./cheque no.", "reference", "cheque no"],
            "balance": ["balance"],
        }
