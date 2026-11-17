// Milestone 3: citizen dashboard and the account-aware situation journey. Backend and Supabase
// Auth are fakes; the AI interpretation is a canned response (no Gemini call).
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import i18n from '../i18n/config'
import type { AccountProposal, Dashboard, ProposalResponse, SituationInterpretation } from '../types/api'
import { fakeAuth, sessionFor } from './authFakes'
import documents from './fixtures/documents.json'
import planMarriage from './fixtures/plan-marriage-delhi.json'
import proposeDelhi from './fixtures/propose-marriage-delhi.json'
import services from './fixtures/services.json'
import vocabulary from './fixtures/vocabulary.json'
import { json, mockFetch, renderApp } from './utils'

const AADHAAR_NAME = 'aadhaar-name-update'
const PASSPORT_NAME = 'passport-reissue-name-change-marriage'
const PAN = 'instant-e-pan'
const signedIn = () => fakeAuth({ stored: sessionFor('user-a') }).client
const svcName = (id: string) => services.find((s) => s.id === id)!.name
const docName = (id: string) => documents.find((d) => d.id === id)!.name

interface Call {
  path: string
  method: string
  auth: string | null
  body: unknown
}

const DASHBOARD: Dashboard = {
  today: '2026-11-16',
  full_name: 'Asha Verma',
  state: 'Delhi',
  city: 'Dwarka',
  preferred_language: 'en',
  plans: [
    {
      id: 'plan-1',
      title: 'Name after marriage',
      status: 'active',
      target_service_ids: [AADHAAR_NAME, PASSPORT_NAME],
      citizen_state: 'Delhi',
      service_names: {},
      total_services: 3,
      completed: 1,
      blocked: 1,
      ready: 1,
      next_action: { type: 'start_service', service_id: 'marriage-registration-delhi' },
      evaluation_error: null,
      created_at: '',
      updated_at: '',
      archived_at: null,
    },
  ],
  next_actions: [{ plan_id: 'plan-1', plan_title: 'Name after marriage', type: 'start_service', service_id: 'marriage-registration-delhi', reason_code: 'unblocks_downstream', document_options: [] }],
  blockers: [
    { plan_id: 'plan-1', plan_title: 'Name after marriage', code: 'missing_document_no_route', service_id: 'vehicle-rc-address-change', requirement_id: 'x', document_options: ['rto_accepted_address_proof'], blocked_by_service_ids: [] },
  ],
  progress: { [PAN]: 'completed' },
  vault_counts: { valid: 2, expired: 1, invalid: 0, unsure: 0 },
  vault_total: 3,
  expiring_soon: [doc('passport_existing', '2026-12-06', 'valid')],
  expired: [doc('driving_licence_existing', '2026-11-10', 'expired')],
  recent_activity: [
    { id: 2, event_type: 'document_expired', entity_type: 'document', entity_id: 'd1', details: { document_type: 'driving_licence_existing', expiry_date: '2026-11-10' }, created_at: '2026-11-16T00:05:00Z' },
    { id: 1, event_type: 'progress_changed', entity_type: 'service', entity_id: PAN, details: { service_id: PAN, from: 'not_started', to: 'completed' }, created_at: '2026-11-15T10:00:00Z' },
  ],
}

function doc(type: string, expiry: string, status: 'valid' | 'expired') {
  return {
    id: `doc-${type}`,
    document_type: type,
    name: docName(type),
    name_hi: null,
    status: 'valid' as const,
    effective_status: status,
    expiry_passed: status === 'expired',
    label: null,
    issue_date: null,
    expiry_date: expiry,
    note: null,
    used_by_plan_ids: [],
    created_at: '',
    updated_at: '',
  }
}

const INTERPRETATION: SituationInterpretation = {
  generated_by: 'ai',
  label: 'AI interpretation',
  model: 'fake',
  goals: ['update-name-after-marriage'],
  life_events: ['marriage-family'],
  state: null,
  held_document_ids: [],
  lacking_document_ids: [],
  completed_service_ids: [AADHAAR_NAME],
  requested_service_ids: [PASSPORT_NAME],
  origin_state: null,
  unknowns: [],
  dropped: [],
  account_state: 'Delhi',
  account_document_ids: ['passport_existing'],
}

