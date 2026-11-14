import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { EvidenceList } from '../../components/knowledge/EvidenceList'
import { Pill, VerificationBadge } from '../../components/ui/Badge'
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

function ServiceDetailView({ service: s }: { service: ServiceDetail }) {
  const { t } = useTranslation()
  const pick = useLocalized()
  const formatDate = useFormatDate()

  return (
    <div className="space-y-6">
      <BackLink />
      <header className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap gap-2">
          {s.life_events.map((e) => (
            <Link key={e} to={`/services?event=${e}`} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-brand-100 ring-inset hover:bg-brand-100">
              <Icon name={e} className="h-3.5 w-3.5" /> {t(`lifeEvents.${e}.name`)}
            </Link>
          ))}
          <Pill>{t(`jurisdiction.${s.jurisdiction}`)}{s.state ? ` · ${s.state}` : ''}</Pill>
          {s.application_form && <Pill tone="blue">{s.application_form}</Pill>}
        </div>
        <h1 className="mt-3 text-2xl font-semibold text-slate-900">{pick(s.name, s.name_hi)}</h1>
        <p className="mt-2 text-slate-600">{pick(s.description, s.description_hi)}</p>
        <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">{t('services.authority')}</dt>
            <dd lang="en">{s.authority}</dd>
          </div>
          {s.last_verified_at && (
            <div>
              <dt className="text-slate-500">{t('serviceDetail.lastVerified')}</dt>
              <dd>{formatDate(s.last_verified_at)}</dd>
            </div>
          )}
        </dl>
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          {s.application_url && (
            <a
              href={s.application_url}
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-700"
            >
              {t('serviceDetail.apply')} ↗
            </a>
          )}
          <a
            href={s.official_info_url}
            target="_blank"
            rel="noreferrer"
            className="rounded-md px-3 py-1.5 font-medium text-brand-700 ring-1 ring-brand-100 hover:bg-brand-50"
          >
            {t('services.officialSite')} ↗
          </a>
          <Link
            to={`/planner?service=${s.id}`}
            className="rounded-md px-3 py-1.5 font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
          >
            {t('serviceDetail.planThis')}
          </Link>
        </div>
      </header>

      {GROUPS.map((group) => {
        const reqs = s.requirements.filter((r) => r.requirement_type === group)
        if (reqs.length === 0) return null
        return (
          <section key={group}>
            <h2 className="text-lg font-semibold text-slate-900">{t(`serviceDetail.group.${group}`)}</h2>
            <p className="mb-3 text-sm text-slate-500">{t(`serviceDetail.groupHint.${group}`)}</p>
            <div className="space-y-3">
              {reqs.map((r) => (
                <RequirementCard key={r.id} requirement={r} />
              ))}
            </div>
          </section>
        )
      })}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-slate-900">{t('serviceDetail.outputs')}</h2>
        <ul className="mt-2 list-disc pl-5 text-sm text-slate-700">
          {s.outputs.map((o) => (
            <li key={o.document_id}>{pick(o.document_name, o.document_name_hi)}</li>
          ))}
        </ul>
        <h2 className="mt-4 font-semibold text-slate-900">{t('serviceDetail.prerequisites')}</h2>
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
        <section className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm">
          <h2 className="font-semibold text-slate-900">{t('serviceDetail.aboutData')}</h2>
          {s.verification_notes && (
            <p lang="en" className="mt-2 text-slate-600">
              {s.verification_notes}
            </p>
          )}
          <EvidenceList items={s.evidence} />
        </section>
      )}
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
      className={`rounded-xl border bg-white p-4 shadow-sm ${verified ? 'border-slate-200' : 'border-amber-300 border-dashed'}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-medium text-slate-900">{pick(r.name, r.name_hi)}</h3>
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
      <ul className={`mt-2 grid gap-1.5 text-sm ${r.is_alternative_group ? 'sm:grid-cols-2' : ''}`}>
        {r.options.map((o) => (
          <li key={o.document_id} className="rounded-md bg-slate-50 px-3 py-2">
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
