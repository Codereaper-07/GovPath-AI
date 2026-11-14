"""Ingestion pipeline: allowlist, robots.txt, fetch errors, extraction, dedupe, change detection.

All HTTP is mocked with httpx.MockTransport; persistence uses the isolated SQLite fixture.
"""

import json

import httpx
import pymupdf
import pytest
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.ingestion.allowlist import (
    Allowlist,
    AllowlistError,
    SourceConfig,
    is_url_allowed,
    load_allowlist,
)
from app.ingestion.extract import ExtractionError, content_hash, extract, extract_html, extract_pdf
from app.ingestion.fetcher import Fetcher, FetchError, FetchErrorKind
from app.ingestion.persistence import SourceStore
from app.ingestion.pipeline import IngestionPipeline
from app.ingestion.verification import (
    ExistingSource,
    IngestOutcome,
    assess,
    excerpt_in_text,
)
from app.models import Evidence, SourceDocument
from app.models.enums import SourceType, VerificationStatus

DOMAINS = ("example.gov.in",)

PAGE = b"""<!doctype html><html lang="en"><head><title>Change of Address | Transport</title>
<meta name="description" content="How to change address"><script>var x=1;</script></head>
<body><nav>Home | About | Login</nav><header>Site header</header>
<main><h1>Change Of Address</h1><p>Documents required:&nbsp;Form 33</p>
<h2>Guidelines</h2><p>Apply within   14 days.</p>
<a href="/files/form-33.pdf">Form 33</a> <a href="https://evil.example.com/x.pdf">x</a>
<a href="mailto:a@b.c">mail</a></main><footer>Copyright</footer></body></html>"""


def make_pdf(text: str, title: str | None = "Form 33") -> bytes:
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 72), text)
    if title:
        doc.set_metadata({"title": title})
    data = doc.tobytes()
    doc.close()
    return data


def transport(routes: dict[str, httpx.Response | Exception], hits: list[str] | None = None):
    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if hits is not None:
            hits.append(url)
        if url.endswith("/robots.txt") and url not in routes:
            return httpx.Response(404)
        result = routes.get(url)
        if result is None:
            return httpx.Response(404, text="not found")
        if isinstance(result, Exception):
            raise result
        return result

    return httpx.MockTransport(handler)


def fetcher_for(routes, *, hits=None, **kw) -> tuple[Fetcher, httpx.AsyncClient]:
    client = httpx.AsyncClient(transport=transport(routes, hits))
    return Fetcher(client, lambda u: is_url_allowed(u, DOMAINS), min_delay_seconds=0, **kw), client


def html(body: bytes, status: int = 200) -> httpx.Response:
    return httpx.Response(
        status, content=body, headers={"content-type": "text/html; charset=utf-8"}
    )


def pdf(body: bytes) -> httpx.Response:
    return httpx.Response(200, content=body, headers={"content-type": "application/pdf"})


# ------------------------------------------------------------------ allowlist


@pytest.mark.parametrize(
    ("url", "ok"),
    [
        ("https://example.gov.in/page", True),
        ("https://sub.example.gov.in/a.pdf", True),
        ("http://example.gov.in/page", False),  # HTTPS only
        ("https://example.gov.in.evil.com/", False),
        ("https://notexample.gov.in/", False),
        ("https://user:pw@example.gov.in/", False),
        ("ftp://example.gov.in/x", False),
        ("not a url", False),
    ],
)
def test_domain_allowlist(url, ok):
    assert is_url_allowed(url, DOMAINS) is ok


def test_allowlist_file_rejects_non_government_domains(tmp_path):
    p = tmp_path / "allowlist.json"
    p.write_text(json.dumps({"allowed_domains": ["blog.example.com"], "sources": []}))
    with pytest.raises(AllowlistError):
        load_allowlist(p)
    p.write_text(
        json.dumps(
            {
                "allowed_domains": ["example.gov.in"],
                "sources": [{"url": "https://other.gov.in/x", "authority": "A"}],
            }
        )
    )
    with pytest.raises(AllowlistError):
        load_allowlist(p)


def test_project_allowlist_is_official_and_consistent():
    allowlist = load_allowlist()
    assert all(d.endswith(".gov.in") for d in allowlist.domains)
    assert allowlist.sources and all(allowlist.is_allowed(s.url) for s in allowlist.sources)


# ------------------------------------------------------------------ extraction


