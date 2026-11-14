import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import i18n from '../i18n/config'
import serviceAadhaar from './fixtures/service-aadhaar.json'
import serviceRc from './fixtures/service-rc.json'
import services from './fixtures/services.json'
import { json, mockFetch, renderApp } from './utils'

function api(url: string) {
  if (url.endsWith('/api/services')) return services
  if (url.endsWith('/api/services/aadhaar-address-update')) return serviceAadhaar
  if (url.endsWith('/api/services/vehicle-rc-address-change')) return serviceRc
  return json(404, { detail: 'Not found' })
}

describe('Services catalogue', () => {
  it('lists every verified service with authority, status and official link', async () => {
    mockFetch(api)
    renderApp('/services')
    const card = (await screen.findByRole('link', { name: 'Aadhaar address update' })).closest('article')!
    expect(within(card).getByText(/Unique Identification Authority of India/)).toBeInTheDocument()
    expect(within(card).getByText(/Verified/)).toBeInTheDocument()
    expect(within(card).getByText('National service')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: /Official website/ })).toHaveAttribute(
      'href',
      'https://uidai.gov.in/en/updating-data-on-aadhaar',
    )
    expect(screen.getAllByRole('article')).toHaveLength(10)
  })

  it('switches service names and labels to Hindi', async () => {
    mockFetch(api)
    renderApp('/services')
    await screen.findByText('Aadhaar address update')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'hi')
    expect(await screen.findByRole('link', { name: 'आधार में पता अपडेट' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'सरकारी सेवाएँ' })).toBeInTheDocument()
    expect(screen.getAllByText('आधिकारिक वेबसाइट ↗').length).toBe(10)
    // Authority names are official English names and are not translated.
    expect(screen.getAllByText(/Unique Identification Authority of India/).length).toBeGreaterThan(0)
    await i18n.changeLanguage('en')
  })

  it('shows an error with retry when the API fails', async () => {
    mockFetch(() => json(500, { detail: 'boom' }))
    renderApp('/services')
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the service information.')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

describe('Service detail', () => {
  it('separates mandatory, optional and conditional documents with alternatives and evidence', async () => {
    mockFetch(api)
    renderApp('/services/vehicle-rc-address-change')
    expect(await screen.findByRole('heading', { level: 1, name: 'Vehicle RC address change' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Mandatory documents' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Needed only in some cases' })).toBeInTheDocument()
    const noc = screen.getByRole('heading', { name: 'No Objection Certificate from financier' }).closest('article')!
    expect(within(noc).getByText('Only if:')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Apply on the official portal/ })).toHaveAttribute(
      'href',
      'https://vahan.parivahan.gov.in/vahanservice/vahan/',
    )
  })

  it('shows "any one of" alternatives and verbatim source quotes', async () => {
    mockFetch(api)
    renderApp('/services/aadhaar-address-update')
    const poa = (await screen.findByRole('heading', { name: 'Proof of new address (any one)' })).closest('article')!
    expect(within(poa).getByText('Any one of these documents is accepted:')).toBeInTheDocument()
    expect(within(poa).getByText('Indian passport showing current address')).toBeInTheDocument()
    await userEvent.click(within(poa).getByText(/Official sources/))
    expect(within(poa).getByText('“1. Valid Indian Passport”')).toBeInTheDocument()
    expect(within(poa).getAllByRole('link', { name: /List of Acceptable Documents/ })[0]).toHaveAttribute(
      'href',
      expect.stringMatching(/^https:\/\/backend\.uidai\.gov\.in\//),
    )
  })

  it('flags unverified requirements distinctly', async () => {
    const unverified = structuredClone(serviceAadhaar)
    unverified.requirements[0].verification_status = 'unverified'
    mockFetch((url) => (url.endsWith('/api/services/aadhaar-address-update') ? unverified : api(url)))
    renderApp('/services/aadhaar-address-update')
    expect(await screen.findByText('Not verified', { exact: false })).toBeInTheDocument()
    expect(screen.getByText(/has not been verified against an official source/)).toBeInTheDocument()
  })

  it('reports unknown services', async () => {
    mockFetch(api)
    renderApp('/services/nope')
    expect(await screen.findByRole('alert')).toHaveTextContent('This service was not found.')
  })
})