const proposal = (over: Partial<ProposalResponse> = {}): ProposalResponse =>
  ({
    ...(proposeDelhi as unknown as ProposalResponse),
    target_service_ids: [PASSPORT_NAME],
    requested: [
      { service_id: PASSPORT_NAME, outcome: 'target' },
      { service_id: 'marriage-registration-delhi', outcome: 'outside_jurisdiction' },
    ],
    suggested_service_ids: [PAN],
    grounding: { requirements: 9, requirements_grounded: 9, dependencies: 2, dependencies_grounded: 2, ungrounded: [] },
    ...over,
  }) as ProposalResponse

function backend(
  opts: { recommendation?: AccountProposal['recommendation']; interpretation?: SituationInterpretation; profileState?: string | null; proposalOver?: Partial<ProposalResponse> } = {},
) {
  const calls: Call[] = []
  mockFetch((url, init) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '')
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ path, method, auth: new Headers(init?.headers).get('Authorization'), body })
    if (path === '/api/services') return services
    if (path === '/api/documents') return documents
    if (path === '/api/workflows/vocabulary') return vocabulary
    if (path === '/api/workflows/propose') return proposal()
    if (path === '/api/situation/interpret') return { ...(opts.interpretation ?? INTERPRETATION), account_state: undefined }
    if (path === '/api/workflows/plan') return planMarriage
    if (!path.startsWith('/api/me/')) return json(404, {})
    if (path === '/api/me/dashboard') return DASHBOARD
    if (path === '/api/me/profile') return { user_id: 'user-a', email: 'a@x', full_name: 'Asha', state: opts.profileState === undefined ? 'Delhi' : opts.profileState, city: null, preferred_language: 'en', created_at: '', updated_at: '' }
    if (path === '/api/me/documents') return { documents: [doc('passport_existing', '2030-01-01', 'valid')] }
    if (path === '/api/me/progress' && method === 'GET') return { progress: {} }
    if (path.startsWith('/api/me/progress/')) return { progress: { [AADHAAR_NAME]: 'completed' }, plan_changes: [] }
    if (path.startsWith('/api/me/plans?')) return { plans: DASHBOARD.plans }
    if (path === '/api/me/situation/interpret') return opts.interpretation ?? INTERPRETATION
    if (path === '/api/me/proposal') {
      const targets: string[] = body.target_service_ids ?? body.requested_service_ids
      const rec = opts.recommendation ?? 'extend'
      return {
        proposal: proposal({ target_service_ids: targets.length ? targets : [PASSPORT_NAME], ...opts.proposalOver }),
        account_context: {
          state: body.state ?? (opts.profileState === undefined ? 'Delhi' : opts.profileState),
          state_source: body.state ? (body.state_source ?? 'description') : opts.profileState === null ? 'none' : 'profile',
          profile_state: 'Delhi',
          city: null,
          vault: { passport_existing: 'valid' },
          documents_from_description: [],
          completed_service_ids: [],
          reported_completed_service_ids: body.reported_completed_service_ids,
          in_progress: {},
        },
        existing_plans: [{ plan_id: 'plan-1', title: 'Name after marriage', target_service_ids: [AADHAAR_NAME, PASSPORT_NAME], overlapping_service_ids: [PASSPORT_NAME], covers_all: rec === 'covered' }],
        recommendation: rec,
        recommended_plan_id: 'plan-1',
      } satisfies AccountProposal
    }
    if (path === '/api/me/plans/plan-1' && method === 'PATCH') return { ...DASHBOARD.plans[0], id: 'plan-1' }
    if (path === '/api/me/plans' && method === 'POST') return json(201, { id: 'plan-new' })
    if (path.startsWith('/api/me/activity')) return { events: DASHBOARD.recent_activity, next_before_id: null }
    return json(404, {})
  })
  return calls
}

async function describeSituation(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(await screen.findByLabelText('Describe your situation in your own words'), text)
  await user.click(screen.getByRole('button', { name: 'Understand my situation' }))
  return screen.findByTestId('journey-review')
}

