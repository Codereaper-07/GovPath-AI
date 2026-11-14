import { useTranslation } from 'react-i18next'

export function EmptyState({ message }: { message: string }) {
  const { t } = useTranslation()
  return (
    <div className="rounded-2xl border border-dashed border-rule-strong p-10 text-center text-muted">
      <p>{message}</p>
      <p className="mt-2 text-xs tracking-wide text-faint uppercase">{t('comingSoon')}</p>
    </div>
  )
}
