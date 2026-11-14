import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { EvidenceList } from '../../components/knowledge/EvidenceList'
import { Pill, VerificationBadge } from '../../components/ui/Badge'
import { buttonClass } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { ErrorState, LoadingState } from '../../components/ui/States'
import { ApiError } from '../../lib/apiClient'
import { useFormatDate, useLocalized } from '../../lib/useLocalized'
import type { Requirement, RequirementType, ServiceDetail } from '../../types/api'
import { useService } from './api'

const GROUPS: RequirementType[] = ['mandatory', 'optional', 'conditional']

export function ServiceDetailPage() {
  const { serviceId = '' } = useParams()
  const { t } = useTranslation()
  const service = useService(serviceId)

  if (service.isPending) return <LoadingState />
  if (service.isError) {
    const notFound = service.error instanceof ApiError && service.error.status === 404
    return (
      <div className="space-y-4">
        <BackLink />
        <ErrorState
          message={notFound ? t('serviceDetail.notFound') : t('services.loadError')}
          onRetry={notFound ? undefined : () => void service.refetch()}
        />
      </div>
    )
  }
  return <ServiceDetailView service={service.data} />
}

function BackLink() {
  const { t } = useTranslation()
  return (
    <Link to="/services" className="text-sm text-brand-700 hover:underline">
      ← {t('serviceDetail.back')}
    </Link>
  )
}

const GROUP_STYLE: Record<RequirementType, { dot: string; edge: string }> = {
  mandatory: { dot: 'bg-brand-700', edge: 'border-l-brand-700' },
  optional: { dot: 'bg-slate-400', edge: 'border-l-slate-300' },
  conditional: { dot: 'bg-accent-500', edge: 'border-l-accent-500' },
}

