"""Extraction stage: HTML (BeautifulSoup) and PDF (PyMuPDF) -> clean text + metadata."""

import hashlib
import re
import unicodedata
from dataclasses import dataclass, field
from urllib.parse import urljoin

import pymupdf
from bs4 import BeautifulSoup

from app.ingestion.allowlist import normalize_url
from app.models.enums import SourceType

BOILERPLATE_TAGS = (
    "script", "style", "noscript", "nav", "header", "footer", "aside", "form", "svg",
    "iframe", "button", "template",
)  # fmt: skip
MAIN_SELECTORS = ("main", "[role=main]", "article", "#main-content", "#content", ".region-content")
MIN_TEXT_CHARS = 20


class ExtractionError(Exception):
    pass


@dataclass(frozen=True)
class ExtractedContent:
    source_type: SourceType
    title: str | None
    text: str
    content_hash: str
    headings: list[str] = field(default_factory=list)
    links: list[str] = field(default_factory=list)
    pdf_links: list[str] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)


def normalize_text(text: str) -> str:
    """NFC-normalise, collapse runs of spaces per line, drop blank lines."""
    text = unicodedata.normalize("NFC", text).replace(" ", " ")
    lines = (re.sub(r"[ \t\r\f\v]+", " ", ln).strip() for ln in text.splitlines())
    return "\n".join(ln for ln in lines if ln)


def content_hash(text: str) -> str:
    """Hash of normalised text, so markup-only changes don't count as content changes."""
    return hashlib.sha256(normalize_text(text).encode("utf-8")).hexdigest()


def _looks_like_pdf(content: bytes) -> bool:
    return content[:1024].lstrip().startswith(b"%PDF")


def extract(content: bytes, content_type: str, base_url: str) -> ExtractedContent:
    if content_type == "application/pdf" or _looks_like_pdf(content):
        return extract_pdf(content)
    if (
        content_type in ("text/html", "application/xhtml+xml", "")
        or b"<html" in content[:2048].lower()
    ):
        return extract_html(content, base_url)
    raise ExtractionError(f"unsupported content type: {content_type or 'unknown'}")


def extract_html(content: bytes | str, base_url: str) -> ExtractedContent:
    try:
        soup = BeautifulSoup(content, "html.parser")
    except Exception as exc:  # html.parser is lenient; this is defensive
        raise ExtractionError(f"unparseable HTML: {type(exc).__name__}") from exc

    title = soup.title.get_text(" ", strip=True) if soup.title else None
    meta_desc = soup.find("meta", attrs={"name": "description"})
    lang = soup.html.get("lang") if soup.html else None

    # Collect links from the whole document before stripping boilerplate.
    links: list[str] = []
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if href.startswith(("mailto:", "tel:", "javascript:", "#")):
            continue
        absolute = normalize_url(urljoin(base_url, href))
        if absolute not in links:
            links.append(absolute)
    pdf_links = [u for u in links if u.lower().split("?")[0].endswith(".pdf")]

    for tag in soup.find_all(BOILERPLATE_TAGS):
        tag.decompose()
    root = next((el for sel in MAIN_SELECTORS if (el := soup.select_one(sel))), None)
    root = root or soup.body or soup

    headings = [
        h.get_text(" ", strip=True)
        for h in root.find_all(["h1", "h2", "h3"])
        if h.get_text(strip=True)
    ]
    text = normalize_text(root.get_text("\n"))
    if len(text) < MIN_TEXT_CHARS:
        raise ExtractionError("no meaningful text (page may require JavaScript)")
    if not title and headings:
        title = headings[0]

    metadata = {"lang": lang, "description": meta_desc.get("content") if meta_desc else None}
    return ExtractedContent(
        source_type=SourceType.WEBPAGE,
        title=title,
        text=text,
        content_hash=content_hash(text),
        headings=headings,
        links=links,
        pdf_links=pdf_links,
        metadata={k: v for k, v in metadata.items() if v},
    )


def extract_pdf(content: bytes) -> ExtractedContent:
    try:
        doc = pymupdf.open(stream=content, filetype="pdf")
    except Exception as exc:
        raise ExtractionError(f"unreadable PDF: {type(exc).__name__}") from exc
    with doc:
        if doc.needs_pass:
            raise ExtractionError("PDF is password-protected")
        pages = [normalize_text(page.get_text("text")) for page in doc]
        meta = doc.metadata or {}
        page_count = doc.page_count
    text = "\n".join(p for p in pages if p)
    if len(text) < MIN_TEXT_CHARS:
        raise ExtractionError("PDF has no extractable text (possibly scanned images)")
    title = (meta.get("title") or "").strip() or next(
        (ln for ln in text.splitlines() if len(ln) > 3), None
    )
    return ExtractedContent(
        source_type=SourceType.PDF,
        title=title,
        text=text,
        content_hash=content_hash(text),
        metadata={
            "page_count": page_count,
            # Page-level offsets let future chunking cite page numbers.
            "page_char_counts": [len(p) for p in pages],
            **{
                k: v for k in ("author", "subject", "creationDate", "modDate") if (v := meta.get(k))
            },
        },
    )
