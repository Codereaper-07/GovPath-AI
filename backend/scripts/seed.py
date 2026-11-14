"""Load the curated knowledge base (data/knowledge/) into the database. Idempotent.

Usage (from backend/):
  python -m scripts.seed           # validate + upsert, then commit
  python -m scripts.seed --check   # validate the JSON files only; no database needed
"""

import argparse
import asyncio

from app.knowledge.seed import apply_seed, load_seed_data


async def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    data = load_seed_data()
    n_evidence = sum(len(s.evidence) for s in data.sources)
    print(
        f"seed files valid: {len(data.services)} services, {len(data.documents)} document types, "
        f"{len(data.sources)} sources, {n_evidence} evidence excerpts"
    )
    if args.check:
        return 0

    from app.db import dispose_engine, get_engine, get_sessionmaker

    get_engine()
    async with get_sessionmaker()() as session:
        report = await apply_seed(session, data)
        await session.commit()
    await dispose_engine()
    print("created:", report.created or "nothing (already up to date)")
    print("totals: ", report.totals)
    print("verification status:", report.status_counts)
    for w in report.warnings:
        print("warning:", w)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
