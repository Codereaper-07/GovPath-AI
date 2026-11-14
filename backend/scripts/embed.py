"""Chunk stored official-source text and embed new/changed chunks with Gemini. MANUAL ONLY.

Re-uses content already ingested into the database (no website fetching). Unchanged chunks
with a current embedding (same model + dimension) are skipped, so re-runs cost nothing.

Usage (from backend/):
  python -m scripts.embed --dry-run        # chunk + report what would be embedded; no API calls
  python -m scripts.embed                  # embed pending chunks (uses Gemini quota)
  python -m scripts.embed --limit 32       # at most 32 chunks this run
  python -m scripts.embed --source URL     # only this source
"""

import argparse
import asyncio
import math

from app.config import get_settings
from app.llm.client import GeminiClient, UsageGuard
from app.rag.indexer import check_embedding_config, count_pending, embed_pending, sync_chunks


async def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--batch-size", type=int)
    parser.add_argument("--source", action="append", default=[])
    args = parser.parse_args()

    settings = get_settings()
    check_embedding_config(settings)
    from app.db import dispose_engine, get_sessionmaker

    async with get_sessionmaker()() as session:
        sync = await sync_chunks(session, settings, source_urls=args.source or None)
        await session.commit()
        pending, total = await count_pending(session, settings)
        batch = args.batch_size or settings.rag_embed_batch_size
        todo = pending if args.limit is None else min(pending, args.limit)
        print(
            f"chunks: {total} total ({sync.created} new, {sync.kept} unchanged, "
            f"{sync.deleted} removed) across {sync.sources} sources"
        )
        print(
            f"model {settings.gemini_embedding_model} @ {settings.embedding_dim} dims: "
            f"{pending} need embedding -> {todo} this run in ~{math.ceil(todo / batch)} request(s)"
        )
        if args.dry_run or todo == 0:
            await dispose_engine()
            return 0
        guard = UsageGuard(
            min_interval=settings.gemini_min_interval_seconds,
            daily_limits={"embedding": settings.gemini_daily_embedding_limit},
        )
        client = GeminiClient(settings, guard=guard)
        stats = await embed_pending(session, settings, client, limit=args.limit, batch_size=batch)
    await dispose_engine()
    print(f"embedded {stats.embedded} chunk(s) in {stats.requests} request(s)")
    if stats.stopped_reason:
        print(
            f"stopped early: {stats.stopped_reason}. Progress was saved; re-run later to continue."
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
