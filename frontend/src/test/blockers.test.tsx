// Blocker wording follows the requirement model: every listed blocker is a separate mandatory
// requirement (all are needed); a requirement's document options are alternatives (any one).
import { render, screen, within } from '@testing-library/react'
import { act } from 'react'
import { describe, expect, it } from 'vitest'
import { IssuesPanel } from '../features/planner/components/IssuesPanel'
import { usePlanNames } from '../features/planner/names'
import i18n from '../i18n/config'
import type { Blocker, DocumentType, PlanResponse, ServiceSummary } from '../types/api'
import documents from './fixtures/documents.json'
import proposeDelhi from './fixtures/propose-marriage-delhi.json'
import services from './fixtures/services.json'

const MR = 'marriage-registration-delhi'
const docName = (id: string) => documents.find((d) => d.id === id)!.name
const noRoute = (requirement_id: string, document_options: string[]): Blocker => ({
  code: 'missing_document_no_route',
  service_id: MR,
  message: '',
  requirement_id,
  document_options,
  blocked_by_service_ids: [],
  route_service_ids: [],
  evidence_ids: [],
})
const waiting: Blocker = { code: 'dependency_blocked', service_id: 'aadhaar-name-update', message: '', requirement_id: null, document_options: [], blocked_by_service_ids: [MR] }

function Panel({ blockers }: { blockers: Blocker[] }) {
  const base = (proposeDelhi as unknown as { plan: PlanResponse }).plan
  const plan = { ...base, blockers }
  const names = usePlanNames(plan, services as ServiceSummary[], documents as DocumentType[])
  return <IssuesPanel plan={plan} names={names} />
}
const intro = () => screen.getByTestId('blockers-intro')

describe('blocker wording', () => {
  it('two separately required documents (Scenario C shape): all are needed, nothing offered as an alternative', () => {
    render(<Panel blockers={[noRoute('marriage-registration-delhi.affidavits', ['marriage_affidavits']), noRoute('marriage-registration-delhi.photographs', ['marriage_photographs_attested']), waiting]} />)
    expect(intro()).toHaveTextContent('All 2 of these requirements must be met: each one is needed separately. No service in GovPath issues them, so you need to obtain them yourself.')
    expect(intro()).not.toHaveTextContent(/one of|any one/i)
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent(docName('marriage_affidavits'))
    expect(items.every((li) => !/any one of/.test(li.textContent ?? ''))).toBe(true)
  })

  it('a genuine OR requirement still says any one of its documents is accepted', () => {
    render(<Panel blockers={[noRoute('marriage-registration-delhi.date-of-birth-proof', ['matriculation_certificate', 'passport_existing', 'birth_certificate'])]} />)
    expect(intro()).toHaveTextContent('This requirement must be met before you can continue. No service in GovPath issues it, so you need to obtain it yourself.')
    expect(screen.getByRole('listitem')).toHaveTextContent(`any one of: ${docName('matriculation_certificate')}, ${docName('passport_existing')}, ${docName('birth_certificate')}`)
  })

  it('a single missing document uses singular wording', () => {
    render(<Panel blockers={[noRoute('marriage-registration-delhi.affidavits', ['marriage_affidavits'])]} />)
    expect(intro()).toHaveTextContent('This requirement must be met before you can continue. No service in GovPath issues it, so you need to obtain it yourself.')
    expect(within(screen.getByRole('listitem')).getByText(docName('marriage_affidavits'))).toBeInTheDocument()
  })

  it('mixed with an out-of-state route: "obtain it yourself" only on the items with no producing service', () => {
    const outside: Blocker = { ...noRoute('aadhaar-name-update.marriage-proof', ['marriage_certificate']), code: 'missing_document_route_outside_jurisdiction', service_id: 'aadhaar-name-update', route_service_ids: [MR] }
    render(<Panel blockers={[noRoute('marriage-registration-delhi.affidavits', ['marriage_affidavits']), outside]} />)
    expect(intro()).toHaveTextContent('All 2 of these requirements must be met: each one is needed separately.')
    expect(intro()).not.toHaveTextContent('obtain')
    const [own, routed] = screen.getAllByRole('listitem')
    expect(own).toHaveTextContent('No service in GovPath issues this, so you need to obtain it yourself.')
    expect(routed).not.toHaveTextContent('No service in GovPath issues this')
  })

  it('in Hindi', async () => {
    await act(() => i18n.changeLanguage('hi'))
    render(<Panel blockers={[noRoute('marriage-registration-delhi.affidavits', ['marriage_affidavits']), noRoute('marriage-registration-delhi.photographs', ['marriage_photographs_attested'])]} />)
    expect(intro()).toHaveTextContent('ये सभी 2 आवश्यकताएँ पूरी करनी होंगी: हर एक अलग से ज़रूरी है। GovPath में कोई सेवा इन्हें जारी नहीं करती, इसलिए इन्हें आपको स्वयं प्राप्त करना होगा।')
    expect(intro()).not.toHaveTextContent('कोई एक')
  })
})
