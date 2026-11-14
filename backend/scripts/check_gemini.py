"""MANUAL real-API smoke test: exactly one generation call and one embedding call.

Never run automatically (uses the Gemini quota). Usage (from backend/):
  python -m scripts.check_gemini
"""

import asyncio

from pydantic import BaseModel

from app.config import get_settings
from app.llm.client import GeminiClient, LLMError
from app.rag.embeddings import format_query


class Ping(BaseModel):
    reply: str


async def main() -> int:
    settings = get_settings()
    client = GeminiClient(settings)
    try:
        out = await client.generate_json(
            system="Reply with JSON only.", prompt='Return {"reply": "ok"}.', schema=Ping
        )
        print(f"generate [{settings.gemini_model}]: {out.reply!r}")
        [vec] = await client.embed([format_query("Aadhaar address update")])
        print(f"embed [{settings.gemini_embedding_model}]: {len(vec)} dims")
    except LLMError as exc:
        print(f"failed: {type(exc).__name__}: {exc}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