def test_html_extraction_cleans_boilerplate_and_collects_metadata():
    e = extract_html(PAGE, "https://example.gov.in/rc/change")
    assert e.source_type is SourceType.WEBPAGE
    assert e.title == "Change of Address | Transport"
    assert e.headings == ["Change Of Address", "Guidelines"]
    assert "Documents required: Form 33" in e.text and "Apply within 14 days." in e.text
    for noise in ("Home | About", "Site header", "Copyright", "var x"):
        assert noise not in e.text
    assert "https://example.gov.in/files/form-33.pdf" in e.pdf_links
    assert not any(link.startswith("mailto:") for link in e.links)
    assert e.metadata == {"lang": "en", "description": "How to change address"}


def test_malformed_html_is_still_extracted():
    e = extract_html(
        b"<html><body><div><p>Unclosed paragraph about Form 8<div>more text here",
        "https://example.gov.in",
    )
    assert "Unclosed paragraph about Form 8" in e.text


def test_javascript_only_page_is_an_extraction_error():
    with pytest.raises(ExtractionError):
        extract_html(
            b'<html><body><div id="root"></div><script>app()</script></body></html>',
            "https://example.gov.in",
        )


def test_pdf_extraction():
    e = extract_pdf(make_pdf("INTIMATION OF CHANGE OF ADDRESS in Form 33"))
    assert e.source_type is SourceType.PDF
    assert e.title == "Form 33"
    assert "INTIMATION OF CHANGE OF ADDRESS" in e.text
    assert e.metadata["page_count"] == 1


@pytest.mark.parametrize("data", [b"%PDF-1.4 garbage that is not a pdf", b"\x00\x01binary"])
def test_corrupt_pdf_is_an_extraction_error(data):
    with pytest.raises(ExtractionError):
        extract_pdf(data)


def test_unsupported_content_type():
    with pytest.raises(ExtractionError):
        extract(b"\x89PNG....", "image/png", "https://example.gov.in/x.png")


def test_content_hash_ignores_whitespace_only_changes():
    assert content_hash("Proof  of\n\n address ") == content_hash("Proof of\naddress")
    assert content_hash("Proof of address") != content_hash("Proof of residence")


def test_excerpt_matching_is_whitespace_case_and_quote_insensitive():
    text = "Revenue Department’s Land Owning\n records"
    assert excerpt_in_text("revenue department's land owning records", text)
    assert not excerpt_in_text("water bill", text)


# ------------------------------------------------------------------ fetching


async def test_fetch_success_and_content_type():
    f, client = fetcher_for({"https://example.gov.in/p": html(PAGE)})
    async with client:
        r = await f.fetch("https://example.gov.in/p#section")
    assert r.final_url == "https://example.gov.in/p" and r.content_type == "text/html"


async def test_fetch_refuses_urls_off_the_allowlist_without_network():
    hits: list[str] = []
    f, client = fetcher_for({}, hits=hits)
    async with client:
        with pytest.raises(FetchError) as exc:
            await f.fetch("https://www.google.com/")
    assert exc.value.kind is FetchErrorKind.NOT_ALLOWLISTED and hits == []


async def test_redirect_off_the_allowlist_is_blocked():
    routes = {
        "https://example.gov.in/go": httpx.Response(302, headers={"location": "https://evil.com/x"})
    }
    f, client = fetcher_for(routes)
    async with client:
        with pytest.raises(FetchError) as exc:
            await f.fetch("https://example.gov.in/go")
    assert exc.value.kind is FetchErrorKind.NOT_ALLOWLISTED


async def test_robots_txt_disallow_is_respected():
    hits: list[str] = []
    routes = {
        "https://example.gov.in/robots.txt": httpx.Response(
            200, text="User-agent: *\nDisallow: /private/"
        ),
        "https://example.gov.in/private/doc": html(PAGE),
        "https://example.gov.in/public": html(PAGE),
    }
    f, client = fetcher_for(routes, hits=hits)
    async with client:
        with pytest.raises(FetchError) as exc:
            await f.fetch("https://example.gov.in/private/doc")
        await f.fetch("https://example.gov.in/public")
    assert exc.value.kind is FetchErrorKind.ROBOTS_DISALLOWED
    assert "https://example.gov.in/private/doc" not in hits
    assert hits.count("https://example.gov.in/robots.txt") == 1  # cached per origin


async def test_robots_txt_server_error_means_disallow():
    routes = {
        "https://example.gov.in/robots.txt": httpx.Response(503),
        "https://example.gov.in/p": html(PAGE),
    }
    f, client = fetcher_for(routes)
    async with client:
        with pytest.raises(FetchError) as exc:
            await f.fetch("https://example.gov.in/p")
    assert exc.value.kind is FetchErrorKind.ROBOTS_DISALLOWED


