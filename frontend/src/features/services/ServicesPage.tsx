import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { Pill, VerifiedBadge } from '../../components/ui/Badge'
import { Icon } from '../../components/ui/Icon'
import { PageHeader } from '../../components/ui/PageHeader'
import { ErrorState, LoadingState } from '../../components/ui/States'
import { useFormatDate, useLocalized } from '../../lib/useLocalized'
import { countByLifeEvent, isLifeEvent, LIFE_EVENTS } from '../../lib/lifeEvents'
import type { LifeEventId, ServiceSummary } from '../../types/api'
import { useServices } from './api'

export function ServicesPage() {
  const { t } = useTranslation()
  const pick = useLocalized()
  const services = useServices()
  const [params, setParams] = useSearchParams()
  const eventParam = params.get('event')
  const event = isLifeEvent(eventParam) ? eventParam : null
  const query = params.get('q') ?? ''

  const update = (next: { event?: LifeEventId | null; q?: string }) => {
    const p = new URLSearchParams(params)
    if ('event' in next) {
      if (next.event) p.set('event', next.event)
      else p.delete('event')
    }
    if ('q' in next) {
      if (next.q) p.set('q', next.q)
      else p.delete('q')
    }
    setParams(p, { replace: true })
  }

  if (services.isPending) return <LoadingState />
  if (services.isError) return <ErrorState message={t('services.loadError')} onRetry={() => void services.refetch()} />

  const counts = countByLifeEvent(services.data)
  const q = query.trim().toLocaleLowerCase()
  const visible = services.data.filter(
    (s) =>
      (!event || s.life_events.includes(event)) &&
      (!q ||
        [s.name, s.name_hi ?? '', s.description, s.description_hi ?? '', s.authority, pick(s.name, s.name_hi)]
          .join(' ')
          .toLocaleLowerCase()
          .includes(q)),
  )

  return (
    <>
      <PageHeader title={t('services.title')}>{t('services.intro')}</PageHeader>
      <div className="mb-5 space-y-3">
        <label className="relative block">
          <span className="sr-only">{t('services.searchLabel')}</span>
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400"><Icon name="search" /></span>
          <input
            type="search"
            value={query}
            onChange={(e) => update({ q: e.target.value })}
            placeholder={t('services.searchPlaceholder')}
            className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pr-3 pl-10 text-sm shadow-sm focus:border-brand-600 focus:ring-2 focus:ring-brand-100 focus:outline-none"
          />
        </label>
        <div role="group" aria-label={t('services.filterLabel')} className="flex flex-wrap gap-2">
          <FilterChip active={!event} onClick={() => update({ event: null })}>
            {t('services.allEvents')} <span className="text-xs opacity-70">{services.data.length}</span>
          </FilterChip>
          {LIFE_EVENTS.map((e) => (
            <FilterChip key={e} active={event === e} onClick={() => update({ event: e })}>
              <Icon name={e} className="h-4 w-4" /> {t(`lifeEvents.${e}.name`)} <span className="text-xs opacity-70">{counts[e]}</span>
            </FilterChip>
          ))}
        </div>
      </div>

      {event && <p className="mb-4 text-sm text-slate-600">{t(`lifeEvents.${event}.description`)}</p>}

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="font-medium text-slate-800">
            {event && counts[event] === 0 ? t('services.noVerifiedInEvent') : t('services.noMatches')}
          </p>
          <p className="mt-1 text-sm text-slate-500">{t('services.coverageNote')}</p>
          <button type="button" onClick={() => update({ event: null, q: '' })} className="mt-3 text-sm font-semibold text-brand-700 hover:underline">
            {t('services.clearFilters')}
          </button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {visible.map((s) => (
            <ServiceCard key={s.id} service={s} />
          ))}
        </div>
      )}
    </>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition ${
        active ? 'bg-brand-600 text-white shadow-sm' : 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
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
        <Pill>{t(`jurisdiction.${s.jurisdiction}`)}{s.state ? ` · ${s.state}` : ''}</Pill>
        {s.application_form && <Pill tone="blue">{s.application_form}</Pill>}
      </div>
      <h2 className="mt-3 text-lg font-semibold text-slate-900">
        <Link to={`/services/${s.id}`} className="hover:text-brand-700 hover:underline">
          {pick(s.name, s.name_hi)}
        </Link>
      </h2>
      <p className="mt-1 text-sm text-slate-600">{pick(s.description, s.description_hi)}</p>
      <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={t('services.lifeEventsLabel')}>
        {s.life_events.map((e) => (
          <li key={e} className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
            <Icon name={e} className="h-3.5 w-3.5" /> {t(`lifeEvents.${e}.name`)}
          </li>
        ))}
      </ul>
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
