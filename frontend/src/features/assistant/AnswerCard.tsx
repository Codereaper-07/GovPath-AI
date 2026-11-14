import { Fragment, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AIBadge } from '../../components/ui/Badge'
import { Icon } from '../../components/ui/Icon'
import type { AssistantAnswer, Citation, EvidenceStatus } from '../../types/api'

const STATUS_STYLE: Record<EvidenceStatus, { cls: string; icon: 'shield' | 'alert' }> = {
  sufficient: { cls: 'text-jade-700', icon: 'shield' },
  partial: { cls: 'text-honey-700', icon: 'alert' },
  insufficient: { cls: 'text-honey-700', icon: 'alert' },
  conflicting: { cls: 'text-crimson-600', icon: 'alert' },
}

/**
 * Turns citation markers into links to the matching citation below the answer.
 * Accepts single ("[S1]") and combined ("[K1, S3]") markers; ids that were not cited are
 * dropped (the server already validates and normalises markers; this is defence in depth).
 */
function withCitationLinks(text: string, prefix: string, known: Set<string>): ReactNode[] {
  return text.split(/(\[\s*[SK]\d+(?:\s*[,;]\s*[SK]\d+)*\s*\])/g).map((part, i) => {
    if (!/^\[\s*[SK]\d+/.test(part)) return <Fragment key={i}>{part}</Fragment>
    const ids = [...new Set(part.match(/[SK]\d+/g) ?? [])].filter((id) => known.has(id))
    return (
      <Fragment key={i}>
        {ids.map((id) => (
          <a
            key={id}
            href={`#${prefix}-${id}`}
            className={`mx-0.5 rounded-md px-1 py-px align-[0.15em] font-mono text-[11px] font-bold no-underline transition ${id.startsWith('K') ? 'bg-jade-100 text-jade-800 hover:bg-jade-200' : 'bg-paper-deep text-ink hover:bg-rule'}`}
          >
            [{id}]
          </a>
        ))}
      </Fragment>
    )
  })
}

export function AnswerCard({
  answer: a,
  prefix,
  serviceName,
}: {
  answer: AssistantAnswer
  prefix: string
  serviceName: (id: string) => string
}) {
  const { t } = useTranslation()
  const known = new Set(a.citations.map((c) => c.id))
  const insufficient = a.evidence_status === 'insufficient'

  const status = STATUS_STYLE[a.evidence_status]

  return (
    <article
      data-testid="assistant-answer"
      className={`overflow-hidden rounded-[1.5rem] rounded-tl-md bg-card ring-1 ${insufficient ? 'ring-2 ring-honey-500/50' : 'ring-rule'}`}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 pt-5 sm:px-6">
        {a.generated_by === 'ai' && <AIBadge />}
        <span className={`inline-flex items-center gap-1.5 text-xs font-bold ${status.cls}`}>
          <Icon name={status.icon} className="h-4 w-4" />
          <span>{t(`assistant.status.${a.evidence_status}`)}</span>
        </span>
      </div>

      <div
        lang={a.language}
        className={`mx-5 mt-4 space-y-3 text-[15.5px] leading-relaxed text-ink sm:mx-6 ${a.generated_by === 'ai' ? 'border-l-[3px] border-lilac-300 pl-4' : ''}`}
      >
        {a.answer
          .split(/\n+/)
          .filter(Boolean)
          .map((para, i) => (
            <p key={i}>{withCitationLinks(para, prefix, known)}</p>
          ))}
      </div>

      {a.workflow && (
        <div className="mx-5 mt-5 flex gap-3 rounded-2xl bg-zest-100 p-4 text-sm ring-1 ring-zest-300 sm:mx-6">
          <Icon name="plan" className="mt-0.5 h-4 w-4 shrink-0 text-ink" />
          <div>
            <p className="font-bold text-ink">{t('assistant.planContext')}</p>
            <p className="text-ink/85">
              {a.workflow.next_action.service_id
                ? t('assistant.planNext', { service: serviceName(a.workflow.next_action.service_id) })
                : t(`assistant.planType.${a.workflow.next_action.type}`)}
            </p>
            <p className="mt-1 text-xs text-muted">{t('planner.deterministicNote')}</p>
          </div>
        </div>
      )}

      {a.citations.length > 0 && (
        <section className="mt-6 border-t border-rule bg-paper/60 px-5 py-5 sm:px-6">
          <h3 className="flex items-center gap-2 text-xs font-bold tracking-[0.16em] text-muted uppercase">
            <Icon name="stamp" className="h-4 w-4" />
            <span>{t('assistant.sources')}</span>
          </h3>
          <ol className="mt-3 space-y-2.5">
            {a.citations.map((c) => (
              <CitationItem key={c.id} c={c} anchor={`${prefix}-${c.id}`} />
            ))}
          </ol>
        </section>
      )}

      {a.generated_by === 'ai' && <p className={`px-5 pb-5 text-xs leading-relaxed text-muted sm:px-6 ${a.citations.length ? 'bg-paper/60' : 'mt-5'}`}>{t('assistant.disclaimer')}</p>}
      {a.generated_by !== 'ai' && <div className="h-5" />}
    </article>
  )
}

function CitationItem({ c, anchor }: { c: Citation; anchor: string }) {
  const { t } = useTranslation()
  const fact = c.kind === 'verified_fact'
  const where = [c.page_start ? t('assistant.page', { page: c.page_start }) : null, c.section, c.locator].filter(Boolean)
  return (
    <li
      id={anchor}
      className={`scroll-mt-28 rounded-2xl p-4 text-sm transition target:ring-2 target:ring-zest-400 ${fact ? 'bg-jade-50 ring-1 ring-jade-100' : 'bg-card ring-1 ring-rule'}`}
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <span className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] font-bold text-paper ${fact ? 'bg-jade-600' : 'bg-ink'}`}>{c.id}</span>
        <span className={`text-xs font-bold ${fact ? 'text-jade-700' : 'text-muted'}`}>
          {t(fact ? 'assistant.kindFact' : 'assistant.kindExcerpt')}
        </span>
        {!c.source_verified && <span className="text-xs font-bold text-honey-700">⚠ {t('verification.unverified')}</span>}
      </div>
      <a href={c.source_url} target="_blank" rel="noreferrer" className="mt-2 inline-block font-semibold text-ink underline decoration-rule-strong underline-offset-2 hover:decoration-ink">
        {c.source_title ?? c.source_url}
      </a>
      {where.length > 0 && (
        <p lang="en" className="mt-0.5 text-xs text-muted">
          {where.join(' · ')}
        </p>
      )}
      <details className="group mt-2">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-bold text-jade-700 select-none hover:underline [&::-webkit-details-marker]:hidden">
          <span aria-hidden className="transition group-open:rotate-90">›</span>
          {t('assistant.showExcerpt')}
        </summary>
        <blockquote lang="en" className="mt-2 border-l-[3px] border-jade-500 pl-3 font-display whitespace-pre-line text-ink/85 italic">
          {c.excerpt}
        </blockquote>
      </details>
    </li>
  )
}
