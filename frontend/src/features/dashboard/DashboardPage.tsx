import { type FormEvent, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { buttonClass } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { Seal } from '../../components/ui/Seal'
import { countByLifeEvent, EVENT_TONE, LIFE_EVENTS } from '../../lib/lifeEvents'
import { useFormatDate, useLocalized } from '../../lib/useLocalized'
import type { LifeEventId, PlanRequest, PlanResponse, ServiceSummary } from '../../types/api'
import { usePlan } from '../planner/api'
import { usePlanNames } from '../planner/names'
import { readSavedPlan } from '../planner/usePlannerState'
import { useDocuments, useServices } from '../services/api'
import { SystemStatus } from './SystemStatus'

export function DashboardPage() {
  const { t } = useTranslation()
  const services = useServices()

  return (
    <div className="space-y-20 sm:space-y-24">
      <Hero />
      <SavedPlanTicket />

      <section aria-labelledby="life-events" className="animate-rise">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <p className="text-xs font-bold tracking-[0.18em] text-jade-700 uppercase">{t('home.discoverEyebrow')}</p>
            <h2 id="life-events" className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              {t('home.lifeEventsTitle')}
            </h2>
            <p className="mt-2 text-muted">{t('home.lifeEventsHint')}</p>
          </div>
          <Link to="/services" className={buttonClass('secondary', 'md')}>
            {t('home.viewAll')} <Icon name="arrow" className="h-4 w-4" />
          </Link>
        </div>
        <LifeEventMosaic services={services.data} />
      </section>

      <Trust />
      <SystemStatus />
    </div>
  )
}

/* ------------------------------------------------------------------ hero */

function Hero() {
  const { t } = useTranslation()
  const formatDate = useFormatDate()
  const navigate = useNavigate()
  const services = useServices()
  const documents = useDocuments()
  const [text, setText] = useState('')
  const counts = services.data ? countByLifeEvent(services.data) : null
  const covered = counts ? LIFE_EVENTS.filter((e) => counts[e] > 0).length : null
  const lastVerified = services.data
    ?.map((s) => s.last_verified_at)
    .filter((d): d is string => !!d)
    .sort()
    .at(-1)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const q = text.trim()
    navigate(q ? `/assistant?q=${encodeURIComponent(q)}` : '/assistant')
  }

  return (
    <section className="grid items-stretch gap-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-14">
      <div className="flex animate-rise flex-col justify-center">
        <p className="flex items-center gap-2 text-xs font-bold tracking-[0.18em] text-jade-700 uppercase">
          <span className="h-px w-6 bg-jade-500" aria-hidden />
          {t('home.eyebrow')}
        </p>
        <h1 className="mt-5 font-display text-[2.6rem] leading-[1.02] font-semibold tracking-tight text-ink sm:text-6xl xl:text-7xl">
          {t('home.heroA')} <em className="font-medium text-jade-600">{t('home.heroB')}</em> {t('home.heroC')}
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">{t('home.subtitle')}</p>

        <form onSubmit={submit} className="mt-8 max-w-xl">
          <label htmlFor="situation" className="text-sm font-bold text-ink">
            {t('home.situationLabel')}
          </label>
          <div className="mt-2 flex items-center gap-2 rounded-full border-2 border-ink bg-card p-1.5 pl-5 shadow-lift transition focus-within:ring-4 focus-within:ring-zest-300">
            <Icon name="spark" className="h-5 w-5 shrink-0 text-jade-600" />
            <input
              id="situation"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('home.situationPlaceholder')}
              className="min-w-0 flex-1 bg-transparent py-2 text-base text-ink placeholder:text-faint focus:outline-none"
            />
            <button type="submit" className={buttonClass('primary', 'md', 'shrink-0')}>
              <span className="hidden sm:inline">{t('home.situationSubmit')}</span>
              <Icon name="arrow" className="h-4 w-4" />
              <span className="sr-only sm:hidden">{t('home.situationSubmit')}</span>
            </button>
          </div>
          <p className="mt-3 pl-5 text-xs text-muted">{t('home.situationHint')}</p>
        </form>

        {services.data && (
          <p className="mt-8 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            <Icon name="shield" className="h-4 w-4 text-jade-600" />
            <span className="font-semibold text-ink">{t('home.coverage', { count: services.data.length })}</span>
            {lastVerified && <span>· {t('home.lastVerified', { date: formatDate(lastVerified) })}</span>}
          </p>
        )}
      </div>

      {/* The product's process, drawn as a route. */}
      <aside className="ink-panel relative flex animate-rise flex-col overflow-hidden rounded-[2rem] p-7 shadow-lift sm:p-9" style={{ animationDelay: '0.1s' }}>
        <p className="text-xs font-bold tracking-[0.18em] text-zest-400 uppercase">{t('home.howTitle')}</p>
        <ol className="relative mt-6 flex-1 space-y-6">
          <span aria-hidden className="absolute top-3 bottom-3 left-[15px] w-0.5 rounded bg-paper/15" />
          {(['1', '2', '3', '4'] as const).map((n, i) => (
            <li key={n} className="relative flex animate-rise gap-4" style={{ animationDelay: `${0.2 + i * 0.12}s` }}>
              <span
                className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                  n === '4' ? 'animate-beacon bg-zest-400 text-ink' : 'bg-ink-soft text-paper ring-2 ring-paper/25'
                }`}
              >
                {n === '4' ? <Icon name="check" className="h-4 w-4" strokeWidth={2.4} /> : n}
              </span>
              <div>
                <p className="font-display text-lg leading-tight font-semibold text-paper">{t(`home.flow.${n}Title`)}</p>
                <p className="mt-1 text-sm leading-relaxed text-paper/65">{t(`home.flow.${n}Text`)}</p>
              </div>
            </li>
          ))}
        </ol>
        <dl className="mt-8 grid grid-cols-4 gap-3 border-t border-paper/15 pt-6">
          <Stat label={t('home.statServices')} value={services.data?.length} />
          <Stat label={t('home.statDocuments')} value={documents.data?.length} />
          <Stat label={t('home.statLifeEvents')} value={covered === null ? undefined : `${covered}/${LIFE_EVENTS.length}`} />
          <Stat label={t('home.statLanguages')} value="2" />
        </dl>
      </aside>
    </section>
  )
}

function Stat({ label, value }: { label: string; value: number | string | undefined }) {
  return (
    <div className="min-w-0">
      <dd className="font-display text-2xl font-semibold text-paper sm:text-3xl">{value ?? '—'}</dd>
      <dt className="mt-0.5 text-[11px] leading-tight text-paper/55">{label}</dt>
    </div>
  )
}

/* ------------------------------------------------------------------ life events */

const MOSAIC: Record<LifeEventId, string> = {
  'relocation-identity': 'sm:col-span-2 lg:col-span-7',
  'marriage-family': 'lg:col-span-5',
  'birth-parenthood': 'lg:col-span-4',
  'employment-career': 'lg:col-span-4',
  'starting-business': 'lg:col-span-4',
}

function LifeEventMosaic({ services }: { services: ServiceSummary[] | undefined }) {
  const counts = services ? countByLifeEvent(services) : null
  return (
    <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-12">
      {LIFE_EVENTS.map((e, i) => (
        <li key={e} className={`animate-rise ${MOSAIC[e]}`} style={{ animationDelay: `${i * 0.06}s` }}>
          <LifeEventTile event={e} count={counts?.[e] ?? null} services={services?.filter((s) => s.life_events.includes(e)) ?? []} featured={e === 'relocation-identity'} />
        </li>
      ))}
    </ul>
  )
}

function LifeEventTile({ event: e, count: n, services, featured }: { event: LifeEventId; count: number | null; services: ServiceSummary[]; featured: boolean }) {
  const { t } = useTranslation()
  const pick = useLocalized()
  const tone = EVENT_TONE[e]
  const countText = n === null ? t('common.loading') : n === 0 ? t('home.noVerifiedYet') : t('home.serviceCount', { count: n })
  const shown = services.slice(0, featured ? 6 : 2)

  if (n === 0) {
    return (
      <Link
        to={`/services?event=${e}`}
        data-testid={`life-event-${e}`}
        className="group flex h-full flex-col rounded-3xl border-2 border-dashed border-rule-strong p-6 transition hover:border-clay-500 sm:p-7"
      >
        <div className="flex items-start justify-between gap-4">
          <Seal event={e} muted />
          <span className="rounded-full bg-clay-50 px-3 py-1 text-xs font-bold text-clay-700">{countText}</span>
        </div>
        <span className="mt-6 block font-display text-2xl font-semibold tracking-tight text-ink/70">{t(`lifeEvents.${e}.name`)}</span>
        <span className="mt-2 block text-sm leading-relaxed text-muted">{t(`lifeEvents.${e}.description`)}</span>
        <span className="mt-auto block border-t border-dashed border-rule-strong pt-4 text-xs leading-relaxed text-muted">{t('home.honestGap')}</span>
      </Link>
    )
  }

  return (
    <Link
      to={`/services?event=${e}`}
      data-testid={`life-event-${e}`}
      className={`group relative flex h-full flex-col overflow-hidden rounded-3xl p-6 transition duration-200 hover:-translate-y-1 hover:shadow-lift sm:p-7 ${tone.bg}`}
    >
      <span className={`absolute -top-10 -right-10 h-40 w-40 rounded-full border-[18px] border-current opacity-[0.07] ${tone.text}`} aria-hidden />
      <div className="flex items-start justify-between gap-4">
        <Seal event={e} size={featured ? 'lg' : 'md'} />
        <span className={`rounded-full bg-card/80 px-3 py-1 text-xs font-bold ${tone.text}`}>{countText}</span>
      </div>
      <span className={`mt-6 block font-display font-semibold tracking-tight text-ink ${featured ? 'text-3xl sm:text-4xl' : 'text-2xl'}`}>
        {t(`lifeEvents.${e}.name`)}
      </span>
      <span className="mt-2 block max-w-md text-sm leading-relaxed text-muted">{t(`lifeEvents.${e}.description`)}</span>
      {shown.length > 0 && (
        <span className={`mt-6 grid gap-x-6 gap-y-2 border-t border-ink/10 pt-4 text-sm ${featured ? 'sm:grid-cols-2' : ''}`}>
          {shown.map((s) => (
            <span key={s.id} className="flex items-start gap-2 text-ink/80">
              <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${tone.solid}`} aria-hidden />
              {pick(s.name, s.name_hi)}
            </span>
          ))}
          {services.length > shown.length && <span className="text-xs font-semibold text-muted">{t('planner.andMore', { count: services.length - shown.length })}</span>}
        </span>
      )}
      <span className={`mt-auto flex items-center gap-1.5 pt-6 text-sm font-bold ${tone.text}`}>
        {t('home.exploreEvent')} <Icon name="arrow" className="h-4 w-4 transition group-hover:translate-x-1" />
      </span>
    </Link>
  )
}

