import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import i18n from '../i18n/config'
import type { AssistantAnswer } from '../types/api'
import services from './fixtures/services.json'
import { json, mockFetch, renderApp } from './utils'

const answer: AssistantAnswer = {
  answer: 'Attach any one proof of present address [S1]. You also need your old passport [K1].',
  language: 'en',
  generated_by: 'ai',
  label: 'AI-generated explanation',
  model: 'gemini-3.6-flash',
  evidence_status: 'sufficient',
  citations: [
    {
      id: 'S1', kind: 'official_excerpt', excerpt: 'Proof of Present Address. For Proof of Address attach one of the following documents:',
      source_url: 'https://www.passportindia.gov.in/AppOnlineProject/pdf/ApplicationformInstructionBooklet-V3.0.pdf',
      source_title: 'Passport instruction booklet', source_authority: 'Ministry of External Affairs', source_verified: true,
      page_start: 14, page_end: 14, section: null, locator: null, similarity: 0.81, evidence_ids: ['pp-poa-list'],
    },
    {
      id: 'K1', kind: 'verified_fact', excerpt: 'For re-issue of passport, an applicant is required to submit old Passport in original',
      source_url: 'https://www.passportindia.gov.in/x.pdf', source_title: 'Passport booklet', source_authority: null,
      source_verified: true, page_start: null, page_end: null, section: null, locator: 'Section D', similarity: null,
      evidence_ids: ['pp-reissue-old-passport'],
    },
  ],
  retrieval_confidence: 'high',
  best_similarity: 0.81,
  cached: false,
  workflow: null,
}

function backend(respond: (body: { question: string; language: string; workflow?: unknown }) => unknown) {
  return mockFetch((url, init) => {
    if (url.endsWith('/api/services')) return services
    if (url.endsWith('/api/assistant/query')) return respond(JSON.parse(String(init!.body)))
    return json(404, {})
  })
}

const assistantCalls = (calls: { url: string; body: unknown }[]) =>
  calls.filter((c) => c.url.endsWith('/api/assistant/query')).map((c) => c.body as { question: string; language: string; workflow?: unknown })

async function ask(text: string) {
  await userEvent.type(await screen.findByLabelText('Your question'), text)
  await userEvent.click(screen.getByRole('button', { name: 'Ask' }))
}

