// Signed-in account data: vault, saved plans, progress, import and history. The backend is a
// stateful fake of /api/me/* (the real planner output comes from fixtures captured from the API);
// Supabase Auth is a fake client. No network.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { ActivityEvent, PlanChange, PlanResponse, SavedPlan, VaultDocument } from '../types/api'
import { fakeAuth, sessionFor } from './authFakes'
import documents from './fixtures/documents.json'
import planRcBlocked from './fixtures/plan-rc-blocked.json'
import planRcReady from './fixtures/plan-rc-ready.json'
import proposeDelhi from './fixtures/propose-marriage-delhi.json'
import services from './fixtures/services.json'
import vocabulary from './fixtures/vocabulary.json'
import { json, mockFetch, renderApp } from './utils'

const RC = 'vehicle-rc-address-change'
const PROOF = 'rto_accepted_address_proof'
const PLAN_KEY = 'govpath.planner.v1'
const PROOF_NAME = documents.find((d) => d.id === PROOF)!.name

interface Call {
  url: string
  method: string
  auth: string | null
  body: unknown
}

/** Stateful fake of the account API. Plans for the RC service are "re-evaluated" from fixtures:
 * ready when the vault has a valid RTO address proof, blocked otherwise. */
function accountBackend(seed: { plans?: string[][]; docs?: Partial<VaultDocument>[] } = {}) {
  const calls: Call[] = []
  const docs: VaultDocument[] = []
  const plans: SavedPlan[] = []
  const progress: Record<string, string> = {}
  const events: ActivityEvent[] = []
  let n = 0
  const log = (event_type: ActivityEvent['event_type'], entity_type: ActivityEvent['entity_type'], entity_id: string, details = {}) =>
    events.unshift({ id: ++n, event_type, entity_type, entity_id, details, created_at: '2026-11-15T10:00:00Z' })
  const snapshot = (targets: string[]): PlanResponse =>
    (targets.includes(RC) && docs.some((d) => d.document_type === PROOF && d.effective_status === 'valid') ? planRcReady : planRcBlocked) as PlanResponse
  const statusOf = (p: SavedPlan) => Object.fromEntries((p.plan?.steps ?? []).map((s) => [s.service_id, s.status]))
  const recalc = (cause: Record<string, unknown>): PlanChange[] => {
    const changes: PlanChange[] = []
    for (const p of plans.filter((x) => x.status === 'active')) {
      const before = statusOf(p)
      p.plan = snapshot(p.target_service_ids)
      const after = statusOf(p)
      const steps = Object.keys({ ...before, ...after })
        .filter((s) => before[s] !== after[s])
        .map((s) => ({ service_id: s, before: before[s] ?? null, after: after[s] ?? null }))
      if (steps.length) {
        changes.push({ plan_id: p.id, title: p.title, steps, blockers_added: [], blockers_removed: [], next_action_changed: true })
        log('plan_recalculated', 'plan', p.id, { cause, steps })
      }
    }
    return changes
  }
  const makePlan = (targets: string[], title: string | null = null): SavedPlan => {
    const p: SavedPlan = {
      id: `plan-${plans.length + 1}`,
      title,
      status: 'active',
      target_service_ids: targets,
      service_names: {},
      total_services: 1,
      completed: 0,
      blocked: 0,
      ready: 0,
      next_action: null,
      evaluation_error: null,
      created_at: '2026-11-15T09:00:00Z',
      updated_at: '2026-11-15T09:00:00Z',
      archived_at: null,
      goals: [],
      citizen_state: 'Delhi',
      evaluated_at: '2026-11-15T09:00:00Z',
      plan: snapshot(targets),
      document_refs: [],
      created_document_ids: [],
      plan_changes: [],
    }
    plans.unshift(p)
    return p
  }
  const addDoc = (d: Partial<VaultDocument>): VaultDocument => {
    const doc: VaultDocument = {
      id: `doc-${docs.length + 1}`,
      document_type: d.document_type!,
      name: documents.find((x) => x.id === d.document_type)?.name ?? null,
      name_hi: null,
      status: d.status ?? 'valid',
      effective_status: d.status ?? 'valid',
      expiry_passed: false,
      label: d.label ?? null,
      issue_date: null,
      expiry_date: d.expiry_date ?? null,
      note: d.note ?? null,
      used_by_plan_ids: [],
      created_at: '',
      updated_at: '',
    }
    docs.push(doc)
    return doc
  }
  for (const d of seed.docs ?? []) addDoc(d)
  for (const t of seed.plans ?? []) makePlan(t)

  mockFetch((url, init) => {
    const method = init?.method ?? 'GET'
    const auth = new Headers(init?.headers).get('Authorization')
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ url, method, auth, body })
    const path = url.replace(/^https?:\/\/[^/]+/, '')
    if (path === '/api/services') return services
    if (path === '/api/documents') return documents
    if (path === '/api/workflows/vocabulary') return vocabulary
    if (path === '/api/workflows/propose') return proposeDelhi
    if (path === '/api/workflows/plan') return planRcBlocked
    if (!path.startsWith('/api/me/')) return json(404, {})
    if (!auth) return json(401, { detail: { code: 'missing_token' } })
    if (path === '/api/me/profile') return { user_id: 'user-a', email: 'a@example.com', full_name: null, state: 'Delhi', city: null, preferred_language: 'en', created_at: '', updated_at: '' }
    if (path === '/api/me/proposal') {
      return {
        proposal: proposeDelhi,
        account_context: {
          state: body.state ?? 'Delhi',
          state_source: body.state ? 'description' : 'profile',
          profile_state: 'Delhi',
          city: null,
          vault: Object.fromEntries(docs.map((d) => [d.document_type, d.effective_status])),
          documents_from_description: body.held_document_ids,
          completed_service_ids: Object.keys(progress).filter((s) => progress[s] === 'completed'),
          reported_completed_service_ids: body.reported_completed_service_ids,
          in_progress: {},
        },
        existing_plans: [],
        recommendation: 'new',
        recommended_plan_id: null,
      }
    }
    if (path === '/api/me/documents' && method === 'GET') return { documents: docs }
    if (path === '/api/me/documents' && method === 'POST') {
      if (/\d{4}\s?\d{4}\s?\d{4}/.test(`${body.note ?? ''}${body.label ?? ''}`)) {
        return json(422, { detail: [{ msg: 'Value error, Do not enter identity numbers (Aadhaar, PAN, ...)' }] })
      }
      if (docs.some((d) => d.document_type === body.document_type && (d.label ?? '') === (body.label ?? ''))) {
        return json(409, { detail: { code: 'duplicate_document' } })
      }
      const doc = addDoc(body)
      log('document_added', 'document', doc.id, { document_type: doc.document_type, status: doc.status })
      return { document: doc, plan_changes: recalc({ type: 'document_added', document_type: doc.document_type }) }
    }
    const docMatch = path.match(/^\/api\/me\/documents\/(.+)$/)
    if (docMatch) {
      const doc = docs.find((d) => d.id === docMatch[1])
      if (!doc) return json(404, { detail: { code: 'not_found' } })
      if (method === 'DELETE') {
        docs.splice(docs.indexOf(doc), 1)
        log('document_removed', 'document', doc.id, { document_type: doc.document_type })
        return { document: null, plan_changes: recalc({ type: 'document_removed', document_type: doc.document_type }) }
      }
      Object.assign(doc, body, body.status ? { effective_status: body.status } : {})
      log('document_updated', 'document', doc.id, { document_type: doc.document_type, changes: { status: ['valid', doc.status] } })
      return { document: doc, plan_changes: recalc({ type: 'document_updated', document_type: doc.document_type }) }
    }
    if (path === '/api/me/progress') return { progress }
    const prog = path.match(/^\/api\/me\/progress\/(.+)$/)
    if (prog) {
      const sid = decodeURIComponent(prog[1])
      if (body.state === 'not_started') delete progress[sid]
      else progress[sid] = body.state
      log('progress_changed', 'service', sid, { service_id: sid, from: 'not_started', to: body.state })
      return { progress, plan_changes: [] }
    }
    const list = path.match(/^\/api\/me\/plans\?status=(\w+)$/)
    if (list) return { plans: plans.filter((p) => list[1] === 'all' || p.status === list[1]) }
    if (path === '/api/me/plans' && method === 'POST') {
      const p = makePlan(body.target_service_ids, body.title ?? null)
      for (const h of body.held_documents ?? []) if (!docs.some((d) => d.document_type === h.document_type)) addDoc(h)
      for (const [s, st] of Object.entries(body.progress ?? {})) if (!(s in progress)) progress[s] = st as string
      log('plan_created', 'plan', p.id, { source: body.source, target_service_ids: body.target_service_ids })
      return json(201, p)
    }
    const planMatch = path.match(/^\/api\/me\/plans\/([^/]+)(?:\/(\w+))?$/)
    if (planMatch) {
      const p = plans.find((x) => x.id === planMatch[1])
      if (!p) return json(404, { detail: { code: 'not_found' } })
      const action = planMatch[2]
      if (method === 'GET') return p
      if (action === 'archive' || action === 'restore') {
        p.status = action === 'archive' ? 'archived' : 'active'
        log(action === 'archive' ? 'plan_archived' : 'plan_restored', 'plan', p.id, { title: p.title })
        return p
      }
      if (method === 'PATCH') {
        Object.assign(p, body.target_service_ids ? { target_service_ids: body.target_service_ids } : {})
        return p
      }
    }
    if (path.startsWith('/api/me/activity')) return { events, next_before_id: null }
    return json(404, {})
  })
  return { calls, docs, plans, progress, events }
}

