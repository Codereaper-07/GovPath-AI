"""Split extracted official-source text into context-preserving retrieval chunks.

Pure functions (no I/O). Chunks follow line boundaries, prefer to start at headings, carry a
small line-based overlap, and keep character offsets so page numbers (PDFs) and the nearest
heading (web pages) can be attached.
"""

import hashlib
import re
from bisect import bisect_right
from dataclasses import dataclass

_WS = re.compile(r"\s+")
_DEVANAGARI = re.compile(r"[ऀ-ॿ]")
_SENTENCE = re.compile(r"(?<=[.!?।])\s+")


@dataclass(frozen=True)
class Chunk:
    index: int
    content: str
    content_hash: str
    char_start: int
    char_end: int
    page_start: int | None
    page_end: int | None
    section: str | None
    language: str


@dataclass(frozen=True)
class _Unit:
    start: int
    end: int
    text: str
    is_heading: bool


def chunk_hash(content: str) -> str:
    return hashlib.sha256(_WS.sub(" ", content).strip().casefold().encode("utf-8")).hexdigest()


def detect_language(text: str) -> str:
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return "en"
    return "hi" if len(_DEVANAGARI.findall(text)) / len(letters) > 0.3 else "en"


def page_ranges(text: str, page_char_counts: list[int] | None) -> list[tuple[int, int]]:
    """(start offset, page number) per non-empty page, if the counts match the text.

    The PDF extractor joins non-empty pages with a single newline.
    """
    if not page_char_counts:
        return []
    out, pos = [], 0
    for page_no, n in enumerate(page_char_counts, start=1):
        if n <= 0:
            continue
        out.append((pos, page_no))
        pos += n + 1
    return out if pos - 1 == len(text) else []


def _page_at(ranges: list[tuple[int, int]], offset: int) -> int | None:
    if not ranges:
        return None
    i = bisect_right([r[0] for r in ranges], offset) - 1
    return ranges[max(i, 0)][1]


def _units(text: str, headings: set[str], max_chars: int) -> list[_Unit]:
    units, pos = [], 0
    for line in text.split("\n"):
        start, end = pos, pos + len(line)
        pos = end + 1
        stripped = line.strip()
        if not stripped:
            continue
        heading = _WS.sub(" ", stripped).casefold() in headings
        if len(line) <= max_chars:
            units.append(_Unit(start, end, stripped, heading))
            continue
        # Very long line: split on sentence boundaries, then hard-wrap as a last resort.
        offset = start
        for sentence in _SENTENCE.split(line):
            for i in range(0, len(sentence), max_chars):
                piece = sentence[i : i + max_chars]
                if piece.strip():
                    units.append(_Unit(offset, offset + len(piece), piece.strip(), False))
                offset += len(piece)
            offset += 1
    return units


def chunk_text(
    text: str,
    *,
    headings: list[str] | None = None,
    page_char_counts: list[int] | None = None,
    target_chars: int = 1200,
    overlap_chars: int = 200,
) -> list[Chunk]:
    heading_set = {_WS.sub(" ", h).strip().casefold() for h in headings or [] if h.strip()}
    units = _units(text, heading_set, max_chars=target_chars)
    pages = page_ranges(text, page_char_counts)

    groups: list[list[_Unit]] = []
    current: list[_Unit] = []
    size = 0
    for u in units:
        # Start a new chunk at a heading once the current chunk has some substance,
        # or when adding this line would exceed the target size.
        starts_section = u.is_heading and size >= target_chars * 0.4
        if current and (size + len(u.text) + 1 > target_chars or starts_section):
            groups.append(current)
            carry: list[_Unit] = []
            if not starts_section:  # overlap only within a section
                carried = 0
                for prev in reversed(current[1:]):  # never carry the whole previous chunk
                    if carried + len(prev.text) > overlap_chars:
                        break
                    carry.insert(0, prev)
                    carried += len(prev.text) + 1
            current, size = carry, sum(len(c.text) + 1 for c in carry)
        current.append(u)
        size += len(u.text) + 1
    if current and (not groups or current != groups[-1][-len(current) :]):
        groups.append(current)

    chunks: list[Chunk] = []
    seen: set[str] = set()
    section: str | None = None
    unit_section: dict[int, str | None] = {}
    for u in units:
        if u.is_heading:
            section = u.text
        unit_section[u.start] = section
    for group in groups:
        content = "\n".join(u.text for u in group)
        h = chunk_hash(content)
        if h in seen:
            continue
        seen.add(h)
        first = next((u for u in group if u.is_heading), group[0])
        chunks.append(
            Chunk(
                index=len(chunks),
                content=content,
                content_hash=h,
                char_start=group[0].start,
                char_end=group[-1].end,
                page_start=_page_at(pages, group[0].start),
                page_end=_page_at(pages, group[-1].end - 1),
                section=(unit_section.get(first.start) or None),
                language=detect_language(content),
            )
        )
    return chunks
