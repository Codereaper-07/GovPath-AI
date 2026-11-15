# Scenario B — Incomplete intent (live Gemini validation)

**Result: PARTIAL PASS.** No hallucination and safe handling. The clarifying question is generic, and the state's source is mislabelled (see Defects).

| | |
|---|---|
| Test date/time | 2026-11-15, request sent 15:41:15 IST, answered 15:41:26 IST (about 11 s) |
| Exact input | "I need to renew my passport." |
| Gemini model | gemini-3.6-flash (configured model; no fallback) |
| Request outcome | Succeeded, HTTP 200, no provider errors, no diagnostic failure lines |
| Gemini requests used | 1 generation request, 0 embeddings, retries disabled |
| Environment | Real frontend and backend on this Mac, live Supabase, dedicated Delhi test account (empty vault, no plans or progress) |
| Data saved | None. The proposal was not accepted; the account still has 0 documents, plans, progress and activity |

## Actual AI response (extracted fields)
- goals: `[]` (none)
- life_events: `[]`
- requested_service_ids: `[]`. No generic "passport renewal" service was invented, and neither passport-reissue service (address change / name change after marriage) was assumed.
- held / lacking documents: `[]`. No document availability was assumed.
- unknowns: `["goal"]`. The model correctly flagged that the goal is unclear.
- state: `"Delhi"`. Copied from the account's profile (KNOWN CONTEXT); the text never mentions a place.
- dropped ids: none.

## Clarifying questions shown
- Review screen: "We could not tell what you want to do. Choose at least one goal." It offers the five supported goals.
- Proposal screen: "Answer the question(s) below to complete the plan. What do you want to do? Choose at least one goal." (planner code `goal_required`).
- Coverage note: "GovPath covers 10 verified services so far. There may be other government services relevant to you that it does not list."

## Planner behaviour
- Proposal status `needs_clarification`; no target services, no supporting services, no plan.
- No prerequisites, dependencies, blockers or next action were fabricated.
- "Save as a new plan" is disabled because there is no plan.
- Review and correction work: goals, state and documents are editable, and the citizen can add a supported service manually.

## Grounding and coverage
- No services were proposed, so there are no grounding counts and no source evidence to show. That is why `05-source-evidence.png` was not captured: no such screen was reached.
- Nothing outside the curated knowledge base appeared.

## Defects / observations
1. **(Low) Wrong provenance label for the state.** The model returned the profile's state although the prompt says not to copy known context unless the text confirms it. The UI then says "Services are checked for Delhi (from your description)" when it should say "from your profile". The jurisdiction is correct; only the attribution is wrong.
2. **(UX limitation) The clarification is generic.** It does not mention passports or say that plain passport renewal is not among the verified services. An ideal reply would ask whether the reissue is for an address change or a name change after marriage (the two supported passport services), or state that renewal for other reasons is not covered. The closed goal vocabulary has no passport-renewal entry, so the AI could only report "goal unknown".

## Screenshots (genuine headless-Chrome captures of the running app, unedited)
- `01-situation-input.png`: the submitted request
- `02-ai-response.png`: the AI result (goal not understood, clarification)
- `03-review-screen.png`: the extracted fields and correction interface
- `04-workflow-result.png`: the proposal outcome (needs clarification, no services, Save disabled)
- `06-final-result.png`: the final page state
- `05-source-evidence.png`: not captured (no evidence screen exists for an empty proposal)
