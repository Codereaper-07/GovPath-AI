"""Fetch allowlisted official sources and store their extracted content.

Usage (from backend/):
  python -m scripts.ingest              # ingest all sources in data/sources/allowlist.json
  python -m scripts.ingest --dry-run    # fetch + extract only; no database needed
  python -m scripts.ingest --url URL    # only this source (must be in the allowlist file)
  python -m scripts.ingest --no-follow-pdfs
"""

import argparse
import asyncio
import dataclasses
import sys

from app.ingestion.allowlist import load_allowlist, normalize_url
from app.ingestion.fetcher import Fetcher
from app.ingestion.persistence import SourceStore
from app.ingestion.pipeline import IngestionPipeline, IngestionReport


def _print(report: IngestionReport) -> None:
    for r in report.results:
        prefix = "  ↳ " if r.parent_url else ""
        detail = r.error or (
            f"{r.source_type} {r.chars} chars, status={r.verification_status or '-'}, "
            f"evidence found {r.evidence_checked - r.evidence_missing}/{r.evidence_checked}"
        )
        print(f"{prefix}[{r.outcome.value:9}] {r.url}\n{prefix}            {detail}")
    print("summary:", report.summary)


async def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--url", action="append", default=[])
    parser.add_argument("--no-follow-pdfs", action="store_true")
    args = parser.parse_args()

    allowlist = load_allowlist()
    sources = list(allowlist.sources)
    if args.url:
        wanted = {normalize_url(u) for u in args.url}
        sources = [s for s in sources if s.url in wanted]
        if not sources:
            print("none of the given URLs are configured sources in the allowlist", file=sys.stderr)
            return 2
    if args.no_follow_pdfs:
        sources = [dataclasses.replace(s, follow_pdfs=False) for s in sources]

    async with Fetcher.create_client() as client:
        fetcher = Fetcher(client, allowlist.is_allowed)
        if args.dry_run:
            report = await IngestionPipeline(allowlist, fetcher, store=None).run(sources)
        else:
            from app.db import dispose_engine, get_engine, get_sessionmaker

            get_engine()
            async with get_sessionmaker()() as session:
                report = await IngestionPipeline(allowlist, fetcher, SourceStore(session)).run(
                    sources
                )
                await session.commit()
            await dispose_engine()
    _print(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
