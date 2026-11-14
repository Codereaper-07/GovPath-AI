import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Icon } from '../../components/ui/Icon'
import { countByLifeEvent, LIFE_EVENTS } from '../../lib/lifeEvents'
import { useFormatDate } from '../../lib/useLocalized'
import { readSavedPlan } from '../planner/usePlannerState'
import { useServices } from '../services/api'
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
  const saved = readSavedPlan()
  const hasPlan = saved.targets.length > 0

  return (
    <div className="space-y-10">
      <section className="rounded-2xl border border-slate-200 bg-white px-6 py-8 shadow-sm sm:px-10">
        <p className="text-sm font-semibold tracking-wide text-brand-700 uppercase">{t('home.eyebrow')}</p>
        <h1 className="mt-2 max-w-3xl text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">{t('home.title')}</h1>
        <p className="mt-3 max-w-2xl text-base text-slate-600">{t('home.subtitle')}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link to="/planner" className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 font-semibold text-white shadow-sm transition hover:bg-brand-700">
            <Icon name="plan" /> {t('home.ctaPlan')}
          </Link>
          <Link to="/services" className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 font-semibold text-slate-800 ring-1 ring-slate-300 transition hover:bg-slate-50">
            <Icon name="search" /> {t('home.ctaBrowse')}
          </Link>
        </div>
        {services.data && (
          <p className="mt-6 text-sm text-slate-500">
            {t('home.coverage', { count: services.data.length })}
            {lastVerified && ` · ${t('home.lastVerified', { date: formatDate(lastVerified) })}`}
          </p>
        )}
      </section>

      <section aria-labelledby="life-events">
        <h2 id="life-events" className="text-xl font-semibold text-slate-900">{t('home.lifeEventsTitle')}</h2>
        <p className="mt-1 text-sm text-slate-600">{t('home.lifeEventsHint')}</p>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {LIFE_EVENTS.map((e) => {
            const n = counts?.[e] ?? null
            return (
              <li key={e}>
                <Link
                  to={`/services?event=${e}`}
                  data-testid={`life-event-${e}`}
                  className="group flex h-full flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-brand-600 hover:shadow"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                    <Icon name={e} className="h-6 w-6" />
                  </span>
                  <span className="mt-3 font-semibold text-slate-900 group-hover:text-brand-700">{t(`lifeEvents.${e}.name`)}</span>
                  <span className="mt-1 text-sm text-slate-600">{t(`lifeEvents.${e}.description`)}</span>
                  <span className={`mt-auto pt-3 text-xs font-medium ${n === 0 ? 'text-amber-700' : 'text-slate-500'}`}>
                    {n === null ? t('common.loading') : n === 0 ? t('home.noVerifiedYet') : t('home.serviceCount', { count: n })}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
          <h2 className="text-lg font-semibold text-slate-900">{t('home.howTitle')}</h2>
          <ol className="mt-4 grid gap-4 sm:grid-cols-3">
            {(['1', '2', '3'] as const).map((n) => (
              <li key={n} className="rounded-lg bg-slate-50 p-4">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">{n}</span>
                <p className="mt-2 font-medium text-slate-900">{t(`home.how${n}Title`)}</p>
                <p className="mt-1 text-sm text-slate-600">{t(`home.how${n}Text`)}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">{t('home.savedTitle')}</h2>
          {hasPlan ? (
            <>
              <dl className="mt-3 space-y-1 text-sm text-slate-700">
                <div className="flex justify-between"><dt>{t('home.savedServices')}</dt><dd className="font-semibold">{saved.targets.length}</dd></div>
                <div className="flex justify-between"><dt>{t('home.savedDocuments')}</dt><dd className="font-semibold">{saved.owned.length}</dd></div>
                <div className="flex justify-between"><dt>{t('home.savedDone')}</dt><dd className="font-semibold">{saved.completed.length}</dd></div>
              </dl>
              <Link to="/planner" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
                {t('home.savedContinue')} <Icon name="arrow" className="h-4 w-4" />
              </Link>
            </>
          ) : (
            <p className="mt-3 text-sm text-slate-600">{t('home.savedEmpty')}</p>
          )}
        </section>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <SystemStatus />
        <section className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
          <h2 className="font-semibold text-slate-900">{t('home.trustTitle')}</h2>
          <p className="mt-2">{t('home.trustText')}</p>
        </section>
      </div>
    </div>
  )
}