const signedIn = () => fakeAuth({ stored: sessionFor('user-a') }).client
const LOCAL_PLAN = JSON.stringify({
  version: 2,
  targets: [RC],
  owned: ['rc_existing', PROOF],
  completed: [],
  progress: { [RC]: 'started' },
  docStates: { [PROOF]: 'unsure' },
  goals: [],
  state: 'Delhi',
  lacking: [],
  generated: true,
})

describe('document vault', () => {
  it('adds, edits and removes documents; statuses are the citizen’s own, never “verified”', async () => {
    const api = accountBackend()
    const user = userEvent.setup()
    renderApp('/vault', signedIn())
    expect(await screen.findByText('Your vault is empty')).toBeInTheDocument()
    expect(screen.getByText('Saved to your account')).toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: /Add a document/ })[0])
    const form = screen.getByRole('form', { name: 'Add a document' })
    await user.selectOptions(within(form).getByRole('combobox', { name: 'Document' }), 'rc_existing')
    await user.type(within(form).getByRole('textbox', { name: 'Label (optional)' }), 'Scooter')
    await user.click(within(form).getByRole('button', { name: 'Save' }))
    const card = await screen.findByTestId('vault-doc-rc_existing')
    expect(within(card).getByText('You said: valid')).toBeInTheDocument()
    expect(within(card).getByText('Scooter')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Document vault' }).textContent).not.toMatch(/verified/i)
    expect(api.calls.find((c) => c.method === 'POST')!.body).toMatchObject({ document_type: 'rc_existing', status: 'valid', label: 'Scooter', note: null })

    await user.click(within(card).getByRole('button', { name: /Edit/ }))
    await user.selectOptions(within(card).getByRole('combobox', { name: 'Status (your assessment)' }), 'expired')
    await user.click(within(card).getByRole('button', { name: 'Save' }))
    expect(await within(card).findByText('Expired')).toBeInTheDocument()

    await user.click(within(card).getByRole('button', { name: /Remove/ }))
    await user.click(within(card).getByRole('button', { name: 'Yes, remove' }))
    expect(await screen.findByText('Your vault is empty')).toBeInTheDocument()
    expect(api.calls.some((c) => c.method === 'DELETE')).toBe(true)
  })

  it('explains duplicates and refuses identity numbers', async () => {
    accountBackend({ docs: [{ document_type: 'rc_existing' }] })
    const user = userEvent.setup()
    renderApp('/vault', signedIn())
    await screen.findByTestId('vault-doc-rc_existing')
    await user.click(screen.getByRole('button', { name: /Add a document/ }))
    const form = screen.getByRole('form', { name: 'Add a document' })
    await user.selectOptions(within(form).getByRole('combobox', { name: 'Document' }), 'rc_existing')
    await user.click(within(form).getByRole('button', { name: 'Save' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent('You already saved this document.')
    await user.type(within(form).getByRole('textbox', { name: 'Label (optional)' }), '1234 5678 9012')
    await user.click(within(form).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(within(form).getByRole('alert')).toHaveTextContent('Please do not enter identity numbers'))
  })

  it('a document change shows which saved plans were recalculated', async () => {
    accountBackend({ plans: [[RC]] })
    const user = userEvent.setup()
    renderApp('/vault', signedIn())
    await screen.findByText('Your vault is empty')
    await user.click(screen.getAllByRole('button', { name: /Add a document/ })[0])
    const form = screen.getByRole('form', { name: 'Add a document' })
    await user.selectOptions(within(form).getByRole('combobox', { name: 'Document' }), PROOF)
    await user.click(within(form).getByRole('button', { name: 'Save' }))
    const notice = await screen.findByTestId('plan-changes')
    expect(notice).toHaveTextContent('1 saved plan was recalculated')
    expect(notice).toHaveTextContent('Blocked → Ready to start')
  })
})

describe('saved plans in the planner', () => {
  it('signed in: shows the saved plan; progress and “I have it” go to the account, not the browser', async () => {
    const api = accountBackend({ plans: [[RC]] })
    const user = userEvent.setup()
    renderApp('/planner', signedIn())
    expect(await screen.findByRole('heading', { name: 'My Plans', level: 1 })).toBeInTheDocument()
    expect(await screen.findByText('Saved to your account')).toBeInTheDocument()
    // The blocked RC plan's next action asks for the missing proof: ticking it adds it to the vault.
    await user.click(await screen.findByRole('checkbox', { name: PROOF_NAME }))
    await waitFor(() => expect(api.calls.some((c) => c.method === 'POST' && c.url.endsWith('/api/me/documents'))).toBe(true))
    expect(api.calls.find((c) => c.method === 'POST' && c.url.endsWith('/api/me/documents'))!.body).toEqual({ document_type: PROOF, status: 'valid' })
    expect(await screen.findByTestId('plan-changes')).toHaveTextContent('Blocked → Ready to start')
    // Ready now: marking it done reports progress to the account.
    await user.click((await screen.findAllByRole('button', { name: /Mark as done/ }))[0])
    await waitFor(() => expect(api.progress[RC]).toBe('completed'))
    expect(localStorage.getItem(PLAN_KEY)).toBeNull()
  })

  it('archives a plan and lists it under archived plans', async () => {
    const api = accountBackend({ plans: [[RC]] })
    const user = userEvent.setup()
    renderApp('/planner', signedIn())
    await user.click(await screen.findByRole('button', { name: 'Archive plan' }))
    expect(await screen.findByText('You have no active plans. Restore an archived plan or create a new one.')).toBeInTheDocument()
    expect(screen.getByText('1 archived plan')).toBeInTheDocument()
    expect(screen.getByTestId('create-plan')).toBeInTheDocument() // creating stays possible
    expect(api.plans[0].status).toBe('archived')
  })

  it('signed out: My Plans asks to sign in (no device planner, no account calls)', async () => {
    localStorage.setItem(PLAN_KEY, LOCAL_PLAN)
    const api = accountBackend()
    renderApp('/planner', fakeAuth().client)
    expect(await screen.findByTestId('plans-sign-in')).toHaveTextContent('Sign in to save and manage your plans')
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(api.calls.some((c) => c.url.includes('/api/me/') || c.url.endsWith('/api/workflows/plan'))).toBe(false)
    expect(localStorage.getItem(PLAN_KEY)).toBe(LOCAL_PLAN) // old device data left untouched
  })

  it('local guest data survives signing in and out', async () => {
    localStorage.setItem(PLAN_KEY, LOCAL_PLAN)
    accountBackend({ plans: [[RC]] })
    const { client } = fakeAuth()
    const user = userEvent.setup()
    renderApp('/login', client)
    await user.type(await screen.findByLabelText('Email'), 'asha@example.com')
    await user.type(screen.getByLabelText('Password'), 'correct-horse')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByRole('heading', { name: 'Your profile' })
    await user.click((await screen.findAllByRole('link', { name: 'My Plans' }))[0])
    expect(await screen.findByRole('heading', { name: 'My Plans', level: 1 })).toBeInTheDocument()
    expect(localStorage.getItem(PLAN_KEY)).toBe(LOCAL_PLAN)
    await user.click(screen.getByRole('link', { name: 'Account' }))
    await user.click(await screen.findByRole('button', { name: 'Sign out' }))
    await screen.findByRole('link', { name: 'Sign in' })
    expect(localStorage.getItem(PLAN_KEY)).toBe(LOCAL_PLAN)
  })
})

describe('situation journey when signed in', () => {
  it('accepting saves a new account plan with the reviewed documents; the browser plan is untouched', async () => {
    const api = accountBackend({ docs: [{ document_type: 'aadhaar_number', status: 'unsure' }] })
    const user = userEvent.setup()
    renderApp('/assistant', signedIn())
    await user.click(await screen.findByRole('button', { name: 'Fill in the details myself' }))
    const review = await screen.findByTestId('journey-review')
    // Prefilled from the vault (Aadhaar held, marked "not sure") and the profile's state.
    expect(within(review).getAllByText(/Aadhaar/).length).toBeGreaterThan(0)
    await user.click(within(review).getByRole('checkbox', { name: 'Change my name after marriage' }))
    await user.click(screen.getByRole('button', { name: 'Find services and build my plan' }))
    // A situation's reviewed workflow is saved as ONE plan (no combined/separate choice here).
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Save as a new plan' }))
    await waitFor(() => expect(api.plans).toHaveLength(1))
    const post = api.calls.find((c) => c.method === 'POST' && c.url.endsWith('/api/me/plans'))!
    expect(post.body).toMatchObject({ source: 'proposal', state: 'Delhi', goals: ['update-name-after-marriage'] })
    expect((post.body as { held_documents: unknown[] }).held_documents).toContainEqual({ document_type: 'aadhaar_number', status: 'unsure' })
    expect(localStorage.getItem(PLAN_KEY)).toBeNull()
    expect(await screen.findByRole('heading', { name: 'My Plans', level: 1 })).toBeInTheDocument()
  })
})

describe('create from selected services', () => {
  const PAN = 'instant-e-pan'
  const DL = 'driving-licence-address-change'
  const svc = (id: string) => services.find((x) => x.id === id)!.name
  const posts = (api: ReturnType<typeof accountBackend>) =>
    api.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/api/me/plans')).map((c) => c.body as { target_service_ids: string[]; client_request_id: string })

  it('one service: saved directly, no combined/separate choice', async () => {
    const api = accountBackend()
    const user = userEvent.setup()
    renderApp('/planner?create=services', signedIn())
    await user.click((await screen.findAllByRole('checkbox', { name: svc(PAN) }))[0])
    expect(screen.queryByTestId('services-grouping')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save plan' }))
    await waitFor(() => expect(posts(api)).toHaveLength(1))
    expect(posts(api)[0].target_service_ids).toEqual([PAN])
  })

  it('several services: the choice is required; "separate" saves one plan per service (double-click safe)', async () => {
    const api = accountBackend()
    const user = userEvent.setup()
    renderApp('/planner?create=services', signedIn())
    await user.click((await screen.findAllByRole('checkbox', { name: svc(PAN) }))[0])
    await user.click(screen.getAllByRole('checkbox', { name: svc(DL) })[0])
    expect(screen.getByRole('button', { name: 'Save plan' })).toBeDisabled()
    await user.click(screen.getByRole('radio', { name: /Create 2 separate plans/ }))
    await user.dblClick(screen.getByRole('button', { name: 'Save 2 separate plans' }))
    await waitFor(() => expect(api.plans).toHaveLength(2))
    expect(posts(api)).toHaveLength(2) // not 4
    expect(posts(api).map((b) => b.target_service_ids)).toEqual([[PAN], [DL]])
    expect(new Set(posts(api).map((b) => b.client_request_id)).size).toBe(2)
    expect(await screen.findByText('2 separate plans saved to My Plans.')).toBeInTheDocument()
  })

  it('"combine" saves exactly one plan with every selected service', async () => {
    const api = accountBackend()
    const user = userEvent.setup()
    renderApp('/planner?create=services', signedIn())
    await user.click((await screen.findAllByRole('checkbox', { name: svc(PAN) }))[0])
    await user.click(screen.getAllByRole('checkbox', { name: svc(DL) })[0])
    await user.click(screen.getByRole('radio', { name: /Combine into one plan/ }))
    await user.click(screen.getByRole('button', { name: 'Save plan' }))
    await waitFor(() => expect(posts(api)).toHaveLength(1))
    expect(posts(api)[0].target_service_ids).toEqual([PAN, DL])
  })

  it('guests keep their selection and choice for after sign-in', async () => {
    accountBackend()
    const user = userEvent.setup()
    renderApp('/planner?create=services', fakeAuth().client)
    await user.click((await screen.findAllByRole('checkbox', { name: svc(PAN) }))[0])
    await user.click(screen.getAllByRole('checkbox', { name: svc(DL) })[0])
    await user.click(screen.getByRole('radio', { name: /Create 2 separate plans/ }))
    await user.click(screen.getByRole('button', { name: 'Sign in to save this plan' }))
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(JSON.parse(sessionStorage.getItem('govpath.pendingSelection')!)).toMatchObject({ selected: [PAN, DL], grouping: 'separate' })
  })
})

describe('activity history', () => {
  it('lists events read-only (no edit or delete controls)', async () => {
    accountBackend({ plans: [[RC]] })
    const user = userEvent.setup()
    renderApp('/vault', signedIn())
    await user.click(await screen.findByRole('button', { name: /Add a document/ }))
    const form = screen.getByRole('form', { name: 'Add a document' })
    await user.selectOptions(within(form).getByRole('combobox', { name: 'Document' }), PROOF)
    await user.click(within(form).getByRole('button', { name: 'Save' }))
    await screen.findByTestId('plan-changes')
    await user.click(screen.getByRole('link', { name: /Activity history/ }))
    const items = await screen.findAllByTestId('activity-event')
    expect(items.map((i) => i.dataset.type)).toEqual(['plan_recalculated', 'document_added'])
    expect(items[0]).toHaveTextContent('A saved plan was recalculated because')
    const list = screen.getByRole('list', { name: 'Activity history' })
    expect(within(list).queryAllByRole('button')).toHaveLength(0)
  })

  it('account pages require sign-in', async () => {
    accountBackend()
    renderApp('/vault', fakeAuth().client)
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })
})
