// Hindi document descriptions: complete for the curated catalogue, made from today's English,
// shown only in Hindi, and never shown when the English they were made from has changed.
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { describe, expect, it } from 'vitest'
import seed from '../../../data/knowledge/documents.json'
import { DOCUMENT_DESCRIPTIONS_HI } from '../i18n/documentDescriptions.hi'
import i18n from '../i18n/config'
import documents from './fixtures/documents.json'
import services from './fixtures/services.json'
import { json, mockFetch, renderApp } from './utils'

type SeedDoc = { slug: string; description: string }

function api(url: string) {
  if (url.endsWith('/api/services')) return services
  if (url.endsWith('/api/documents')) return documents
  return json(404, {})
}

const row = (name: string) => screen.getByText(name, { selector: 'p' }).closest('li') as HTMLElement

describe('Hindi document descriptions (data)', () => {
  it('cover every curated document, each made from its current English description', () => {
    const docs = seed as SeedDoc[]
    expect(docs).toHaveLength(65)
    expect(Object.keys(DOCUMENT_DESCRIPTIONS_HI).sort()).toEqual(docs.map((d) => d.slug).sort())
    for (const d of docs) {
      const entry = DOCUMENT_DESCRIPTIONS_HI[d.slug]
      expect(entry.en, d.slug).toBe(d.description)
      expect(entry.hi, d.slug).toMatch(/[ऀ-ॿ]/)
      expect(entry.hi, d.slug).not.toBe(entry.en)
      expect(entry.hi, d.slug).not.toMatch(/\{\{|\}\}/)
    }
  })
})

describe('Documents page descriptions', () => {
  it('English is the API text, unchanged', async () => {
    mockFetch(api)
    renderApp('/documents')
    const r = within(await screen.findByText('Aadhaar number (existing Aadhaar)', { selector: 'p' }).then(() => row('Aadhaar number (existing Aadhaar)')))
    const p = r.getByText('The Aadhaar number of the person whose Aadhaar is being updated.')
    expect(p).toHaveAttribute('lang', 'en')
  })

  it('Hindi shows the translation, follows a live language switch, and is searchable', async () => {
    mockFetch(api)
    renderApp('/documents')
    await screen.findByText('Aadhaar number (existing Aadhaar)', { selector: 'p' })
    await act(() => i18n.changeLanguage('hi'))
    const r = within(row('आधार नंबर (मौजूदा आधार)'))
    expect(r.getByText(DOCUMENT_DESCRIPTIONS_HI.aadhaar_number.hi)).toHaveAttribute('lang', 'hi')
    expect(r.queryByText('The Aadhaar number of the person whose Aadhaar is being updated.')).toBeNull()

    await userEvent.type(screen.getByRole('searchbox'), 'ओटीपी')
    expect(screen.getByText(DOCUMENT_DESCRIPTIONS_HI.mobile_linked_to_aadhaar.hi)).toBeInTheDocument()
    expect(screen.queryByText(DOCUMENT_DESCRIPTIONS_HI.aadhaar_number.hi)).toBeNull()
  })

  it('falls back to English when the API English differs from what was translated', async () => {
    // The captured fixture still has the older English for this document.
    const old = (documents as { id: string; description: string }[]).find((d) => d.id === 'driving_licence_existing')!.description
    expect(old).not.toBe(DOCUMENT_DESCRIPTIONS_HI.driving_licence_existing.en)
    await act(() => i18n.changeLanguage('hi'))
    mockFetch(api)
    renderApp('/documents')
    const r = within(await screen.findByText('मौजूदा ड्राइविंग लाइसेंस', { selector: 'p' }).then(() => row('मौजूदा ड्राइविंग लाइसेंस')))
    expect(r.getByText(old)).toHaveAttribute('lang', 'en')
    expect(r.queryByText(DOCUMENT_DESCRIPTIONS_HI.driving_licence_existing.hi)).toBeNull()
  })
})
