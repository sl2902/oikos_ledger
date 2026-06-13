"""SQLModel table definitions for macro_economic_data."""

import uuid
from datetime import datetime
from decimal import Decimal
from enum import Enum

import sqlalchemy as sa
from sqlalchemy import Column, Numeric, UniqueConstraint, text
from sqlmodel import Field, SQLModel


class MacroIndicator(str, Enum):
    gdp_growth = "gdp_growth"
    inflation = "inflation"
    food_inflation = "food_inflation"
    gdp_per_capita = "gdp_per_capita"


class MacroEconomicData(SQLModel, table=True):
    __tablename__ = "macro_economic_data"
    __table_args__ = (
        UniqueConstraint("country_code", "indicator", "period", name="uq_macro_country_indicator_period"),
    )

    id: uuid.UUID = Field(
        default=None,
        sa_column=Column(sa.UUID, primary_key=True, server_default=text("gen_random_uuid()")),
    )
    country_code: str
    indicator: MacroIndicator
    period: str  # YYYY-MM
    value: Decimal = Field(sa_column=Column("value", Numeric(12, 4), nullable=False))
    source: str  # world_bank | rbi
    fetched_at: datetime = Field(
        default=None,
        sa_column=Column(
            sa.TIMESTAMP(timezone=True),
            server_default=text("timezone('utc', now())"),
            nullable=False,
        ),
    )
