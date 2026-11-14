"""Knowledge base: model relationships, evidence, OR groups, and idempotent seeding."""

import copy
from datetime import UTC, datetime

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.ingestion.allowlist import load_allowlist
from app.knowledge import repository
from app.knowledge.seed import SeedError, apply_seed, validate_seed_data
from app.models import (
    DocumentType,
    Evidence,
    GovernmentService,
    ServicePrerequisite,
    ServiceRequirement,
    SourceDocument,
)
from app.models.enums import Jurisdiction, RequirementType, SourceType, VerificationStatus

SERVICES = {
    "aadhaar-address-update",
    "voter-id-address-change-form-8",
    "driving-licence-address-change",
    "vehicle-rc-address-change",
    "passport-reissue-change-of-address",
}


async def _count(session, model) -> int:
    return (await session.execute(select(func.count()).select_from(model))).scalar_one()


# ------------------------------------------------------------------ models


async def test_service_requirement_option_and_evidence_relationships(session):
    src = SourceDocument(url="https://x.gov.in/a", source_type=SourceType.WEBPAGE)
    ev = Evidence(key="ev-a", source=src, excerpt="Proof of address", excerpt_hash="h1")
    bill = DocumentType(slug="bill", name="Bill", category="address_proof")
    deed = DocumentType(slug="deed", name="Deed", category="address_proof")
    svc = GovernmentService(
        slug="svc",
        name="Svc",
        description="d",
        authority="A",
        jurisdiction=Jurisdiction.NATIONAL,
        category="c",
        official_info_url="https://x.gov.in",
    )
    req = ServiceRequirement(slug="poa", name="PoA", requirement_type=RequirementType.MANDATORY)
    req.evidence = [ev]
    from app.models import RequirementOption

    req.options = [
        RequirementOption(document_type=bill, evidence=ev),
        RequirementOption(document_type=deed),
    ]
    svc.requirements = [req]
    svc.evidence = [ev]
    session.add(svc)
    await session.commit()

    loaded = await repository.get_service(session, "svc")
    [r] = loaded.requirements
    assert [o.document_type.slug for o in r.options] == ["bill", "deed"]  # OR group
    assert r.options[0].evidence.source.url == "https://x.gov.in/a"
    assert r.evidence[0].key == "ev-a" and loaded.evidence[0].key == "ev-a"
    assert r.verification_status is VerificationStatus.UNVERIFIED  # default


async def test_unique_and_check_constraints(session):
    session.add_all(
        [
            DocumentType(slug="dup", name="A", category="other"),
            DocumentType(slug="dup", name="B", category="other"),
        ]
    )
    with pytest.raises(IntegrityError):
        await session.commit()
    await session.rollback()

    src = SourceDocument(url="https://x.gov.in/b", source_type=SourceType.PDF)
    ev = Evidence(key="ev-b", source=src, excerpt="x", excerpt_hash="h")
    svc = GovernmentService(
        slug="s",
        name="S",
        description="d",
        authority="A",
        jurisdiction=Jurisdiction.STATE,
        category="c",
        official_info_url="https://x.gov.in",
    )
    session.add_all([svc, ev])
    await session.flush()
    session.add(ServicePrerequisite(service_id=svc.id, prerequisite_service_id=svc.id, evidence=ev))
    with pytest.raises(IntegrityError):  # a service cannot be its own prerequisite
        await session.commit()


async def test_deleting_service_cascades_requirements(seeded_factory):
    async with seeded_factory() as s:
        svc = await repository.get_service(s, "vehicle-rc-address-change")
        await s.delete(svc)
        await s.commit()
        remaining = await s.execute(
            select(func.count()).select_from(ServiceRequirement).join(GovernmentService)
        )
        assert remaining.scalar_one() == sum(
            1 for _ in (await s.execute(select(ServiceRequirement))).scalars()
        )
        assert await repository.get_service(s, "vehicle-rc-address-change") is None


# ------------------------------------------------------------------ curated dataset


async def test_seed_loads_all_five_services_with_verified_evidence(seeded_factory):
    async with seeded_factory() as s:
        services = await repository.list_services(s)
        assert {x.slug for x in services} == SERVICES
        for svc in services:
            assert svc.last_verified_at is not None
            assert svc.official_info_url.startswith("https://")
            for r in svc.requirements:
                evidence = [*r.evidence, *(o.evidence for o in r.options if o.evidence)]
                assert evidence, f"{svc.slug}.{r.slug} has no evidence"
                assert r.verification_status is VerificationStatus.VERIFIED
                assert all(e.verification_status is VerificationStatus.VERIFIED for e in evidence)
                assert all(e.source.url.startswith("https://") for e in evidence)
        # No cross-service prerequisite is stated by the official sources: none is seeded.
        assert await _count(s, ServicePrerequisite) == 0


