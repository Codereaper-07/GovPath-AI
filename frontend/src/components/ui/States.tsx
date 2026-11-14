import { useTranslation } from 'react-i18next'
import { Icon } from './Icon'

export function LoadingState({ label }: { label?: string }) {
  const { t } = useTranslation()
  return (
    <div role="status" className="flex items-center gap-3 py-16 text-muted">
      <span className="flex gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-2 w-2 animate-dots rounded-full bg-jade-500" style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
      </span>
      {label ?? t('common.loading')}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  const { t } = useTranslation()
  return (
    <div role="alert" className="flex items-start gap-4 rounded-2xl border border-crimson-100 bg-crimson-50 p-5 text-sm text-crimson-700">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-card text-crimson-600 ring-1 ring-crimson-100">
        <Icon name="alert" className="h-4 w-4" />
      </span>
      <div>
        <p className="font-semibold">{message ?? t('common.error')}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 rounded-full bg-card px-4 py-1.5 font-semibold text-crimson-700 ring-1 ring-crimson-200 transition hover:bg-crimson-100"
          >
            {t('common.retry')}
          </button>
        )}
      </div>
    </div>
  )
}
