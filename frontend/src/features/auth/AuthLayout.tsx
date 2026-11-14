import { type InputHTMLAttributes, type ReactNode, useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from '../../components/ui/Icon'
import { INPUT_CLASS } from './authUtils'

/** Centred card shared by the sign-in and sign-up pages. */
export function AuthCard({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="mx-auto grid max-w-4xl animate-rise gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="ink-panel relative hidden overflow-hidden rounded-[2rem] p-8 md:block">
        <span aria-hidden className="absolute -right-16 -bottom-16 h-56 w-56 rounded-full border-[26px] border-zest-400/10" />
        <p className="flex items-center gap-2 text-xs font-bold tracking-[0.18em] text-zest-400 uppercase">
          <Icon name="shield" className="h-4 w-4" /> {t('auth.asideEyebrow')}
        </p>
        <p className="relative mt-4 font-display text-2xl leading-snug font-semibold text-paper">{t('auth.asideTitle')}</p>
        <p className="relative mt-4 text-sm leading-relaxed text-paper/70">{t('auth.asideBody')}</p>
      </aside>
      <section className="rounded-[2rem] border border-rule bg-card p-6 shadow-soft sm:p-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">{intro}</p>
        <div className="mt-6">{children}</div>
      </section>
    </div>
  )
}

export function Field({ label, hint, ...input }: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const hintId = useId()
  return (
    <div>
      <label className="block">
        <span className="mb-1.5 block text-xs font-bold tracking-[0.14em] text-muted uppercase">{label}</span>
        <input {...input} aria-describedby={hint ? hintId : undefined} className={INPUT_CLASS} />
      </label>
      {hint && (
        <p id={hintId} aria-live="polite" className="mt-1 text-xs text-faint">
          {hint}
        </p>
      )}
    </div>
  )
}

export function Notice({ tone, children }: { tone: 'error' | 'info' | 'success'; children: ReactNode }) {
  const styles = {
    error: 'border-crimson-100 bg-crimson-50 text-crimson-700',
    info: 'border-honey-100 bg-honey-50 text-ink',
    success: 'border-jade-100 bg-jade-50 text-jade-800',
  }[tone]
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} className={`rounded-2xl border px-4 py-3 text-sm leading-relaxed ${styles}`}>
      {children}
    </p>
  )
}
