import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Supabase client for **authentication only** (email sign-up/sign-in, session refresh).
 * Uses the project's public publishable (anon) key; never the service-role key. All data goes
 * through the FastAPI backend, which verifies the access token. Returns null when sign-in is not
 * configured, so the rest of the app keeps working without accounts.
 *
 * Sessions are persisted by supabase-js in localStorage under its own `sb-<ref>-auth-token` key;
 * the planner's `govpath.planner.v1` is never touched.
 */
export type AuthClient = Pick<
  SupabaseClient['auth'],
  'getSession' | 'onAuthStateChange' | 'signUp' | 'signInWithPassword' | 'signOut' | 'refreshSession'
>

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined

export const supabaseAuth: AuthClient | null =
  url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }).auth : null
