import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import documents from './fixtures/documents.json'
import planParallel from './fixtures/plan-parallel.json'
import services from './fixtures/services.json'
import { json, mockFetch, renderApp } from './utils'

function api(url: string, init?: RequestInit) {
  if (url.endsWith('/api/services')) return services
  if (url.endsWith('/api/documents')) return documents
  if (url.endsWith('/api/workflows/plan')) return planParallel
  if (url.endsWith('/api/assistant/query'))
    return { answer: 'Your next step is Aadhaar [S1].', language: 'en', generated_by: 'ai', label: 'AI', model: 'm', evidence_status: 'sufficient', citations: [], retrieval_confidence: 'high', best_similarity: 0.8, cached: false, workflow: null, _body: init?.body }
  if (url.includes('/api/health')) return { status: 'ok', app: 'GovPath AI', version: '0.1.0', database: 'postgresql', pgvector: true, detail: null }
  return json(404, {})
}

const PLAN = { targets: ['aadhaar-address-update', 'driving-licence-address-change', 'passport-reissue-change-of-address'], owned: ['aadhaar_number', 'driving_licence_existing', 'electricity_bill', 'passport_existing'], completed: [], generated: true }

describe('Planner journey visualisation', () => {
  it('explains how the plan is built before generating', async () => {
    mockFetch(api)
    renderApp('/planner')
    expect(await screen.findByText('Select at least one service to begin')).toBeInTheDocument()
    expect(screen.getByText('How your plan is built')).toBeInTheDocument()
    expect(screen.getByText('Step status')).toBeInTheDocument()
  })

  it('shows which later steps a step unlocks, from the backend plan', async () => {
    localStorage.setItem('govpath.planner.v1', JSON.stringify(PLAN))
    mockFetch(api)
    renderApp('/planner')
    const aadhaar = await screen.findByTestId('step-aadhaar-address-update')
    expect(within(aadhaar).getByText('Completing this unlocks: Driving licence address change')).toBeInTheDocument()
    expect(within(screen.getByTestId('step-passport-reissue-change-of-address')).queryByText(/Completing this unlocks/)).toBeNull()
  })

  it('keeps selections after a reload', async () => {
    mockFetch(api)
    renderApp('/planner')
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Instant e-PAN (free PAN through Aadhaar)' }))
    cleanup()
    renderApp('/planner')
    expect(await screen.findByRole('checkbox', { name: 'Instant e-PAN (free PAN through Aadhaar)' })).toBeChecked()
  })
})

describe('Route-map details', () => {
  it('marks only the backend next action as "You are here" in the journey and overview', async () => {
    localStorage.setItem('govpath.planner.v1', JSON.stringify(PLAN))
    mockFetch(api)
    renderApp('/planner')
    const aadhaar = await screen.findByTestId('step-aadhaar-address-update')
    expect(within(aadhaar).getByText('You are here')).toBeInTheDocument()
    expect(screen.getAllByText('You are here')).toHaveLength(1)
    expect(screen.getByLabelText('Route overview')).toHaveTextContent('0 of 3 services completed')
  })

  it('groups the full catalogue by primary life event, listing every service once', async () => {
    mockFetch(api)
    renderApp('/services')
    await screen.findAllByRole('article')
    expect(screen.getAllByRole('article')).toHaveLength(10)
    const marriage = screen.getByRole('region', { name: 'Marriage & Family' })
    expect(within(marriage).getAllByRole('article')).toHaveLength(3)
    expect(within(screen.getByRole('region', { name: 'Relocation & Identity' })).getAllByRole('article')).toHaveLength(5)
    expect(screen.queryByRole('region', { name: 'Starting a Business' })).toBeNull()
  })
})

describe('Documents relationships', () => {
  it('links documents to the services that accept or issue them and supports search', async () => {
    mockFetch(api)
    renderApp('/documents')
    const row = (await screen.findByText('Marriage certificate (issued by government / Registrar of Marriage)')).closest('li')!
    expect(within(row).getByText('Accepted by 2 services')).toBeInTheDocument()
    expect(within(row).getByRole('link', { name: 'Aadhaar name update (e.g. after marriage)' })).toHaveAttribute('href', '/services/aadhaar-name-update')
    expect(within(row).getByRole('link', { name: 'Marriage registration (Delhi, Hindu Marriage Act)' })).toHaveAttribute('href', '/services/marriage-registration-delhi')
    await userEvent.type(screen.getByRole('searchbox'), 'PUC')
    expect(screen.getByText('Pollution Under Control (PUC) certificate')).toBeInTheDocument()
    expect(screen.queryByText('Marriage certificate (issued by government / Registrar of Marriage)')).toBeNull()
  })
})

describe('Assistant plan-aware suggestions', () => {
  it('offers plan suggestions only with a saved plan and sends the workflow context', async () => {
    const calls = mockFetch(api)
    renderApp('/assistant')
    await screen.findByText('How answers work')
    expect(screen.queryByText('About your saved plan')).toBeNull()
    cleanup()
    localStorage.setItem('govpath.planner.v1', JSON.stringify(PLAN))
    renderApp('/assistant')
    await userEvent.click(await screen.findByRole('button', { name: 'What is my next step and why?' }))
    await screen.findByTestId('assistant-answer')
    const sent = calls.filter((c) => c.url.endsWith('/api/assistant/query')).at(-1)!.body as { question: string; workflow: { target_service_ids: string[] } }
    expect(sent.question).toBe('What is my next step and why?')
    expect(sent.workflow.target_service_ids).toEqual(PLAN.targets)
  })
})

describe('Dashboard plan states', () => {
  it('prompts to build a plan when none is saved', async () => {
    mockFetch(api)
    renderApp('/')
    const strip = (await screen.findByRole('heading', { name: 'Your saved plan' })).closest('section')!
    expect(within(strip).getByRole('link', { name: /Plan my steps/ })).toHaveAttribute('href', '/planner')
  })
})

