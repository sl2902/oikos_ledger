from .base import BaseCSVParser


class ICICIParser(BaseCSVParser):
    @property
    def bank_name(self) -> str:
        return "ICICI Bank"

    @property
    def bank_code(self) -> str:
        return "ICICI"

    @property
    def column_map(self) -> dict[str, list[str]]:
        return {
            "date": ["date", "transaction date"],
            "narration": ["particulars", "narration", "description"],
            "debit": ["withdrawal amt (dr.)", "withdrawal", "debit", "dr"],
            "credit": ["deposit amt (cr.)", "deposit", "credit", "cr"],
            "reference": ["cheque number", "reference", "ref no"],
            "balance": ["balance"],
        }
