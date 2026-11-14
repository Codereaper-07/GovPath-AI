"""Compute evaluation metrics from cached results (no API calls) -> results/summary.{json,md}."""

import json
from collections import defaultdict

from app.config import get_settings
from evaluation.metrics import (
    behaviour_correct,
    citation_precision,
    dependency_scores,
    latency_summary,
    mention_coverage,
    next_action_correct,
    retrieval_scores,
    summarize,
    unsupported_specifics,
)
from evaluation.run import OUT

# Names that identify a service in an answer (EN/HI), for explanation-consistency checks.
SERVICE_TERMS = {
    "aadhaar-address-update": ["aadhaar", "आधार"],
    "voter-id-address-change-form-8": ["voter", "form 8", "मतदाता"],
    "driving-licence-address-change": ["driving licence", "driving license", "ड्राइविंग"],
    "vehicle-rc-address-change": ["rc", "registration certificate", "आरसी", "वाहन"],
    "passport-reissue-change-of-address": ["passport", "पासपोर्ट"],
}

SYSTEM_NAMES = {
    "A": "A · LLM-only",
    "B": "B · Ordinary RAG",
    "C": "C · RAG + structured knowledge",
    "P": "GovPath (proposed)",
}
THRESHOLDS = [0.5, 0.6, 0.65, 0.66, 0.68, 0.7, 0.72]


def _apply(ranked: list[dict], threshold: float, k: int) -> list[dict]:
    return [r for r in ranked if r["similarity"] >= threshold][:k]


def retrieval_section(cases, retrieval, threshold, k):
    rows, per_lang = [], defaultdict(list)
    for c in cases:
        got = _apply(retrieval.get(c["id"], []), threshold, k)
        s = retrieval_scores(got, c, k)
        if s is None:  # abstain / out-of-scope: anything retrieved above threshold is noise
            rows.append(
                {
                    "id": c["id"],
                    "language": c["language"],
                    "labelled": False,
                    "retrieved": len(got),
                    "top_similarity": got[0]["similarity"] if got else None,
                }
            )
            continue
        # Best achievable P@k given the per-source cap: relevant chunks present in the wide ranking.
        available = sum(
            1 for r in retrieval.get(c["id"], []) if r["source_url"] in set(c["relevant_sources"])
        )
        ceiling = min(k, available) / k if available else None
        s.update(
            id=c["id"],
            language=c["language"],
            labelled=True,
            retrieved=len(got),
            top_similarity=got[0]["similarity"] if got else None,
            precision_ceiling=ceiling,
            normalised_precision=(s["precision_at_k"] / ceiling) if ceiling else None,
        )
        rows.append(s)
        per_lang[c["language"]].append(s)
    lab = [r for r in rows if r["labelled"]]

    def agg(rs):
        return {
            "cases": len(rs),
            "precision_at_5": summarize([r["precision_at_k"] for r in rs]),
            "precision_ceiling": summarize([r["precision_ceiling"] for r in rs]),
            "normalised_precision_at_5": summarize([r["normalised_precision"] for r in rs]),
            "evidence_recall_at_5": summarize([r["evidence_recall_at_k"] for r in rs]),
            "source_recall_at_5": summarize([r["source_recall_at_k"] for r in rs]),
            "mrr": summarize([r["reciprocal_rank"] for r in rs]),
            "success_rate": summarize([1.0 if r["hit"] else 0.0 for r in rs]),
        }

    return {
        "threshold": threshold,
        "k": k,
        "overall": agg(lab),
        "by_language": {lg: agg(v) for lg, v in per_lang.items()},
        "unlabelled_cases_with_results": [
            r["id"] for r in rows if not r["labelled"] and r["retrieved"]
        ],
        "rows": rows,
    }


