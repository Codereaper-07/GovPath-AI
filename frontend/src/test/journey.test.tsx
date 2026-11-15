// Situation → services → plan → review → accept (assistant entry point). Fixtures captured from
// the real /api/workflows/propose; the AI interpretation is a canned (mocked) response.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import i18n from '../i18n/config'
import type { SituationInterpretation } from '../types/api'
import documents from './fixtures/documents.json'
import proposeAadhaarOnly from './fixtures/propose-marriage-aadhaar-only.json'
import proposeDelhi from './fixtures/propose-marriage-delhi.json'
import proposeNoState from './fixtures/propose-marriage-nostate.json'
import proposePan from './fixtures/propose-marriage-pan.json'
import proposeRecords from './fixtures/propose-marriage-records.json'
import proposeAnnexure from './fixtures/propose-annexure.json'
import proposeUnsupported from './fixtures/propose-unsupported.json'
import planParallel from './fixtures/plan-parallel.json'
import services from './fixtures/services.json'
import vocabulary from './fixtures/vocabulary.json'
import { json, mockFetch, renderApp } from './utils'

const KEY = 'govpath.planner.v1'
const STORY = "I'm recently married in Delhi. I want to update my Aadhaar and passport surname. I don't have my marriage certificate yet."
const AADHAAR_NAME = 'aadhaar-name-update'
const PASSPORT_NAME = 'passport-reissue-name-change-marriage'

const interpretation: SituationInterpretation = {
  generated_by: 'ai',
  label: 'AI interpretation: review before using',
  model: 'fake-model',
  goals: ['update-name-after-marriage'],
  life_events: ['marriage-family'],
  state: 'Delhi',
  held_document_ids: ['aadhaar_number', 'passport_existing'],
  lacking_document_ids: ['marriage_certificate'],
  document_states: {},
  completed_service_ids: [],
  unknowns: [],
  dropped: [],
}

type Body = {
  context?: { goals: string[]; state: string | null; held_document_ids: string[]; lacking_document_ids: string[] }
  target_service_ids?: string[] | null
  workflow?: Record<string, unknown>
}

function backend(o: { interpret?: () => unknown; propose?: (b: Body) => unknown } = {}) {
  return mockFetch((url, init) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Body) : ({} as Body)
    if (url.endsWith('/api/services')) return services
    if (url.endsWith('/api/documents')) return documents
    if (url.endsWith('/api/workflows/vocabulary')) return vocabulary
    if (url.endsWith('/api/situation/interpret')) return (o.interpret ?? (() => interpretation))()
    if (url.endsWith('/api/workflows/propose')) return (o.propose ?? (() => proposeDelhi))(body)
    if (url.endsWith('/api/workflows/plan')) return planParallel
    if (url.endsWith('/api/assistant/query')) return json(503, { detail: { code: 'assistant_not_configured' } })
    return json(404, {})
  })
}
const bodies = (calls: { url: string; body: unknown }[], path: string) => calls.filter((c) => c.url.endsWith(path)).map((c) => c.body as Body)

async function describeAndUnderstand() {
  renderApp('/assistant')
  await userEvent.type(await screen.findByLabelText('Describe your situation in your own words'), STORY)
  await userEvent.click(screen.getByRole('button', { name: 'Understand my situation' }))
  return screen.findByTestId('journey-review')
}
async function buildPlan() {
  await userEvent.click(screen.getByRole('button', { name: 'Find services and build my plan' }))
  return screen.findByTestId('journey-proposal')
}

