import type { Session } from '@supabase/supabase-js'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import i18n from '../i18n/config'
import type { AuthClient } from '../lib/supabase'
import type { Profile } from '../types/api'
import { json, mockFetch, renderApp } from './utils'

// ---- fake Supabase auth client (no network) ------------------------------------------------

type Listener = (event: string, session: Session | null) => void

interface FakeOptions {
  /** A session already persisted by supabase-js (simulates a page refresh). */
  stored?: Session | null
  /** Sign-up returns no session until the email is confirmed. */
  confirmEmail?: boolean
  /** What refreshSession() yields after a 401 ('fail' = refresh token rejected). */
  refresh?: 'ok' | 'fail'
}

const ACCOUNTS: Record<string, { password: string; id: string }> = {
  'asha@example.com': { password: 'correct-horse', id: 'user-a' },
  'bala@example.com': { password: 'battery-staple', id: 'user-b' },
}

const sessionFor = (id: string, token = `token-${id}`) => ({ access_token: token, refresh_token: 'r', user: { id } }) as unknown as Session

function fakeAuth(opts: FakeOptions = {}) {
  let session: Session | null = opts.stored ?? null
  const listeners = new Set<Listener>()
  const emit = (event: string) => listeners.forEach((l) => l(event, session))
  const calls = { signUp: [] as unknown[], signOut: [] as unknown[], refresh: 0 }
  const client = {
    getSession: async () => ({ data: { session }, error: null }),
    onAuthStateChange: (cb: Listener) => {
      listeners.add(cb)
      queueMicrotask(() => cb('INITIAL_SESSION', session))
      return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } }
    },
    signUp: async (args: { email: string; password: string; options?: unknown }) => {
      calls.signUp.push(args)
      if (ACCOUNTS[args.email]) return { data: { user: null, session: null }, error: { code: 'user_already_exists' } }
      if (opts.confirmEmail) return { data: { user: { id: 'new' }, session: null }, error: null }
      session = sessionFor('new-user')
      emit('SIGNED_IN')
      return { data: { user: session.user, session }, error: null }
    },
    signInWithPassword: async ({ email, password }: { email: string; password: string }) => {
      const account = ACCOUNTS[email]
      if (!account || account.password !== password) {
        return { data: { user: null, session: null }, error: { code: 'invalid_credentials', status: 400 } }
      }
      session = sessionFor(account.id)
      emit('SIGNED_IN')
      return { data: { user: session.user, session }, error: null }
    },
    signOut: async (args?: unknown) => {
      calls.signOut.push(args ?? null)
      session = null
      emit('SIGNED_OUT')
      return { error: null }
    },
    refreshSession: async () => {
      calls.refresh += 1
      if (opts.refresh === 'ok' && session) {
        session = sessionFor(session.user.id, `fresh-${session.user.id}`)
        emit('TOKEN_REFRESHED')
        return { data: { session, user: session.user }, error: null }
      }
      return { data: { session: null, user: null }, error: { code: 'refresh_token_not_found' } }
    },
  }
  return { client: client as unknown as AuthClient, calls }
}

// ---- backend fake ---------------------------------------------------------------------------

const baseProfile = (id: string, overrides: Partial<Profile> = {}): Profile => ({
  user_id: id,
  email: `${id}@example.com`,
  full_name: id === 'user-a' ? 'Asha Verma' : null,
  state: null,
  city: null,
  preferred_language: 'en',
  created_at: '2026-11-14T10:00:00Z',
  updated_at: '2026-11-14T10:00:00Z',
  ...overrides,
})

interface Seen {
  url: string
  method: string
  auth: string | null
  body: unknown
}

/** Backend fake: identifies the user ONLY from the bearer token, like the real API. */
function backend({ rejectToken }: { rejectToken?: (token: string) => boolean } = {}) {
  const seen: Seen[] = []
  const profiles = new Map<string, Profile>()
  mockFetch((url, init) => {
    const headers = new Headers(init?.headers)
    const auth = headers.get('Authorization')
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    seen.push({ url, method: init?.method ?? 'GET', auth, body })
    if (url.endsWith('/api/workflows/vocabulary')) return { goals: [], life_events: [], states: ['Delhi', 'Kerala', 'Maharashtra'] }
    if (url.endsWith('/api/me/profile')) {
      const token = auth?.replace(/^Bearer /, '')
      if (!token || rejectToken?.(token)) return json(401, { detail: { code: 'token_expired' } })
      const id = token.replace(/^(token|fresh)-/, '')
      const current = profiles.get(id) ?? baseProfile(id)
      if (init?.method === 'PATCH') {
        const next = { ...current, ...(body as Partial<Profile>), updated_at: new Date().toISOString() }
        profiles.set(id, next)
        return next
      }
      profiles.set(id, current)
      return current
    }
    if (url.includes('/api/')) return []
    return json(404, {})
  })
  return { seen, profiles }
}

