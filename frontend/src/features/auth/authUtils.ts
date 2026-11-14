export const INPUT_CLASS =
  'w-full rounded-2xl border border-rule-strong bg-paper px-3.5 py-2.5 text-sm text-ink placeholder:text-faint focus:border-ink focus:outline-none disabled:opacity-60'

const KNOWN_ERRORS = new Set([
  'invalid_credentials',
  'email_not_confirmed',
  'user_already_exists',
  'weak_password',
  'email_address_invalid',
  'over_email_send_rate_limit',
  'over_request_rate_limit',
  'signup_disabled',
  'network',
  'unconfigured',
])

/** i18n key for a Supabase Auth error code (unknown codes get a generic message). */
export function authErrorKey(code: string | undefined): string {
  return `auth.errors.${code && KNOWN_ERRORS.has(code) ? code : 'unknown'}`
}

/** Where to go after signing in: the protected page that sent the user here, else the profile. */
export function returnPath(state: unknown): string {
  const from = (state as { from?: unknown } | null)?.from
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') && !from.startsWith('/login') ? from : '/profile'
}

export const MIN_PASSWORD = 8
