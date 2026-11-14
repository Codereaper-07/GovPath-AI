"""Government services, their document requirements, outputs and verified prerequisites."""

from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, JSONType, TimestampMixin, enum_column
from app.models.document import DocumentType
from app.models.enums import Jurisdiction, RequirementType, VerificationStatus
from app.models.source import Evidence

service_evidence = sa.Table(
    "service_evidence",
    Base.metadata,
    sa.Column(
        "service_id",
        sa.ForeignKey("government_services.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    sa.Column("evidence_id", sa.ForeignKey("evidence.id", ondelete="CASCADE"), primary_key=True),
)

requirement_evidence = sa.Table(
    "requirement_evidence",
    Base.metadata,
    sa.Column(
        "requirement_id",
        sa.ForeignKey("service_requirements.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    sa.Column("evidence_id", sa.ForeignKey("evidence.id", ondelete="CASCADE"), primary_key=True),
)


class GovernmentService(TimestampMixin, Base):
    __tablename__ = "government_services"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(sa.String(100), unique=True)
    name: Mapped[str] = mapped_column(sa.String(200))
    name_hi: Mapped[str | None] = mapped_column(sa.String(300))
    description: Mapped[str] = mapped_column(sa.Text)
    description_hi: Mapped[str | None] = mapped_column(sa.Text)
    authority: Mapped[str] = mapped_column(sa.String(200))
    jurisdiction: Mapped[Jurisdiction] = mapped_column(enum_column(Jurisdiction, "jurisdiction"))
    state: Mapped[str | None] = mapped_column(sa.String(100))
    category: Mapped[str] = mapped_column(sa.String(50), index=True)
    # Life-event categories (app.models.enums.LifeEvent values) this service belongs to.
    life_events: Mapped[list[str]] = mapped_column(JSONType, default=list, server_default="[]")
    # Citizen goals (app.models.enums.CitizenGoal values) this service directly serves.
    goals: Mapped[list[str]] = mapped_column(JSONType, default=list, server_default="[]")
    application_form: Mapped[str | None] = mapped_column(sa.String(100))
    official_info_url: Mapped[str] = mapped_column(sa.String(1000))
    application_url: Mapped[str | None] = mapped_column(sa.String(1000))
    verification_notes: Mapped[str | None] = mapped_column(sa.Text)
    is_active: Mapped[bool] = mapped_column(default=True, server_default=sa.true())
    last_verified_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))

    requirements: Mapped[list["ServiceRequirement"]] = relationship(
        back_populates="service",
        cascade="all, delete-orphan",
        order_by="ServiceRequirement.sort_order",
    )
    outputs: Mapped[list["ServiceOutput"]] = relationship(
        back_populates="service", cascade="all, delete-orphan"
    )
    prerequisites: Mapped[list["ServicePrerequisite"]] = relationship(
        back_populates="service",
        cascade="all, delete-orphan",
        foreign_keys="ServicePrerequisite.service_id",
    )
    evidence: Mapped[list[Evidence]] = relationship(secondary=service_evidence)


class ServiceRequirement(TimestampMixin, Base):
    """One requirement of a service. Its options form an OR group: any one satisfies it."""

    __tablename__ = "service_requirements"
    __table_args__ = (sa.UniqueConstraint("service_id", "slug"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    service_id: Mapped[int] = mapped_column(
        sa.ForeignKey("government_services.id", ondelete="CASCADE"), index=True
    )
    slug: Mapped[str] = mapped_column(sa.String(100))
    name: Mapped[str] = mapped_column(sa.String(200))
    name_hi: Mapped[str | None] = mapped_column(sa.String(300))
    description: Mapped[str | None] = mapped_column(sa.Text)
    requirement_type: Mapped[RequirementType] = mapped_column(
        enum_column(RequirementType, "requirement_type")
    )
    condition: Mapped[str | None] = mapped_column(sa.Text)  # for conditional requirements
    notes: Mapped[str | None] = mapped_column(sa.Text)
    sort_order: Mapped[int] = mapped_column(default=0, server_default="0")
    verification_status: Mapped[VerificationStatus] = mapped_column(
        enum_column(VerificationStatus, "requirement_verification_status"),
        default=VerificationStatus.UNVERIFIED,
        server_default=VerificationStatus.UNVERIFIED.value,
    )
    verified_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))

    service: Mapped[GovernmentService] = relationship(back_populates="requirements")
    options: Mapped[list["RequirementOption"]] = relationship(
        back_populates="requirement", cascade="all, delete-orphan", order_by="RequirementOption.id"
    )
    evidence: Mapped[list[Evidence]] = relationship(secondary=requirement_evidence)


class RequirementOption(Base):
    """A document that satisfies a requirement (one member of its OR group)."""

    __tablename__ = "requirement_options"
    __table_args__ = (sa.UniqueConstraint("requirement_id", "document_type_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    requirement_id: Mapped[int] = mapped_column(
        sa.ForeignKey("service_requirements.id", ondelete="CASCADE"), index=True
    )
    document_type_id: Mapped[int] = mapped_column(
        sa.ForeignKey("document_types.id", ondelete="RESTRICT"), index=True
    )
    notes: Mapped[str | None] = mapped_column(sa.Text)  # e.g. "not older than 3 months"
    evidence_id: Mapped[int | None] = mapped_column(
        sa.ForeignKey("evidence.id", ondelete="SET NULL")
    )

    requirement: Mapped[ServiceRequirement] = relationship(back_populates="options")
    document_type: Mapped[DocumentType] = relationship()
    evidence: Mapped[Evidence | None] = relationship()


class ServiceOutput(Base):
    """A document a service issues or updates (used for acquisition routes)."""

    __tablename__ = "service_outputs"

    service_id: Mapped[int] = mapped_column(
        sa.ForeignKey("government_services.id", ondelete="CASCADE"), primary_key=True
    )
    document_type_id: Mapped[int] = mapped_column(
        sa.ForeignKey("document_types.id", ondelete="RESTRICT"), primary_key=True
    )
    evidence_id: Mapped[int | None] = mapped_column(
        sa.ForeignKey("evidence.id", ondelete="SET NULL")
    )

    service: Mapped[GovernmentService] = relationship(back_populates="outputs")
    document_type: Mapped[DocumentType] = relationship()
    evidence: Mapped[Evidence | None] = relationship()


class ServicePrerequisite(TimestampMixin, Base):
    """A verified, unconditional 'must complete B before A' relationship.

    Only created when an official source states it; evidence is mandatory.
    """

    __tablename__ = "service_prerequisites"
    __table_args__ = (
        sa.UniqueConstraint("service_id", "prerequisite_service_id"),
        sa.CheckConstraint("service_id <> prerequisite_service_id", name="not_self"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    service_id: Mapped[int] = mapped_column(
        sa.ForeignKey("government_services.id", ondelete="CASCADE"), index=True
    )
    prerequisite_service_id: Mapped[int] = mapped_column(
        sa.ForeignKey("government_services.id", ondelete="CASCADE"), index=True
    )
    evidence_id: Mapped[int] = mapped_column(sa.ForeignKey("evidence.id", ondelete="RESTRICT"))
    notes: Mapped[str | None] = mapped_column(sa.Text)
    verification_status: Mapped[VerificationStatus] = mapped_column(
        enum_column(VerificationStatus, "prerequisite_verification_status"),
        default=VerificationStatus.UNVERIFIED,
        server_default=VerificationStatus.UNVERIFIED.value,
    )

    service: Mapped[GovernmentService] = relationship(
        back_populates="prerequisites", foreign_keys=[service_id]
    )
    prerequisite: Mapped[GovernmentService] = relationship(foreign_keys=[prerequisite_service_id])
    evidence: Mapped[Evidence] = relationship()
