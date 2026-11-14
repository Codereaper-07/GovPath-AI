// Planner persistence and consistency regressions (audit 2026-11-14).
import { act, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { diff, reconcile } from '../features/planner/selectionSync'
import { type PlannerSelection, SCHEMA_VERSION, usePlannerState } from '../features/planner/usePlannerState'
import discoverNoState from './fixtures/discover-marriage-nostate.json'
import documents from './fixtures/documents.json'
import planParallel from './fixtures/plan-parallel.json'
import services from './fixtures/services.json'
import vocabulary from './fixtures/vocabulary.json'
import { json, mockFetch, renderApp } from './utils'

const KEY = 'govpath.planner.v1'
const saved = () => JSON.parse(localStorage.getItem(KEY) ?? '{}')
const save = (v: object) => localStorage.setItem(KEY, JSON.stringify(v))
type Body = Record<string, unknown>

function backend(o: { services?: () => unknown; vocabulary?: () => unknown; plan?: () => unknown; assistant?: unknown } = {}) {
  return mockFetch((url) => {
    if (url.endsWith('/api/services')) return (o.services ?? (() => services))()
    if (url.endsWith('/api/documents')) return documents
    if (url.endsWith('/api/workflows/vocabulary')) return (o.vocabulary ?? (() => vocabulary))()
    if (url.endsWith('/api/workflows/plan')) return (o.plan ?? (() => planParallel))()
    if (url.endsWith('/api/workflows/discover')) return discoverNoState
    if (url.endsWith('/api/assistant/query')) return o.assistant ?? json(503, { detail: { code: 'assistant_not_configured' } })
    return json(404, {})
  })
}
const bodies = (calls: { url: string; body: unknown }[], path: string) => calls.filter((c) => c.url.endsWith(path)).map((c) => c.body as Body)

const PARALLEL = {
  targets: ['aadhaar-address-update', 'driving-licence-address-change', 'passport-reissue-change-of-address'],
  owned: ['aadhaar_number', 'driving_licence_existing', 'electricity_bill', 'passport_existing'],
  completed: [],
  generated: true,
}
const PASSPORT = 'passport-reissue-change-of-address'

describe('cross-tab safety', () => {
  it('a stale tab applies its change on top of the newer saved data', () => {
    save({ ...PARALLEL, targets: ['aadhaar-address-update'] })
    const { result } = renderHook(() => usePlannerState()) // tab A, now stale
    save({ ...saved(), targets: ['aadhaar-address-update', 'instant-e-pan'], progress: { 'aadhaar-address-update': 'submitted' } }) // tab B
    act(() => result.current.setOwned('pan_card', true))
    expect(saved().targets).toEqual(['aadhaar-address-update', 'instant-e-pan'])
    expect(saved().progress).toEqual({ 'aadhaar-address-update': 'submitted' })
    expect(saved().owned).toContain('pan_card')
    expect(result.current.selection.targets).toEqual(['aadhaar-address-update', 'instant-e-pan'])
  })

  it('shows changes made in another tab', () => {
    save(PARALLEL)
    const { result } = renderHook(() => usePlannerState())
    const other = { ...PARALLEL, state: 'Delhi', version: SCHEMA_VERSION }
    save(other)
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: JSON.stringify(other) }))
    })
    expect(result.current.selection.state).toBe('Delhi')
  })
})

