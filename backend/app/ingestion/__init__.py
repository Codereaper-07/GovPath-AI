"""OFFICIAL-SOURCE INGESTION (knowledge side, no AI).

Stages, kept separate so each is testable on its own:
  1. allowlist  - only explicitly configured official government domains/URLs
  2. fetch      - httpx, robots.txt-aware, size/timeout limits, per-host politeness delay
  3. extract    - BeautifulSoup (HTML) / PyMuPDF (PDF) -> clean text, title, headings, links
  4. assess     - duplicate + change detection, verification-status transitions
  5. persist    - SourceDocument rows (async SQLAlchemy)

Scraped content is evidence, never verified knowledge by itself: new and changed sources are
`unverified` / `needs_review` until a human-curated seed marks them verified.
Must never import app.rag, app.llm or google.genai.
"""