function ServiceDetailView({ service: s }: { service: ServiceDetail }) {
  const { t } = useTranslation()
  const pick = useLocalized()
  const formatDate = useFormatDate()

  return (
    <div className="space-y-8">
      <BackLink />
      <header className="border-b border-line pb-8">
        <div className="flex flex-wrap gap-2">
          {s.life_events.map((e) => (
            <Link key={e} to={`/services?event=${e}`} className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-800 ring-1 ring-brand-100 ring-inset hover:bg-brand-100">
              <Icon name={e} className="h-3.5 w-3.5" /> {t(`lifeEvents.${e}.name`)}
            </Link>
          ))}
          <Pill>{t(`jurisdiction.${s.jurisdiction}`)}{s.state ? ` · ${s.state}` : ''}</Pill>
          {s.application_form && <Pill tone="blue">{s.application_form}</Pill>}
        </div>
        <h1 className="mt-4 max-w-3xl font-display text-3xl leading-tight font-semibold tracking-tight text-slate-900 sm:text-4xl">{pick(s.name, s.name_hi)}</h1>
        <p className="mt-3 max-w-3xl text-lg text-slate-600">{pick(s.description, s.description_hi)}</p>
        <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <div>
            <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{t('services.authority')}</dt>
            <dd lang="en" className="mt-0.5 text-slate-800">{s.authority}</dd>
          </div>
          {s.last_verified_at && (
            <div>
              <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{t('serviceDetail.lastVerified')}</dt>
              <dd className="mt-0.5 flex items-center gap-1.5 text-slate-800"><Icon name="shield" className="h-4 w-4 text-verified" />{formatDate(s.last_verified_at)}</dd>
            </div>
          )}
        </dl>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-10">
          {GROUPS.map((group) => {
            const reqs = s.requirements.filter((r) => r.requirement_type === group)
            if (reqs.length === 0) return null
            return (
              <section key={group}>
                <div className="flex items-center gap-2.5">
                  <span className={`h-2.5 w-2.5 rounded-full ${GROUP_STYLE[group].dot}`} aria-hidden />
                  <h2 className="font-display text-xl font-semibold text-slate-900">{t(`serviceDetail.group.${group}`)}</h2>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{reqs.length}</span>
                </div>
                <p className="mt-1 mb-4 text-sm text-slate-500">{t(`serviceDetail.groupHint.${group}`)}</p>
                <div className="space-y-4">
                  {reqs.map((r) => (
                    <RequirementCard key={r.id} requirement={r} />
                  ))}
                </div>
              </section>
            )
          })}
        </div>

        <aside className="space-y-5 lg:sticky lg:top-6 lg:self-start">
          <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <div className="flex flex-col gap-2">
              {s.application_url && (
                <a href={s.application_url} target="_blank" rel="noreferrer" className={buttonClass('primary', 'md', 'w-full')}>
                  {t('serviceDetail.apply')} ↗
                </a>
              )}
              <Link to={`/planner?service=${s.id}`} className={buttonClass('secondary', 'md', 'w-full')}>
                <Icon name="plan" className="h-4 w-4" /> {t('serviceDetail.planThis')}
              </Link>
              <a href={s.official_info_url} target="_blank" rel="noreferrer" className={buttonClass('ghost', 'md', 'w-full')}>
                {t('services.officialSite')} ↗
              </a>
            </div>
          </section>

          <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <h2 className="text-sm font-semibold text-slate-900">{t('serviceDetail.outputs')}</h2>
            <ul className="mt-2 space-y-1.5 text-sm text-slate-700">
              {s.outputs.map((o) => (
                <li key={o.document_id} className="flex gap-2"><Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-verified" />{pick(o.document_name, o.document_name_hi)}</li>
              ))}
            </ul>
            <h2 className="mt-5 text-sm font-semibold text-slate-900">{t('serviceDetail.prerequisites')}</h2>
            {s.prerequisites.length === 0 ? (
              <p className="mt-1 text-sm text-slate-600">{t('serviceDetail.noPrerequisites')}</p>
            ) : (
              <ul className="mt-2 space-y-2 text-sm">
                {s.prerequisites.map((p) => (
                  <li key={p.service_id}>
                    <Link to={`/services/${p.service_id}`} className="text-brand-700 underline">
                      {pick(p.service_name, p.service_name_hi)}
                    </Link>{' '}
                    <VerificationBadge status={p.verification_status} />
                    <EvidenceList items={[{ ...p.evidence }]} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {(s.verification_notes || s.evidence.length > 0) && (
            <section className="rounded-2xl border border-line bg-canvas p-5 text-sm">
              <h2 className="font-semibold text-slate-900">{t('serviceDetail.aboutData')}</h2>
              {s.verification_notes && (
                <p lang="en" className="mt-2 leading-relaxed text-slate-600">
                  {s.verification_notes}
                </p>
              )}
              <EvidenceList items={s.evidence} />
            </section>
          )}
        </aside>
      </div>
    </div>
  )
}

function RequirementCard({ requirement: r }: { requirement: Requirement }) {
  const { t } = useTranslation()
  const pick = useLocalized()
  const verified = r.verification_status === 'verified'
  const evidence = [...r.evidence, ...r.options.flatMap((o) => (o.evidence ? [o.evidence] : []))]
  const unique = [...new Map(evidence.map((e) => [e.id, e])).values()]

  return (
    <article
      className={`rounded-xl border border-l-4 bg-surface p-5 shadow-card ${GROUP_STYLE[r.requirement_type].edge} ${verified ? 'border-line' : 'border-dashed border-amber-300'}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-base font-semibold text-slate-900">{pick(r.name, r.name_hi)}</h3>
        <VerificationBadge status={r.verification_status} />
      </div>
      {!verified && <p className="mt-1 text-xs text-amber-700">{t('serviceDetail.unverifiedWarning')}</p>}
      {r.condition && (
        <p className="mt-1 text-sm text-slate-600">
          <span className="font-medium">{t('serviceDetail.onlyIf')}:</span> <span lang="en">{r.condition}</span>
        </p>
      )}
      {r.is_alternative_group && (
        <p className="mt-2 text-sm font-medium text-slate-700">{t('serviceDetail.anyOne')}</p>
      )}
      <ul className={`mt-3 grid gap-2 text-sm ${r.is_alternative_group ? 'sm:grid-cols-2' : ''}`}>
        {r.options.map((o) => (
          <li key={o.document_id} className="rounded-lg border border-line bg-canvas px-3 py-2.5">
            <span className="text-slate-800">{pick(o.document_name, o.document_name_hi)}</span>
            {o.notes && (
              <span lang="en" className="block text-xs text-slate-500">
                {o.notes}
              </span>
            )}
          </li>
        ))}
      </ul>
      {r.notes && (
        <p lang="en" className="mt-2 text-xs text-slate-500">
          {r.notes}
        </p>
      )}
      <EvidenceList items={unique} />
    </article>
  )
}
