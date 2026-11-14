"""Manual live check of row-level security on Supabase: `python -m scripts.check_rls`.

Everything runs inside ONE transaction that is always rolled back: two throwaway auth users and
profiles are created, then queries run as Supabase's `authenticated` and `anon` roles (what the
public Data API uses). Nothing persists. Never run from tests (tests must not touch Supabase).
"""

import asyncio
import json

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from app.config import get_settings
from app.db import build_engine

A = "aaaaaaaa-0000-4000-8000-00000000000a"
B = "bbbbbbbb-0000-4000-8000-00000000000b"
NEW = "dddddddd-0000-4000-8000-00000000000d"

# (description, SQL, expect permission error). Run as user A (`authenticated`).
AS_A = [
    ("A reads profiles: only own row", "select id::text from public.profiles", False),
    ("A reads B by id: 0 rows", f"select id from public.profiles where id = '{B}'", False),
    ("A updates own: denied", f"update public.profiles set city = 'x' where id = '{A}'", True),
    ("A updates B: denied", f"update public.profiles set city = 'x' where id = '{B}'", True),
    ("A inserts a profile: denied", f"insert into public.profiles (id) values ('{NEW}')", True),
    ("A deletes B: denied", f"delete from public.profiles where id = '{B}'", True),
    ("authenticated reads knowledge: denied", "select 1 from public.government_services", True),
    ("authenticated writes knowledge: denied", "update public.service_outputs set id = id", True),
]  # fmt: skip
AS_ANON = [
    ("anon reads profiles: denied", "select 1 from public.profiles", True),
    ("anon reads knowledge: denied", "select 1 from public.government_services", True),
    ("anon truncates knowledge: denied", "truncate public.source_chunks", True),
]


async def _attempt(c: AsyncConnection, sql: str, expect_error: bool) -> tuple[bool, str]:
    await c.execute(text("savepoint s"))
    try:
        result = await c.execute(text(sql))
        rows = result.all() if result.returns_rows else []
        await c.execute(text("release savepoint s"))
        return not expect_error, f"rows={rows}"
    except Exception as exc:  # noqa: BLE001 - permission errors are the expected outcome
        await c.execute(text("rollback to savepoint s"))
        return expect_error, type(exc.__cause__ or exc).__name__


async def main() -> None:
    engine = build_engine(get_settings())
    results: list[tuple[str, bool, str]] = []
    async with engine.connect() as c:
        tx = await c.begin()
        try:
            for uid in (A, B):
                await c.execute(
                    text("insert into auth.users (id, email, aud, role) values (:id, :email, "
                         "'authenticated', 'authenticated')"),
                    {"id": uid, "email": f"rls-check-{uid[:4]}@example.invalid"},
                )  # fmt: skip
                await c.execute(text("insert into public.profiles (id) values (:id)"), {"id": uid})

            await c.execute(text("savepoint as_a"))
            await c.execute(text("set local role authenticated"))
            claims = json.dumps({"sub": A, "role": "authenticated"})
            await c.execute(
                text("select set_config('request.jwt.claims', :c, true)"), {"c": claims}
            )
            for name, sql, expect_error in AS_A:
                ok, detail = await _attempt(c, sql, expect_error)
                if name.startswith("A reads profiles"):
                    ok = ok and detail == f"rows=[('{A}',)]"
                results.append((name, ok, detail))
            await c.execute(text("rollback to savepoint as_a"))

            await c.execute(text("savepoint as_anon"))
            await c.execute(text("set local role anon"))
            for name, sql, expect_error in AS_ANON:
                results.append((name, *(await _attempt(c, sql, expect_error))))
            await c.execute(text("rollback to savepoint as_anon"))

            ok, detail = await _attempt(c, "select 1 from public.government_services", False)
            results.append(("backend role still reads knowledge", ok, detail))
            await c.execute(text(f"delete from auth.users where id = '{A}'"))
            left = (
                await c.execute(text(f"select count(*) from public.profiles where id = '{A}'"))
            ).scalar()
            results.append(("deleting the auth user deletes the profile", left == 0, str(left)))
        finally:
            await tx.rollback()
    await engine.dispose()
    for name, ok, detail in results:
        print("PASS" if ok else "FAIL", name, "|", detail)
    print(f"{sum(ok for _, ok, _ in results)}/{len(results)} passed (transaction rolled back)")


if __name__ == "__main__":
    asyncio.run(main())
