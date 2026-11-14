import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import i18n from '../i18n/config'
import documents from './fixtures/documents.json'
import planParallelDone from './fixtures/plan-parallel-done.json'
import planParallel from './fixtures/plan-parallel.json'
import planRcBlocked from './fixtures/plan-rc-blocked.json'
import planRcReady from './fixtures/plan-rc-ready.json'
import services from './fixtures/services.json'
import { json, mockFetch, renderApp } from './utils'

type PlanBody = { target_service_ids: string[]; owned_document_ids: string[]; completed_service_ids: string[] }

function backend(plan: (body: PlanBody) => unknown) {
  return mockFetch((url, init) => {
    if (url.endsWith('/api/services')) return services
    if (url.endsWith('/api/documents')) return documents
    if (url.endsWith('/api/workflows/plan')) return plan(JSON.parse(String(init!.body)))
    return json(404, {})
  })
}

const planCalls = (calls: { url: string; body: unknown }[]) =>
  calls.filter((c) => c.url.endsWith('/api/workflows/plan')).map((c) => c.body as PlanBody)

async function choose(label: string) {
  await userEvent.click(await screen.findByRole('checkbox', { name: label }))
}

describe('Workflow planner', () => {
  it('shows an empty state until a service is selected and a plan generated', async () => {
    const calls = backend(() => planRcBlocked)
    renderApp('/planner')
    expect(await screen.findByText('Select at least one service to begin')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generate my plan' })).toBeDisabled()
    expect(planCalls(calls)).toHaveLength(0)
  })

  it('generates a plan, then replans when a document is ticked (blocked → ready)', async () => {
    const calls = backend((b) => (b.owned_document_ids.includes('rto_accepted_address_proof') ? planRcReady : planRcBlocked))
    renderApp('/planner')
    await choose('Vehicle RC address change')
    for (const d of ['Certificate of registration (RC) of the vehicle', 'Valid vehicle insurance certificate', 'Pollution Under Control (PUC) certificate']) {
      await choose(d)
    }
    await userEvent.click(screen.getByRole('button', { name: 'Generate my plan' }))

    const step = await screen.findByTestId('step-vehicle-rc-address-change')
    expect(step).toHaveAttribute('data-status', 'blocked')
    expect(within(step).getByText('Blocked')).toBeInTheDocument()
    expect(screen.getByText('Get a missing document')).toBeInTheDocument()
    expect(screen.getByText("What's blocking you (1)")).toBeInTheDocument()
    expect(planCalls(calls)[0]).toEqual({
      target_service_ids: ['vehicle-rc-address-change'],
      owned_document_ids: ['puc_certificate', 'rc_existing', 'vehicle_insurance_certificate'],
      completed_service_ids: [],
    })

    // Tick the missing document straight from the step card: the backend is asked again.
    await userEvent.click(within(step).getByRole('button', { name: /I have Proof of new address accepted/ }))
    await waitFor(() => expect(screen.getByTestId('step-vehicle-rc-address-change')).toHaveAttribute('data-status', 'ready'))
    expect(planCalls(calls).at(-1)!.owned_document_ids).toContain('rto_accepted_address_proof')
    expect(screen.getByRole('heading', { name: 'Start: Vehicle RC address change' })).toBeInTheDocument()
    // Selections are preserved across the recalculation.
    expect(screen.getByRole('checkbox', { name: 'Vehicle RC address change' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Valid vehicle insurance certificate' })).toBeChecked()
  })

  it('renders parallel groups, acquisition waits and the next action from the backend', async () => {
    const calls = backend((b) => (b.completed_service_ids.length ? planParallelDone : planParallel))
    renderApp('/planner')
    for (const s of ['Aadhaar address update', 'Driving licence address change', 'Passport reissue for change of address']) await choose(s)
    for (const d of ['Aadhaar number (existing Aadhaar)', 'Existing driving licence', 'Old passport (original)', 'Electricity bill for current address']) await choose(d)
    await userEvent.click(screen.getByRole('button', { name: 'Generate my plan' }))

    expect(await screen.findByText(/2 independent steps/)).toBeInTheDocument()
    const aadhaar = screen.getByTestId('step-aadhaar-address-update')
    const passport = screen.getByTestId('step-passport-reissue-change-of-address')
    const dl = screen.getByTestId('step-driving-licence-address-change')
    expect(aadhaar).toHaveAttribute('data-status', 'ready')
    expect(passport).toHaveAttribute('data-status', 'ready')
    expect(dl).toHaveAttribute('data-status', 'waiting')
    // Independent steps say so; only the DL step names a dependency.
    expect(within(aadhaar).getByText('Does not depend on any other step.')).toBeInTheDocument()
    expect(within(passport).getByText('Does not depend on any other step.')).toBeInTheDocument()
    expect(within(dl).getByText(/Waits for Aadhaar address update \(to get Aadhaar card\/letter showing current address\)/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Start: Aadhaar address update' })).toBeInTheDocument()
    expect(screen.getByText(/completing it unblocks Driving licence address change/)).toBeInTheDocument()

    // Mark the next action done: replans with completed_service_ids.
    await userEvent.click(within(screen.getByLabelText(/Your next step/)).getByRole('button', { name: /Mark as done/ }))
    await waitFor(() => expect(screen.getByTestId('step-driving-licence-address-change')).toHaveAttribute('data-status', 'ready'))
    expect(planCalls(calls).at(-1)!.completed_service_ids).toEqual(['aadhaar-address-update'])
    expect(screen.getByText('✓ Aadhaar address update')).toBeInTheDocument()
  })

  it('switches the whole plan to Hindi, keeping official quotes in English', async () => {
    backend(() => planParallel)
    renderApp('/planner')
    for (const s of ['Aadhaar address update', 'Driving licence address change', 'Passport reissue for change of address']) await choose(s)
    await userEvent.click(screen.getByRole('button', { name: 'Generate my plan' }))
    await screen.findByTestId('step-aadhaar-address-update')
    await userEvent.selectOptions(screen.getByRole('combobox'), 'hi')
    expect(await screen.findByRole('heading', { name: 'शुरू करें: आधार में पता अपडेट' })).toBeInTheDocument()
    expect(screen.getAllByText('शुरू करने के लिए तैयार').length).toBe(2)
    expect(screen.getByText('प्रतीक्षा में', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getAllByText(/आपके पास है: वर्तमान पते का बिजली बिल/).length).toBeGreaterThan(0)
    const dl = screen.getByTestId('step-driving-licence-address-change')
    await userEvent.click(within(dl).getByText(/आधिकारिक स्रोत/))
    expect(within(dl).getAllByText(/“Present Address \(shall be printed on Licence\)”|“1\. Aadhaar Card/).length).toBeGreaterThan(0)
    await i18n.changeLanguage('en')
  })

  it('handles stale selections rejected by the backend', async () => {
    localStorage.setItem(
      'govpath.planner.v1',
      JSON.stringify({ targets: ['vehicle-rc-address-change'], owned: [], completed: [], generated: true }),
    )
    backend(() => json(422, { detail: { code: 'unknown_ids', unknown_service_ids: ['vehicle-rc-address-change'], unknown_document_ids: [] } }))
    renderApp('/planner')
    expect(await screen.findByRole('alert')).toHaveTextContent('Some saved selections are no longer available.')
  })

  it('shows a network error with retry', async () => {
    mockFetch((url) => {
      if (url.endsWith('/api/services')) return services
      if (url.endsWith('/api/documents')) return documents
      throw new TypeError('Failed to fetch')
    })
    renderApp('/planner')
    await choose('Vehicle RC address change')
    await userEvent.click(screen.getByRole('button', { name: 'Generate my plan' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach the GovPath server.')
  })
})
