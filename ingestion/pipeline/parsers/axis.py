from .base import BaseCSVParser


class AxisParser(BaseCSVParser):
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
