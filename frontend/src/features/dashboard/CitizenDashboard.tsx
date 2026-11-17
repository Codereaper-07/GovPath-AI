import { usePlanName } from '../account/planName'
import { useStateName } from '../../lib/useStateName'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { buttonClass } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { ErrorState, LoadingState } from '../../components/ui/States'
import { useFormatDate, useLocalized } from '../../lib/useLocalized'
import type { Dashboard, VaultDocument } from '../../types/api'
import { EventItem } from '../account/ActivityPage'
import { AccountBadge } from '../account/AccountBadge'
import { useDashboard } from '../account/api'
import { useDocuments, useServices } from '../services/api'

/** Signed-in home: what the citizen should do next, from their own saved data. */
export function CitizenDashboard() {
  const { t } = useTranslation()
  const dashboard = useDashboard()
  if (dashboard.isPending) return <LoadingState />
  if (dashboard.isError) return <ErrorState message={t('dashboard.loadError')} onRetry={() => void dashboard.refetch()} />
  const d = dashboard.data
  return (
    <div className="space-y-10" data-testid="citizen-dashboard">
      <Greeting d={d} />
      <NewSituation hasPlans={d.plans.length > 0} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <NextActions d={d} />
          <Blockers d={d} />
          <Plans d={d} />
        </div>
        <div className="space-y-6">
          <Documents d={d} />
          <Progress d={d} />
          <Recent d={d} />
        </div>
      </div>
    </div>
  )
}

function useNames() {
  const pick = useLocalized()
  const services = useServices()
  const documents = useDocuments()
  return {
    service: (id: string | null) => {
      const s = services.data?.find((x) => x.id === id)
      return s ? pick(s.name, s.name_hi) : (id ?? '')
    },
    document: (id: string) => {
      const x = documents.data?.find((y) => y.id === id)
      return x ? pick(x.name, x.name_hi) : id
    },
  }
}