@pytest.mark.parametrize(
    ("response", "kind"),
    [
        (html(b"gone", status=404), FetchErrorKind.HTTP_ERROR),
        (html(b"down", status=503), FetchErrorKind.HTTP_ERROR),
        (httpx.ReadTimeout("slow"), FetchErrorKind.TIMEOUT),
        (httpx.ConnectError("refused"), FetchErrorKind.NETWORK_ERROR),
    ],
)
async def test_fetch_failures_are_classified(response, kind):
    f, client = fetcher_for({"https://example.gov.in/p": response})
    async with client:
        with pytest.raises(FetchError) as exc:
            await f.fetch("https://example.gov.in/p")
    assert exc.value.kind is kind


async def test_oversized_response_is_rejected():
    f, client = fetcher_for(
        {"https://example.gov.in/big": pdf(b"%PDF" + b"0" * 2000)}, max_bytes=1000
    )
    async with client:
        with pytest.raises(FetchError) as exc:
            await f.fetch("https://example.gov.in/big")
    assert exc.value.kind is FetchErrorKind.TOO_LARGE


# ------------------------------------------------------------------ assessment


def test_assessment_transitions():
    v, u, n = (
        VerificationStatus.VERIFIED,
        VerificationStatus.UNVERIFIED,
        VerificationStatus.NEEDS_REVIEW,
    )
    assert assess(None, "h", False).outcome is IngestOutcome.NEW
    assert assess(None, "h", True).outcome is IngestOutcome.DUPLICATE
    assert assess(ExistingSource(None, v), "h", False) == assess(
        ExistingSource(None, v), "h", False
    )
    assert (
        assess(ExistingSource(None, v), "h", False).verification_status is v
    )  # curated, first fetch
    assert assess(ExistingSource("h", v), "h", False).outcome is IngestOutcome.UNCHANGED
    changed = assess(ExistingSource("old", v), "new", False)
    assert changed.outcome is IngestOutcome.CHANGED and changed.verification_status is n
    assert assess(ExistingSource("old", u), "new", False).verification_status is u


# ------------------------------------------------------------------ pipeline + persistence

PAGE_URL = "https://example.gov.in/rc/change"
PDF_URL = "https://example.gov.in/files/form-33.pdf"


def pipeline_for(routes, store, *, follow_pdfs=True, max_pdfs=5, sources=None):
    allowlist = Allowlist(
        domains=DOMAINS,
        sources=tuple(
            sources
            or [
                SourceConfig(
                    PAGE_URL, "Transport Dept", follow_pdfs=follow_pdfs, max_linked_pdfs=max_pdfs
                )
            ]
        ),
    )
    f, client = fetcher_for(routes)
    return IngestionPipeline(allowlist, f, store), client


async def _source(session, url):
    stmt = (
        select(SourceDocument)
        .options(selectinload(SourceDocument.evidence))
        .where(SourceDocument.url == url)
    )
    return (await session.execute(stmt)).scalar_one_or_none()


async def test_dry_run_extracts_without_persisting(session):
    pipe, client = pipeline_for(
        {PAGE_URL: html(PAGE), PDF_URL: pdf(make_pdf("Form 33 intimation of change of address"))},
        None,
    )
    async with client:
        report = await pipe.run()
    assert [r.outcome for r in report.results] == [IngestOutcome.DRY_RUN, IngestOutcome.DRY_RUN]
    assert report.results[1].parent_url == PAGE_URL
    assert await _source(session, PAGE_URL) is None


