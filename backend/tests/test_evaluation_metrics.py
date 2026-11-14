"""Scoring functions used by evaluation/ (pure; no API calls)."""

from evaluation.metrics import (
    behaviour_correct,
    citation_precision,
    dependency_scores,
    mention_coverage,
    next_action_correct,
    retrieval_scores,
    unsupported_specifics,
)

CASE = {
    "relevant_sources": ["u1", "u2"],
    "relevant_evidence": ["e1", "e2"],
    "must_mention": [["form 8"], ["ero", "officer"]],
}


def test_retrieval_scores():
    ranked = [
        {"source_url": "x", "evidence_ids": []},
        {"source_url": "u1", "evidence_ids": ["e1"]},
        {"source_url": "u1", "evidence_ids": []},
    ]
    s = retrieval_scores(ranked, CASE)
    assert s["precision_at_k"] == 2 / 5 and s["reciprocal_rank"] == 0.5
    assert s["evidence_recall_at_k"] == 0.5 and s["source_recall_at_k"] == 0.5
    assert s["duplicates_same_source"] == 1
    assert retrieval_scores(ranked, {**CASE, "relevant_sources": []}) is None


def test_answer_scoring():
    assert mention_coverage("Use Form 8 with the ERO", CASE["must_mention"]) == 1.0
    assert mention_coverage("Use Form 8", CASE["must_mention"]) == 0.5
    assert unsupported_specifics(
        "The fee is ₹1,500 and takes 30 days.", "apply within 14 days"
    ) == ["₹1,500", "30 days"]
    assert unsupported_specifics("Apply within 14 days.", "within 14 days of address changed") == []
    assert behaviour_correct("abstain", "insufficient", True, False)
    assert not behaviour_correct("abstain", "sufficient", False, False)
    assert not behaviour_correct("answer", "sufficient", False, True)
    assert behaviour_correct("partial", "partial", False, False)
    assert (
        citation_precision(
            [
                {"source_url": "u2"},
                {"source_url": "z", "evidence_ids": ["e2"]},
                {"source_url": "z"},
            ],
            CASE,
        )
        == 2 / 3
    )
    assert next_action_correct(
        {"type": "start_service", "service_id": "a"},
        {"type": "start_service", "service_ids": ["a", "b"]},
    )
    assert not next_action_correct(
        {"type": "start_service", "service_id": "c"},
        {"type": "start_service", "service_ids": ["a"]},
    )
    assert next_action_correct(
        {"type": "obtain_document", "service_id": None},
        {"type": "obtain_document", "service_ids": []},
    )
    d = dependency_scores([["a", "b"], ["c", "d"]], [["a", "b"]])
    assert not d["exact"] and d["invented"] == [("c", "d")] and d["missed"] == []
