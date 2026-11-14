import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, enum_column
from app.models.enums import DocumentCategory


class DocumentType(TimestampMixin, Base):
    __tablename__ = "document_types"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(sa.String(100), unique=True)
    name: Mapped[str] = mapped_column(sa.String(200))
    name_hi: Mapped[str | None] = mapped_column(sa.String(300))
    description: Mapped[str | None] = mapped_column(sa.Text)
    category: Mapped[DocumentCategory] = mapped_column(
        enum_column(DocumentCategory, "document_category")
    )
