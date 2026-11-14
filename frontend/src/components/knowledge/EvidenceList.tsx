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
      <summary className="cursor-pointer select-none text-brand-700 hover:underline">
        {t('evidence.toggle', { count: items.length })}
      </summary>
      <ul className={`mt-2 space-y-3 ${compact ? '' : 'border-l-2 border-slate-200 pl-3'}`}>
        {items.map((e) => (
          <li key={e.id}>
            <blockquote lang="en" className="text-slate-700 italic">
              “{e.excerpt}”
            </blockquote>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              <a
                href={e.source_url}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-brand-700 underline"
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