const PLAN_KEY = 'govpath.planner.v1'
const LOCAL_PLAN = JSON.stringify({ version: 2, targets: ['aadhaar-name-update', 'passport-reissue'], owned: ['aadhaar'], completed: [] })

async function signInVia(user: ReturnType<typeof userEvent.setup>, email: string, password: string) {
  await user.type(await screen.findByLabelText('Email'), email)
  await user.type(screen.getByLabelText('Password'), password)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

// ---- tests ----------------------------------------------------------------------------------

describe('authentication', () => {
  it('without sign-in configured, public pages work and account pages explain why', async () => {
    backend()
    renderApp('/profile', null)
    expect(await screen.findByText('Accounts are not available')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument()
  })

  it('protects /profile: signed-out visitors are sent to sign in, then returned', async () => {
    const { seen } = backend()
    const { client } = fakeAuth()
    const user = userEvent.setup()
    renderApp('/profile', client)
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(seen.some((s) => s.url.endsWith('/api/me/profile'))).toBe(false)

    await signInVia(user, 'asha@example.com', 'correct-horse')
    expect(await screen.findByRole('heading', { name: 'Your profile' })).toBeInTheDocument()
    expect(await screen.findByDisplayValue('Asha Verma')).toBeInTheDocument()
    const call = seen.find((s) => s.url.endsWith('/api/me/profile'))!
    expect(call.auth).toBe('Bearer token-user-a')
  })

  it('shows a clear error for wrong credentials and stays on the sign-in page', async () => {
    backend()
    const { client } = fakeAuth()
    const user = userEvent.setup()
    renderApp('/login', client)
    await signInVia(user, 'asha@example.com', 'wrong-password')
    expect(await screen.findByRole('alert')).toHaveTextContent('The email or password is not correct.')
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('sign-up sends the name as metadata and asks to confirm the email when required', async () => {
    backend()
    const { client, calls } = fakeAuth({ confirmEmail: true })
    const user = userEvent.setup()
    renderApp('/signup', client)
    await user.type(await screen.findByLabelText('Full name'), 'Chitra Rao')
    await user.type(screen.getByLabelText('Email'), 'chitra@example.com')
    const submit = screen.getByRole('button', { name: 'Create account' })
    await user.type(screen.getByLabelText('Password'), 'short')
    expect(submit).toBeDisabled()
    expect(screen.getByText('Too short: use at least 8 characters.')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Password'), '-but-now-long')
    await user.click(submit)
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument()
    expect(calls.signUp[0]).toMatchObject({
      email: 'chitra@example.com',
      password: 'short-but-now-long',
      options: { data: { full_name: 'Chitra Rao' }, emailRedirectTo: `${window.location.origin}/profile` },
    })
  })

  it('sign-up without email confirmation signs in and opens the profile', async () => {
    backend()
    const { client } = fakeAuth()
    const user = userEvent.setup()
    renderApp('/signup', client)
    await user.type(await screen.findByLabelText('Email'), 'new@example.com')
    await user.type(screen.getByLabelText('Password'), 'long-enough-1')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByRole('heading', { name: 'Your profile' })).toBeInTheDocument()
  })

  it('sign-up reports an existing account', async () => {
    backend()
    const { client } = fakeAuth()
    const user = userEvent.setup()
    renderApp('/signup', client)
    await user.type(await screen.findByLabelText('Email'), 'asha@example.com')
    await user.type(screen.getByLabelText('Password'), 'long-enough-1')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('An account with this email already exists.')
  })

  it('restores a persisted session after a refresh (no sign-in needed)', async () => {
    backend()
    const { client } = fakeAuth({ stored: sessionFor('user-a') })
    renderApp('/profile', client)
    expect(await screen.findByDisplayValue('Asha Verma')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Account' })).toHaveAttribute('href', '/profile')
  })

  it('signing out returns home, shows "Sign in" and keeps the local plan untouched', async () => {
    localStorage.setItem(PLAN_KEY, LOCAL_PLAN)
    backend()
    const { client, calls } = fakeAuth({ stored: sessionFor('user-a') })
    const user = userEvent.setup()
    renderApp('/profile', client)
    await screen.findByDisplayValue('Asha Verma')
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeInTheDocument()
    expect(calls.signOut).toHaveLength(1)
    expect(screen.queryByRole('heading', { name: 'Your profile' })).not.toBeInTheDocument()
    expect(localStorage.getItem(PLAN_KEY)).toBe(LOCAL_PLAN)
  })

  it('an expired session the API rejects ends locally with a clear message', async () => {
    backend({ rejectToken: () => true })
    const { client, calls } = fakeAuth({ stored: sessionFor('user-a'), refresh: 'fail' })
    renderApp('/profile', client)
    expect(await screen.findByText('Your session has ended. Please sign in again.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(calls.refresh).toBe(1)
    expect(calls.signOut).toEqual([{ scope: 'local' }])
  })

  it('a 401 is retried once with a refreshed token', async () => {
    const { seen } = backend({ rejectToken: (t) => t.startsWith('token-') })
    const { client, calls } = fakeAuth({ stored: sessionFor('user-a'), refresh: 'ok' })
    renderApp('/profile', client)
    expect(await screen.findByDisplayValue('Asha Verma')).toBeInTheDocument()
    expect(calls.refresh).toBe(1)
    expect(seen.filter((s) => s.url.endsWith('/api/me/profile')).map((s) => s.auth)).toEqual(['Bearer token-user-a', 'Bearer fresh-user-a'])
  })

  it('public API calls never carry the access token', async () => {
    const { seen } = backend()
    const { client } = fakeAuth({ stored: sessionFor('user-a') })
    renderApp('/profile', client)
    await screen.findByDisplayValue('Asha Verma')
    const publicCalls = seen.filter((s) => !s.url.endsWith('/api/me/profile'))
    expect(publicCalls.length).toBeGreaterThan(0)
    expect(publicCalls.every((s) => s.auth === null)).toBe(true)
  })
})

describe('profile', () => {
  it('updates the profile without ever sending a user id, and applies the language', async () => {
    const { seen } = backend()
    const { client } = fakeAuth({ stored: sessionFor('user-a') })
    const user = userEvent.setup()
    renderApp('/profile', client)
    const name = await screen.findByDisplayValue('Asha Verma')
    const save = screen.getByRole('button', { name: 'Save changes' })
    expect(save).toBeDisabled() // nothing changed yet

    await user.clear(name)
    await user.type(name, 'Asha V.')
    await user.selectOptions(screen.getByLabelText('State or union territory'), 'Kerala')
    await user.type(screen.getByLabelText('City or district'), '  Kochi ')
    await user.selectOptions(screen.getByLabelText('Preferred language'), 'hi')
    await user.click(save)

    expect(await screen.findByText('आपकी प्रोफ़ाइल सहेज ली गई है।')).toBeInTheDocument()
    expect(i18n.resolvedLanguage).toBe('hi')
    const patch = seen.find((s) => s.method === 'PATCH')!
    expect(patch.auth).toBe('Bearer token-user-a')
    expect(patch.body).toEqual({ full_name: 'Asha V.', state: 'Kerala', city: 'Kochi', preferred_language: 'hi' })
    expect(JSON.stringify(patch.body)).not.toMatch(/user_id|"id"/)
  })

  it('clearing a field sends null', async () => {
    const { seen } = backend()
    const { client } = fakeAuth({ stored: sessionFor('user-a') })
    const user = userEvent.setup()
    renderApp('/profile', client)
    await user.clear(await screen.findByDisplayValue('Asha Verma'))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await screen.findByText('Your profile has been saved.')
    expect(seen.find((s) => s.method === 'PATCH')!.body).toMatchObject({ full_name: null })
  })

  it('switching accounts never shows the previous user’s profile', async () => {
    backend()
    const { client } = fakeAuth({ stored: sessionFor('user-a') })
    const user = userEvent.setup()
    renderApp('/profile', client)
    await screen.findByDisplayValue('Asha Verma')
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    await user.click(await screen.findByRole('link', { name: 'Sign in' }))
    await signInVia(user, 'bala@example.com', 'battery-staple')
    await user.click(await screen.findByRole('link', { name: 'Account' }))
    const name = await screen.findByLabelText('Full name')
    await waitFor(() => expect(name).toHaveValue(''))
    expect(screen.queryByDisplayValue('Asha Verma')).not.toBeInTheDocument()
  })

  it('reports the plan saved on this device without modifying it', async () => {
    localStorage.setItem(PLAN_KEY, LOCAL_PLAN)
    backend()
    const { client } = fakeAuth({ stored: sessionFor('user-a') })
    renderApp('/profile', client)
    const note = (await screen.findByText('Your plan on this device')).closest('aside')!
    expect(within(note).getByText(/Your workflow plan \(2 services\) is saved in this browser only/)).toBeInTheDocument()
    expect(localStorage.getItem(PLAN_KEY)).toBe(LOCAL_PLAN)
  })
})
