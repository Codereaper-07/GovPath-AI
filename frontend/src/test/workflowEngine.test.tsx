import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import i18n from '../i18n/config'
import discoverDelhi from './fixtures/discover-marriage-delhi.json'
import discoverNoState from './fixtures/discover-marriage-nostate.json'
import documents from './fixtures/documents.json'
import planMarriageDelhi from './fixtures/plan-marriage-delhi.json'
import planMarriageMh from './fixtures/plan-marriage-maharashtra.json'
import planParallelDone from './fixtures/plan-parallel-done.json'
import planParallelSubmitted from './fixtures/plan-parallel-submitted.json'
import planParallel from './fixtures/plan-parallel.json'
import services from './fixtures/services.json'
import vocabulary from './fixtures/vocabulary.json'
import { json, mockFetch, renderApp } from './utils'

type Body = Record<string, unknown> & {
  owned_document_ids?: string[]
  completed_service_ids?: string[]
  progress?: Record<string, string>
  document_states?: Record<string, string>
  held_document_ids?: string[]
  goals?: string[]
  state?: string | null
}

function backend(opts: { plan?: (b: Body) => unknown; discover?: (b: Body) => unknown; interpret?: (b: Body) => unknown } = {}) {
  return mockFetch((url, init) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Body) : ({} as Body)
    if (url.endsWith('/api/services')) return services
    if (url.endsWith('/api/documents')) return documents
    if (url.endsWith('/api/workflows/vocabulary')) return vocabulary
    if (url.endsWith('/api/workflows/plan')) return (opts.plan ?? (() => planParallel))(body)
    if (url.endsWith('/api/workflows/discover')) return (opts.discover ?? (() => discoverNoState))(body)
    if (url.endsWith('/api/situation/interpret')) return (opts.interpret ?? (() => json(503, { detail: { code: 'assistant_not_configured' } })))(body)
    return json(404, {})
  })
}
const callsTo = (calls: { url: string; body: unknown }[], path: string) => calls.filter((c) => c.url.endsWith(path)).map((c) => c.body as Body)

const PARALLEL = {
  targets: ['aadhaar-address-update', 'driving-licence-address-change', 'passport-reissue-change-of-address'],
  owned: ['aadhaar_number', 'driving_licence_existing', 'electricity_bill', 'passport_existing'],
  completed: [],
  generated: true,
}
const save = (v: object) => localStorage.setItem('govpath.planner.v1', JSON.stringify(v))

describe('Document readiness is separate from process progress', () => {
  it('ticking documents never reports a service as completed', async () => {
    const calls = backend()
    save(PARALLEL)
    renderApp('/planner')
    await screen.findByTestId('step-aadhaar-address-update')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Aadhaar card/letter showing current address' }))
    await waitFor(() => expect(callsTo(calls, '/api/workflows/plan').at(-1)!.owned_document_ids).toContain('aadhaar_current_address'))
    for (const body of callsTo(calls, '/api/workflows/plan')) {
      expect(body.completed_service_ids).toEqual([])
      expect(body.progress).toEqual({})
    }
    expect(screen.getByText('0 of 3 services completed')).toBeInTheDocument()
  })

  it('a held document marked expired is sent as unusable and not counted', async () => {
    const calls = backend()
    save(PARALLEL)
    renderApp('/planner')
    await screen.findByTestId('step-aadhaar-address-update')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Condition of Electricity bill for current address' }), 'expired')
    await waitFor(() => expect(callsTo(calls, '/api/workflows/plan').at(-1)!.document_states).toEqual({ electricity_bill: 'expired' }))
    expect(screen.getByText('Not counted until it is valid.')).toBeInTheDocument()
  })
})

describe('Process progress', () => {
  it('reporting a step as submitted replans and shows it in progress', async () => {
    const calls = backend({ plan: (b) => (b.progress?.['aadhaar-address-update'] === 'submitted' ? planParallelSubmitted : planParallel) })
    save(PARALLEL)
    renderApp('/planner')
    await screen.findByTestId('step-aadhaar-address-update')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Your progress on Aadhaar address update' }), 'submitted')
    await waitFor(() => expect(screen.getByTestId('step-aadhaar-address-update')).toHaveAttribute('data-status', 'in_progress'))
    const body = callsTo(calls, '/api/workflows/plan').at(-1)!
    expect(body.progress).toEqual({ 'aadhaar-address-update': 'submitted' })
    expect(body.completed_service_ids).toEqual([]) // submitted is not completed
    // The other ready step is recommended while the submitted one is processed.
    expect(screen.getByRole('heading', { name: 'Start: Passport reissue for change of address' })).toBeInTheDocument()
    expect(screen.getByText('1 in progress')).toBeInTheDocument()
  })

  it('completed services are labelled as reported by the user', async () => {
    backend({ plan: () => planParallelDone })
    save({ ...PARALLEL, completed: ['aadhaar-address-update'] })
    renderApp('/planner')
    expect(await screen.findByText('✓ Aadhaar address update')).toBeInTheDocument()
    expect(screen.getByText('Reported by you')).toBeInTheDocument()
    expect(screen.getByText(/ticking documents never completes a service/)).toBeInTheDocument()
  })
})

