from app.rag.chunking import chunk_hash, chunk_text, detect_language, page_ranges


def _long_doc() -> str:
    lines = ["Change Of Address", "Guidelines"]
    lines += [
        f"Line {i}: apply for recording the change in residence within 14 days." for i in range(60)
    ]
    lines += ["Documents required"]
    lines += [f"Document {i}: proof of new address and insurance certificate." for i in range(30)]
    return "\n".join(lines)


def test_chunks_respect_size_and_cover_all_text():
    text = _long_doc()
    chunks = chunk_text(text, target_chars=600, overlap_chars=120)
    assert len(chunks) > 3
    assert all(len(c.content) <= 600 for c in chunks)
    assert [c.index for c in chunks] == list(range(len(chunks)))
    joined = "\n".join(c.content for c in chunks)
    for line in text.split("\n"):
        assert line in joined  # nothing is dropped
    # offsets point back into the source text
    for c in chunks:
        assert text[c.char_start : c.char_end].startswith(c.content.split("\n")[0])


def test_overlap_carries_context_but_never_repeats_whole_chunks():
    chunks = chunk_text(_long_doc(), target_chars=600, overlap_chars=120)
    overlaps = [
        set(a.content.split("\n")) & set(b.content.split("\n"))
        for a, b in zip(chunks, chunks[1:], strict=False)
    ]
    assert any(overlaps)
    assert len({c.content_hash for c in chunks}) == len(chunks)


def test_headings_become_sections_and_start_new_chunks():
    text = _long_doc()
    chunks = chunk_text(
        text,
        headings=["Change Of Address", "Documents required"],
        target_chars=600,
        overlap_chars=120,
    )
    assert chunks[0].section == "Change Of Address"
    docs = [c for c in chunks if c.section == "Documents required"]
    assert docs and docs[0].content.startswith("Documents required")


def test_pdf_page_numbers_are_preserved():
    pages = [
        "Page one text about Form 8. " * 20,
        "",
        "Page three text about proof of address. " * 20,
    ]
    text = "\n".join(p for p in pages if p)
    counts = [len(p) for p in pages]
    assert page_ranges(text, counts) == [(0, 1), (len(pages[0]) + 1, 3)]
    chunks = chunk_text(text, page_char_counts=counts, target_chars=300, overlap_chars=0)
    assert chunks[0].page_start == 1
    assert chunks[-1].page_end == 3
    assert page_ranges(text + "x", counts) == []  # mismatched metadata is ignored, not guessed


def test_language_hash_and_dedupe():
    assert detect_language("पते का प्रमाण आवश्यक है") == "hi"
    assert detect_language("Proof of address is required") == "en"
    assert chunk_hash("Proof  of\naddress") == chunk_hash("proof of address")
    repeated = "\n".join(["Same footer line repeated here."] * 3)
    assert len(chunk_text(repeated, target_chars=40, overlap_chars=0)) == 1


def test_very_long_line_is_split():
    chunks = chunk_text(
        " ".join(f"word{i}" for i in range(1000)), target_chars=500, overlap_chars=0
    )
    assert len(chunks) >= 9 and all(len(c.content) <= 500 for c in chunks)