def answers_section(cases, answers):
    by_id = {c["id"]: c for c in cases}
    out = {}
    for system, res in answers.items():
        rows = []
        for cid, r in res.items():
            c = by_id[cid]
            abstained = (not r["used_ai"]) or r["evidence_status"] == "insufficient"
            specifics = unsupported_specifics(r["answer"], r.get("evidence_text", ""))
            rows.append(
                {
                    "id": cid,
                    "language": c["language"],
                    "category": c["category"],
                    "expected": c["expected_behavior"],
                    "status": r["evidence_status"],
                    "abstained": abstained,
                    "behaviour_ok": behaviour_correct(
                        c["expected_behavior"], r["evidence_status"], abstained, bool(specifics)
                    ),
                    "coverage": mention_coverage(r["answer"], c["must_mention"]),
                    "unsupported_specifics": specifics,
                    "citations": len(r["citations"]),
                    "citation_precision": citation_precision(r["citations"], c),
                    "invalid_citations": len(r.get("invalid_citation_ids", [])),
                    "next_action_ok": next_action_correct(
                        r.get("first_action"), c.get("expected_next_action")
                    ),
                    "dependencies": dependency_scores(
                        r.get("claimed_dependencies") or [], c.get("expected_dependencies")
                    ),
                    "latency_ms": r["latency_ms"],
                    "schema_error": bool(r.get("schema_error")),
                    "explains_next_action": _explains(r, c),
                }
            )
        answer_cases = [x for x in rows if x["expected"] == "answer"]
        deps = [x["dependencies"] for x in rows if x["dependencies"] is not None]
        out[system] = {
            "cases": len(rows),
            "behaviour_accuracy": summarize([1.0 if x["behaviour_ok"] else 0.0 for x in rows]),
            "abstention_accuracy": summarize(
                [1.0 if x["behaviour_ok"] else 0.0 for x in rows if x["expected"] == "abstain"]
            ),
            "mention_coverage": summarize([x["coverage"] for x in rows]),
            "answers_with_citations": summarize(
                [1.0 if x["citations"] else 0.0 for x in answer_cases]
            ),
            "citation_precision": summarize([x["citation_precision"] for x in rows]),
            "invalid_citation_ids": sum(x["invalid_citations"] for x in rows),
            "answers_with_unsupported_specifics": sum(
                1 for x in rows if x["unsupported_specifics"]
            ),
            "next_action_accuracy": summarize(
                [
                    1.0 if x["next_action_ok"] else 0.0
                    for x in rows
                    if x["next_action_ok"] is not None
                ]
            ),
            "dependency_exact": summarize([1.0 if d["exact"] else 0.0 for d in deps]),
            "invented_dependencies": sum(len(d["invented"]) for d in deps),
            "latency": latency_summary(
                [x["latency_ms"] for x in rows if x["latency_ms"] is not None]
            ),
            "schema_errors": sum(1 for x in rows if x["schema_error"]),
            "explanation_consistent": summarize(
                [
                    1.0 if x["explains_next_action"] else 0.0
                    for x in rows
                    if x["explains_next_action"] is not None
                ]
            ),
            "by_language": {
                lg: {
                    "cases": len(rs),
                    "behaviour_accuracy": summarize(
                        [1.0 if x["behaviour_ok"] else 0.0 for x in rs]
                    ),
                    "mention_coverage": summarize([x["coverage"] for x in rs]),
                    "citation_precision": summarize([x["citation_precision"] for x in rs]),
                }
                for lg in ("en", "hi")
                if (rs := [x for x in rows if x["language"] == lg])
            },
            "rows": rows,
        }
    return out


def _explains(r: dict, c: dict) -> bool | None:
    """Workflow cases where a service should start first: does the answer name that service?"""
    exp = c.get("expected_next_action")
    fa = r.get("first_action")
    if (
        not exp
        or exp["type"] != "start_service"
        or not fa
        or not fa.get("service_id")
        or not r["answer"]
    ):
        return None
    a = r["answer"].casefold()
    return any(t in a for t in SERVICE_TERMS.get(fa["service_id"], []))


def pairs_section(cases, answers):
    pairs = defaultdict(dict)
    for c in cases:
        if "pair" in c:
            pairs[c["pair"]][c["language"]] = c["id"]
    out = {}
    for system, res in answers.items():
        items = []
        for name, p in pairs.items():
            en, hi = res.get(p.get("en")), res.get(p.get("hi"))
            if not en or not hi:
                continue
            se = {x["source_url"] for x in en["citations"]}
            sh = {x["source_url"] for x in hi["citations"]}
            items.append(
                {
                    "pair": name,
                    "same_status": en["evidence_status"] == hi["evidence_status"],
                    "same_first_action": en.get("first_action") == hi.get("first_action"),
                    "cited_source_jaccard": round(len(se & sh) / len(se | sh), 3)
                    if se | sh
                    else None,
                }
            )
        out[system] = {
            "pairs": len(items),
            "same_status": summarize([1.0 if i["same_status"] else 0.0 for i in items]),
            "same_first_action": summarize([1.0 if i["same_first_action"] else 0.0 for i in items]),
            "cited_source_jaccard": summarize([i["cited_source_jaccard"] for i in items]),
            "items": items,
        }
    return out


