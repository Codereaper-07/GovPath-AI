import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Pill, VerifiedBadge } from '../../components/ui/Badge'
import { PageHeader } from '../../components/ui/PageHeader'
import { ErrorState, LoadingState } from '../../components/ui/States'
import { useFormatDate, useLocalized } from '../../lib/useLocalized'
import type { ServiceSummary } from '../../types/api'
import { useServices } from './api'

export function ServicesPage() {
  const { t } = useTranslation()
  const services = useServices()

  return (
    <>
      <PageHeader title={t('services.title')}>{t('services.intro')}</PageHeader>
      {services.isPending ? (
        <LoadingState />
      ) : services.isError ? (
        <ErrorState message={t('services.loadError')} onRetry={() => void services.refetch()} />
      ) : services.data.length === 0 ? (
        <p className="text-slate-600">{t('services.empty')}</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {services.data.map((s) => (
            <ServiceCard key={s.id} service={s} />
          ))}
        </div>
      )}
    </>
  )
}

function ServiceCard({ service: s }: { service: ServiceSummary }) {
  const { t } = useTranslation()
  const pick = useLocalized()
  const formatDate = useFormatDate()
  const fullyVerified = s.requirement_count > 0 && s.verified_requirement_count === s.requirement_count

  return (
    <article className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        {fullyVerified ? (
          <VerifiedBadge />
        ) : (
          <Pill tone="amber">
            ⚠ {t('services.partlyVerified', { verified: s.verified_requirement_count, total: s.requirement_count })}
          </Pill>
        )}
        <Pill>{t(`jurisdiction.${s.jurisdiction}`)}</Pill>
        {s.application_form && <Pill tone="blue">{s.application_form}</Pill>}
      </div>
      <h2 className="mt-3 text-lg font-semibold text-slate-900">
        <Link to={`/services/${s.id}`} className="hover:text-brand-700 hover:underline">
          {pick(s.name, s.name_hi)}
        </Link>
      </h2>
      <p className="mt-1 text-sm text-slate-600">{pick(s.description, s.description_hi)}</p>
      <dl className="mt-3 space-y-1 text-sm">
        <div>
          <dt className="inline text-slate-500">{t('services.authority')}: </dt>
          <dd className="inline text-slate-800" lang="en">
            {s.authority}
          </dd>
        </div>
        {s.last_verified_at && (
          <div className="text-xs text-slate-500">
            {t('services.lastVerified', { date: formatDate(s.last_verified_at) })}
          </div>
        )}
      </dl>
      <div className="mt-auto flex flex-wrap gap-3 pt-4 text-sm">
        <Link
          to={`/services/${s.id}`}
          className="rounded-md bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-700"
        >
          {t('services.viewRequirements')}
        </Link>
        <a
          href={s.official_info_url}
          target="_blank"
          rel="noreferrer"
          className="rounded-md px-3 py-1.5 font-medium text-brand-700 ring-1 ring-brand-100 hover:bg-brand-50"
        >
          {t('services.officialSite')} ↗
        </a>
      </div>
    </article>
  )
}
