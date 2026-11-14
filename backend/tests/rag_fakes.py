"""Offline stand-ins for the Gemini SDK. No network, no quota."""

import math
import re
from types import SimpleNamespace

from google.genai import errors

from app.config import Settings
from app.llm.client import GeminiClient, UsageGuard

DIM = 768
VOCAB = [
    "aadhaar", "address", "passport", "voter", "epic", "form", "licence", "driving", "vehicle",
    "registration", "certificate", "insurance", "pollution", "bill", "electricity", "water",
    "gas", "rent", "deed", "proof", "reissue", "old", "photograph", "mobile", "online",
    "enrolment", "elector", "shifting", "residence", "financier", "hypothecation", "noc",
    "bank", "passbook", "ration", "fee", "days", "constituency", "update", "sarathi",
]  # fmt: skip
HINDI = {"पासपोर्ट": "passport", "आधार": "aadhaar", "पता": "address", "मतदाता": "voter"}


def keyword_vector(text: str) -> list[float]:
    """Deterministic bag-of-keywords embedding (normalised)."""
    t = text.casefold()
    for hi, en in HINDI.items():
        t = t.replace(hi, f" {en} ")
    words = re.findall(r"[a-z]+", t)
    v = [0.01] * DIM
    for i, w in enumerate(VOCAB):
        v[i] += sum(1 for x in words if x.startswith(w))
    n = math.sqrt(sum(x * x for x in v))
    return [x / n for x in v]


def api_error(code: int, status: str, details: list | None = None) -> errors.APIError:
    return errors.APIError(
        code, {"error": {"code": code, "status": status, "message": "x", "details": details or []}}
    )


def quota_error() -> errors.APIError:
    return api_error(
        429,
        "RESOURCE_EXHAUSTED",
        [
            {
                "@type": "type.googleapis.com/google.rpc.QuotaFailure",
                "violations": [{"quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier"}],
            }
        ],
    )


def rate_limit_error(delay: str = "1s") -> errors.APIError:
    return api_error(
        429,
        "RESOURCE_EXHAUSTED",
        [{"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": delay}],
    )


class FakeModels:
    def __init__(self):
        self.embed_calls: list[dict] = []
        self.generate_calls: list[dict] = []
        self.embed_errors: list[Exception] = []
        self.generate_errors: list[Exception] = []
        self.answer: str | None = None  # JSON text returned by generate

    async def embed_content(self, *, model, contents, config):
        self.embed_calls.append({"model": model, "contents": contents, "config": config})
        if self.embed_errors:
            raise self.embed_errors.pop(0)
        texts = [c.parts[0].text for c in contents]
        dim = config.output_dimensionality
        return SimpleNamespace(
            embeddings=[SimpleNamespace(values=keyword_vector(t)[:dim]) for t in texts]
        )

    async def generate_content(self, *, model, contents, config):
        self.generate_calls.append({"model": model, "contents": contents, "config": config})
        if self.generate_errors:
            raise self.generate_errors.pop(0)
        text = self.answer or (
            '{"answer": "Use any one listed proof of address [S1].", '
            '"cited_source_ids": ["S1"], "evidence_status": "sufficient"}'
        )
        return SimpleNamespace(text=text, parsed=None)


async def no_sleep(_seconds: float) -> None:
    return None


def fake_gemini(settings: Settings | None = None, **guard_kw) -> tuple[GeminiClient, FakeModels]:
    settings = settings or Settings(_env_file=None, database_url=None, gemini_api_key=None)
    models = FakeModels()
    sdk = SimpleNamespace(aio=SimpleNamespace(models=models))
    guard = UsageGuard(min_interval=0, sleep=no_sleep, **guard_kw)
    return GeminiClient(settings, client=sdk, guard=guard, sleep=no_sleep), models