def build_report(cases):
    s = get_settings()
    retrieval = (
        json.loads((OUT / "retrieval.json").read_text())
        if (OUT / "retrieval.json").exists()
        else {}
    )
    answers = (
        json.loads((OUT / "answers.json").read_text()) if (OUT / "answers.json").exists() else {}
    )
    summary = {
        "retrieval_production": retrieval_section(
            cases, retrieval, s.rag_min_similarity, s.rag_top_k
        ),
        "retrieval_sweep": [
            {k: v for k, v in retrieval_section(cases, retrieval, t, 5).items() if k != "rows"}
            for t in THRESHOLDS
        ],
        "answers": answers_section(cases, answers),
        "pairs": pairs_section(cases, answers),
    }
    (OUT / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1))
    lines = ["# Evaluation summary (generated)", ""]
    rp = summary["retrieval_production"]
    lines += [
        f"## Retrieval (k={rp['k']}, min similarity {rp['threshold']})",
        "",
        "| Slice | Cases | P@5 | P@5 ceiling | P@5 / ceiling | Evidence R@5 | Source R@5 | MRR | Success |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for name, a in [("all", rp["overall"]), *rp["by_language"].items()]:
        lines.append(
            f"| {name} | {a['cases']} | {a['precision_at_5']} | {a['precision_ceiling']} | {a['normalised_precision_at_5']} | {a['evidence_recall_at_5']} | {a['source_recall_at_5']} | {a['mrr']} | {a['success_rate']} |"
        )
    lines += [
        "",
        "Out-of-scope/abstain cases with chunks above threshold: "
        + (", ".join(rp["unlabelled_cases_with_results"]) or "none"),
        "",
        "### Threshold sweep (k=5)",
        "",
        "| Min similarity | P@5 | Evidence R@5 | MRR | Success | Abstain cases with results |",
        "|---|---|---|---|---|---|",
    ]
    for r in summary["retrieval_sweep"]:
        o = r["overall"]
        lines.append(
            f"| {r['threshold']} | {o['precision_at_5']} | {o['evidence_recall_at_5']} | {o['mrr']} | {o['success_rate']} | {len(r['unlabelled_cases_with_results'])} |"
        )
    if summary["answers"]:
        lines += [
            "",
            "## Answers",
            "",
            "| System | Cases | Behaviour acc. | Abstention acc. | Mention coverage | Cited answers | Citation precision | Unsupported specifics | Next-action acc. | Dependency exact | Invented deps | Median latency |",
            "|---|---|---|---|---|---|---|---|---|---|---|---|",
        ]
        for k in ["A", "B", "C", "P"]:
            a = summary["answers"].get(k)
            if a:
                lines.append(
                    f"| {SYSTEM_NAMES[k]} | {a['cases']} | {a['behaviour_accuracy']} | {a['abstention_accuracy']} | {a['mention_coverage']} | {a['answers_with_citations']} | {a['citation_precision']} | {a['answers_with_unsupported_specifics']} | {a['next_action_accuracy']} | {a['dependency_exact']} | {a['invented_dependencies']} | {a['latency'].get('median_ms')} ms |"
                )
        lines += [
            "",
            "| System | Schema errors | Names the next-action service | EN behaviour | HI behaviour | EN coverage | HI coverage |",
            "|---|---|---|---|---|---|---|",
        ]
        for k in ["A", "B", "C", "P"]:
            a = summary["answers"].get(k)
            if a:
                en, hi = a["by_language"].get("en", {}), a["by_language"].get("hi", {})
                lines.append(
                    f"| {SYSTEM_NAMES[k]} | {a['schema_errors']} | {a['explanation_consistent']} | {en.get('behaviour_accuracy')} | {hi.get('behaviour_accuracy')} | {en.get('mention_coverage')} | {hi.get('mention_coverage')} |"
                )
        lines += [
            "",
            "## English/Hindi pairs",
            "",
            "| System | Pairs | Same evidence status | Same first action | Cited-source Jaccard |",
            "|---|---|---|---|---|",
        ]
        for k in ["A", "B", "C", "P"]:
            p = summary["pairs"].get(k)
            if p:
                lines.append(
                    f"| {SYSTEM_NAMES[k]} | {p['pairs']} | {p['same_status']} | {p['same_first_action']} | {p['cited_source_jaccard']} |"
                )
    (OUT / "summary.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))
