"""SQLModel table definitions for users, bank_accounts, and uploads."""

import uuid
from datetime import datetime
from enum import Enum
from typing import Optional

from decimal import Decimal

import sqlalchemy as sa
from sqlalchemy import JSON, Column, Numeric, UniqueConstraint, text
from sqlmodel import Field, SQLModel


class UploadStatus(str, Enum):
    pending = "pending"
    processing = "processing"
    complete = "complete"
    failed = "failed"
    cancelled = "cancelled"


class User(SQLModel, table=True):
    __tablename__ = "users"

    id: uuid.UUID = Field(
        default=None,
        sa_column=Column(sa.UUID, primary_key=True, server_default=text("gen_random_uuid()")),
    )
    email: str = Field(unique=True)
    first_name: str
    last_name: Optional[str] = Field(default=None)
    country_code: str
    currency: str
    income_bracket: Optional[str] = Field(default=None)
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


class BankAccount(SQLModel, table=True):
    __tablename__ = "bank_accounts"

    id: uuid.UUID = Field(
        default=None,
        sa_column=Column(sa.UUID, primary_key=True, server_default=text("gen_random_uuid()")),
    )
    user_id: uuid.UUID = Field(foreign_key="users.id")
    bank_name: str
    account_type: str  # AccountType enum value
    account_nickname: Optional[str] = Field(default=None)
    currency: str
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


class Upload(SQLModel, table=True):
    __tablename__ = "uploads"
    __table_args__ = (
        UniqueConstraint("user_id", "account_id", "file_hash", name="uq_uploads_user_account_hash"),
    )

    id: uuid.UUID = Field(
        default=None,
        sa_column=Column(sa.UUID, primary_key=True, server_default=text("gen_random_uuid()")),
    )
    user_id: uuid.UUID = Field(foreign_key="users.id")
    account_id: uuid.UUID = Field(foreign_key="bank_accounts.id")
    filename: str
    file_hash: Optional[str] = Field(default=None)
    s3_key: str
    status: UploadStatus = Field(default=UploadStatus.pending)
    row_count: Optional[int] = Field(default=None)
    error_message: Optional[str] = Field(default=None)
    uploaded_at: datetime = Field(
        default=None,
        sa_column=Column(
            sa.TIMESTAMP(timezone=True),
            server_default=text("timezone('utc', now())"),
            nullable=False,
        ),
    )
    completed_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(sa.TIMESTAMP(timezone=True), nullable=True),
    )
    opening_balance: Optional[Decimal] = Field(
        default=None,
        sa_column=Column(Numeric(15, 2)),
    )
    closing_balance: Optional[Decimal] = Field(
        default=None,
        sa_column=Column(Numeric(15, 2)),
    )
    balance_verified: Optional[bool] = Field(default=None)
    balance_discrepancy: Optional[Decimal] = Field(
        default=None,
        sa_column=Column(Numeric(15, 2)),
    )
    dropped_rows: Optional[list] = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
