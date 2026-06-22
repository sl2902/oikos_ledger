"""SQLModel table definitions for merchants, categories, transactions, and transaction_amendments."""

import uuid
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Any, List, Optional

import sqlalchemy as sa
from geoalchemy2 import Geometry
from pgvector.sqlalchemy import Vector
from sqlalchemy import Column, Index, Numeric, UniqueConstraint, text
from sqlmodel import Field, SQLModel


class AccountType(str, Enum):
    checking = "checking"
    savings = "savings"
    credit = "credit"


class TransactionType(str, Enum):
    debit = "debit"
    credit = "credit"


class AmendedBy(str, Enum):
    user = "user"
    system = "system"


class Merchant(SQLModel, table=True):
    __tablename__ = "merchants"
    __table_args__ = (
        UniqueConstraint("canonical_name", name="uq_merchants_canonical_name"),
    )

    id: uuid.UUID = Field(
        default=None,
        sa_column=Column(sa.UUID, primary_key=True, server_default=text("gen_random_uuid()")),
    )
    global_merchant_id: Optional[str] = Field(default=None)
    canonical_name: str
    category: str
    subcategory: Optional[str] = Field(default=None)
    location: Optional[Any] = Field(
        default=None,
        sa_column=Column("location", Geometry("POINT", srid=4326), nullable=True),
    )
    embedding: List[float] = Field(
        sa_column=Column("embedding", Vector(1536), nullable=False),
    )
    created_at: datetime = Field(
        default=None,
        sa_column=Column(
            sa.TIMESTAMP(timezone=True),
            server_default=text("timezone('utc', now())"),
            nullable=False,
        ),
    )
    updated_at: datetime = Field(
        default=None,
        sa_column=Column(
            sa.TIMESTAMP(timezone=True),
            server_default=text("timezone('utc', now())"),
            onupdate=text("timezone('utc', now())"),
            nullable=False,
        ),
    )


class Category(SQLModel, table=True):
    __tablename__ = "categories"

    id: uuid.UUID = Field(
        default=None,
        sa_column=Column(sa.UUID, primary_key=True, server_default=text("gen_random_uuid()")),
    )
    name: str
    parent_id: Optional[uuid.UUID] = Field(default=None, foreign_key="categories.id")
    icon: Optional[str] = Field(default=None)
    color: Optional[str] = Field(default=None)
    created_at: datetime = Field(
        default=None,
        sa_column=Column(
            sa.TIMESTAMP(timezone=True),
            server_default=text("timezone('utc', now())"),
            nullable=False,
        ),
    )


class Transaction(SQLModel, table=True):
    __tablename__ = "transactions"
    __table_args__ = (
        Index(
            "uq_transactions_ref_number",
            "user_id", "account_id", "reference_number",
            unique=True,
            postgresql_where=text("reference_number IS NOT NULL"),
        ),
        Index(
            "uq_transactions_composite",
            "user_id", "account_id", "transaction_date",
            "amount", "transaction_type", "raw_description",
            "closing_balance",
            unique=True,
        ),
    )

    id: uuid.UUID = Field(
        default=None,
        sa_column=Column(sa.UUID, primary_key=True, server_default=text("gen_random_uuid()")),
    )
    user_id: uuid.UUID = Field(foreign_key="users.id")
    account_id: uuid.UUID = Field(foreign_key="bank_accounts.id")
    merchant_id: Optional[uuid.UUID] = Field(default=None, foreign_key="merchants.id")
    upload_id: uuid.UUID = Field(foreign_key="uploads.id")
    row_number: Optional[int] = Field(default=None)
    transaction_date: date
    raw_description: str
    normalized_merchant: str
    amount: Decimal = Field(sa_column=Column("amount", Numeric(12, 2), nullable=False))
    closing_balance: Optional[Decimal] = Field(
        default=None,
        sa_column=Column("closing_balance", Numeric(15, 2), nullable=True),
    )
    currency: str
    transaction_type: TransactionType
    reference_number: Optional[str] = Field(default=None)
    category: str
    subcategory: Optional[str] = Field(default=None)
    payment_method: str
    location: Optional[Any] = Field(
        default=None,
        sa_column=Column("location", Geometry("POINT", srid=4326), nullable=True),
    )
    embedding: List[float] = Field(
        sa_column=Column("embedding", Vector(1536), nullable=False),
    )
    created_at: datetime = Field(
        default=None,
        sa_column=Column(
            sa.TIMESTAMP(timezone=True),
            server_default=text("timezone('utc', now())"),
            nullable=False,
        ),
    )
    # no updated_at — append-only table


class TransactionAmendment(SQLModel, table=True):
    __tablename__ = "transaction_amendments"

    id: uuid.UUID = Field(
        default=None,
        sa_column=Column(sa.UUID, primary_key=True, server_default=text("gen_random_uuid()")),
    )
    transaction_id: uuid.UUID = Field(foreign_key="transactions.id")
    amendment_group_id: uuid.UUID
    user_id: uuid.UUID = Field(foreign_key="users.id")
    field_name: str
    old_value: str
    new_value: str
    amended_by: AmendedBy
    reason: Optional[str] = Field(default=None)
    amended_at: datetime = Field(
        default=None,
        sa_column=Column(
            sa.TIMESTAMP(timezone=True),
            server_default=text("timezone('utc', now())"),
            nullable=False,
        ),
    )
    # no updated_at — append-only table