/* ------------------------------------------------------------------ saved plan */

function SavedPlanTicket() {
  const { t } = useTranslation()
  const saved = readSavedPlan()
  const hasPlan = saved.targets.length > 0
  const request: PlanRequest | null = useMemo(
    () =>
      saved.generated && saved.targets.length
        ? {
            target_service_ids: [...saved.targets].sort(),
            owned_document_ids: [...saved.owned].sort(),
            completed_service_ids: [...saved.completed].sort(),
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const plan = usePlan(request)
  const services = useServices()
  const documents = useDocuments()
  const names = usePlanNames(plan.data, services.data ?? [], documents.data ?? [])
  const next = plan.data?.next_action
  const total = plan.data ? plan.data.steps.length + plan.data.completed_service_ids.length : 0
  const done = plan.data?.completed_service_ids.length ?? 0

  if (!hasPlan) {
    return (
      <section className="flex animate-rise flex-wrap items-center gap-5 rounded-3xl border-2 border-dashed border-rule-strong px-6 py-6 sm:px-8">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-zest-200 text-ink">
          <Icon name="plan" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl font-semibold text-ink">{t('home.savedTitle')}</h2>
          <p className="mt-0.5 text-sm text-muted">{t('home.savedEmpty')}</p>
        </div>
        <Link to="/planner" className={buttonClass('primary', 'md')}>
          {t('home.ctaPlan')} <Icon name="arrow" className="h-4 w-4" />
        </Link>
      </section>
    )
  }

  return (
    <section className="grid animate-rise overflow-hidden rounded-3xl bg-card shadow-lift ring-1 ring-rule md:grid-cols-[minmax(0,1.5fr)_auto_minmax(0,1fr)]">
      <div className="p-6 sm:p-8">
        <div className="flex items-center gap-2 text-xs font-bold tracking-[0.18em] text-jade-700 uppercase">
          <span className="h-2 w-2 animate-beacon rounded-full bg-zest-400" aria-hidden />
          <h2 className="text-xs">{t('home.savedTitle')}</h2>
        </div>
        {next && next.type !== 'none' ? (
          <>
            <p className="mt-4 text-xs font-semibold text-muted">{t('planner.nextAction')}</p>
            <p className="mt-1 font-display text-2xl leading-snug font-semibold text-ink sm:text-3xl">
              {next.type === 'start_service' && next.service_id
                ? t('planner.startService', { service: names.service(next.service_id) })
                : t('planner.obtainDocument')}
            </p>
          </>
        ) : (
          <p className="mt-4 text-sm text-muted">{plan.isPending && request ? t('common.loading') : next?.type === 'none' ? t('planner.allDone') : t('home.savedNotGenerated')}</p>
        )}
        {plan.data && total > 0 && <MiniRoute plan={plan.data} />}
      </div>

      {/* ticket perforation */}
      <div aria-hidden className="relative hidden w-px md:block">
        <span className="absolute inset-y-6 left-0 border-l-2 border-dashed border-rule" />
        <span className="absolute -top-3 -left-3 h-6 w-6 rounded-full bg-paper" />
        <span className="absolute -bottom-3 -left-3 h-6 w-6 rounded-full bg-paper" />
      </div>

      <div className="flex flex-col justify-between gap-6 border-t-2 border-dashed border-rule bg-paper-deep/40 p-6 sm:p-8 md:border-t-0">
        {plan.data && total > 0 && (
          <div>
            <div className="flex justify-between text-xs font-semibold text-muted">
              <span>{t('home.progress')}</span>
              <span>{t('home.progressValue', { done, total })}</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-rule">
              <div className="h-full rounded-full bg-jade-600 transition-all duration-700" style={{ width: `${(done / total) * 100}%` }} />
            </div>
          </div>
        )}
        <dl className="grid grid-cols-3 gap-3">
          {(
            [
              ['savedServices', saved.targets.length],
              ['savedDocuments', saved.owned.length],
              ['savedDone', saved.completed.length],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="flex flex-col-reverse">
              <dt className="text-xs leading-tight text-muted">{t(`home.${k}`)}</dt>
              <dd className="font-display text-3xl font-semibold text-ink">{v}</dd>
            </div>
          ))}
        </dl>
        <Link to="/planner" className={buttonClass('primary', 'lg', 'w-full')}>
          {t('home.savedContinue')} <Icon name="arrow" className="h-4 w-4" />
        </Link>
      </div>
    </section>
  )
}

/** The saved plan as a row of stops, in the backend's order (completed first). */
function MiniRoute({ plan }: { plan: PlanResponse }) {
  const stops = [
    ...plan.completed_service_ids.map((id) => ({ id, status: 'done' as const })),
    ...plan.steps.map((s) => ({ id: s.service_id, status: s.status })),
  ]
  const nextId = plan.next_action.service_id
  return (
    <div className="mt-6 flex items-center" aria-hidden>
      {stops.map((s, i) => (
        <span key={s.id} className="flex flex-1 items-center last:flex-none">
          <span
            className={`h-3.5 w-3.5 shrink-0 rounded-full ${
              s.id === nextId
                ? 'animate-beacon bg-zest-400 ring-2 ring-ink'
                : s.status === 'done'
                  ? 'bg-jade-600'
                  : s.status === 'blocked'
                    ? 'bg-crimson-500'
                    : s.status === 'ready'
                      ? 'bg-ink'
                      : 'border-2 border-waiting bg-card'
            }`}
          />
          {i < stops.length - 1 && <span className={`h-0.5 flex-1 ${s.status === 'done' ? 'bg-jade-600' : 'bg-rule-strong'}`} />}
        </span>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ trust */

function Trust() {
  const { t } = useTranslation()
  return (
    <section aria-labelledby="trust" className="grid animate-rise gap-10 border-t border-rule pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div>
        <Icon name="quote" className="h-10 w-10 text-jade-300" />
        <h2 id="trust" className="mt-4 font-display text-3xl leading-tight font-semibold tracking-tight text-ink sm:text-4xl">
          {t('home.trustTitle')}
        </h2>
        <p className="mt-4 max-w-lg leading-relaxed text-muted">{t('home.trustText')}</p>
      </div>
      <ul className="divide-y divide-rule border-y border-rule">
        {(['sources', 'rules', 'ai'] as const).map((k) => (
          <li key={k} className="flex gap-5 py-6">
            <span
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
                k === 'ai' ? 'bg-lilac-50 text-lilac-700' : k === 'rules' ? 'bg-zest-200 text-ink' : 'bg-jade-50 text-jade-700'
              }`}
            >
              <Icon name={k === 'sources' ? 'stamp' : k === 'rules' ? 'plan' : 'spark'} />
            </span>
            <div>
              <p className="font-display text-xl font-semibold text-ink">{t(`home.trust.${k}Title`)}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted">{t(`home.trust.${k}Text`)}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
