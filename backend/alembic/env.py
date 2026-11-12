from logging.config import fileConfig

from sqlalchemy import create_engine, pool

from alembic import context
from app.core.config import get_settings
from app.models import Base

config = context.config

if config.config_file_name is not None and config.attributes.get("configure_logger", True):
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def database_url() -> str:
    """Use a URL set on the Alembic config (tests), else DATABASE_URL from settings."""
    return config.get_main_option("sqlalchemy.url") or get_settings().database_url


def run_migrations_offline() -> None:
    """Write the migration SQL to stdout instead of running it (`alembic upgrade --sql`)."""
    context.configure(
        url=database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations against a live database.

    Tests can pass an open connection in config.attributes["connection"].
    """
    connection = config.attributes.get("connection")
    if connection is not None:
        _run_with(connection)
        return

    engine = create_engine(database_url(), poolclass=pool.NullPool)
    with engine.connect() as connection:
        _run_with(connection)


def _run_with(connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
