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

function backend(opts: { recommendation?: AccountProposal['recommendation']; interpretation?: SituationInterpretation } = {}) {
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
    if (path === '/api/me/profile') return { user_id: 'user-a', email: 'a@x', full_name: 'Asha', state: 'Delhi', city: null, preferred_language: 'en', created_at: '', updated_at: '' }
    if (path === '/api/me/documents') return { documents: [doc('passport_existing', '2030-01-01', 'valid')] }
    if (path === '/api/me/progress' && method === 'GET') return { progress: {} }
    if (path.startsWith('/api/me/progress/')) return { progress: { [AADHAAR_NAME]: 'completed' }, plan_changes: [] }
    if (path.startsWith('/api/me/plans?')) return { plans: DASHBOARD.plans }
    if (path === '/api/me/situation/interpret') return opts.interpretation ?? INTERPRETATION
    if (path === '/api/me/proposal') {
      const targets: string[] = body.target_service_ids ?? body.requested_service_ids
      const rec = opts.recommendation ?? 'extend'
      return {
        proposal: proposal({ target_service_ids: targets.length ? targets : [PASSPORT_NAME] }),
        account_context: {
          state: body.state ?? 'Delhi',
          state_source: body.state ? 'description' : 'profile',
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
    expect(within(dash).getByRole('link', { name: /Describe your situation/ })).toHaveAttribute('href', '/assistant')
    const next = within(dash).getByTestId('dash-next-action')
    await waitFor(() => expect(next).toHaveTextContent(`Start: ${svcName('marriage-registration-delhi')}`))
    expect(next).toHaveAttribute('href', '/planner?plan=plan-1')
    expect(within(dash).getByTestId('dash-blocker')).toHaveTextContent(`Needs one of: ${docName('rto_accepted_address_proof')}`)
    expect(within(dash).getByTestId('dash-doc-expired')).toHaveTextContent('Expired on 2026-11-10')
    expect(within(dash).getByTestId('dash-doc-soon')).toHaveTextContent('Expires in 20 days (2026-12-06)')
    expect(within(dash).getByText('1 of 3 services completed')).toBeInTheDocument()
    expect(within(dash).getByText('Completed (reported by you)')).toBeInTheDocument()
    expect(within(dash).getByText(/expired \(2026-11-10\)/)).toBeInTheDocument()
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
      state: 'Delhi',
    })
    expect(within(p).getByTestId('journey-account')).toHaveTextContent(`Documents from your vault: ${docName('passport_existing')}`)
    expect(within(p).getByTestId('journey-grounding')).toHaveTextContent('Every requirement (9) and dependency (2) cites an official source')
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