async def test_ingest_new_then_unchanged_then_changed(session):
    store = SourceStore(session)
    routes = {
        PAGE_URL: html(PAGE),
        PDF_URL: pdf(make_pdf("Form 33 intimation of change of address")),
    }
    pipe, client = pipeline_for(routes, store)
    async with client:
        first = await pipe.run()
    assert [r.outcome for r in first.results] == [IngestOutcome.NEW, IngestOutcome.NEW]
    page = await _source(session, PAGE_URL)
    child = await _source(session, PDF_URL)
    assert page.authority == "Transport Dept" and page.content_hash and page.retrieved_at
    assert page.extracted_metadata["headings"] == ["Change Of Address", "Guidelines"]
    assert child.parent_source_id == page.id and child.source_type is SourceType.PDF
    assert page.verification_status is VerificationStatus.UNVERIFIED  # scraped != verified

    # Curator verifies the page and attaches evidence.
    page.verification_status = VerificationStatus.VERIFIED
    session.add(
        Evidence(
            key="ev-page",
            source=page,
            excerpt="Apply within 14 days.",
            excerpt_hash="x",
            verification_status=VerificationStatus.VERIFIED,
        )
    )
    await session.flush()

    pipe, client = pipeline_for(routes, store)
    async with client:
        second = await pipe.run()
    assert second.results[0].outcome is IngestOutcome.UNCHANGED
    assert second.results[0].evidence_checked == 1 and second.results[0].evidence_missing == 0
    assert (await _source(session, PAGE_URL)).verification_status is VerificationStatus.VERIFIED

    edited = PAGE.replace(b"Apply within   14 days.", b"Apply within 30 days.")
    pipe, client = pipeline_for({**routes, PAGE_URL: html(edited)}, store)
    async with client:
        third = await pipe.run()
    assert third.results[0].outcome is IngestOutcome.CHANGED
    assert third.results[0].evidence_missing == 1
    page = await _source(session, PAGE_URL)
    assert page.verification_status is VerificationStatus.NEEDS_REVIEW
    assert page.previous_content_hash and page.previous_content_hash != page.content_hash
    assert page.evidence[0].excerpt_found_in_source is False
    assert page.evidence[0].verification_status is VerificationStatus.NEEDS_REVIEW


async def test_markup_only_change_is_not_a_content_change(session):
    store = SourceStore(session)
    pipe, client = pipeline_for({PAGE_URL: html(PAGE)}, store, follow_pdfs=False)
    async with client:
        await pipe.run()
    restyled = PAGE.replace(b"<main>", b'<main class="new-theme" data-x="1">')
    pipe, client = pipeline_for({PAGE_URL: html(restyled)}, store, follow_pdfs=False)
    async with client:
        report = await pipe.run()
    assert report.results[0].outcome is IngestOutcome.UNCHANGED


async def test_duplicate_content_under_another_url_is_not_stored_twice(session):
    other = "https://example.gov.in/rc/change-copy"
    sources = [SourceConfig(PAGE_URL, "Transport Dept"), SourceConfig(other, "Transport Dept")]
    pipe, client = pipeline_for(
        {PAGE_URL: html(PAGE), other: html(PAGE)}, SourceStore(session), sources=sources
    )
    async with client:
        report = await pipe.run()
    assert [r.outcome for r in report.results] == [IngestOutcome.NEW, IngestOutcome.DUPLICATE]
    original, dup = await _source(session, PAGE_URL), await _source(session, other)
    assert dup.duplicate_of_id == original.id and dup.content_text is None
    assert dup.content_hash == original.content_hash


async def test_failures_are_reported_and_do_not_stop_the_run(session):
    bad = "https://example.gov.in/broken.pdf"
    js = "https://example.gov.in/spa"
    sources = [
        SourceConfig(bad, "A"),
        SourceConfig(js, "A"),
        SourceConfig("https://example.gov.in/missing", "A"),
        SourceConfig(PAGE_URL, "A"),
    ]
    routes = {
        bad: pdf(b"%PDF-1.7 corrupted"),
        js: html(b'<html><body><div id="root"></div></body></html>'),
        PAGE_URL: html(PAGE),
    }
    store = SourceStore(session)
    session.add(SourceDocument(url=bad, source_type=SourceType.PDF))  # previously known source
    await session.flush()
    pipe, client = pipeline_for(routes, store, sources=sources)
    async with client:
        report = await pipe.run()
    outcomes = [r.outcome for r in report.results]
    assert outcomes == [IngestOutcome.FAILED] * 3 + [IngestOutcome.NEW]
    assert "ExtractionError" in report.results[0].error
    assert "HTTP 404" in report.results[2].error
    assert (await _source(session, bad)).last_error.startswith("ExtractionError")
    assert await _source(session, js) is None  # failed fetches never create rows
    assert report.summary == {"new": 1, "failed": 3}


async def test_linked_pdfs_are_limited_and_must_be_allowlisted(session):
    page = PAGE.replace(
        b"</main>", b'<a href="/files/b.pdf">b</a><a href="/files/c.pdf">c</a></main>'
    )
    routes = {
        PAGE_URL: html(page),
        PDF_URL: pdf(make_pdf("Form 33 intimation of change of address")),
        "https://example.gov.in/files/b.pdf": pdf(
            make_pdf("Second linked PDF with enough body text")
        ),
    }
    pipe, client = pipeline_for(routes, None, max_pdfs=2)
    async with client:
        report = await pipe.run()
    urls = [r.url for r in report.results]
    assert urls == [PAGE_URL, PDF_URL, "https://example.gov.in/files/b.pdf"]
    assert "https://evil.example.com/x.pdf" not in urls
