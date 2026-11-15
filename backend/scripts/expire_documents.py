"""Process vault documents whose expiry date has passed: `python -m scripts.expire_documents`
(`--dry-run` only counts what is due and writes nothing).

Idempotent (safe to run any number of times a day). Schedule it daily shortly after 00:00 IST,
e.g. cron `5 0 * * *` with TZ=Asia/Kolkata (or `35 18 * * *` in UTC). Account pages also catch up
on read, so a missed run only delays the history entry, never a plan's correctness.
"""

import asyncio
import sys

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.account.service import _due, expire_all, today
from app.config import get_settings
from app.db import build_engine


async def main(dry_run: bool) -> None:
    engine = build_engine(get_settings())
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            if dry_run:
                due = _due(today()).subquery()
                n = (await session.execute(select(func.count()).select_from(due))).scalar()
                print(f"{today().isoformat()} (IST): {n} document(s) due; dry run, nothing written")
                return
            run = await expire_all(session, cache=None)
        print(
            f"{today().isoformat()} (IST): {run.documents} document(s) expired for "
            f"{run.users} user(s); {run.plans_changed} saved plan(s) changed"
        )
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main("--dry-run" in sys.argv))
