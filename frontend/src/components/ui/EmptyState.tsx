import { useTranslation } from 'react-i18next'

export function EmptyState({ message }: { message: string }) {
  const { t } = useTranslation()
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-slate-600">
      <p>{message}</p>
      <p className="mt-2 text-xs uppercase tracking-wide text-slate-400">{t('comingSoon')}</p>
    </div>
  )
}
