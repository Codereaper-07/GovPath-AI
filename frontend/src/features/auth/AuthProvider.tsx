import type { Session } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { setAuthBridge } from '../../lib/apiClient'
import type { AuthClient } from '../../lib/supabase'
import { AuthContext, type AuthResult, type AuthStatus } from './useAuth'

function errorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return 'unknown'
  const e = error as { code?: unknown; status?: unknown; name?: unknown }
  if (typeof e.code === 'string' && e.code) return e.code
  if (e.name === 'AuthRetryableFetchError' || e.status === 0) return 'network'
  return 'unknown'
}

/**
 * Authenticated application state. With no client (sign-in not configured) the status is
 * 'unconfigured' and every public page works exactly as before. Signing in or out never reads,
 * writes or clears the device-local planner data.
 */
export function AuthProvider({ client, children }: { client: AuthClient | null; children: ReactNode }) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [expired, setExpired] = useState(false)
  const userInitiatedSignOut = useRef(false)
  const hadSession = useRef(false)

  useEffect(() => {
    if (!client) return
    let active = true
    const apply = (next: Session | null) => {
      if (!active) return
      if (next) hadSession.current = true
      setSession(next)
      setReady(true)
    }
    void client.getSession().then(({ data }) => apply(data.session), () => apply(null))
    const { data } = client.onAuthStateChange((event, next) => {
      if (event === 'SIGNED_OUT') {
        // Ended without the user asking (refresh token expired/revoked, or rejected by the API).
        if (hadSession.current && !userInitiatedSignOut.current) setExpired(true)
        userInitiatedSignOut.current = false
        hadSession.current = false
        queryClient.removeQueries({ queryKey: ['profile'] })
      }
      if (event === 'SIGNED_IN') setExpired(false)
      apply(next)
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [client, queryClient])

  useEffect(() => {
    if (!client) return
    return setAuthBridge({
      getAccessToken: async () => (await client.getSession()).data.session?.access_token ?? null,
      refresh: async () => {
        try {
          return (await client.refreshSession()).data.session?.access_token ?? null
        } catch {
          return null
        }
      },
      onUnauthorized: () => {
        setExpired(true)
        void client.signOut({ scope: 'local' })
      },
    })
  }, [client])

  const signUp = useCallback(
    async (email: string, password: string, fullName: string): Promise<AuthResult> => {
      if (!client) return { ok: false, error: 'unconfigured' }
      try {
        const { data, error } = await client.signUp({
          email,
          password,
          options: { data: { full_name: fullName }, emailRedirectTo: `${window.location.origin}/profile` },
        })
        if (error) return { ok: false, error: errorCode(error) }
        return { ok: true, needsConfirmation: !data.session }
      } catch (err) {
        return { ok: false, error: errorCode(err) }
      }
    },
    [client],
  )

  const signIn = useCallback(
    async (email: string, password: string): Promise<AuthResult> => {
      if (!client) return { ok: false, error: 'unconfigured' }
      try {
        const { error } = await client.signInWithPassword({ email, password })
        if (error) return { ok: false, error: errorCode(error) }
        setExpired(false)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: errorCode(err) }
      }
    },
    [client],
  )

  const signOut = useCallback(async () => {
    if (!client) return
    userInitiatedSignOut.current = true
    setExpired(false)
    try {
      await client.signOut()
    } catch {
      await client.signOut({ scope: 'local' }).catch(() => undefined)
    }
    queryClient.removeQueries({ queryKey: ['profile'] })
  }, [client, queryClient])

  const status: AuthStatus = !client ? 'unconfigured' : !ready ? 'loading' : session ? 'signedIn' : 'signedOut'
  const value = useMemo(() => ({ status, session, expired, signUp, signIn, signOut }), [status, session, expired, signUp, signIn, signOut])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
