import { screen, within } from '@testing-library/react'
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


describe('Route-map details', () => {
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



