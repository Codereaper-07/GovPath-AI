// Plan display names are built in the current language at the presentation layer; names the
// citizen typed are never changed; old generated names are rebuilt from the plan's services.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { usePlanName } from '../features/account/planName'
import i18n from '../i18n/config'
import services from './fixtures/services.json'
import { mockFetch } from './utils'

const RC = 'vehicle-rc-address-change'
const AADHAAR = 'aadhaar-address-update'
const svc = (id: string) => services.find((s) => s.id === id)!

function setup() {
  mockFetch((url) => (url.endsWith('/api/services') ? services : []))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return renderHook(() => usePlanName(), { wrapper })
}

describe('plan display names', () => {
  it('follow the language, track the current services and keep typed names', async () => {
    const { result, rerender } = setup()
    await waitFor(() => expect(result.current.isGenerated(`${svc(AADHAAR).name}, ${svc(RC).name}`)).toBe(true))
    // A stale generated name ("Aadhaar…, RC…") on a plan that now has only RC shows only RC.
    const stale = { title: `${svc(AADHAAR).name}, ${svc(RC).name}`, target_service_ids: [RC] }
    expect(result.current.name(stale)).toBe(svc(RC).name)
    const untitled = { title: null, target_service_ids: [AADHAAR, RC] }
    const typed = { title: "Mum's move", target_service_ids: [RC] }
    const prefixed = { title: `Move — ${svc(RC).name}`, target_service_ids: [RC] }
    const situation = { title: null, target_service_ids: [RC], goals: ['update-address'] }
    expect(result.current.name(untitled)).toBe(`${svc(AADHAAR).name}, ${svc(RC).name}`)
    expect(result.current.name(typed)).toBe("Mum's move")
    expect(result.current.isGenerated(typed.title)).toBe(false)

    await act(() => i18n.changeLanguage('hi'))
    rerender()
    expect(result.current.name(stale)).toBe(svc(RC).name_hi)
    expect(result.current.name(untitled)).toBe(`${svc(AADHAAR).name_hi}, ${svc(RC).name_hi}`)
    expect(result.current.name(typed)).toBe("Mum's move") // never translated
    expect(result.current.name(prefixed)).toBe(`Move — ${svc(RC).name_hi}`)
    expect(result.current.name(situation)).toBe('घर बदलने के बाद पता अपडेट करना')
    expect(result.current.name({ title: 'Update my address after moving', target_service_ids: [RC] })).toBe('घर बदलने के बाद पता अपडेट करना')
  })
})