describe('citizen dashboard', () => {
  it('shows what to do next from profile, plans, vault, progress and history', async () => {
    const calls = backend()
    renderApp('/', signedIn())
    const dash = await screen.findByTestId('citizen-dashboard')
    expect(within(dash).getByRole('heading', { name: 'Namaste, Asha' })).toBeInTheDocument()
    expect(within(dash).getByText('Planning for Dwarka, Delhi')).toBeInTheDocument()
    expect(within(dash).getByRole('link', { name: /Describe your situation/ })).toHaveAttribute('href', '/planner?create=situation')
    const next = within(dash).getByTestId('dash-next-action')
    await waitFor(() => expect(next).toHaveTextContent(`Start: ${svcName('marriage-registration-delhi')}`))
    expect(next).toHaveAttribute('href', '/planner?plan=plan-1')
    expect(within(dash).getByTestId('dash-blocker')).toHaveTextContent(`Needs: ${docName('rto_accepted_address_proof')}.`)
    expect(within(dash).getByTestId('dash-doc-expired')).toHaveTextContent('Expired on 10 Nov 2026')
    expect(within(dash).getByTestId('dash-doc-soon')).toHaveTextContent('Expires in 20 days (6 Dec 2026)')
    expect(within(dash).getByText('1 of 3 services completed')).toBeInTheDocument()
    expect(within(dash).getByText('Completed (reported by you)')).toBeInTheDocument()
    expect(within(dash).getByText(/expired \(10 Nov 2026\)/)).toBeInTheDocument()
    expect(calls.find((c) => c.path === '/api/me/dashboard')!.auth).toMatch(/^Bearer /)
  })

  it('works in Hindi', async () => {
    backend()
    await i18n.changeLanguage('hi')
    renderApp('/', signedIn())
    expect(await screen.findByRole('heading', { name: 'नमस्ते, Asha' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'अगला कदम' })).toBeInTheDocument()
    expect(screen.getByTestId('dash-doc-soon')).toHaveTextContent('20 दिनों में समाप्त')
  })

  it('signed out: the public home is unchanged and no account data is requested', async () => {
    const calls = backend()
    renderApp('/', fakeAuth().client)
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(screen.queryByTestId('citizen-dashboard')).not.toBeInTheDocument()
    expect(calls.some((c) => c.path.startsWith('/api/me/'))).toBe(false)
  })
})

