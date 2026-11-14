import { type FormEvent, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { buttonClass } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { countByLifeEvent, LIFE_EVENTS } from '../../lib/lifeEvents'
import { useFormatDate } from '../../lib/useLocalized'
import type { LifeEventId, PlanRequest } from '../../types/api'
import { usePlan } from '../planner/api'
import { usePlanNames } from '../planner/names'
import { readSavedPlan } from '../planner/usePlannerState'
import { useDocuments, useServices } from '../services/api'
import { SystemStatus } from './SystemStatus'

export function DashboardPage() {
  const { t } = useTranslation()
  const formatDate = useFormatDate()
  const services = useServices()
  const counts = services.data ? countByLifeEvent(services.data) : null
  const lastVerified = services.data
    ?.map((s) => s.last_verified_at)
    .filter((d): d is string => !!d)
    .sort()
    .at(-1)

  return (
    <div className="space-y-14">
      <section className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div>
          <p className="text-xs font-semibold tracking-[0.14em] text-brand-600 uppercase">{t('home.eyebrow')}</p>
          <h1 className="mt-3 font-display text-4xl leading-[1.1] font-semibold tracking-tight text-slate-900 sm:text-5xl">
            {t('home.title')}
          </h1>
          <p className="mt-4 max-w-xl text-lg text-slate-600">{t('home.subtitle')}</p>
          <SituationBox />
          <div className="mt-5 flex flex-wrap gap-3">
            <Link to="/planner" className={buttonClass('primary', 'lg')}>
              <Icon name="plan" /> {t('home.ctaPlan')}
            </Link>
            <Link to="/services" className={buttonClass('secondary', 'lg')}>
              <Icon name="search" /> {t('home.ctaBrowse')}
            </Link>
          </div>
          {services.data && (
            <p className="mt-6 flex items-center gap-2 text-sm text-slate-500">
              <Icon name="shield" className="h-4 w-4 text-verified" />
              {t('home.coverage', { count: services.data.length })}
              {lastVerified && ` · ${t('home.lastVerified', { date: formatDate(lastVerified) })}`}
            </p>
          )}
        </div>
        <SavedPlanCard />
      </section>

      <section aria-labelledby="life-events">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="life-events" className="font-display text-2xl font-semibold text-slate-900">{t('home.lifeEventsTitle')}</h2>
            <p className="mt-1 text-sm text-slate-600">{t('home.lifeEventsHint')}</p>
          </div>
          <Link to="/services" className={buttonClass('ghost', 'sm')}>
            {t('home.viewAll')} <Icon name="arrow" className="h-4 w-4" />
          </Link>
        </div>
        <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {LIFE_EVENTS.map((e, i) => (
            <LifeEventCard key={e} event={e} count={counts?.[e] ?? null} featured={i === 0} />
          ))}
        </ul>
      </section>

      <section className="rounded-2xl bg-brand-900 px-6 py-10 text-white sm:px-10">
        <h2 className="font-display text-2xl font-semibold">{t('home.howTitle')}</h2>
        <ol className="mt-6 grid gap-8 sm:grid-cols-3">
          {(['1', '2', '3'] as const).map((n) => (
            <li key={n}>
              <span className="font-display text-4xl font-semibold text-accent-500">{n}</span>
              <p className="mt-2 font-semibold">{t(`home.how${n}Title`)}</p>
              <p className="mt-1 text-sm text-brand-100">{t(`home.how${n}Text`)}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="trust" className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <h2 id="trust" className="font-display text-2xl font-semibold text-slate-900">{t('home.trustTitle')}</h2>
          <p className="mt-2 text-sm text-slate-600">{t('home.trustText')}</p>
        </div>
        <ul className="grid gap-4 sm:grid-cols-3 lg:col-span-2">
          {(['sources', 'rules', 'ai'] as const).map((k) => (
            <li key={k} className="rounded-xl border border-line bg-surface p-5 shadow-card">
              <Icon name={k === 'sources' ? 'shield' : k === 'rules' ? 'plan' : 'spark'} className={`h-6 w-6 ${k === 'ai' ? 'text-ai' : 'text-brand-700'}`} />
              <p className="mt-3 font-semibold text-slate-900">{t(`home.trust.${k}Title`)}</p>
              <p className="mt-1 text-sm text-slate-600">{t(`home.trust.${k}Text`)}</p>
            </li>
          ))}
        </ul>
      </section>

      <SystemStatus />
    </div>
  )
}

function SituationBox() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const q = text.trim()
    navigate(q ? `/assistant?q=${encodeURIComponent(q)}` : '/assistant')
  }
  return (
    <form onSubmit={submit} className="mt-7 max-w-xl">
      <label htmlFor="situation" className="text-sm font-semibold text-slate-800">{t('home.situationLabel')}</label>
      <div className="mt-2 flex rounded-xl border border-line bg-surface p-1.5 shadow-card focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100">
        <input
          id="situation"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('home.situationPlaceholder')}
          className="min-w-0 flex-1 bg-transparent px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
        />
        <button type="submit" className={buttonClass('primary', 'md')}>
          <Icon name="send" className="h-4 w-4" />
          <span className="hidden sm:inline">{t('home.situationSubmit')}</span>
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-500">{t('home.situationHint')}</p>
    </form>
  )
}

function LifeEventCard({ event: e, count: n, featured }: { event: LifeEventId; count: number | null; featured: boolean }) {
  const { t } = useTranslation()
  return (
    <li className={featured ? 'sm:col-span-2 lg:row-span-2' : ''}>
      <Link
        to={`/services?event=${e}`}
        data-testid={`life-event-${e}`}
        className={`group flex h-full flex-col rounded-2xl border border-line p-5 shadow-card transition duration-150 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-raised ${
          featured ? 'bg-brand-50/60 sm:p-7' : 'bg-surface'
        }`}
      >
        <span className={`flex items-center justify-center rounded-xl bg-surface text-brand-700 ring-1 ring-line ${featured ? 'h-12 w-12' : 'h-10 w-10'}`}>
          <Icon name={e} className={featured ? 'h-7 w-7' : 'h-5 w-5'} />
        </span>
        <span className={`mt-4 font-semibold text-slate-900 group-hover:text-brand-700 ${featured ? 'font-display text-2xl' : ''}`}>
          {t(`lifeEvents.${e}.name`)}
        </span>
        <span className="mt-1 text-sm text-slate-600">{t(`lifeEvents.${e}.description`)}</span>
        <span className={`mt-auto flex items-center justify-between pt-4 text-xs font-medium ${n === 0 ? 'text-accent-700' : 'text-slate-500'}`}>
          {n === null ? t('common.loading') : n === 0 ? t('home.noVerifiedYet') : t('home.serviceCount', { count: n })}
          <Icon name="arrow" className="h-4 w-4 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-brand-700" />
        </span>
      </Link>
    </li>
  )
}

function SavedPlanCard() {
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

  return (
    <section className="rounded-2xl border border-line bg-surface p-6 shadow-raised">
      <h2 className="font-display text-xl font-semibold text-slate-900">{t('home.savedTitle')}</h2>
      {hasPlan ? (
        <>
          {plan.data && total > 0 && (
            <div className="mt-4">
              <div className="flex justify-between text-xs font-medium text-slate-500">
                <span>{t('home.progress')}</span>
                <span>{t('home.progressValue', { done, total })}</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-verified transition-all" style={{ width: `${(done / total) * 100}%` }} />
              </div>
            </div>
          )}
          {next && next.type !== 'none' && (
            <div className="mt-4 rounded-xl border border-accent-100 bg-accent-50 p-4">
              <p className="text-xs font-semibold tracking-wide text-accent-700 uppercase">{t('planner.nextAction')}</p>
              <p className="mt-1 font-semibold text-slate-900">
                {next.type === 'start_service' && next.service_id
                  ? t('planner.startService', { service: names.service(next.service_id) })
                  : t('planner.obtainDocument')}
              </p>
            </div>
          )}
          <dl className="mt-4 space-y-1.5 text-sm text-slate-700">
            <div className="flex justify-between"><dt>{t('home.savedServices')}</dt><dd className="font-semibold">{saved.targets.length}</dd></div>
            <div className="flex justify-between"><dt>{t('home.savedDocuments')}</dt><dd className="font-semibold">{saved.owned.length}</dd></div>
            <div className="flex justify-between"><dt>{t('home.savedDone')}</dt><dd className="font-semibold">{saved.completed.length}</dd></div>
          </dl>
          <Link to="/planner" className={buttonClass('primary', 'md', 'mt-5 w-full')}>
            {t('home.savedContinue')} <Icon name="arrow" className="h-4 w-4" />
          </Link>
        </>
      ) : (
        <>
          <p className="mt-2 text-sm text-slate-600">{t('home.savedEmpty')}</p>
          <ol className="mt-5 space-y-3">
            {(['1', '2', '3'] as const).map((n) => (
              <li key={n} className="flex gap-3 text-sm">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">{n}</span>
                <span className="text-slate-700">{t(`home.how${n}Title`)}</span>
              </li>
            ))}
          </ol>
          <Link to="/planner" className={buttonClass('secondary', 'md', 'mt-5 w-full')}>
            {t('home.ctaPlan')}
          </Link>
        </>
      )}
    </section>
  )
}
