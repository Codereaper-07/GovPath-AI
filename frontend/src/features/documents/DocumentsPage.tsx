import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Icon } from '../../components/ui/Icon'
import { PageHeader } from '../../components/ui/PageHeader'
import { ErrorState, LoadingState } from '../../components/ui/States'
import { useDocumentDescription, useLocalized } from '../../lib/useLocalized'
import type { DocumentCategory, DocumentType } from '../../types/api'
import { useDocuments, useServices } from '../services/api'

const ORDER: DocumentCategory[] = ['existing_record', 'address_proof', 'vehicle', 'financial', 'identity', 'other']

export function DocumentsPage() {
  const { t } = useTranslation()
  const pick = useLocalized()
  const describe = useDocumentDescription()
  const documents = useDocuments()
  const services = useServices()
  const [query, setQuery] = useState('')

  if (documents.isPending || services.isPending) return <LoadingState />
  if (documents.isError || services.isError) return <ErrorState message={t('services.loadError')} onRetry={() => void documents.refetch()} />

  const serviceName = (id: string) => {
    const s = services.data.find((x) => x.id === id)
    return s ? pick(s.name, s.name_hi) : id
  }
  const q = query.trim().toLocaleLowerCase()
  const visible = documents.data.filter(
    (d) => !q || [d.name, d.name_hi ?? '', d.description ?? '', describe(d.id, d.description)?.text ?? ''].join(' ').toLocaleLowerCase().includes(q),
  )
  const groups = ORDER.map((cat) => ({ cat, docs: visible.filter((d) => d.category === cat) })).filter((g) => g.docs.length)
  const issuedCount = documents.data.filter((d) => d.issued_by_service_ids.length > 0).length

  return (
    <>
      <PageHeader eyebrow={t('documents.eyebrow')} title={t('documents.title')}>
        {t('documents.intro')}
      </PageHeader>

      <div className="grid gap-10 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-12">
        <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <label className="relative block">
            <span className="sr-only">{t('documents.searchLabel')}</span>
            <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-muted">
              <Icon name="search" className="h-4 w-4" />
            </span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('documents.searchPlaceholder')}
              className="w-full rounded-full border-2 border-rule-strong bg-card py-3 pr-4 pl-10 text-sm placeholder:text-faint focus:border-ink focus:outline-none"
            />
          </label>
          <dl className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-ink p-4 text-paper">
              <dd className="font-display text-3xl font-semibold">{documents.data.length}</dd>
              <dt className="text-xs text-paper/60">{t('home.statDocuments')}</dt>
            </div>
            <div className="rounded-2xl bg-jade-50 p-4 text-jade-800">
              <dd className="font-display text-3xl font-semibold">{issuedCount}</dd>
              <dt className="text-xs">{t('documents.issuedByGovPath')}</dt>
            </div>
          </dl>
          <nav aria-label={t('documents.categories')} className="hidden lg:block">
            <p className="mb-2 px-3 text-xs font-bold tracking-[0.18em] text-muted uppercase">{t('documents.categories')}</p>
            <ul className="space-y-0.5 text-sm">
              {groups.map(({ cat, docs }) => (
                <li key={cat}>
                  <a href={`#doc-${cat}`} className="flex items-center justify-between rounded-2xl px-3 py-2 font-semibold text-ink/80 transition hover:bg-paper-deep hover:text-ink">
                    {t(`documentCategory.${cat}`)} <span className="text-xs font-semibold text-muted tabular-nums">{docs.length}</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="hidden space-y-2 rounded-2xl border border-dashed border-rule-strong p-4 text-xs text-muted lg:block">
            <p className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full border-2 border-ink" aria-hidden />{t('documents.legendAccepted')}</p>
            <p className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-jade-600" aria-hidden />{t('documents.legendIssued')}</p>
          </div>
        </aside>

        <div className="min-w-0 space-y-12">
          {groups.length === 0 && (
            <p className="rounded-3xl border-2 border-dashed border-rule-strong p-10 text-center font-display text-xl text-muted">{t('documents.noMatches')}</p>
          )}
          {groups.map(({ cat, docs }) => (
            <section key={cat} id={`doc-${cat}`} className="scroll-mt-24">
              <h2 className="flex items-baseline gap-3 border-b-2 border-ink pb-3 font-display text-2xl font-semibold tracking-tight text-ink">
                {t(`documentCategory.${cat}`)} <span className="font-sans text-sm font-semibold text-muted">{docs.length}</span>
              </h2>
              <ul className="divide-y divide-rule">
                {docs.map((d) => (
                  <DocumentRow key={d.id} doc={d} serviceName={serviceName} totalServices={services.data.length} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </>
  )
}

function DocumentRow({ doc: d, serviceName, totalServices }: { doc: DocumentType; serviceName: (id: string) => string; totalServices: number }) {
  const { t } = useTranslation()
  const pick = useLocalized()
  const description = useDocumentDescription()(d.id, d.description)
  const uses = d.accepted_by_service_ids.length
  const issued = d.issued_by_service_ids.length > 0
  return (
    <li className="grid gap-5 py-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] md:gap-8">
      <div className="flex min-w-0 gap-4">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${issued ? 'bg-jade-600 text-paper' : 'bg-paper-deep text-ink'}`} aria-hidden>
          <Icon name="doc" />
        </span>
        <div className="min-w-0">
          <p className="font-bold text-ink">{pick(d.name, d.name_hi)}</p>
          {description && <p lang={description.lang} className="mt-0.5 text-sm text-muted">{description.text}</p>}
          {uses > 0 && (
            <div className="mt-3 flex items-center gap-2">
              <span className="flex gap-0.5" aria-hidden>
                {Array.from({ length: totalServices }, (_, i) => (
                  <span key={i} className={`h-1.5 w-3 rounded-full ${i < uses ? 'bg-ink' : 'bg-rule'}`} />
                ))}
              </span>
              <span className="text-xs font-bold text-ink">{t('documents.usefulFor', { count: uses })}</span>
            </div>
          )}
        </div>
      </div>
      {(uses > 0 || issued) && (
        <div className="relative space-y-3 md:border-l-2 md:border-dashed md:border-rule md:pl-8">
          <span aria-hidden className="absolute top-5 -left-[7px] hidden h-3 w-3 rounded-full bg-paper ring-2 ring-rule-strong md:block" />
          {issued && <Relation label={t('documents.issuedBy')} ids={d.issued_by_service_ids} serviceName={serviceName} issued />}
          {uses > 0 && <Relation label={t('documents.acceptedBy')} ids={d.accepted_by_service_ids} serviceName={serviceName} />}
        </div>
      )}
    </li>
  )
}

function Relation({ label, ids, serviceName, issued = false }: { label: string; ids: string[]; serviceName: (id: string) => string; issued?: boolean }) {
  return (
    <div>
      <p className={`text-xs font-bold tracking-[0.12em] uppercase ${issued ? 'text-jade-700' : 'text-muted'}`}>{label}</p>
      <ul className="mt-1.5 flex flex-wrap gap-1.5">
        {ids.map((id) => (
          <li key={id}>
            <Link
              to={`/services/${id}`}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition ${
                issued ? 'bg-jade-600 text-paper hover:bg-jade-700' : 'bg-card text-ink ring-1 ring-ink/25 hover:ring-ink'
              }`}
            >
              {serviceName(id)}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