describe('Situation → workflow journey (assistant entry point)', () => {
  it('understands the situation, finds several services automatically and proposes a plan without saving it', async () => {
    const calls = backend()
    const review = await describeAndUnderstand()
    expect(within(review).getByText(/AI-generated/)).toBeInTheDocument()
    expect(within(review).getByRole('checkbox', { name: 'Change my name after marriage' })).toBeChecked()
    expect(within(review).getByRole('button', { name: 'Remove Marriage certificate (issued by government / Registrar of Marriage)' })).toBeInTheDocument()
    const proposal = await buildPlan()

    // The request carries the reviewed facts; services are NOT chosen by the citizen or the AI.
    expect(bodies(calls, '/api/workflows/propose')[0]).toEqual({
      context: {
        goals: ['update-name-after-marriage'],
        life_events: ['marriage-family'],
        state: 'Delhi',
        held_document_ids: ['aadhaar_number', 'passport_existing'],
        lacking_document_ids: ['marriage_certificate'],
        completed_service_ids: [],
      },
      document_states: {},
      progress: {},
      target_service_ids: null,
      requested_service_ids: [], // the AI found no explicitly named services in this story
    })
    expect(within(proposal).getByTestId(`outcome-${AADHAAR_NAME}`)).toHaveTextContent('Matches your goal')
    expect(within(proposal).getByTestId(`outcome-${PASSPORT_NAME}`)).toBeInTheDocument()
    // Prerequisite discovered by the planner, with its reason.
    expect(within(proposal).getByTestId('supporting-marriage-registration-delhi')).toHaveTextContent(
      'Added by the planner: it issues Marriage certificate (issued by government / Registrar of Marriage)',
    )
    // Order, parallel group and blockers come from the planner (stage 1, then 2 steps in parallel).
    expect(within(proposal).getByText(/2 independent steps: do them in any order or at the same time/)).toBeInTheDocument()
    expect(within(proposal).getByTestId('step-marriage-registration-delhi')).toHaveAttribute('data-status', 'blocked')
    // Preview: no progress controls yet; evidence links present; coverage limits stated.
    expect(within(proposal).queryByRole('combobox', { name: /Your progress on/ })).toBeNull()
    expect(within(proposal).getAllByText(/Official sources? \(\d+\)/).length).toBeGreaterThan(0)
    expect(proposal.querySelector('a[href^="https://"][href*=".gov.in"]')).not.toBeNull()
    expect(within(proposal).getByText(/There may be other government services/)).toBeInTheDocument()
    // Nothing saved before acceptance.
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('keeps alternative documents visible and regenerates when the citizen holds one', async () => {
    const calls = backend({ propose: (b) => (b.context?.held_document_ids.includes('joint_photo_declaration') ? proposeAnnexure : proposeDelhi) })
    await describeAndUnderstand()
    const proposal = await buildPlan()
    const passport = within(proposal).getByTestId(`step-${PASSPORT_NAME}`)
    expect(passport).toHaveTextContent('Or, if you already have one: Joint photo declaration of husband and wife (Passport Annexure J)')
    await userEvent.click(within(passport).getByRole('button', { name: /I have Joint photo declaration/ }))
    await waitFor(() => expect(bodies(calls, '/api/workflows/propose').at(-1)!.context!.held_document_ids).toContain('joint_photo_declaration'))
    await waitFor(() => expect(within(screen.getByTestId(`step-${PASSPORT_NAME}`)).getByText('Does not depend on any other step.')).toBeInTheDocument())
    expect(within(screen.getByTestId(`step-${AADHAAR_NAME}`)).queryByText('Does not depend on any other step.')).toBeNull()
  })

  it('lets the citizen remove and add services and regenerate before accepting', async () => {
    const calls = backend({
      propose: (b) =>
        b.target_service_ids?.includes('instant-e-pan') ? proposePan : b.target_service_ids?.length === 1 ? proposeAadhaarOnly : proposeDelhi,
    })
    await describeAndUnderstand()
    await buildPlan()
    await userEvent.click(screen.getByRole('button', { name: /Remove Passport reissue for change of name/ }))
    await waitFor(() => expect(bodies(calls, '/api/workflows/propose').at(-1)!.target_service_ids).toEqual([AADHAAR_NAME]))
    await waitFor(() => expect(screen.queryByTestId(`outcome-${PASSPORT_NAME}`)).toBeNull())
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '+ Add another supported service' }), PASSPORT_NAME)
    await waitFor(() => expect(bodies(calls, '/api/workflows/propose').at(-1)!.target_service_ids).toEqual([AADHAAR_NAME, PASSPORT_NAME]))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '+ Add another supported service' }), 'instant-e-pan')
    await waitFor(() => expect(screen.getByTestId('outcome-instant-e-pan')).toHaveTextContent('Added by you'))
  })

  it('guests must sign in to save: the proposal is kept for after sign-in, nothing is saved on the device', async () => {
    backend()
    await describeAndUnderstand()
    await buildPlan()
    expect(screen.queryByRole('button', { name: 'Use this plan' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Sign in to save this plan' }))
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByText(/Your proposal is kept/)).toBeInTheDocument()
    const pending = JSON.parse(sessionStorage.getItem('govpath.pendingProposal')!)
    expect(pending.draft).toMatchObject({ goals: ['update-name-after-marriage'], state: 'Delhi' })
    expect(localStorage.getItem(KEY)).toBeNull()
  })
})

