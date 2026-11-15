import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import i18n from '../i18n/config'
import documents from './fixtures/documents.json'
import services from './fixtures/services.json'
import { json, mockFetch, renderApp } from './utils'

function api(url: string) {
  if (url.endsWith('/api/services')) return services
  if (url.endsWith('/api/documents')) return documents
  if (url.includes('/api/health')) return { status: 'ok', app: 'GovPath AI', version: '0.1.0', database: 'postgresql', pgvector: true, detail: null }
  return json(404, {})
}

const cards = () => screen.getAllByRole('article').map((a) => within(a).getByRole('heading', { level: 2 }).textContent)

describe('Dashboard life-event discovery', () => {
  it('shows all five life events with live verified-service counts', async () => {
    mockFetch(api)
    renderApp('/')
    expect(await screen.findByText('10 government services verified from official sources', { exact: false })).toBeInTheDocument()
    expect(screen.getByTestId('life-event-relocation-identity')).toHaveTextContent('6 verified services')
    expect(screen.getByTestId('life-event-marriage-family')).toHaveTextContent('3 verified services')
    expect(screen.getByTestId('life-event-birth-parenthood')).toHaveTextContent('1 verified service')
    expect(screen.getByTestId('life-event-employment-career')).toHaveTextContent('1 verified service')
    // Honest coverage gap, not a fabricated count.
    expect(screen.getByTestId('life-event-starting-business')).toHaveTextContent('No verified services yet')
    expect(screen.getByTestId('life-event-marriage-family')).toHaveAttribute('href', '/services?event=marriage-family')
  })

  it('hands a described situation to the assistant', async () => {
    mockFetch(api)
    renderApp('/')
    await userEvent.type(await screen.findByLabelText('Describe your situation'), 'I got married')
    await userEvent.click(screen.getByRole('button', { name: /Ask GovPath/ }))
    expect(await screen.findByLabelText('Your question')).toHaveValue('I got married')
  })

  it('renders in Hindi', async () => {
    mockFetch(api)
    renderApp('/')
    await screen.findByTestId('life-event-marriage-family')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'hi')
    expect(await within(screen.getByTestId('life-event-marriage-family')).findByText('विवाह और परिवार')).toBeInTheDocument()
    expect(screen.getByTestId('life-event-starting-business')).toHaveTextContent('अभी कोई सत्यापित सेवा नहीं')
    await i18n.changeLanguage('en')
  })
})

describe('Services catalogue filtering', () => {
  it('filters by life event and keeps the filter in the URL', async () => {
    mockFetch(api)
    renderApp('/services?event=marriage-family')
    await screen.findAllByRole('article')
    expect(cards().sort()).toEqual(
      ['Aadhaar name update (e.g. after marriage)', 'Marriage registration (Delhi, Hindu Marriage Act)', 'Passport reissue for change of name after marriage'].sort(),
    )
    expect(screen.getByRole('button', { name: /Marriage & Family/ })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: /^All/ }))
    expect(screen.getAllByRole('article')).toHaveLength(10)
    await userEvent.click(screen.getByRole('button', { name: /Birth & Parenthood/ }))
    expect(cards()).toEqual(['Aadhaar enrolment for a child under 5'])
  })

  it('searches names, descriptions and Hindi names', async () => {
    mockFetch(api)
    renderApp('/services')
    await screen.findAllByRole('article')
    await userEvent.type(screen.getByRole('searchbox'), 'PAN')
    expect(cards()).toContain('Instant e-PAN (free PAN through Aadhaar)')
    await userEvent.clear(screen.getByRole('searchbox'))
    await userEvent.type(screen.getByRole('searchbox'), 'विवाह')
    expect(cards()).toContain('Marriage registration (Delhi, Hindu Marriage Act)')
  })

  it('shows an honest empty state for a category without verified services', async () => {
    mockFetch(api)
    renderApp('/services')
    await screen.findAllByRole('article')
    await userEvent.click(screen.getByRole('button', { name: /Starting a Business/ }))
    expect(screen.queryAllByRole('article')).toHaveLength(0)
    expect(screen.getByText('No services in this life event have been verified yet.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getAllByRole('article')).toHaveLength(10)
  })
})

