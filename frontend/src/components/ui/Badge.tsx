import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { VerificationStatus } from '../../types/api'
import { Icon } from './Icon'

const TONES = {
  green: 'text-jade-700',
  amber: 'text-honey-700',
  red: 'text-crimson-600',
  ink: 'text-ink',
  slate: 'text-muted',
  violet: 'text-lilac-700',
} as const

export type Tone = keyof typeof TONES

/** Quiet inline label: coloured text with an optional mark, no pill background. */
export function Pill({ tone = 'slate', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 text-xs font-semibold ${TONES[tone]}`}>{children}</span>
}

/** Marks content that comes from the verified knowledge base (official sources). */
export function VerifiedBadge() {
  const { t } = useTranslation()
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-jade-700">
      <Icon name="shield" className="h-4 w-4" /> {t('badge.verified')}
    </span>
  )
}

/** Verification status of a fact. Anything other than "verified" is shown as a warning. */
export function VerificationBadge({ status }: { status: VerificationStatus }) {
  const { t } = useTranslation()
  if (status === 'verified') return <VerifiedBadge />
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold ${status === 'rejected' ? 'bg-crimson-50 text-crimson-700' : 'bg-honey-50 text-honey-700'}`}>
      ⚠ {t(`verification.${status}`)}
    </span>
  )
}

/** Marks AI-generated explanations. Never use on verified facts or deterministic plan output. */
export function AIBadge() {
  const { t } = useTranslation()
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-lilac-50 px-2.5 py-1 text-xs font-semibold text-lilac-700 ring-1 ring-lilac-100 ring-inset">
      ✦ {t('badge.ai')}
    </span>
  )
}
