import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { VerificationStatus } from '../../types/api'

const TONES = {
  green: 'bg-green-50 text-green-800 ring-green-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  red: 'bg-red-50 text-red-800 ring-red-200',
  blue: 'bg-brand-50 text-brand-800 ring-brand-100',
  slate: 'bg-slate-50 text-slate-700 ring-line',
  violet: 'bg-violet-50 text-ai ring-violet-200',
} as const

export type Tone = keyof typeof TONES

export function Pill({ tone = 'slate', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}
    >
      {children}
    </span>
  )
}

/** Marks content that comes from the verified knowledge base (official sources). */
export function VerifiedBadge() {
  const { t } = useTranslation()
  return <Pill tone="green">✓ {t('badge.verified')}</Pill>
}

/** Verification status of a fact. Anything other than "verified" is shown as a warning. */
export function VerificationBadge({ status }: { status: VerificationStatus }) {
  const { t } = useTranslation()
  if (status === 'verified') return <VerifiedBadge />
  return <Pill tone={status === 'rejected' ? 'red' : 'amber'}>⚠ {t(`verification.${status}`)}</Pill>
}

/** Marks AI-generated explanations. Never use on verified facts or deterministic plan output. */
export function AIBadge() {
  const { t } = useTranslation()
  return <Pill tone="violet">✦ {t('badge.ai')}</Pill>
}
