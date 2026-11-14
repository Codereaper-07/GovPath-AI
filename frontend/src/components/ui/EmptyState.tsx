import { useTranslation } from 'react-i18next'

export function EmptyState({ message }: { message: string }) {
  const { t } = useTranslation()
  return (
    <div className="rounded-2xl border border-dashed border-line bg-surface p-10 text-center text-slate-600">
      <p>{message}</p>
      <p className="mt-2 text-xs uppercase tracking-wide text-slate-400">{t('comingSoon')}</p>
    </div>
  )
}
