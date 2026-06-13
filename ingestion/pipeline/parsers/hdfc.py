from .base import BaseCSVParser


class HDFCParser(BaseCSVParser):
    @property
    def bank_name(self) -> str:
        return "HDFC Bank"

    @property
    def bank_code(self) -> str:
        return "HDFC"

    @property
    def column_map(self) -> dict[str, list[str]]:
        return {
            "date": ["date"],
            "narration": ["narration", "description"],
            "debit": ["debit amount", "withdrawal", "debit"],
            "credit": ["credit amount", "deposit", "credit"],
            "reference": ["chq/ref number", "reference", "ref"],
            "balance": ["closing balance", "balance"],
            "value_date": ["value dat", "value date"],
        }