describe('near-simultaneous edits in two tabs (both read the same old value)', () => {
  const BASE: PlannerSelection = { targets: ['a'], owned: ['d1'], completed: [], generated: true, progress: {}, docStates: {}, goals: [], state: null, lacking: [] }
  const mine = (next: PlannerSelection, at: number) => ({ base: BASE, ops: diff(BASE, next), stamp: { at, writer: 'A' } })

  it('different items: both changes survive', () => {
    const a = { ...BASE, docStates: { d1: 'expired' as const } }
    const b = { ...BASE, progress: { a: 'submitted' as const }, targets: ['a', 'b'] }
    const merged = reconcile(b, { at: 2, writer: 'B' }, mine(a, 1))
    expect(merged).toMatchObject({ docStates: { d1: 'expired' }, progress: { a: 'submitted' }, targets: ['a', 'b'] })
  })

  it('same item: the later edit wins, whichever tab made it', () => {
    const a = { ...BASE, docStates: { d1: 'expired' as const } }
    const b = { ...BASE, docStates: { d1: 'invalid' as const } }
    expect(reconcile(b, { at: 2, writer: 'B' }, mine(a, 1)).docStates).toEqual({ d1: 'invalid' }) // B later
    expect(reconcile(b, { at: 1, writer: 'B' }, mine(a, 2)).docStates).toEqual({ d1: 'expired' }) // A later
  })

  it('returns the incoming value unchanged when this tab\'s change is already in it', () => {
    const a = { ...BASE, owned: ['d1', 'd2'] }
    const incoming = { ...a, state: 'Delhi' }
    expect(reconcile(incoming, { at: 2, writer: 'B' }, mine(a, 1))).toBe(incoming)
  })

  it('a racing write from another tab does not drop this tab\'s change (hook + storage event)', () => {
    save(PARALLEL)
    const old = saved() // what tab B read, before tab A's change reached it
    const { result } = renderHook(() => usePlannerState()) // tab A
    act(() => result.current.setDocState('passport_existing', 'expired'))
    // Tab B's write, computed from the old value: it lacks A's change.
    const fromB = { ...old, progress: { 'aadhaar-address-update': 'submitted' }, version: SCHEMA_VERSION, updatedAt: Date.now() + 1, writer: 'tab-b' }
    localStorage.setItem(KEY, JSON.stringify(fromB))
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: JSON.stringify(fromB) }))
    })
    expect(saved()).toMatchObject({ docStates: { passport_existing: 'expired' }, progress: { 'aadhaar-address-update': 'submitted' } })
    expect(result.current.selection.docStates).toEqual({ passport_existing: 'expired' })
    expect(result.current.selection.progress).toEqual({ 'aadhaar-address-update': 'submitted' })
  })
})

describe('pruning never erases data on empty or failed responses', () => {
  const SAVED = { ...PARALLEL, completed: ['aadhaar-address-update'], goals: ['update-address'] }

  it('keeps the saved plan when /api/services returns an empty list', async () => {
    save(SAVED)
    const calls = backend({ services: () => [] })
    renderApp('/planner')
    await waitFor(() => expect(bodies(calls, '/api/workflows/vocabulary').length).toBeGreaterThan(0))
    await new Promise((r) => setTimeout(r, 30))
    expect(saved()).toMatchObject({ targets: SAVED.targets, completed: SAVED.completed, owned: SAVED.owned })
  })

  it('keeps the saved plan when /api/services fails', async () => {
    save(SAVED)
    backend({ services: () => json(503, {}) })
    renderApp('/planner')
    await screen.findByRole('alert')
    expect(saved()).toEqual(SAVED) // untouched: not even rewritten
  })

  it('keeps saved goals when the vocabulary is empty or fails', async () => {
    for (const vocab of [() => ({ goals: [], life_events: [], states: [] }), () => json(500, {})]) {
      localStorage.clear()
      save(SAVED)
      const calls = backend({ vocabulary: vocab })
      const { unmount } = renderApp('/planner')
      await screen.findByTestId('step-aadhaar-address-update')
      await waitFor(() => expect(bodies(calls, '/api/workflows/vocabulary').length).toBeGreaterThan(0))
      await new Promise((r) => setTimeout(r, 30))
      expect(saved().goals).toEqual(['update-address'])
      unmount()
    }
  })

  it('drops a saved goal the backend no longer offers, and keeps valid ones', async () => {
    save({ ...SAVED, goals: ['retired-goal', 'update-address'] })
    backend()
    renderApp('/planner')
    await screen.findByTestId('step-aadhaar-address-update')
    await waitFor(() => expect(saved().goals).toEqual(['update-address']))
    expect(saved().targets).toEqual(SAVED.targets)
  })
})

describe('document conditions', () => {
  it('"I do not have it" forgets the document\'s condition, so re-ticking it starts clean', () => {
    const { result } = renderHook(() => usePlannerState())
    act(() => result.current.setOwned('passport_existing', true))
    act(() => result.current.setDocState('passport_existing', 'expired'))
    act(() => result.current.setLacking('passport_existing', true))
    expect(result.current.selection.owned).not.toContain('passport_existing')
    expect(result.current.selection.docStates).toEqual({})
    act(() => result.current.setOwned('passport_existing', true))
    expect(saved().docStates).toEqual({})
  })
})

