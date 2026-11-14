import { ApiError } from '../../lib/apiClient'
import type { VaultStatus } from '../../types/api'

export const VAULT_STATUSES: VaultStatus[] = ['valid', 'expired', 'invalid', 'unsure']

export const STATUS_TONE: Record<VaultStatus, string> = {
  valid: 'bg-jade-50 text-jade-800 ring-jade-100',
  expired: 'bg-honey-50 text-honey-700 ring-honey-100',
  invalid: 'bg-crimson-50 text-crimson-700 ring-crimson-100',
  unsure: 'bg-paper-deep text-ink ring-rule-strong',
}

/** i18n key for an account write error (duplicate, identity number, dates, ...). */
export function writeErrorKey(error: unknown): string {
  if (error instanceof ApiError) {
    const detail = error.detail as { code?: string } | Array<{ msg?: string }> | undefined
    if (error.status === 409) return 'vault.errors.duplicate'
    if (Array.isArray(detail) && detail.some((d) => /identity numbers/i.test(d.msg ?? ''))) return 'vault.errors.identityNumber'
    if (Array.isArray(detail) && detail.some((d) => /date/i.test(d.msg ?? ''))) return 'vault.errors.dates'
    if (!Array.isArray(detail) && detail?.code === 'invalid_dates') return 'vault.errors.dates'
    if (error.status === 0) return 'common.networkError'
  }
  return 'vault.errors.generic'
}
