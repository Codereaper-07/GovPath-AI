"""Citation normalisation/validation and grounding context (pure; no API calls)."""

from app.rag.context import FactLine, ServiceFacts, is_relocation_question, relevant_services
from app.rag.generator import AnswerDraft, build_prompt, normalize_citations, validate_draft

KNOWN = {"S1", "S2", "S3", "K1", "K2"}


def test_single_markers_are_kept():
    assert normalize_citations("Use a bill [S1].", KNOWN) == ("Use a bill [S1].", ["S1"])


def test_combined_markers_are_split_into_valid_ids():
    text, ids = normalize_citations("Apply online [K1, S3]. Also [S1; S2] and [s2 and k1].", KNOWN)
    assert text == "Apply online [K1][S3]. Also [S1][S2] and [S2][K1]."
    assert ids == ["K1", "S3", "S1", "S2"]


def test_unknown_ids_never_survive():
    text, ids = normalize_citations("Fee is Rs 50 [S99]. Mixed [K1, S42].", KNOWN)
    assert text == "Fee is Rs 50. Mixed [K1]."
    assert ids == ["K1"] and "S99" not in text and "S42" not in text


def test_malformed_markers_are_handled():
    assert (
        normalize_citations("Unclosed [S1, S3 then text", KNOWN)[0] == "Unclosed [S1][S3] then text"
    )
    assert normalize_citations("Spaced [ K2 ]", KNOWN)[0] == "Spaced [K2]"
    assert normalize_citations("Range [S1-S3].", KNOWN)[0] == "Range [S1][S2][S3]."
    assert normalize_citations("Huge range [S1-S9999]", KNOWN)[0] == "Huge range [S1][S2][S3]"
    # Not citations: left untouched.
    assert normalize_citations("Item [1] and [note]", KNOWN)[0] == "Item [1] and [note]"


def test_validate_draft_uses_listed_and_inline_ids_but_only_known_ones():
    draft = AnswerDraft(
        answer="Docs [K1, S9]. More [s2].",
        cited_source_ids=["s1", "K7"],
        evidence_status="sufficient",
    )
    text, cited, status = validate_draft(draft, KNOWN)
    assert text == "Docs [K1]. More [S2]."
    assert cited == ["S1", "K1", "S2"] and status == "sufficient"
    uncited = AnswerDraft(
        answer="Trust me [S77].", cited_source_ids=["S77"], evidence_status="sufficient"
    )
    assert validate_draft(uncited, KNOWN) == ("Trust me.", [], "partial")


def _facts():
    def svc(slug, name):
        return ServiceFacts(slug, name, None, frozenset(), (FactLine(name, None),))

    return [
        svc("aadhaar-address-update", "Aadhaar address update"),
        svc("voter-id-address-change-form-8", "Voter ID address change"),
        svc("driving-licence-address-change", "Driving licence address change"),
        svc("vehicle-rc-address-change", "Vehicle RC address change"),
        svc("passport-reissue-change-of-address", "Passport reissue"),
    ]


def test_relocation_questions_include_every_covered_service():
    q = "I moved from Delhi to Maharashtra and I own a car. What should I update?"
    assert is_relocation_question(q)
    picked = [
        f.slug for f in relevant_services(q, _facts(), evidence_ids=set(), workflow_service_ids=[])
    ]
    assert picked[0] == "vehicle-rc-address-change"  # 'car' is an explicit vehicle mention
    assert len(picked) == 5
    hindi = "मैं दूसरे राज्य में शिफ्ट हुआ हूँ, क्या अपडेट करूँ?"
    assert len(relevant_services(hindi, _facts(), evidence_ids=set(), workflow_service_ids=[])) == 5


def test_keywords_match_whole_words_only():
    from app.rag.context import mentions

    assert mentions("I own a car", "car") and not mentions("How do I get a PAN card?", " car")
    assert not relevant_services(
        "How do I apply for a new PAN card?", _facts(), evidence_ids=set(), workflow_service_ids=[]
    )
    assert mentions("मेरी कार है", "कार")
    assert not mentions("सरकारी सेवा", "कार") and not mentions("पैन कार्ड", "कार")
    assert is_relocation_question("We are relocating to Pune") and not is_relocation_question(
        "PAN card"
    )


def test_specific_questions_stay_focused():
    picked = relevant_services(
        "Which documents for passport reissue?",
        _facts(),
        evidence_ids=set(),
        workflow_service_ids=[],
    )
    assert [f.slug for f in picked] == ["passport-reissue-change-of-address"]


def test_prompt_lists_covered_services_and_requirement_rules():
    from app.rag.generator import SYSTEM_PROMPT

    prompt = build_prompt(
        question="q",
        language="en",
        facts=[],
        excerpts=[],
        plan_summary=None,
        catalogue=["Aadhaar address update", "Passport reissue"],
    )
    assert (
        "SERVICES COVERED (GovPath knowledge base): Aadhaar address update; Passport reissue"
        in prompt
    )
    assert "Never present one alternative as required" in SYSTEM_PROMPT
    assert "official source does not specify" in SYSTEM_PROMPT
    assert "Never say a covered service is unavailable" in SYSTEM_PROMPT


async def test_rc_proof_of_address_fact_carries_unspecified_note(seeded_factory):
    from app.rag.context import load_service_facts

    async with seeded_factory() as s:
        facts = {f.slug: f for f in await load_service_facts(s)}
    rc = [
        line.text
        for line in facts["vehicle-rc-address-change"].lines
        if "Proof of new address" in line.text
    ]
    assert rc and "not listed by Parivahan" in rc[0]
    dl = [
        line.text
        for line in facts["driving-licence-address-change"].lines
        if "Proof of new address" in line.text
    ]
    assert "any one of:" in dl[0]  # alternatives stay alternatives