describe('reviewed situation facts', () => {
  it('"you do not have" from the reviewed AI facts un-holds the document and clears its condition', () => {
    const { result } = renderHook(() => usePlannerState())
    act(() => result.current.setOwned('passport_existing', true))
    act(() => result.current.setDocState('passport_existing', 'expired'))
    act(() => result.current.applyContext({ goals: [], state: 'Delhi', held: [], lacking: ['passport_existing'] }))
    expect(result.current.selection).toMatchObject({ owned: [], docStates: {}, lacking: ['passport_existing'], state: 'Delhi' })
    act(() => result.current.setOwned('passport_existing', true)) // later: "I have it again"
    expect(result.current.selection).toMatchObject({ owned: ['passport_existing'], docStates: {}, lacking: [] })
  })
})

describe('assistant and planner use the same workflow state', () => {
  it('the assistant forwards progress, document conditions and state', async () => {
    save({ ...PARALLEL, progress: { 'aadhaar-address-update': 'submitted' }, docStates: { passport_existing: 'expired' }, state: 'Delhi' })
    const calls = backend()
    renderApp('/assistant')
    await userEvent.type(await screen.findByLabelText('Your question'), 'What should I do first?')
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() => expect(bodies(calls, '/api/assistant/query').length).toBe(1))
    expect(bodies(calls, '/api/assistant/query')[0].workflow).toEqual({
      target_service_ids: [...PARALLEL.targets].sort(),
      owned_document_ids: [...PARALLEL.owned].sort(),
      completed_service_ids: [],
      progress: { 'aadhaar-address-update': 'submitted' },
      document_states: { passport_existing: 'expired' },
      state: 'Delhi',
    })
  })
})

describe('removing and re-adding a service', () => {
  it('keeps reported progress when a service is removed and resumes it when re-added', () => {
    save(PARALLEL)
    const { result } = renderHook(() => usePlannerState())
    act(() => result.current.setProcess(PASSPORT, 'submitted'))
    act(() => result.current.setTarget(PASSPORT, false))
    expect(result.current.selection.progress).toEqual({ [PASSPORT]: 'submitted' })
    act(() => result.current.setTarget(PASSPORT, true))
    expect(result.current.selection.progress).toEqual({ [PASSPORT]: 'submitted' })
  })

  it('shows progress that is outside the plan and lets the citizen forget it', async () => {
    save({ ...PARALLEL, progress: { 'marriage-registration-delhi': 'submitted' } })
    const outside = {
      ...planParallel,
      notices: [{ code: 'progress_outside_plan', service_id: 'marriage-registration-delhi', message: '', related_service_ids: [] }],
      services: { ...planParallel.services, 'marriage-registration-delhi': { name: 'Marriage registration (Delhi, Hindu Marriage Act)', name_hi: null } },
    }
    const calls = backend({ plan: () => outside })
    renderApp('/planner')
    const notice = await screen.findByTestId('notice-progress-marriage-registration-delhi')
    expect(notice).toHaveTextContent('You reported progress on Marriage registration (Delhi, Hindu Marriage Act), but it is not part of this plan now.')
    await userEvent.click(screen.getByRole('button', { name: 'Forget this report' }))
    await waitFor(() => expect(bodies(calls, '/api/workflows/plan').at(-1)!.progress).toEqual({}))
    expect(saved().progress).toEqual({})
  })
})

describe('versioned storage', () => {
  it('loads version 1 data, does not write on load, and keeps unknown fields on later writes', () => {
    const v1 = JSON.stringify({ ...PARALLEL, futureField: { x: 1 } })
    localStorage.setItem(KEY, v1)
    const { result } = renderHook(() => usePlannerState())
    expect(result.current.selection.targets).toEqual(PARALLEL.targets)
    expect(localStorage.getItem(KEY)).toBe(v1) // opening the planner never rewrites storage
    act(() => result.current.setCitizenState('Delhi'))
    expect(saved()).toMatchObject({ futureField: { x: 1 }, version: SCHEMA_VERSION, state: 'Delhi', targets: PARALLEL.targets })
  })

  it('keeps a newer schema version number instead of downgrading it', () => {
    save({ ...PARALLEL, version: SCHEMA_VERSION + 1, extra: 'kept' })
    const { result } = renderHook(() => usePlannerState())
    act(() => result.current.setGoal('update-address', true))
    expect(saved()).toMatchObject({ version: SCHEMA_VERSION + 1, extra: 'kept', goals: ['update-address'] })
  })

  it('start over clears planner fields but keeps fields it does not own', () => {
    save({ ...PARALLEL, futureField: 1 })
    const { result } = renderHook(() => usePlannerState())
    act(() => result.current.reset())
    expect(saved()).toMatchObject({ targets: [], owned: [], generated: false, futureField: 1 })
  })
})
