# Scenario B retest — passport renewal (live Gemini, after the provenance and clarification fixes)

**Result: PASS.** Location provenance, the passport clarification and the unsupported path all behaved as intended, with no writes.

| | |
|---|---|
| Date/time | 2026-11-15, run started 16:00:27 IST |
| Exact input | "I need to renew my passport." (submitted once) |
| Model | gemini-3.6-flash (configured; no fallback) |
| Gemini requests | **1** generation request (1 `POST /api/me/situation/interpret` in the backend log), 0 embeddings |
| Provider response | HTTP 200, about 4.1 s from click to the result on screen; no provider errors, no diagnostic failure lines |
| Retries | Disabled for this run only (`GEMINI_MAX_RETRIES=0` on the local backend process; `.env` unchanged) |
| Account | Dedicated test account, profile Delhi; 0 documents, plans, progress and activity before and after |

## What was checked (live page, after the single request)
- **Location provenance:** the state field showed Delhi labelled "From your saved profile." The proposal said "Services are checked for Delhi (from your profile)." Nothing was attributed to the description.
- **Passport clarification:** "You mentioned a passport. Which case is yours?" listed exactly the curated options "Passport reissue for change of address", "Passport reissue for change of name after marriage" and "Something else (another reason)". None was pre-selected, and no service was added automatically.
- **Unsupported reason:** after choosing "Something else", the page said "GovPath does not cover other passport cases yet, so it cannot plan them and nothing is saved…". The proposal had no services, no steps, no prerequisites and no plan, and "Save as a new plan" was disabled.
- **No writes:** My Plans shows "You have no plans yet." The account still has 0 documents, plans, progress and activity.
- **Hindi:** checked by switching language on the same page, with no new request. The question, the options (curated Hindi names), "कुछ और (कोई दूसरा कारण)", "आपकी सहेजी गई प्रोफ़ाइल से।", the not-covered notice and "सेवाएँ दिल्ली के लिए जाँची जा रही हैं (आपकी प्रोफ़ाइल से)।" all appeared in Hindi.
- **Mobile:** no horizontal overflow at 390 px on the review and proposal screens, in English and Hindi.
- **Errors:** no console errors and no failed network requests.

## Limitations of this evidence
- The raw JSON of the AI response was not kept. The test script read its in-page capture only after navigating away, which cleared it. The results above come from the live page and the backend log. It therefore cannot be shown whether Gemini itself returned no state or echoed Delhi and the server discarded the echo; either way the UI correctly attributes Delhi to the profile.
- The proposal screen shows both the not-covered notice and the generic "What do you want to do? Choose at least one goal." prompt. This is correct but slightly redundant.

## Screenshots (genuine headless-Chrome captures of the running app, unedited)
- `01-situation-input.png`: the submitted request
- `02-ai-response.png`: the AI result on the review screen (goal unclear, passport question, profile location)
- `03-passport-clarification.png`: the passport question, no option selected, "From your saved profile."
- `03b-hindi-mobile-clarification.png`: the same in Hindi at 390 px
- `04-unsupported-reason.png`: "Something else" chosen: coverage notice, no services, Save disabled
- `05-final-no-plan-saved.png`: My Plans after the test: no plans
