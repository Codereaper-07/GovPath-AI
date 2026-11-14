import { useTranslation } from 'react-i18next'
import { useFormatDate } from '../../lib/useLocalized'

export interface EvidenceItem {
  id: string
  excerpt: string
  locator: string | null
  source_url: string
  source_title: string | null
  verified_at: string | null
  note?: string | null
}

/** Verbatim quotations from official sources. Quotes are never translated. */
export function EvidenceList({ items, compact = false }: { items: EvidenceItem[]; compact?: boolean }) {
  const { t } = useTranslation()
  const formatDate = useFormatDate()
  if (items.length === 0) return null
  return (
    <details className="group mt-2 text-sm">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold text-brand-700 select-none hover:text-brand-800 [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="transition group-open:rotate-90">›</span>
        {t('evidence.toggle', { count: items.length })}
      </summary>
      <ul className={`mt-3 space-y-3 ${compact ? '' : ''}`}>
        {items.map((e) => (
          <li key={e.id}>
            <blockquote lang="en" className="rounded-lg border-l-2 border-brand-300 bg-brand-50/50 px-3 py-2 font-display text-[15px] leading-relaxed text-slate-800">
              “{e.excerpt}”
            </blockquote>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              <a
                href={e.source_url}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-brand-700 underline decoration-brand-200 underline-offset-2 hover:decoration-brand-700"
              >
                {e.source_title ?? e.source_url}
              </a>
              {e.locator && <span lang="en">{e.locator}</span>}
              {e.verified_at && <span>{t('evidence.verifiedOn', { date: formatDate(e.verified_at) })}</span>}
            </div>
            {e.note && (
              <p lang="en" className="mt-1 text-xs text-slate-500">
                {t('evidence.note')}: {e.note}
              </p>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-slate-400">{t('evidence.quotedInEnglish')}</p>
    </details>
  )
}