function Card({ title, id, children, action }: { title: string; id: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-[2rem] bg-card p-6 ring-1 ring-rule">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="font-display text-xl font-semibold text-ink">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function Greeting({ d }: { d: Dashboard }) {
  const { t } = useTranslation()
  const stateName = useStateName()
  const place = [d.city, stateName(d.state)].filter(Boolean).join(t('common.listSeparator'))
  return (
    <header className="flex animate-rise flex-wrap items-end justify-between gap-4">
      <div>
        <p className="flex items-center gap-2 text-xs font-bold tracking-[0.18em] text-jade-700 uppercase">
          <span className="h-px w-6 bg-jade-500" aria-hidden />
          {t('dashboard.eyebrow')}
        </p>
        <h1 className="mt-3 font-display text-4xl leading-tight font-semibold tracking-tight text-ink sm:text-5xl">
          {d.full_name ? t('dashboard.hello', { name: d.full_name.split(' ')[0] }) : t('dashboard.helloAnon')}
        </h1>
        <p className="mt-2 text-muted">
          {place ? (
            t('dashboard.place', { place })
          ) : (
            <Link to="/profile" className="font-semibold text-jade-700 underline-offset-4 hover:underline">
              {t('dashboard.addState')}
            </Link>
          )}
        </p>
      </div>
      <AccountBadge />
    </header>
  )
}

function NewSituation({ hasPlans }: { hasPlans: boolean }) {
  const { t } = useTranslation()
  return (
    <section className="ink-panel relative overflow-hidden rounded-[2rem] p-7 sm:p-9" aria-labelledby="new-situation">
      <span aria-hidden className="absolute -top-16 -right-16 h-56 w-56 rounded-full border-[28px] border-zest-400/10" />
      <h2 id="new-situation" className="relative max-w-xl font-display text-2xl font-semibold text-paper sm:text-3xl">
        {t(hasPlans ? 'dashboard.newSituation' : 'dashboard.firstSituation')}
      </h2>
      <p className="relative mt-2 max-w-xl text-paper/70">{t('dashboard.newSituationHint')}</p>
      <Link to="/planner?create=situation" className={buttonClass('zest', 'lg', 'relative mt-5')}>
        <Icon name="spark" className="h-5 w-5" /> {t('dashboard.describe')}
      </Link>
    </section>
  )
}

function NextActions({ d }: { d: Dashboard }) {
  const { t } = useTranslation()
  const { name: planName } = usePlanName()
  const names = useNames()
  return (
    <Card title={t('dashboard.nextTitle')} id="dash-next">
      {d.next_actions.length === 0 ? (
        <p className="text-sm text-muted">{d.plans.length ? t('dashboard.nothingNext') : t('dashboard.noPlans')}</p>
      ) : (
        <ol className="space-y-3">
          {d.next_actions.map((a) => (
            <li key={a.plan_id}>
              <Link
                to={`/planner?plan=${a.plan_id}`}
                className="flex items-start gap-3 rounded-2xl bg-paper px-4 py-3 ring-1 ring-rule transition hover:ring-ink"
                data-testid="dash-next-action"
              >
                <span className="mt-1 h-2.5 w-2.5 shrink-0 animate-beacon rounded-full bg-zest-400" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-ink">
                    {a.type === 'start_service' && t('planner.startService', { service: names.service(a.service_id) })}
                    {a.type === 'follow_up' && t('planner.followUp', { service: names.service(a.service_id) })}
                    {a.type === 'obtain_document' &&
                      t(a.reason_code === 'confirm_document' ? 'dashboard.confirmDocument' : 'dashboard.getDocument', {
                        documents: a.document_options.map(names.document).join(t('situation.or')),
                      })}
                  </span>
                  <span className="block text-xs text-muted">{planName(d.plans.find((p) => p.id === a.plan_id) ?? { title: a.plan_title })}</span>
                </span>
                <Icon name="arrow" className="mt-1 h-4 w-4 text-muted" />
              </Link>
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}

function Blockers({ d }: { d: Dashboard }) {
  const { t } = useTranslation()
  const { name: planName } = usePlanName()
  const names = useNames()
  if (d.blockers.length === 0) return null
  return (
    <Card title={t('dashboard.blockedTitle', { count: d.blockers.length })} id="dash-blocked">
      <ul className="space-y-2">
        {d.blockers.map((b) => (
          <li key={`${b.plan_id}-${b.code}-${b.service_id}-${b.requirement_id}`} className="rounded-2xl bg-crimson-50 px-4 py-3 text-sm ring-1 ring-crimson-100" data-testid="dash-blocker">
            <p className="font-semibold text-crimson-700">{names.service(b.service_id)}</p>
            <p className="text-crimson-700/90">
              {b.code === 'dependency_blocked'
                ? t('dashboard.blockedBy', { services: b.blocked_by_service_ids.map(names.service).join(t('common.listSeparator')) })
                : b.document_options.length === 1
                  ? t('dashboard.blockedDoc', { document: names.document(b.document_options[0]) })
                  : b.document_options.length
                  ? t('dashboard.blockedDocs', { documents: b.document_options.map(names.document).join(t('situation.or')) })
                  : t('dashboard.blockedOther')}
            </p>
            <Link to={`/planner?plan=${b.plan_id}`} className="text-xs font-semibold text-crimson-700 underline">
              {planName(d.plans.find((p) => p.id === b.plan_id) ?? { title: b.plan_title })}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function Plans({ d }: { d: Dashboard }) {
  const { t } = useTranslation()
  const { name: planName } = usePlanName()
  return (
    <Card
      title={t('dashboard.plansTitle')}
      id="dash-plans"
      action={
        <Link to="/planner" className="text-sm font-semibold text-jade-700 underline-offset-4 hover:underline">
          {t('dashboard.allPlans')}
        </Link>
      }
    >
      {d.plans.length === 0 ? (
        <p className="text-sm text-muted">{t('dashboard.noPlans')}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {d.plans.map((p) => {
            const pct = p.total_services ? Math.round((p.completed / p.total_services) * 100) : 0
            return (
              <li key={p.id}>
                <Link to={`/planner?plan=${p.id}`} className="block rounded-2xl bg-paper p-4 ring-1 ring-rule transition hover:ring-ink">
                  <p className="font-semibold leading-snug text-ink">{planName(p)}</p>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-rule" aria-hidden>
                    <div className="h-full rounded-full bg-jade-600" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-2 text-xs text-muted">
                    {t('planner.servicesDone', { done: p.completed, total: p.total_services })}
                    {p.blocked > 0 && <span className="text-crimson-600"> · {t('planner.countBlocked', { count: p.blocked })}</span>}
                  </p>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)

function DocLine({ doc, today, tone }: { doc: VaultDocument; today: string; tone: 'soon' | 'expired' }) {
  const { t } = useTranslation()
  const formatDate = useFormatDate()
  const pick = useLocalized()
  const name = doc.name ? pick(doc.name, doc.name_hi) : doc.document_type
  const days = doc.expiry_date ? daysBetween(today, doc.expiry_date) : 0
  return (
    <li className={`rounded-2xl px-4 py-2.5 text-sm ring-1 ${tone === 'expired' ? 'bg-crimson-50 ring-crimson-100' : 'bg-honey-50 ring-honey-100'}`} data-testid={`dash-doc-${tone}`}>
      <p className="font-semibold text-ink">
        {name}
        {doc.label && <span className="font-normal text-muted"> · {doc.label}</span>}
      </p>
      <p className={`text-xs ${tone === 'expired' ? 'text-crimson-700' : 'text-honey-700'}`}>
        {tone === 'expired'
          ? doc.expiry_date
            ? t('dashboard.expiredOn', { date: formatDate(doc.expiry_date) })
            : t('dashboard.markedExpired')
          : days === 0
            ? t('dashboard.expiresToday')
            : t('dashboard.expiresIn', { count: days, date: formatDate(doc.expiry_date) })}
      </p>
    </li>
  )
}

function Documents({ d }: { d: Dashboard }) {
  const { t } = useTranslation()
  return (
    <Card
      title={t('vault.title')}
      id="dash-docs"
      action={
        <Link to="/vault" className="text-sm font-semibold text-jade-700 underline-offset-4 hover:underline">
          {t('account.manageVault')}
        </Link>
      }
    >
      {d.vault_total === 0 ? (
        <p className="text-sm text-muted">{t('dashboard.noDocs')}</p>
      ) : (
        <>
          <p className="text-sm text-muted">
            {t('dashboard.docCounts', { total: d.vault_total, valid: d.vault_counts.valid ?? 0 })}
          </p>
          {(d.expired.length > 0 || d.expiring_soon.length > 0) && (
            <ul className="mt-3 space-y-2">
              {d.expired.map((doc) => (
                <DocLine key={doc.id} doc={doc} today={d.today} tone="expired" />
              ))}
              {d.expiring_soon.map((doc) => (
                <DocLine key={doc.id} doc={doc} today={d.today} tone="soon" />
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  )
}

function Progress({ d }: { d: Dashboard }) {
  const { t } = useTranslation()
  const names = useNames()
  const entries = Object.entries(d.progress)
  if (entries.length === 0) return null
  return (
    <Card title={t('dashboard.progressTitle')} id="dash-progress">
      <ul className="space-y-1.5 text-sm">
        {entries.map(([sid, state]) => (
          <li key={sid} className="flex items-center justify-between gap-3">
            <span className="text-ink">{names.service(sid)}</span>
            <span className={`text-xs font-semibold ${state === 'completed' ? 'text-jade-700' : 'text-muted'}`}>{t(`processState.${state}`)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-faint">{t('dashboard.progressNote')}</p>
    </Card>
  )
}

function Recent({ d }: { d: Dashboard }) {
  const { t } = useTranslation()
  if (d.recent_activity.length === 0) return null
  return (
    <Card
      title={t('dashboard.recentTitle')}
      id="dash-recent"
      action={
        <Link to="/activity" className="text-sm font-semibold text-jade-700 underline-offset-4 hover:underline">
          {t('activity.title')}
        </Link>
      }
    >
      <ol className="relative space-y-3 border-l-2 border-rule pl-6">
        {d.recent_activity.map((e) => (
          <EventItem key={e.id} event={e} />
        ))}
      </ol>
    </Card>
  )
}
