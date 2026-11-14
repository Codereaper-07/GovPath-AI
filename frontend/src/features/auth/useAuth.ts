import type { Session } from '@supabase/supabase-js'
import { createContext, useContext } from 'react'

export type AuthStatus = 'unconfigured' | 'loading' | 'signedIn' | 'signedOut'

export interface AuthResult {
  ok: boolean
  /** Supabase Auth error code (e.g. invalid_credentials), 'network' or 'unknown'. */
  error?: string
  /** Sign-up only: the account exists but the email must be confirmed before signing in. */
  needsConfirmation?: boolean
}

interface AuthContextValue {
  status: AuthStatus
  session: Session | null
  /** True after a session ended without the user signing out (expired or revoked). */
  expired: boolean
  signUp(email: string, password: string, fullName: string): Promise<AuthResult>
  signIn(email: string, password: string): Promise<AuthResult>
  signOut(): Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
