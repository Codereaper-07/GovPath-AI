"""Embedding formatting and the GeminiClient embedding call (fake SDK, no network)."""

import pytest

from app.config import Settings
from app.llm.client import LLMRequestError
from app.rag.embeddings import format_document, format_query
from tests.rag_fakes import fake_gemini


def test_prefix_formats() -> None:
    assert format_query("q") == "task: question answering | query: q"
    assert format_document("t", title="Doc") == "title: Doc | text: t"
    assert format_document("t") == "title: none | text: t"


async def test_each_text_is_wrapped_in_its_own_content_and_dimension_requested() -> None:
    client, models = fake_gemini()
    vecs = await client.embed(["a passport", "b voter"])
    assert len(vecs) == 2 and all(len(v) == 768 for v in vecs)
    call = models.embed_calls[0]
    assert call["model"] == "gemini-embedding-2"
    assert call["config"].output_dimensionality == 768
    # gemini-embedding-2 aggregates multi-part input; one Content per text keeps vectors separate.
    assert [c.parts[0].text for c in call["contents"]] == ["a passport", "b voter"]


async def test_embed_rejects_wrong_dimension() -> None:
    # The fake can only produce 768 values, so asking for 3072 yields a mismatch.
    client, _ = fake_gemini(Settings(_env_file=None, gemini_api_key=None, embedding_dim=3072))
    with pytest.raises(LLMRequestError):
        await client.embed(["a"])


async def test_empty_input_makes_no_call() -> None:
    client, models = fake_gemini()
    assert await client.embed([]) == []
    assert models.embed_calls == []
