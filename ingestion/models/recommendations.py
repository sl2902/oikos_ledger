"""SQLModel table definitions for insights, recommendations, query_cache, voice_sessions, and voice_messages."""

import uuid
from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Any, Dict, List, Optional

import sqlalchemy as sa
from pgvector.sqlalchemy import Vector
from sqlalchemy import Column, Numeric, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class RecommendationType(str, Enum):
    reduce_spending = "reduce_spending"
    shift_category = "shift_category"
    macro_alert = "macro_alert"


class RecommendationPriority(str, Enum):
    high = "high"
    medium = "medium"
    low = "low"


class VoiceRole(str, Enum):
    user = "user"
    assistant = "assistant"


class Insight(SQLModel, table=True):
    __tablename__ = "insights"
    __table_args__ = (
        UniqueConstraint("user_id", "period", "category", name="uq_insights_user_period_category"),
    )

    id: uuid.UUID = Field(
        default=None,
        sa_column=Column(sa.UUID, primary_key=True, server_default=text("gen_random_uuid()")),
    )
    user_id: uuid.UUID = Field(foreign_key="users.id")
    period: str  # YYYY-MM
    category: str
    total_amount: Decimal = Field(
        sa_column=Column("total_amount", Numeric(12, 2), nullable=False)
    )
    transaction_count: int
    avg_amount: Decimal = Field(
        sa_column=Column("avg_amount", Numeric(12, 2), nullable=False)
    )
    mom_delta: Decimal = Field(
        sa_column=Column("mom_delta", Numeric(12, 2), nullable=False)
    )
    last_upload_id: uuid.UUID = Field(foreign_key="uploads.id")
    computed_at: datetime = Field(
        default=None,
        sa_column=Column(
            sa.TIMESTAMP(timezone=True),
            server_default=text("timezone('utc', now())"),
            nullable=False,
        ),
    )


class Recommendation(SQLModel, table=True):
    __tablename__ = "recommendations"
    __table_args__ = (
        UniqueConstraint("user_id", "type", "category", name="uq_recommendations_user_type_category"),
    )

    id: uuid.UUID = Field(
        default=None,
        sa_column=Column(sa.UUID, primary_key=True, server_default=text("gen_random_uuid()")),
    )
    user_id: uuid.UUID = Field(foreign_key="users.id")
    type: RecommendationType
    priority: RecommendationPriority
    message: str
    supporting_data: Dict[str, Any] = Field(
        sa_column=Column("supporting_data", JSONB, nullable=False)
    )
    category: Optional[str] = Field(default=None)
    macro_indicator: Optional[str] = Field(default=None)
    is_dismissed: bool = Field(default=False)
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


class QueryCache(SQLModel, table=True):
    __tablename__ = "query_cache"
    __table_args__ = (
        UniqueConstraint("user_id", "query_hash", name="uq_query_cache_user_query"),
    )

    id: uuid.UUID = Field(
        default=None,
        sa_column=Column(sa.UUID, primary_key=True, server_default=text("gen_random_uuid()")),
    )
    user_id: uuid.UUID = Field(foreign_key="users.id")
    query_hash: str
    query_text: str
    query_embedding: List[float] = Field(
        sa_column=Column("query_embedding", Vector(1536), nullable=False)
    )
    result: Dict[str, Any] = Field(
        sa_column=Column("result", JSONB, nullable=False)
    )
    expires_at: datetime = Field(
        sa_column=Column(sa.TIMESTAMP(timezone=True), nullable=False)
    )
    created_at: datetime = Field(
        default=None,
        sa_column=Column(
            sa.TIMESTAMP(timezone=True),
            server_default=text("timezone('utc', now())"),
            nullable=False,
        ),
    )


class VoiceSession(SQLModel, table=True):
    __tablename__ = "voice_sessions"

    id: uuid.UUID = Field(
        default=None,
        sa_column=Column(sa.UUID, primary_key=True, server_default=text("gen_random_uuid()")),
    )
    user_id: uuid.UUID = Field(foreign_key="users.id")
    started_at: datetime = Field(
        default=None,
        sa_column=Column(
            sa.TIMESTAMP(timezone=True),
            server_default=text("timezone('utc', now())"),
            nullable=False,
        ),
    )
    ended_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(sa.TIMESTAMP(timezone=True), nullable=True),
    )


class VoiceMessage(SQLModel, table=True):
    __tablename__ = "voice_messages"

    id: uuid.UUID = Field(
        default=None,
        sa_column=Column(sa.UUID, primary_key=True, server_default=text("gen_random_uuid()")),
    )
    session_id: uuid.UUID = Field(foreign_key="voice_sessions.id")
    role: VoiceRole
    content: str
    generated_query: Optional[str] = Field(default=None)
    created_at: datetime = Field(
        default=None,
        sa_column=Column(
            sa.TIMESTAMP(timezone=True),
            server_default=text("timezone('utc', now())"),
            nullable=False,
        ),
    )
