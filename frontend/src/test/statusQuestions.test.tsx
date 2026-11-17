// A status the planner will not presume (e.g. a mobile registered with Aadhaar) is asked about:
// "Yes" marks it held, "No" brings in the service that provides it. Never "obtain it yourself".
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { IssuesPanel } from '../features/planner/components/IssuesPanel'
import { StatusQuestions } from '../features/planner/components/StatusQuestions'
import { usePlanNames } from '../features/planner/names'
import i18n from '../i18n/config'
import type { Blocker, DocumentType, PlanResponse, ServiceSummary } from '../types/api'
import documents from './fixtures/documents.json'
import proposeDelhi from './fixtures/propose-marriage-delhi.json'
import services from './fixtures/services.json'

const EPAN = 'instant-e-pan'
const MOBILE_DOC = 'mobile_linked_to_aadhaar'
const MOBILE_SVC = 'aadhaar-mobile-number-update'
const unknown: Blocker = {
  code: 'missing_document_status_unknown',
  service_id: EPAN,
  message: '',
  requirement_id: 'instant-e-pan.aadhaar-linked-mobile',
  document_options: [MOBILE_DOC],
  blocked_by_service_ids: [],
  route_service_ids: [MOBILE_SVC],
  evidence_ids: [],
}

function View({ onHave, onLack }: { onHave: (d: string) => void; onLack: (d: string, s: string[]) => void }) {
  const base = (proposeDelhi as unknown as { plan: PlanResponse }).plan
  const plan: PlanResponse = {
    ...base,
    blockers: [unknown],
    clarifications: [{ code: 'document_status_required', service_id: EPAN, region: null, document_id: MOBILE_DOC, route_service_ids: [MOBILE_SVC] }],
    // display names for the services/documents in this synthetic plan
    services: { ...base.services, [EPAN]: { name: 'Instant e-PAN (free PAN through Aadhaar)', name_hi: 'इंस्टेंट ई-पैन (आधार से निःशुल्क पैन)' }, [MOBILE_SVC]: { name: 'Register or update mobile number in Aadhaar', name_hi: 'आधार में मोबाइल नंबर पंजीकृत / अपडेट करना' } },
  }
  const names = usePlanNames(plan, services as ServiceSummary[], documents as DocumentType[])
  return (
    <>
      <StatusQuestions plan={plan} names={names} onHave={onHave} onLack={onLack} />
      <IssuesPanel plan={plan} names={names} />
    </>
  )
}

describe('status questions', () => {
  it('asks instead of assuming; Yes marks it held, No brings in the providing service', async () => {
    const onHave = vi.fn()
    const onLack = vi.fn()
    const user = userEvent.setup()
    render(<View onHave={onHave} onLack={onLack} />)
    const q = screen.getByTestId(`status-question-${MOBILE_DOC}`)
    expect(q).toHaveTextContent('Do you already have: Mobile number registered with Aadhaar?')
    expect(q).toHaveTextContent('GovPath will not assume you don’t have it. If you don’t, Register or update mobile number in Aadhaar can provide it.')
    await user.click(within(q).getByRole('button', { name: 'Yes, I have it' }))
    expect(onHave).toHaveBeenCalledWith(MOBILE_DOC)
    await user.click(within(q).getByRole('button', { name: 'No — add Register or update mobile number in Aadhaar' }))
    expect(onLack).toHaveBeenCalledWith(MOBILE_DOC, [MOBILE_SVC])
    // The blocker never tells the citizen to obtain it on their own.
    const item = screen.getByRole('listitem')
    expect(item).toHaveTextContent('Not known yet: answer the question above.')
    expect(screen.getByTestId('blockers-intro')).not.toHaveTextContent('obtain')
  })

  it('in Hindi', async () => {
    await act(() => i18n.changeLanguage('hi'))
    render(<View onHave={() => {}} onLack={() => {}} />)
    const q = screen.getByTestId(`status-question-${MOBILE_DOC}`)
    expect(q).toHaveTextContent('क्या आपके पास पहले से है: आधार से पंजीकृत मोबाइल नंबर?')
    expect(within(q).getByRole('button', { name: 'हाँ, मेरे पास है' })).toBeInTheDocument()
    expect(within(q).getByRole('button', { name: 'नहीं — आधार में मोबाइल नंबर पंजीकृत / अपडेट करना जोड़ें' })).toBeInTheDocument()
  })
})

describe('obtainable later through a service', () => {
  it('no Aadhaar and no mobile: the mobile item says the update needs the Aadhaar number first; never "obtain it yourself"', () => {
    const base = (proposeDelhi as unknown as { plan: PlanResponse }).plan
    const aadhaar: Blocker = { ...unknown, code: 'missing_document_no_route', requirement_id: 'instant-e-pan.aadhaar-number', document_options: ['aadhaar_number'], route_service_ids: [] }
    const mobile: Blocker = { ...unknown, code: 'missing_document_no_route', route_service_ids: [MOBILE_SVC], route_needs_document_ids: ['aadhaar_number'] }
    const plan: PlanResponse = {
      ...base,
      blockers: [aadhaar, mobile],
      clarifications: [],
      services: { ...base.services, [EPAN]: { name: 'Instant e-PAN (free PAN through Aadhaar)', name_hi: null }, [MOBILE_SVC]: { name: 'Register or update mobile number in Aadhaar', name_hi: null } },
    }
    function Panel() {
      const names = usePlanNames(plan, services as ServiceSummary[], documents as DocumentType[])
      return <IssuesPanel plan={plan} names={names} />
    }
    render(<Panel />)
    // Not every item is "obtain yourself", so the heading does not claim it for the whole list.
    expect(screen.getByTestId('blockers-intro')).toHaveTextContent('All 2 of these requirements must be met: each one is needed separately.')
    expect(screen.getByTestId('blockers-intro')).not.toHaveTextContent('obtain')
    const [aadhaarItem, mobileItem] = screen.getAllByRole('listitem')
    expect(aadhaarItem).toHaveTextContent('No service in GovPath issues this, so you need to obtain it yourself.')
    expect(mobileItem).toHaveTextContent('Not available yet: Register or update mobile number in Aadhaar can provide it once you have Aadhaar number (existing Aadhaar).')
    expect(mobileItem).not.toHaveTextContent('obtain it yourself')
  })
})
