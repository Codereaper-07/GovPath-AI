import { Fragment, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AIBadge, Pill, type Tone } from '../../components/ui/Badge'
import type { AssistantAnswer, Citation, EvidenceStatus } from '../../types/api'

const STATUS_TONE: Record<EvidenceStatus, Tone> = {
  sufficient: 'green',
  partial: 'amber',
  insufficient: 'amber',
  conflicting: 'red',
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
            className="mx-0.5 align-super text-xs font-semibold text-brand-700 hover:underline"
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

  return (
    <article
      data-testid="assistant-answer"
      className={`rounded-xl border bg-white p-5 shadow-sm ${insufficient ? 'border-amber-300' : 'border-slate-200'}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {a.generated_by === 'ai' && <AIBadge />}
        <Pill tone={STATUS_TONE[a.evidence_status]}>{t(`assistant.status.${a.evidence_status}`)}</Pill>
      </div>

      <div lang={a.language} className="mt-3 space-y-2 text-slate-800">
        {a.answer
          .split(/\n+/)
          .filter(Boolean)
          .map((para, i) => (
            <p key={i}>{withCitationLinks(para, prefix, known)}</p>
          ))}
      </div>

      {a.workflow && (
        <div className="mt-4 rounded-lg border border-brand-100 bg-brand-50 p-3 text-sm">
          <p className="font-medium text-slate-800">{t('assistant.planContext')}</p>
          <p className="text-slate-700">
            {a.workflow.next_action.service_id
              ? t('assistant.planNext', { service: serviceName(a.workflow.next_action.service_id) })
              : t(`assistant.planType.${a.workflow.next_action.type}`)}
          </p>
          <p className="mt-1 text-xs text-slate-500">{t('planner.deterministicNote')}</p>
        </div>
      )}

      {a.citations.length > 0 && (
        <section className="mt-4 border-t border-slate-100 pt-3">
          <h3 className="text-sm font-semibold text-slate-900">{t('assistant.sources')}</h3>
          <ol className="mt-2 space-y-2">
            {a.citations.map((c) => (
              <CitationItem key={c.id} c={c} anchor={`${prefix}-${c.id}`} />
            ))}
          </ol>
        </section>
      )}

      {a.generated_by === 'ai' && <p className="mt-4 text-xs text-slate-500">{t('assistant.disclaimer')}</p>}
    </article>
  )
}

function CitationItem({ c, anchor }: { c: Citation; anchor: string }) {
  const { t } = useTranslation()
  const where = [
    c.page_start ? t('assistant.page', { page: c.page_start }) : null,
    c.section,
    c.locator,
  ].filter(Boolean)
  return (
    <li id={anchor} className="rounded-lg bg-slate-50 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-semibold text-brand-700">[{c.id}]</span>
        <a href={c.source_url} target="_blank" rel="noreferrer" className="font-medium text-brand-700 underline">
          {c.source_title ?? c.source_url}
        </a>
        <Pill tone={c.kind === 'verified_fact' ? 'green' : 'slate'}>
          {t(c.kind === 'verified_fact' ? 'assistant.kindFact' : 'assistant.kindExcerpt')}
        </Pill>
        {!c.source_verified && <Pill tone="amber">⚠ {t('verification.unverified')}</Pill>}
      </div>
      {where.length > 0 && (
        <p lang="en" className="mt-1 text-xs text-slate-500">
          {where.join(' · ')}
        </p>
      )}
      <details className="mt-1">
        <summary className="cursor-pointer text-xs text-brand-700 select-none hover:underline">
          {t('assistant.showExcerpt')}
        </summary>
        <blockquote lang="en" className="mt-1 border-l-2 border-slate-300 pl-3 whitespace-pre-line text-slate-700 italic">
          {c.excerpt}
        </blockquote>
      </details>
    </li>
  )
}
