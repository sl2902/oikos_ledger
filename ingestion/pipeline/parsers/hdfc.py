from .base import BaseCSVParser, ParsedRow


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
    
    def parse_csv(self, file_content: str) -> list[ParsedRow]:
        """Override base parse_csv to handle HDFC narrations with embedded commas.
        
        HDFC exports narrations without quoting even when they contain commas,
        causing column overflow. Re-join split narration fields before parsing.
        """
        lines = file_content.strip().splitlines()
        if not lines:
            return []

        # Find header line
        header_line = next((l for l in lines if l.strip()), None)
        if not header_line:
            return []

        raw_headers = [h.strip() for h in header_line.split(",")]
        expected_cols = len(raw_headers)
        header_map = self.detect_headers(raw_headers)
        if not self.validate_headers(header_map):
            raise ValueError(
                f"{self.bank_name} parser: required columns not found. "
                f"Got: {raw_headers}"
            )

        rows: list[ParsedRow] = []
        for i, line in enumerate(lines[1:]):  # skip header
            if not line.strip():
                continue

            parts = line.split(",")
            if len(parts) > expected_cols:
                # Narration contains embedded comma — rejoin middle fields
                tail_count = expected_cols - 2
                date = parts[0]
                tail = parts[-tail_count:]
                narration = ",".join(parts[1:-tail_count])
                parts = [date, narration] + tail

            if len(parts) != expected_cols:
                continue  # skip malformed rows

            row = dict(zip(raw_headers, [p.strip() for p in parts]))
            parsed = self._parse_row(row, header_map)
            if parsed is not None:
                parsed["row_number"] = i
                rows.append(parsed)

        return rows
    
    # logic carried into parse_csv()
    def _fix_split_narration(self, row: list[str]) -> list[str]:
        """Re-join narration fields split by embedded commas.
        
        HDFC exports narrations without quoting even when they contain
        commas. Detect overflow by checking if column count exceeds 7
        and re-join the middle fields as narration.
        
        Expected columns: Date, Narration, Value Date, Debit, Credit, Ref, Balance
        """
        EXPECTED_COLS = 7
        if len(row) <= EXPECTED_COLS:
            return row
        
        # Extra columns = narration was split
        # Last 5 columns are always: Value Date, Debit, Credit, Ref, Balance
        date = row[0]
        tail = row[-(EXPECTED_COLS - 2):]  # Value Date, Debit, Credit, Ref, Balance
        narration = ",".join(row[1:-(EXPECTED_COLS - 2)])  # rejoin middle parts
        return [date, narration] + tail