describe('situation journey (signed in)', () => {
  it('reads the situation with account context and builds the proposal on the server', async () => {
    const calls = backend()
    const user = userEvent.setup()
    renderApp('/assistant', signedIn())
    const review = await describeSituation(user, 'Married in Delhi. I updated Aadhaar already; I need my passport changed.')
    // The account reader was used (with the token), never the public one.
    expect(calls.some((c) => c.path === '/api/me/situation/interpret' && c.auth)).toBe(true)
    expect(calls.some((c) => c.path === '/api/situation/interpret')).toBe(false)
    expect(within(review).getByTestId('journey-requested')).toHaveTextContent(svcName(PASSPORT_NAME))
    expect(within(review).getByTestId('journey-reported-done')).toHaveTextContent(svcName(AADHAAR_NAME))
    expect(within(review).getByText('from your vault')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Find services and build my plan' }))
    const p = await screen.findByTestId('journey-proposal')
    const req = calls.find((c) => c.path === '/api/me/proposal')!.body as Record<string, unknown>
    expect(req).toMatchObject({
      requested_service_ids: [PASSPORT_NAME],
      reported_completed_service_ids: [AADHAAR_NAME],
      held_document_ids: [], // the vault's passport is added on the server, not sent
      state: null, // the profile's state is resolved (and labelled) on the server
    })
    expect(within(p).getByTestId('journey-account')).toHaveTextContent(`Documents from your vault: ${docName('passport_existing')}`)
    expect(within(p).getByTestId('journey-grounding')).toHaveTextContent('Every requirement (9) and every link between steps (2) cites an official source')
    expect(within(p).getByTestId('journey-requested-notes')).toHaveTextContent('verified for another state only')
    expect(within(p).getByTestId('journey-overlap')).toHaveTextContent('you can add to it')
    // Nothing saved by generating or reviewing.
    expect(calls.some((c) => c.method !== 'GET' && /\/api\/me\/(plans|documents|progress)/.test(c.path))).toBe(false)

    // A suggested service is added with one click and the proposal regenerates.
    await user.click(within(within(p).getByTestId('journey-suggested')).getByRole('button', { name: svcName(PAN) }))
    await waitFor(() => expect(calls.filter((c) => c.path === '/api/me/proposal').at(-1)!.body).toMatchObject({ target_service_ids: [PASSPORT_NAME, PAN] }))
  })

  it('a correction is interpreted with the facts so far and changes the proposal', async () => {
    const calls = backend()
    const user = userEvent.setup()
    renderApp('/assistant', signedIn())
    const review = await describeSituation(user, 'Married in Delhi, need passport changed.')
    const corrected = { ...INTERPRETATION, requested_service_ids: [AADHAAR_NAME], completed_service_ids: [], state: 'Maharashtra' }
    calls.length = 0
    backend({ interpretation: corrected })
    await user.type(within(review).getByLabelText('Add or correct details'), 'Actually I need Aadhaar, and I live in Mumbai now.')
    await user.click(within(review).getByRole('button', { name: 'Update my situation' }))
    await waitFor(() => expect(within(screen.getByTestId('journey-review')).getByTestId('journey-requested')).toHaveTextContent(svcName(AADHAAR_NAME)))
    expect(screen.queryByTestId('journey-reported-done')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Find services and build my plan' }))
    await screen.findByTestId('journey-proposal')
  })

  it('replacing an existing plan asks for confirmation and records reported completions', async () => {
    const calls = backend()
    const user = userEvent.setup()
    renderApp('/assistant', signedIn())
    await describeSituation(user, 'Married in Delhi. I updated Aadhaar already; I need my passport changed.')
    await user.click(screen.getByRole('button', { name: 'Find services and build my plan' }))
    await screen.findByTestId('journey-proposal')
    await user.click(await screen.findByRole('button', { name: 'Replace that plan’s services…' }))
    const confirm = screen.getByRole('group', { name: /Replace the services in “Name after marriage”/ })
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false) // not yet
    await user.click(within(confirm).getByRole('button', { name: 'Yes, replace them' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true))
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({ path: `/api/me/progress/${AADHAAR_NAME}`, body: { state: 'completed' } })
    expect(calls.find((c) => c.method === 'PATCH')!.body).toMatchObject({ target_service_ids: [PASSPORT_NAME] })
  })

  it('“Save as a new plan” creates one; reported completions can be left unrecorded', async () => {
    const calls = backend({ recommendation: 'new' })
    const user = userEvent.setup()
    renderApp('/assistant', signedIn())
    await describeSituation(user, 'Married in Delhi. I updated Aadhaar already; I need my passport changed.')
    await user.click(screen.getByRole('button', { name: 'Find services and build my plan' }))
    await screen.findByTestId('journey-proposal')
    await user.click(screen.getByRole('checkbox', { name: /Also record as completed/ }))
    await user.click(screen.getByRole('button', { name: 'Save as a new plan' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/me/plans')).toBe(true))
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
    expect(localStorage.getItem('govpath.planner.v1')).toBeNull()
  })
})

describe('situation journey (guest)', () => {
  it('named services from the AI reading are sent to the public proposal', async () => {
    const calls = backend()
    const user = userEvent.setup()
    renderApp('/assistant')
    await describeSituation(user, 'I need my passport changed after marriage in Delhi.')
    await user.click(screen.getByRole('button', { name: 'Find services and build my plan' }))
    await screen.findByTestId('journey-proposal')
    const body = calls.find((c) => c.path === '/api/workflows/propose')!.body as { requested_service_ids: string[]; context: { completed_service_ids: string[] } }
    expect(body.requested_service_ids).toEqual([PASSPORT_NAME])
    expect(body.context.completed_service_ids).toEqual([AADHAAR_NAME])
    expect(calls.some((c) => c.path.startsWith('/api/me/'))).toBe(false)
  })
})

describe('location provenance and coverage-aware passport question (Scenario B findings)', () => {
  const PASSPORT_ADDR = 'passport-reissue-change-of-address'
  // What the server returns for "I need to renew my passport." (no goal, no service understood).
  const RENEW: SituationInterpretation = {
    ...INTERPRETATION,
    goals: [],
    life_events: [],
    completed_service_ids: [],
    requested_service_ids: [],
    state: null,
    unknowns: ['goal'],
    account_document_ids: [],
    topic: 'passport',
    topic_service_ids: [PASSPORT_ADDR, PASSPORT_NAME],
  }
  const lastProposal = (calls: ReturnType<typeof backend>) => calls.filter((c) => c.path === '/api/me/proposal').at(-1)!.body as Record<string, unknown>
  const saves = (calls: ReturnType<typeof backend>) => calls.filter((c) => c.method !== 'GET' && /\/api\/me\/(plans|documents|progress)/.test(c.path))

  it('profile Delhi, no location in the text: shown and sent as the profile’s, not the description’s', async () => {
    const calls = backend({ interpretation: RENEW })
    const user = userEvent.setup()
    renderApp('/assistant', signedIn())
    const review = await describeSituation(user, 'I need to renew my passport.')
    expect(within(review).getByTestId('journey-state-source')).toHaveTextContent('From your saved profile.')
    await user.click(within(review).getByRole('checkbox', { name: svcName(PASSPORT_NAME) }))
    await user.click(screen.getByRole('button', { name: 'Find services and build my plan' }))
    const p = await screen.findByTestId('journey-proposal')
    expect(lastProposal(calls)).toMatchObject({ state: null })
    expect(lastProposal(calls)).not.toHaveProperty('state_source')
    expect(within(p).getByTestId('journey-account')).toHaveTextContent('Services are checked for Delhi (from your profile).')
  })

  it('a state named in the text is the description’s; changing it by hand is the citizen’s choice', async () => {
    const calls = backend({ interpretation: { ...RENEW, state: 'Maharashtra' } })
    const user = userEvent.setup()
    renderApp('/assistant', signedIn())
    const review = await describeSituation(user, 'I need to renew my passport in Maharashtra.')
    expect(within(review).getByTestId('journey-state-source')).toHaveTextContent('From your description.')
    await user.click(within(review).getByRole('checkbox', { name: svcName(PASSPORT_ADDR) }))
    await user.click(screen.getByRole('button', { name: 'Find services and build my plan' }))
    let p = await screen.findByTestId('journey-proposal')
    expect(lastProposal(calls)).toMatchObject({ state: 'Maharashtra' })
    expect(within(p).getByTestId('journey-account')).toHaveTextContent('Services are checked for Maharashtra (from your description). Your profile says Delhi.')
    // Back to the details: choose another state by hand.
    await user.click(within(p).getAllByRole('button', { name: 'Edit details' })[0])
    const again = await screen.findByTestId('journey-review')
    await user.selectOptions(within(again).getByDisplayValue('Maharashtra'), 'Karnataka')
    expect(within(again).getByTestId('journey-state-source')).toHaveTextContent('Chosen by you.')
    await user.click(screen.getByRole('button', { name: 'Find services and build my plan' }))
    p = await screen.findByTestId('journey-proposal')
    await waitFor(() => expect(lastProposal(calls)).toMatchObject({ state: 'Karnataka', state_source: 'manual' }))
    expect(within(p).getByTestId('journey-account')).toHaveTextContent('Services are checked for Karnataka (chosen by you).')
  })

  it('no profile state and none in the text: the state stays unknown (nothing invented)', async () => {
    const calls = backend({ interpretation: { ...RENEW, account_state: null, unknowns: ['goal', 'state'] }, profileState: null })
    const user = userEvent.setup()
    renderApp('/assistant', signedIn())
    const review = await describeSituation(user, 'I need to renew my passport.')
    expect(within(review).queryByTestId('journey-state-source')).not.toBeInTheDocument()
    expect(within(review).getByText(/Choose your state so we can check/)).toBeInTheDocument()
    await user.click(within(review).getByRole('checkbox', { name: svcName(PASSPORT_NAME) }))
    await user.click(screen.getByRole('button', { name: 'Find services and build my plan' }))
    await screen.findByTestId('journey-proposal')
    expect(lastProposal(calls)).toMatchObject({ state: null })
  })

  it('passport renewal with no reason: asks which curated case applies, selecting nothing for the citizen', async () => {
    const calls = backend({ interpretation: RENEW })
    const user = userEvent.setup()
    renderApp('/assistant', signedIn())
    const review = await describeSituation(user, 'I need to renew my passport.')
    const q = within(review).getByTestId('journey-topic')
    expect(q).toHaveTextContent('You mentioned a passport. Which case is yours?')
    expect(q).toHaveTextContent('GovPath covers a passport only in these verified cases.')
    const options = within(q).getAllByRole('checkbox').map((c) => c.closest('label')!.textContent)
    expect(options).toEqual([svcName(PASSPORT_ADDR), svcName(PASSPORT_NAME), 'Something else (another reason)'])
    expect(within(q).getAllByRole('checkbox').every((c) => !(c as HTMLInputElement).checked)).toBe(true)
    expect(within(review).queryByTestId('journey-requested')).not.toBeInTheDocument()
    // Name change after marriage -> the curated service goes to the existing pipeline.
    await user.click(within(q).getByRole('checkbox', { name: svcName(PASSPORT_NAME) }))
    expect(within(review).getByTestId('journey-requested')).toHaveTextContent(svcName(PASSPORT_NAME))
    await user.click(screen.getByRole('button', { name: 'Find services and build my plan' }))
    await screen.findByTestId('journey-proposal')
    expect(lastProposal(calls)).toMatchObject({ requested_service_ids: [PASSPORT_NAME], goals: [] })
    expect(saves(calls)).toEqual([])
  })

  it('another passport reason: explains the coverage limit, plans nothing and saves nothing', async () => {
    const calls = backend({
      interpretation: RENEW,
      proposalOver: { status: 'needs_clarification', target_service_ids: [], supporting: [], plan: null, requested: [], suggested_service_ids: [], grounding: null },
    })
    const user = userEvent.setup()
    renderApp('/assistant', signedIn())
    const review = await describeSituation(user, 'I need to renew my passport.')
    await user.click(within(review).getByRole('checkbox', { name: 'Something else (another reason)' }))
    expect(within(review).getByTestId('journey-topic')).toHaveTextContent('GovPath does not cover other passport cases yet')
    await user.click(screen.getByRole('button', { name: 'Find services and build my plan' }))
    const p = await screen.findByTestId('journey-proposal')
    expect(lastProposal(calls)).toMatchObject({ requested_service_ids: [], goals: [] })
    expect(String(lastProposal(calls).requested_service_ids)).not.toMatch(/renew/)
    expect(within(p).getByTestId('journey-topic-not-covered')).toHaveTextContent('GovPath does not cover other passport cases yet')
    expect(within(p).getByRole('button', { name: 'Save as a new plan' })).toBeDisabled()
    expect(saves(calls)).toEqual([])
  })

  it('the passport question and location source are in Hindi', async () => {
    backend({ interpretation: RENEW })
    await i18n.changeLanguage('hi')
    const user = userEvent.setup()
    renderApp('/assistant', signedIn())
    await user.type(await screen.findByLabelText('अपनी स्थिति अपने शब्दों में बताएँ'), 'मुझे पासपोर्ट नवीनीकरण करना है')
    await user.click(screen.getByRole('button', { name: 'मेरी स्थिति समझें' }))
    const review = await screen.findByTestId('journey-review')
    const q = within(review).getByTestId('journey-topic')
    expect(q).toHaveTextContent('आपने पासपोर्ट का ज़िक्र किया। आपका मामला कौन-सा है?')
    expect(q).toHaveTextContent('विवाह के बाद नाम परिवर्तन हेतु पासपोर्ट पुनः जारी करना')
    expect(q).toHaveTextContent('कुछ और (कोई दूसरा कारण)')
    expect(within(review).getByTestId('journey-state-source')).toHaveTextContent('आपकी सहेजी गई प्रोफ़ाइल से।')
  })
})
