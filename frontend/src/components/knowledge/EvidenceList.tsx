import { useTranslation } from 'react-i18next'
import { useFormatDate } from '../../lib/useLocalized'
import { Icon } from '../ui/Icon'

export interface EvidenceItem {
  id: string
  excerpt: string
  locator: string | null
  source_url: string
  source_title: string | null
  verified_at: string | null
  note?: string | null
}

/** Verbatim quotations from official sources, shown as dated record slips. Never translated. */
export function EvidenceList({ items, compact = false }: { items: EvidenceItem[]; compact?: boolean }) {
  const { t } = useTranslation()
  const formatDate = useFormatDate()
  if (items.length === 0) return null
  return (
    <details className={`group text-sm ${compact ? 'mt-3' : 'mt-4'}`}>
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full px-2 py-1 -ml-2 text-xs font-bold text-jade-700 transition select-none hover:bg-jade-50 [&::-webkit-details-marker]:hidden">
        <Icon name="stamp" className="h-3.5 w-3.5" />
        {t('evidence.toggle', { count: items.length })}
        <span aria-hidden className="transition group-open:rotate-90">›</span>
      </summary>
      <ul className="mt-3 space-y-3">
        {items.map((e) => (
          <li key={e.id} className="relative rounded-xl border border-rule bg-paper/60 py-3 pr-4 pl-5">
            <span className="absolute top-3 bottom-3 left-0 w-[3px] rounded-r bg-jade-500" aria-hidden />
            <blockquote lang="en" className="font-display text-[15px] leading-relaxed text-ink italic">
              “{e.excerpt}”
            </blockquote>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              <a
                href={e.source_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-jade-700 underline decoration-jade-200 underline-offset-2 hover:decoration-jade-700"
              >
                {e.source_title ?? e.source_url}
              </a>
              {e.locator && <span lang="en">{e.locator}</span>}
              {e.verified_at && <span>{t('evidence.verifiedOn', { date: formatDate(e.verified_at) })}</span>}
            </div>
            {e.note && (
              <p lang="en" className="mt-1 text-xs text-muted">
                {t('evidence.note')}: {e.note}
              </p>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-faint">{t('evidence.quotedInEnglish')}</p>
    </details>
  )
}
