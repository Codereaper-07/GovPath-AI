import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { Pill, VerifiedBadge } from '../../components/ui/Badge'
import { buttonClass } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { PageHeader } from '../../components/ui/PageHeader'
import { Seal } from '../../components/ui/Seal'
import { ErrorState, LoadingState } from '../../components/ui/States'
import { countByLifeEvent, EVENT_TONE, isLifeEvent, LIFE_EVENTS } from '../../lib/lifeEvents'
import { useFormatDate, useLocalized } from '../../lib/useLocalized'
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
  // Browsing everything: group by each service's primary life event (each service appears once).
  const groups: { key: LifeEventId | 'all'; items: ServiceSummary[] }[] =
    event || q
      ? [{ key: event ?? 'all', items: visible }]
      : LIFE_EVENTS.map((e) => ({ key: e, items: visible.filter((s) => s.life_events[0] === e) })).filter((g) => g.items.length)

  return (
    <>
      <PageHeader eyebrow={t('services.eyebrow')} title={t('services.title')}>
        {t('services.intro')}
      </PageHeader>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-12">
        <aside className="space-y-5 lg:sticky lg:top-24 lg:self-start">
          <label className="relative block">
            <span className="sr-only">{t('services.searchLabel')}</span>
            <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-muted">
              <Icon name="search" className="h-4 w-4" />
            </span>
            <input
              type="search"
              value={query}
              onChange={(e) => update({ q: e.target.value })}
              placeholder={t('services.searchPlaceholder')}
              className="w-full rounded-full border-2 border-rule-strong bg-card py-3 pr-4 pl-10 text-sm text-ink placeholder:text-faint focus:border-ink focus:outline-none"
            />
          </label>
          <div>
            <p className="mb-2 hidden px-1 text-xs font-bold tracking-[0.18em] text-muted uppercase lg:block">{t('services.filterLabel')}</p>
            <div role="group" aria-label={t('services.filterLabel')} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0">
              <FilterItem active={!event} onClick={() => update({ event: null })} count={services.data.length}>
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-paper-deep text-ink" aria-hidden>
                  <Icon name="layers" className="h-4 w-4" />
                </span>
                {t('services.allEvents')}
              </FilterItem>
              {LIFE_EVENTS.map((e) => (
                <FilterItem key={e} active={event === e} onClick={() => update({ event: e })} count={counts[e]}>
                  <Seal event={e} size="sm" muted={counts[e] === 0} />
                  {t(`lifeEvents.${e}.name`)}
                </FilterItem>
              ))}
            </div>
          </div>
        </aside>

        <div className="min-w-0">
          {event && <EventBanner event={event} count={counts[event]} />}

          {visible.length === 0 ? (
            <div className="flex animate-rise flex-col items-center rounded-3xl border-2 border-dashed border-rule-strong px-6 py-14 text-center">
              {event ? <Seal event={event} size="lg" muted /> : <Icon name="search" className="h-10 w-10 text-faint" />}
              <p className="mt-5 max-w-md font-display text-2xl font-semibold text-ink">
                {event && counts[event] === 0 ? t('services.noVerifiedInEvent') : t('services.noMatches')}
              </p>
              <p className="mt-2 max-w-md text-sm text-muted">{t('services.coverageNote')}</p>
              <button type="button" onClick={() => update({ event: null, q: '' })} className={buttonClass('primary', 'md', 'mt-6')}>
                {t('services.clearFilters')}
              </button>
            </div>
          ) : (
            <div className="space-y-12">
              {groups.map((g) => (
                <section key={g.key} aria-label={g.key === 'all' ? undefined : t(`lifeEvents.${g.key}.name`)}>
                  {!event && g.key !== 'all' && (
                    <div className="mb-4 flex items-center gap-3">
                      <span className={`h-2.5 w-2.5 rounded-full ${EVENT_TONE[g.key].solid}`} aria-hidden />
                      <p className="font-display text-xl font-semibold text-ink">{t(`lifeEvents.${g.key}.name`)}</p>
                      <span className="h-px flex-1 bg-rule" aria-hidden />
                    </div>
                  )}
                  <div className="space-y-3">
                    {g.items.map((s, i) => (
                      <ServiceRow key={s.id} service={s} index={i} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function FilterItem({ active, onClick, count, children }: { active: boolean; onClick: () => void; count: number; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex shrink-0 items-center gap-2.5 rounded-full py-1.5 pr-3.5 pl-1.5 text-left text-sm font-semibold whitespace-nowrap transition lg:w-full lg:rounded-2xl lg:whitespace-normal ${
        active ? 'bg-ink text-paper shadow-soft' : 'bg-card text-ink ring-1 ring-rule ring-inset hover:ring-ink lg:bg-transparent lg:ring-0 lg:hover:bg-paper-deep'
      }`}
    >
      {children}
      <span className={`ml-auto pl-2 text-xs tabular-nums ${active ? 'text-zest-400' : count === 0 ? 'text-clay-700' : 'text-muted'}`}>{count}</span>
    </button>
  )
}

function EventBanner({ event, count }: { event: LifeEventId; count: number }) {
  const { t } = useTranslation()
  const tone = EVENT_TONE[event]
  return (
    <div className={`relative mb-8 flex animate-rise items-center gap-5 overflow-hidden rounded-3xl p-6 sm:p-8 ${count === 0 ? 'bg-paper-deep' : tone.bg}`}>
      <span className={`absolute -right-8 -bottom-12 h-44 w-44 rounded-full border-[22px] border-current opacity-[0.07] ${tone.text}`} aria-hidden />
      <Seal event={event} size="lg" muted={count === 0} />
      <div>
        <p className="font-display text-3xl font-semibold tracking-tight text-ink">{t(`lifeEvents.${event}.name`)}</p>
        <p className="mt-1 text-muted">{t(`lifeEvents.${event}.description`)}</p>
      </div>
    </div>
  )
}

function ServiceRow({ service: s, index }: { service: ServiceSummary; index: number }) {
  const { t } = useTranslation()
  const pick = useLocalized()
  const formatDate = useFormatDate()
  const fullyVerified = s.requirement_count > 0 && s.verified_requirement_count === s.requirement_count
  const primary = s.life_events[0]
  const tone = primary ? EVENT_TONE[primary] : null

  return (
    <article
      className="group relative grid animate-rise gap-5 overflow-hidden rounded-3xl bg-card p-6 ring-1 ring-rule transition duration-200 hover:shadow-lift hover:ring-ink/30 sm:grid-cols-[auto_minmax(0,1fr)] sm:p-7 xl:grid-cols-[auto_minmax(0,1fr)_auto]"
      style={{ animationDelay: `${Math.min(index, 6) * 0.04}s` }}
    >
      {tone && <span className={`absolute inset-y-0 left-0 w-1 ${tone.solid}`} aria-hidden />}
      {primary && <Seal event={primary} />}
      <div className="min-w-0">
        <p lang="en" className="text-xs font-bold tracking-wide text-muted uppercase">
          {s.authority}
        </p>
        <h2 className="mt-1.5 font-display text-2xl leading-snug font-semibold tracking-tight text-ink">
          <Link to={`/services/${s.id}`} className="decoration-jade-500 decoration-2 underline-offset-4 hover:underline">
            {pick(s.name, s.name_hi)}
          </Link>
        </h2>
        <p className="mt-2 line-clamp-2 max-w-2xl text-sm leading-relaxed text-muted">{pick(s.description, s.description_hi)}</p>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          {fullyVerified ? (
            <VerifiedBadge />
          ) : (
            <Pill tone="amber">⚠ {t('services.partlyVerified', { verified: s.verified_requirement_count, total: s.requirement_count })}</Pill>
          )}
          <span className="font-semibold text-ink">
            {t(`jurisdiction.${s.jurisdiction}`)}
            {s.state ? ` · ${s.state}` : ''}
          </span>
          {s.application_form && <span className="text-muted">{s.application_form}</span>}
          {s.last_verified_at && <span className="text-muted">{t('services.lastVerified', { date: formatDate(s.last_verified_at) })}</span>}
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1" aria-label={t('services.lifeEventsLabel')}>
          {s.life_events.map((e) => (
            <li key={e} className={`inline-flex items-center gap-1.5 text-xs font-semibold ${EVENT_TONE[e].text}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${EVENT_TONE[e].solid}`} aria-hidden />
              {t(`lifeEvents.${e}.name`)}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:col-start-2 xl:col-start-3 xl:flex-col xl:items-stretch xl:justify-center">
        <Link to={`/services/${s.id}`} className={buttonClass('primary', 'sm')}>
          {t('services.viewRequirements')} <Icon name="arrow" className="h-3.5 w-3.5" />
        </Link>
        <a href={s.official_info_url} target="_blank" rel="noreferrer" className={buttonClass('ghost', 'sm')}>
          {t('services.officialSite')} ↗
        </a>
      </div>
    </article>
  )
}