describe('Review edits are what gets saved (independent review findings)', () => {
  it('ignores old device-plan data left in this browser (only account data is used)', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ targets: ['retired-service'], owned: ['retired_doc'], completed: ['retired-service'], generated: true, progress: { 'retired-service': 'started' }, docStates: { retired_doc: 'expired' } }),
    )
    const calls = backend()
    await describeAndUnderstand()
    await buildPlan()
    const body = bodies(calls, '/api/workflows/propose')[0] as unknown as Record<string, Record<string, unknown>>
    expect(body.context.held_document_ids).toEqual(['aadhaar_number', 'passport_existing'])
    expect(body.context.completed_service_ids).toEqual([])
    expect(body.progress).toEqual({})
    expect(body.document_states).toEqual({})
  })

  it('AI-extracted life events can be removed before services are looked up', async () => {
    const calls = backend()
    const review = await describeAndUnderstand()
    await userEvent.click(within(review).getByRole('button', { name: 'Remove Marriage & Family' }))
    await buildPlan()
    expect((bodies(calls, '/api/workflows/propose')[0] as unknown as { context: { life_events: string[] } }).context.life_events).toEqual([])
  })
})

describe('Missing information, unsupported situations and failures', () => {
  it('works without AI (quota exhausted) and asks about existing records instead of assuming', async () => {
    const calls = backend({
      interpret: () => json(429, { detail: { code: 'quota_exhausted' } }),
      propose: (b) => (b.context!.held_document_ids.includes('aadhaar_number') ? proposeDelhi : proposeRecords),
    })
    renderApp('/assistant')
    await userEvent.type(await screen.findByLabelText('Describe your situation in your own words'), STORY)
    await userEvent.click(screen.getByRole('button', { name: 'Understand my situation' }))
    expect(await screen.findByText(/AI reader is unavailable right now/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Fill in the details myself' }))
    const review = await screen.findByTestId('journey-review')
    await userEvent.click(within(review).getByRole('checkbox', { name: 'Change my name after marriage' }))
    await userEvent.selectOptions(within(review).getByRole('combobox', { name: /Where do you live now\?/ }), 'Delhi')
    const proposal = await buildPlan()
    expect(proposal).toHaveAttribute('data-status', 'needs_clarification')
    expect(within(proposal).getByText('Do you have Aadhaar number (existing Aadhaar)?')).toBeInTheDocument()
    expect(within(proposal).getByRole('button', { name: 'Sign in to save this plan' })).toBeDisabled()
    await userEvent.click(within(proposal).getAllByRole('button', { name: 'Yes, I have it' })[0])
    await waitFor(() => expect(bodies(calls, '/api/workflows/propose').at(-1)!.context!.held_document_ids).toContain('aadhaar_number'))
    expect(bodies(calls, '/api/situation/interpret')).toHaveLength(1) // only the explicit click
  })

  it('asks for the state when a suggested service is state-specific', async () => {
    const calls = backend({ interpret: () => ({ ...interpretation, state: null, unknowns: ['state'] }), propose: (b) => (b.context!.state ? proposeDelhi : proposeNoState) })
    await describeAndUnderstand()
    const proposal = await buildPlan()
    expect(within(proposal).getByText(/Which state or union territory do you live in/)).toBeInTheDocument()
    await userEvent.selectOptions(within(proposal).getByRole('combobox', { name: 'Where do you live now?' }), 'Delhi')
    await waitFor(() => expect(bodies(calls, '/api/workflows/propose').at(-1)!.context!.state).toBe('Delhi'))
  })

  it('says so when the knowledge base has no verified service, and invents none', async () => {
    backend({ interpret: () => ({ ...interpretation, goals: [], life_events: ['starting-business'] }), propose: () => proposeUnsupported })
    await describeAndUnderstand()
    const proposal = await buildPlan()
    expect(within(proposal).getByText(/no verified service for this situation yet/)).toBeInTheDocument()
    expect(within(proposal).getByText(/No verified services yet for: Starting a Business/i)).toBeInTheDocument()
    expect(within(proposal).queryAllByTestId(/^outcome-/)).toHaveLength(0)
    expect(within(proposal).getByRole('button', { name: 'Sign in to save this plan' })).toBeDisabled()
  })

  it('fails safely when the proposal API errors: nothing is saved', async () => {
    localStorage.setItem(KEY, JSON.stringify({ targets: ['instant-e-pan'], owned: [], completed: [], generated: true }))
    const before = localStorage.getItem(KEY)
    backend({ propose: () => json(500, {}) })
    await describeAndUnderstand()
    await userEvent.click(screen.getByRole('button', { name: 'Find services and build my plan' }))
    expect(await screen.findByText('We could not build a plan right now. Your saved plan has not changed.')).toBeInTheDocument()
    expect(localStorage.getItem(KEY)).toBe(before)
  })

  it('explains the proposal (not the saved plan) and keeps the journey on screen', async () => {
    localStorage.setItem(KEY, JSON.stringify({ targets: ['instant-e-pan'], owned: ['pan_card'], completed: [], generated: true }))
    const calls = backend()
    await describeAndUnderstand()
    await buildPlan()
    await userEvent.click(screen.getByRole('button', { name: 'Ask the assistant to explain it' }))
    await waitFor(() => expect(bodies(calls, '/api/assistant/query')).toHaveLength(1))
    expect(bodies(calls, '/api/assistant/query')[0].workflow).toMatchObject({
      target_service_ids: [AADHAAR_NAME, PASSPORT_NAME],
      owned_document_ids: ['aadhaar_number', 'passport_existing'], // old device data is not used
      state: 'Delhi',
    })
    expect(await screen.findByTestId('journey-proposal')).toBeInTheDocument()
  })

  it('works in Hindi', async () => {
    backend()
    renderApp('/assistant')
    await screen.findByLabelText('Describe your situation in your own words')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'hi')
    expect(await screen.findByText('अपनी स्थिति से योजना बनाएँ')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('अपनी स्थिति अपने शब्दों में बताएँ'), STORY)
    await userEvent.click(screen.getByRole('button', { name: 'मेरी स्थिति समझें' }))
    await userEvent.click(await screen.findByRole('button', { name: 'सेवाएँ ढूँढें और मेरी योजना बनाएँ' }))
    const proposal = await screen.findByTestId('journey-proposal')
    expect(within(proposal).getByText('पहले ज़रूरी')).toBeInTheDocument()
    expect(within(proposal).getByRole('button', { name: 'यह योजना सहेजने के लिए साइन इन करें' })).toBeInTheDocument()
    await i18n.changeLanguage('en')
  })
})
