const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000').replace(/\/$/, '')

export class ApiError extends Error {
  readonly status: number
  /** Parsed `detail` from a FastAPI error response, when present. */
  readonly detail: unknown
  constructor(status: number, message: string, detail?: unknown) {
    super(message)
    this.status = status
    this.detail = detail
  }
}

/** Supplies access tokens for signed-in requests (registered by AuthProvider). */
export interface AuthBridge {
  /** A current access token (refreshed by supabase-js when close to expiry), or null. */
  getAccessToken(): Promise<string | null>
  /** Force a refresh after a 401; null when the session can no longer be refreshed. */
  refresh(): Promise<string | null>
  /** The session is gone or rejected: sign out locally and tell the user. */
  onUnauthorized(): void
}

let authBridge: AuthBridge | null = null

export function setAuthBridge(bridge: AuthBridge | null): () => void {
  authBridge = bridge
  return () => {
    if (authBridge === bridge) authBridge = null
  }
}

const NOT_SIGNED_IN = { code: 'missing_token', message: 'Sign in to continue.' }

/**
 * Request as the signed-in user (Authorization: Bearer). On 401 the token is refreshed once and
 * the request retried; if that fails too, the session is ended locally. Public endpoints keep
 * using apiGet/apiPost and never send a token.
 */
export async function apiAuthed<T>(path: string, init: RequestInit = {}): Promise<T> {
  const bridge = authBridge
  if (!bridge) throw new ApiError(401, `${init.method ?? 'GET'} ${path}: not signed in`, NOT_SIGNED_IN)
  const send = (token: string) =>
    request<T>(path, {
      method: 'GET',
      ...init,
      headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers, Authorization: `Bearer ${token}` },
    })
  const token = await bridge.getAccessToken()
  if (!token) {
    bridge.onUnauthorized()
    throw new ApiError(401, `${init.method ?? 'GET'} ${path}: not signed in`, NOT_SIGNED_IN)
  }
  try {
    return await send(token)
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401) throw err
    const fresh = await bridge.refresh()
    if (!fresh) {
      bridge.onUnauthorized()
      throw err
    }
    try {
      return await send(fresh)
    } catch (retryErr) {
      if (retryErr instanceof ApiError && retryErr.status === 401) bridge.onUnauthorized()
      throw retryErr
    }
  }
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  return request<T>(path, { ...init, method: 'GET' })
}

export async function apiPost<T>(path: string, body: unknown, init?: RequestInit): Promise<T> {
  return request<T>(path, {
    ...init,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    body: JSON.stringify(body),
  })
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, init)
  } catch {
    throw new ApiError(0, `${init.method} ${path}: network error`)
  }
  if (!res.ok) {
    let detail: unknown
    try {
      detail = ((await res.json()) as { detail?: unknown }).detail
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, `${init.method} ${path} failed with ${res.status}`, detail)
  }
  return (await res.json()) as T
}