describe('Workflow repair from the backend', () => {
  const MARRIAGE = {
    targets: ['aadhaar-name-update', 'passport-reissue-name-change-marriage'],
    owned: ['aadhaar_number', 'passport_existing', 'marriage_affidavits', 'marriage_photographs_attested'],
    completed: [],
    generated: true,
  }

  it('shows the inserted marriage registration and why it is needed (Delhi)', async () => {
    const calls = backend({ plan: () => planMarriageDelhi, discover: () => discoverDelhi })
    save({ ...MARRIAGE, state: 'Delhi', goals: ['update-name-after-marriage'] })
    renderApp('/planner')
    const reg = await screen.findByTestId('step-marriage-registration-delhi')
    expect(within(reg).getByText('Needed for a document')).toBeInTheDocument()
    expect(within(reg).getByText(/Added to get Marriage certificate/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Start: Marriage registration (Delhi, Hindu Marriage Act)' })).toBeInTheDocument()
    const passport = screen.getByTestId('step-passport-reissue-name-change-marriage')
    expect(within(passport).getByText(/Or, if you already have one: Joint photo declaration/)).toBeInTheDocument()
    expect(callsTo(calls, '/api/workflows/plan').at(-1)!.state).toBe('Delhi')
  })

  it('explains that an out-of-state route cannot be used', async () => {
    backend({ plan: () => planMarriageMh, discover: () => discoverDelhi })
    save({ ...MARRIAGE, state: 'Maharashtra' })
    renderApp('/planner')
    await screen.findByTestId('step-aadhaar-name-update')
    expect(screen.queryByTestId('step-marriage-registration-delhi')).toBeNull()
    expect(screen.getAllByText(/verified that service for another state only, so it is not used for Maharashtra/).length).toBe(2)
  })
})

describe('Situation and service discovery', () => {
  it('suggests services from a goal, asks about records, and adds the suggestions', async () => {
    const calls = backend({
      discover: (b) => ((b.held_document_ids ?? []).includes('aadhaar_number') && b.state === 'Delhi' ? discoverDelhi : discoverNoState),
    })
    renderApp('/planner')
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Change my name after marriage' }))
    expect(await screen.findByText('Do you have Aadhaar number (existing Aadhaar)?')).toBeInTheDocument()
    expect(callsTo(calls, '/api/workflows/discover').at(-1)!.goals).toEqual(['update-name-after-marriage'])
    await userEvent.click(within(screen.getByText('Do you have Aadhaar number (existing Aadhaar)?').closest('div')!).getByRole('button', { name: 'Yes, I have it' }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Where do you live now?' }), 'Delhi')
    await userEvent.click(await screen.findByRole('button', { name: 'Add 2 to my plan' }))
    for (const name of ['Aadhaar name update (e.g. after marriage)', 'Passport reissue for change of name after marriage']) {
      expect(screen.getAllByRole('checkbox', { name }).every((b) => (b as HTMLInputElement).checked)).toBe(true)
    }
    expect(callsTo(calls, '/api/workflows/discover').at(-1)).toMatchObject({ state: 'Delhi', held_document_ids: ['aadhaar_number'] })
  })

  it('falls back clearly when the AI reader is unavailable', async () => {
    const calls = backend({ interpret: () => json(429, { detail: { code: 'quota_exhausted' } }) })
    renderApp('/planner')
    await userEvent.type(await screen.findByLabelText('Or describe it in your own words'), 'I moved to Pune')
    await userEvent.click(screen.getByRole('button', { name: 'Read my situation' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('AI reader is unavailable right now')
    expect(callsTo(calls, '/api/workflows/plan')).toHaveLength(0)
  })

  it('applies reviewed AI-extracted facts only when the user accepts them', async () => {
    backend({
      interpret: () => ({
        generated_by: 'ai', label: 'AI', model: 'm', goals: ['update-name-after-marriage'], life_events: [], state: 'Delhi',
        held_document_ids: ['aadhaar_number'], lacking_document_ids: [], completed_service_ids: [], unknowns: [], dropped: ['xyz'],
      }),
    })
    renderApp('/planner')
    await userEvent.type(await screen.findByLabelText('Or describe it in your own words'), 'Married in Delhi, need new surname')
    await userEvent.click(screen.getByRole('button', { name: 'Read my situation' }))
    const review = await screen.findByTestId('situation-review')
    expect(within(review).getByText('✦ AI-generated')).toBeInTheDocument()
    expect(within(review).getByText(/1 item was ignored/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Change my name after marriage' })).not.toBeChecked()
    await userEvent.click(within(review).getByRole('button', { name: 'Use these details' }))
    expect(screen.getByRole('checkbox', { name: 'Change my name after marriage' })).toBeChecked()
    expect(screen.getByRole('combobox', { name: 'Where do you live now?' })).toHaveValue('Delhi')
    expect(screen.getByRole('checkbox', { name: 'Aadhaar number (existing Aadhaar)' })).toBeChecked()
  })

  it('shows goals and suggestions in Hindi', async () => {
    backend()
    renderApp('/planner')
    await screen.findByRole('checkbox', { name: 'Change my name after marriage' })
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'hi')
    await userEvent.click(await screen.findByRole('checkbox', { name: 'शादी के बाद नाम बदलना' }))
    expect(await screen.findByText('सुझाई गई सेवाएँ')).toBeInTheDocument()
    await i18n.changeLanguage('en')
  })
})
