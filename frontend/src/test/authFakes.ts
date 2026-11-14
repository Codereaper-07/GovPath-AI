import type { Session } from '@supabase/supabase-js'
import type { AuthClient } from '../lib/supabase'

// ---- fake Supabase auth client (no network) ------------------------------------------------

type Listener = (event: string, session: Session | null) => void

export interface FakeOptions {
  /** A session already persisted by supabase-js (simulates a page refresh). */
  stored?: Session | null
  /** Sign-up returns no session until the email is confirmed. */
  confirmEmail?: boolean
  /** What refreshSession() yields after a 401 ('fail' = refresh token rejected). */
  refresh?: 'ok' | 'fail'
}

export const ACCOUNTS: Record<string, { password: string; id: string }> = {
  'asha@example.com': { password: 'correct-horse', id: 'user-a' },
  'bala@example.com': { password: 'battery-staple', id: 'user-b' },
}

export const sessionFor = (id: string, token = `token-${id}`) => ({ access_token: token, refresh_token: 'r', user: { id } }) as unknown as Session

export function fakeAuth(opts: FakeOptions = {}) {
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