async def test_alternative_groups_and_requirement_types_are_distinguished(seeded_factory):
    async with seeded_factory() as s:
        voter = await repository.get_service(s, "voter-id-address-change-form-8")
        by_slug = {r.slug: r for r in voter.requirements}
        poa = by_slug["proof-of-address"]
        assert poa.requirement_type is RequirementType.MANDATORY and len(poa.options) == 9
        assert "aadhaar_current_address" in {o.document_type.slug for o in poa.options}
        # Aadhaar number is optional for Form 8, not a prerequisite.
        assert by_slug["aadhaar-number"].requirement_type is RequirementType.OPTIONAL

        rc = await repository.get_service(s, "vehicle-rc-address-change")
        kinds = {r.slug: r.requirement_type for r in rc.requirements}
        assert kinds["financier-noc"] is RequirementType.CONDITIONAL
        assert kinds["insurance"] is RequirementType.MANDATORY


async def test_driving_licence_is_not_an_aadhaar_address_proof(seeded_factory):
    async with seeded_factory() as s:
        aadhaar = await repository.get_service(s, "aadhaar-address-update")
        poa = next(r for r in aadhaar.requirements if r.slug == "proof-of-address")
        docs = {o.document_type.slug for o in poa.options}
        assert "driving_licence_current_address" not in docs
        assert "driving_licence_existing" not in docs


def test_every_seed_source_is_on_the_ingestion_allowlist(seed_data):
    allowlist = load_allowlist()
    for src in seed_data.sources:
        assert allowlist.is_allowed(src.url), src.url


async def test_seeding_is_idempotent(session_factory, seed_data):
    async with session_factory() as s:
        first = await apply_seed(s, seed_data)
        await s.commit()
    async with session_factory() as s:
        second = await apply_seed(s, seed_data)
        await s.commit()
    assert first.created["government_services"] == 5
    assert second.created == {}
    assert first.totals == second.totals
    assert first.warnings == second.warnings == []


async def test_seed_updates_existing_rows_in_place(session_factory, seed_data):
    async with session_factory() as s:
        await apply_seed(s, seed_data)
        await s.commit()
    changed = copy.deepcopy(seed_data)
    svc = next(x for x in changed.services if x.slug == "vehicle-rc-address-change")
    svc.name = "Vehicle RC address change (renamed)"
    svc.requirements = [r for r in svc.requirements if r.slug != "chassis-engine-pencil-print"]
    async with session_factory() as s:
        report = await apply_seed(s, changed)
        await s.commit()
        assert report.created == {}
        rc = await repository.get_service(s, "vehicle-rc-address-change")
        assert rc.name.endswith("(renamed)")
        assert "chassis-engine-pencil-print" not in {r.slug for r in rc.requirements}


def test_seed_validation_rejects_bad_references(seed_data):
    bad = copy.deepcopy(seed_data)
    svc = bad.services[0]
    svc.requirements[0].options[0].document = "no_such_document"
    svc.evidence.append("no-such-evidence")
    with pytest.raises(SeedError) as exc:
        validate_seed_data(bad)
    text = str(exc.value)
    assert "unknown document no_such_document" in text and "no-such-evidence" in text


async def test_source_changed_after_verification_is_not_reverified(session_factory, seed_data):
    async with session_factory() as s:
        await apply_seed(s, seed_data)
        await s.commit()
    url = seed_data.sources[0].url
    async with session_factory() as s:
        src = (
            await s.execute(select(SourceDocument).where(SourceDocument.url == url))
        ).scalar_one()
        src.content_text = "completely different text"
        src.content_hash = "x"
        src.last_changed_at = datetime(2099, 1, 1, tzinfo=UTC)
        src.verification_status = VerificationStatus.NEEDS_REVIEW
        await s.commit()
    async with session_factory() as s:
        report = await apply_seed(s, seed_data)
        await s.commit()
        src = (
            await s.execute(
                select(SourceDocument)
                .options(selectinload(SourceDocument.evidence))
                .where(SourceDocument.url == url)
            )
        ).scalar_one()
        assert src.verification_status is VerificationStatus.NEEDS_REVIEW
        assert all(e.verification_status is VerificationStatus.NEEDS_REVIEW for e in src.evidence)
        assert any("needs_review" in w for w in report.warnings)
        # Requirements relying on that evidence are no longer verified.
        aadhaar = await repository.get_service(s, "aadhaar-address-update")
        statuses = {r.slug: r.verification_status for r in aadhaar.requirements}
        assert statuses["aadhaar-number"] is not VerificationStatus.VERIFIED


async def test_seed_flags_evidence_missing_from_ingested_text(session_factory, seed_data):
    url = seed_data.sources[2].url
    async with session_factory() as s:
        s.add(
            SourceDocument(
                url=url,
                source_type=SourceType.PDF,
                content_text="This text does not contain any of the curated excerpts.",
                content_hash="abc",
            )
        )
        await s.commit()
    async with session_factory() as s:
        report = await apply_seed(s, seed_data)
        await s.commit()
    missing = [w for w in report.warnings if "excerpt not found" in w]
    assert len(missing) == len(seed_data.sources[2].evidence)
