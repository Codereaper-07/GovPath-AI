import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'
import { ActivityPage } from '../features/account/ActivityPage'
import { VaultPage } from '../features/account/VaultPage'
import { AssistantPage } from '../features/assistant/AssistantPage'
import { AuthProvider } from '../features/auth/AuthProvider'
import { LoginPage } from '../features/auth/LoginPage'
import { ProfilePage } from '../features/auth/ProfilePage'
import { RequireAuth } from '../features/auth/RequireAuth'
import { SignupPage } from '../features/auth/SignupPage'
import { DashboardPage } from '../features/dashboard/DashboardPage'
import { DocumentsPage } from '../features/documents/DocumentsPage'
import { PlannerPage } from '../features/planner/PlannerPage'
import { ServiceDetailPage } from '../features/services/ServiceDetailPage'
import { ServicesPage } from '../features/services/ServicesPage'
import { DashboardLayout } from '../layouts/DashboardLayout'
import type { AuthClient } from '../lib/supabase'

/** Renders the app at `path`. `auth` is a fake Supabase auth client (default: sign-in not configured). */
export function renderApp(path: string, auth: AuthClient | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider client={auth}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<DashboardLayout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/services" element={<ServicesPage />} />
            <Route path="/services/:serviceId" element={<ServiceDetailPage />} />
            <Route path="/planner" element={<PlannerPage />} />
            <Route path="/assistant" element={<AssistantPage />} />
            <Route path="/documents" element={<DocumentsPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route
              path="/profile"
              element={
                <RequireAuth>
                  <ProfilePage />
                </RequireAuth>
              }
            />
            <Route
              path="/vault"
              element={
                <RequireAuth>
                  <VaultPage />
                </RequireAuth>
              }
            />
            <Route
              path="/activity"
              element={
                <RequireAuth>
                  <ActivityPage />
                </RequireAuth>
              }
            />
          </Route>
        </Routes>
      </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
}

type Handler = (url: string, init?: RequestInit) => unknown | Response

/** Mock fetch: handler returns a JSON body (200) or a Response. Records every call. */
export function mockFetch(handler: Handler) {
  const calls: { url: string; body: unknown }[] = []
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const out = await handler(url, init)
    if (out instanceof Response) return out
    return new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fn)
  return calls
}

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
