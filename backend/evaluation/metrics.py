"""Pure scoring functions for the GovPath evaluation (no I/O, no AI)."""

import re
from statistics import mean, median

ABSTAIN_STATUSES = {"insufficient"}
FLAGGED_STATUSES = {"partial", "insufficient", "conflicting"}

_MONEY = re.compile(
    r"(₹\s*\d[\d,]*|\brs\.?\s*\d[\d,]*|\b\d[\d,]*\s*(rupees|रुपये|रुपए)|\binr\s*\d)", re.I
)
_DURATION = re.compile(r"\b(\d+)\s*(working\s+)?(days?|weeks?|दिन|सप्ताह|हफ़्ते|हफ्ते)\b", re.I)


def retrieval_scores(retrieved: list[dict], case: dict, k: int = 5) -> dict | None:
    """retrieved: [{source_url, evidence_ids}] in rank order. None when the case has no labels."""
    sources = set(case["relevant_sources"])
    if not sources:
        return None
    top = retrieved[:k]
    rel = [r["source_url"] in sources for r in top]
    found = {e for r in top for e in r["evidence_ids"]} & set(case["relevant_evidence"])
    first = next((i for i, ok in enumerate(rel, start=1) if ok), None)
    return {
        "precision_at_k": sum(rel) / k,  # standard P@k: denominator is k, not the number returned
        "evidence_recall_at_k": len(found) / len(case["relevant_evidence"])
        if case["relevant_evidence"]
        else None,
        "source_recall_at_k": len({r["source_url"] for r in top} & sources) / len(sources),
        "reciprocal_rank": 1 / first if first else 0.0,
        "hit": first is not None,
        "duplicates_same_source": len(top) - len({r["source_url"] for r in top}),
    }


def mention_coverage(answer: str, groups: list[list[str]]) -> float | None:
    if not groups:
        return None
    a = answer.casefold()
    return sum(1 for g in groups if any(term.casefold() in a for term in g)) / len(groups)


def unsupported_specifics(answer: str, evidence_text: str) -> list[str]:
    """Money amounts and durations in the answer that do not appear in the supplied evidence."""
    ev = evidence_text.casefold()
    out = [m.group(0) for m in _MONEY.finditer(answer)]
    for m in _DURATION.finditer(answer):
        if m.group(1) not in ev:
            out.append(m.group(0))
    return out


def behaviour_correct(expected: str, status: str, abstained: bool, fabricated: bool) -> bool:
    if expected == "answer":
        return not abstained and not fabricated
    if expected == "partial":
        return status in FLAGGED_STATUSES and not fabricated
    # abstain: say there is not enough evidence; a flagged partial answer is acceptable only
    # if it states no unsupported specifics.
    return (abstained or status in FLAGGED_STATUSES) and not fabricated


def citation_precision(citations: list[dict], case: dict) -> float | None:
    if not citations or not case["relevant_sources"]:
        return None
    sources, evidence = set(case["relevant_sources"]), set(case["relevant_evidence"])
    ok = sum(
        1
        for c in citations
        if c["source_url"] in sources or set(c.get("evidence_ids", [])) & evidence
    )
    return ok / len(citations)


def next_action_correct(predicted: dict | None, expected: dict | None) -> bool | None:
    if expected is None:
        return None
    if not predicted:
        return False
    if predicted.get("type") != expected["type"]:
        return False
    if expected["type"] == "start_service":
        return predicted.get("service_id") in expected["service_ids"]
    return True


def dependency_scores(claimed: list[list[str]], expected: list[list[str]] | None) -> dict | None:
    if expected is None:
        return None
    c = {tuple(p) for p in claimed}
    e = {tuple(p) for p in expected}
    return {"exact": c == e, "invented": sorted(c - e), "missed": sorted(e - c)}


def summarize(values: list[float | None]) -> float | None:
    vals = [v for v in values if v is not None]
    return round(mean(vals), 3) if vals else None


def latency_summary(ms: list[float]) -> dict:
    return (
        {"mean_ms": round(mean(ms)), "median_ms": round(median(ms)), "max_ms": round(max(ms))}
        if ms
        else {}
    )
