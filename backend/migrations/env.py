import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy.engine import Connection

from app.config import get_settings
from app.db import build_engine
from app.models import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

# Database objects managed outside this metadata (see 0007/0008): foreign keys to Supabase's
# auth.users. Skipped so `alembic check` does not try to drop it.
UNMANAGED = {
    ("foreign_key_constraint", "fk_profiles_id_users"),
    *(
        ("foreign_key_constraint", f"fk_{t}_user_id_users")
        for t in ("vault_documents", "service_progress", "user_plans", "activity_events")
    ),
}


def include_object(obj, name, type_, reflected, compare_to) -> bool:
    return (type_, name) not in UNMANAGED


def run_migrations_offline() -> None:
    context.configure(
        url=get_settings().sqlalchemy_database_url,
        target_metadata=target_metadata,
        include_object=include_object,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def _do_run(connection: Connection) -> None:
    context.configure(
        connection=connection, target_metadata=target_metadata, include_object=include_object
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    engine = build_engine(get_settings())
    async with engine.connect() as connection:
        await connection.run_sync(_do_run)
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
