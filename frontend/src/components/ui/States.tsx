import { useTranslation } from 'react-i18next'

export function LoadingState({ label }: { label?: string }) {
  const { t } = useTranslation()
  return (
    <div role="status" className="flex items-center gap-3 py-12 text-slate-500">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-brand-100 border-t-brand-700" />
      {label ?? t('common.loading')}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  const { t } = useTranslation()
  return (
    <div role="alert" className="flex flex-col items-start gap-1 rounded-xl border border-red-200 bg-red-50/70 p-5 text-sm text-red-800">
      <p className="font-medium">{message ?? t('common.error')}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-md bg-white px-3 py-1.5 font-medium text-red-700 ring-1 ring-red-200 hover:bg-red-100"
        >
          {t('common.retry')}
        </button>
      )}
    </div>
  )
}