describe('Assistant', () => {
  it('answers with an AI label, clickable citations and expandable evidence', async () => {
    const calls = backend(() => answer)
    renderApp('/assistant')
    await ask('Which proof of address for passport?')
    const card = await screen.findByTestId('assistant-answer')
    expect(within(card).getByText('✦ AI-generated')).toBeInTheDocument()
    expect(within(card).getByText(/not an official government decision/)).toBeInTheDocument()
    expect(within(card).getByText('Backed by official sources')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: '[S1]' })).toHaveAttribute('href', expect.stringMatching(/-S1$/))
    const source = within(card).getByRole('link', { name: 'Passport instruction booklet' })
    expect(source).toHaveAttribute('href', answer.citations[0].source_url)
    expect(within(card).getByText('page 14')).toBeInTheDocument()
    expect(within(card).getByText('Verified fact')).toBeInTheDocument()
    const excerpt = within(card).getByText(/Proof of Present Address\. For Proof of Address/)
    expect(excerpt).not.toBeVisible()
    await userEvent.click(within(card).getAllByText('Show supporting excerpt')[0])
    expect(excerpt).toBeVisible()
    expect(assistantCalls(calls)[0]).toMatchObject({ question: 'Which proof of address for passport?', language: 'en' })
    expect(screen.getByText('Which proof of address for passport?')).toBeInTheDocument()
  })

  it('renders combined citation markers as separate links and drops unknown ids', async () => {
    backend(() => ({ ...answer, answer: 'Bring your old passport [S1, K1] and one proof [S1; S9].' }))
    renderApp('/assistant')
    await ask('Passport documents?')
    const card = await screen.findByTestId('assistant-answer')
    const links = within(card).getAllByRole('link', { name: /^\[(S1|K1)\]$/ })
    expect(links.map((l) => l.textContent)).toEqual(['[S1]', '[K1]', '[S1]'])
    expect(links[1]).toHaveAttribute('href', expect.stringMatching(/-K1$/))
    expect(within(card).queryByText(/S9/)).not.toBeInTheDocument()
    expect(within(card).queryByText(/\[S1, K1\]/)).not.toBeInTheDocument()
  })

  it('shows a loading state while waiting', async () => {
    let release: (v: unknown) => void = () => {}
    backend(() => new Promise((r) => (release = r)))
    renderApp('/assistant')
    await ask('Passport proof of address?')
    expect(await screen.findByText(/Searching official sources/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Answering…' })).toBeDisabled()
    release(json(200, answer))
    expect(await screen.findByTestId('assistant-answer')).toBeInTheDocument()
  })

  it('presents insufficient evidence clearly', async () => {
    backend(() => ({ ...answer, answer: 'I could not find enough information.', evidence_status: 'insufficient', generated_by: 'none', citations: [], model: null }))
    renderApp('/assistant')
    await ask('What is the weather?')
    const card = await screen.findByTestId('assistant-answer')
    expect(within(card).getByText('Not enough official information')).toBeInTheDocument()
    expect(within(card).queryByText('✦ AI-generated')).not.toBeInTheDocument()
  })

  it.each([
    [json(429, { detail: { code: 'quota_exhausted' } }), 'reached its usage limit'],
    [json(429, { detail: { code: 'rate_limited' } }), 'Too many questions'],
    [json(503, { detail: { code: 'index_not_built' } }), 'not ready yet'],
    [json(422, { detail: [{ msg: 'bad' }] }), 'between 3 and 1000 characters'],
  ])('maps API errors to friendly messages (%#)', async (response, message) => {
    backend(() => response)
    renderApp('/assistant')
    await ask('Passport proof of address?')
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
  })

  it('retries the last question after an error', async () => {
    let fail = true
    const calls = backend(() => (fail ? json(503, { detail: { code: 'model_unavailable' } }) : answer))
    renderApp('/assistant')
    await ask('Passport proof of address?')
    expect(await screen.findByRole('alert')).toHaveTextContent('temporarily unavailable')
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByTestId('assistant-answer')).toBeInTheDocument()
    expect(assistantCalls(calls).map((c) => c.question)).toEqual(['Passport proof of address?', 'Passport proof of address?'])
  })

  it('prefills a question handed over from the dashboard without sending it', async () => {
    const calls = backend(() => answer)
    renderApp('/assistant?q=I%20got%20married')
    expect(await screen.findByLabelText('Your question')).toHaveValue('I got married')
    expect(assistantCalls(calls)).toHaveLength(0)
  })

  it('shows a network error', async () => {
    mockFetch((url) => {
      if (url.endsWith('/api/services')) return services
      throw new TypeError('Failed to fetch')
    })
    renderApp('/assistant')
    await ask('Passport proof of address?')
    expect(await screen.findByRole('alert')).toHaveTextContent('GovPath can’t be reached right now.')
  })

  it('works in Hindi and sends the Hindi language code', async () => {
    const calls = backend(() => ({ ...answer, language: 'hi', answer: 'वर्तमान पते का कोई एक प्रमाण लगाएँ [S1]।' }))
    renderApp('/assistant')
    await screen.findByLabelText('Your question')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'hi')
    await userEvent.type(await screen.findByLabelText('आपका प्रश्न'), 'पासपोर्ट के लिए पते का प्रमाण?')
    await userEvent.click(screen.getByRole('button', { name: 'पूछें' }))
    const card = await screen.findByTestId('assistant-answer')
    expect(within(card).getByText(/वर्तमान पते का कोई एक प्रमाण/)).toBeInTheDocument()
    expect(within(card).getByText('आधिकारिक स्रोत')).toBeInTheDocument()
    expect(within(card).getAllByText('सहायक अंश दिखाएँ').length).toBe(2)
    await waitFor(() => expect(assistantCalls(calls)[0].language).toBe('hi'))
    await i18n.changeLanguage('en')
  })
})

