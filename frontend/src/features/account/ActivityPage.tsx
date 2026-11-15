import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { buttonClass } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { PageHeader } from '../../components/ui/PageHeader'
import { ErrorState, LoadingState } from '../../components/ui/States'
import { useLocalized } from '../../lib/useLocalized'
import type { ActivityEvent } from '../../types/api'
import { useDocuments, useServices } from '../services/api'
import { useActivity } from './api'
import { AccountBadge } from './AccountBadge'

/** Append-only history of the citizen's account changes (read-only: nothing here edits it). */
export function ActivityPage() {
  const { t } = useTranslation()
  const activity = useActivity()
  const events = activity.data?.pages.flatMap((p) => p.events) ?? []

  return (
    <div>
      <PageHeader
        eyebrow={t('profile.eyebrow')}
        title={t('activity.title')}
        actions={
          <Link to="/vault" className={buttonClass('secondary', 'md')}>
            <Icon name="doc" className="h-4 w-4" /> {t('vault.title')}
          </Link>
        }
      >
        {t('activity.intro')}
      </PageHeader>
      <div className="mb-6">
        <AccountBadge />
      </div>
      {activity.isPending && <LoadingState />}
      {activity.isError && <ErrorState message={t('activity.loadError')} onRetry={() => void activity.refetch()} />}
      {activity.data && events.length === 0 && (
        <p className="rounded-[2rem] border border-dashed border-rule-strong p-10 text-center text-muted">{t('activity.empty')}</p>
      )}
      {events.length > 0 && (
        <ol className="relative space-y-3 border-l-2 border-rule pl-6" aria-label={t('activity.title')}>
          {events.map((e) => (
            <EventItem key={e.id} event={e} />
          ))}
        </ol>
      )}
      {activity.hasNextPage && (
        <button
          type="button"
          className={buttonClass('secondary', 'md', 'mt-6')}
          disabled={activity.isFetchingNextPage}
          onClick={() => void activity.fetchNextPage()}
        >
          {t('activity.more')}
        </button>
      )}
    </div>
  )
}

function useEventText() {
  const { t, i18n } = useTranslation()
  const pick = useLocalized()
  const services = useServices()
  const documents = useDocuments()
  const svc = (id: unknown) => {
    const s = services.data?.find((x) => x.id === id)
    return s ? pick(s.name, s.name_hi) : String(id ?? '')
  }
  const doc = (id: unknown) => {
    const d = documents.data?.find((x) => x.id === id)
    return d ? pick(d.name, d.name_hi) : String(id ?? '')
  }
  const progress = (p: unknown) => t(`processState.${String(p)}`, { defaultValue: String(p) })
  const status = (s: unknown) => t(`vault.statusOption.${String(s)}`, { defaultValue: String(s) })
  const list = (ids: unknown) => (Array.isArray(ids) ? ids.map(svc).join(t('common.listSeparator')) : '')
  const stepLabel = (s: unknown) => (s === null ? t('account.notInPlan') : s === 'completed' ? t('planner.completed') : t(`stepStatus.${String(s)}`, { defaultValue: String(s) }))

  return (e: ActivityEvent): { title: string; lines: string[] } => {
    const d = e.details as Record<string, unknown>
    const plan = typeof d.title === 'string' && d.title ? d.title : t('account.untitledPlan')
    switch (e.event_type) {
      case 'document_added':
        return { title: t('activity.e.document_added', { document: doc(d.document_type), status: status(d.status) }), lines: [] }
      case 'document_updated': {
        const c = (d.changes ?? {}) as Record<string, unknown>
        const lines: string[] = []
        if (Array.isArray(c.status)) lines.push(t('activity.statusChange', { from: status(c.status[0]), to: status(c.status[1]) }))
        if (Array.isArray(c.expiry_date)) lines.push(t('activity.expiryChange', { to: c.expiry_date[1] ?? t('activity.none') }))
        if (c.note || c.label || c.issue_date) lines.push(t('activity.detailsChanged'))
        return { title: t('activity.e.document_updated', { document: doc(d.document_type) }), lines }
      }
      case 'document_expired':
        return { title: t('activity.e.document_expired', { document: doc(d.document_type), date: String(d.expiry_date ?? '') }), lines: [t('activity.expiredNote')] }
      case 'document_removed':
        return { title: t('activity.e.document_removed', { document: doc(d.document_type) }), lines: [] }
      case 'plan_created':
        return {
          title: t(d.source === 'import' ? 'activity.e.plan_imported' : 'activity.e.plan_created', { services: list(d.target_service_ids) }),
          lines: Number(d.documents_added) > 0 ? [t('activity.documentsAdded', { count: Number(d.documents_added) })] : [],
        }
      case 'plan_updated': {
        const lines: string[] = []
        if (Array.isArray(d.services_added) && d.services_added.length) lines.push(t('activity.servicesAdded', { services: list(d.services_added) }))
        if (Array.isArray(d.services_removed) && d.services_removed.length) lines.push(t('activity.servicesRemoved', { services: list(d.services_removed) }))
        return { title: t('activity.e.plan_updated'), lines }
      }
      case 'plan_archived':
      case 'plan_restored':
      case 'plan_deleted':
        return { title: t(`activity.e.${e.event_type}`, { plan }), lines: [] }
      case 'plan_recalculated': {
        const cause = (d.cause ?? {}) as Record<string, unknown>
        const why =
          cause.type === 'progress_changed'
            ? t('activity.cause.progress', { service: svc(cause.service_id) })
            : cause.type === 'document_expired'
              ? t('activity.cause.expired', {
                  documents: (Array.isArray(cause.document_types) ? cause.document_types : [cause.document_type]).map(doc).join(t('common.listSeparator')),
                })
              : cause.document_type
              ? t('activity.cause.document', { document: doc(cause.document_type) })
              : t('activity.cause.other')
        const steps = Array.isArray(d.steps) ? (d.steps as { service_id: string; before: string | null; after: string | null }[]) : []
        return {
          title: t('activity.e.plan_recalculated', { cause: why }),
          lines: [
            ...steps.map((s) => `${svc(s.service_id)}: ${stepLabel(s.before)} → ${stepLabel(s.after)}`),
            ...(Array.isArray(d.blockers_removed) && d.blockers_removed.length ? [t('account.blockersResolved', { count: d.blockers_removed.length })] : []),
            ...(Array.isArray(d.blockers_added) && d.blockers_added.length ? [t('account.blockersAdded', { count: d.blockers_added.length })] : []),
          ],
        }
      }
      case 'progress_changed':
        return { title: t('activity.e.progress_changed', { service: svc(d.service_id), from: progress(d.from), to: progress(d.to) }), lines: [] }
      default:
        return { title: i18n.exists(`activity.e.${String(e.event_type)}`) ? t(`activity.e.${String(e.event_type)}`) : String(e.event_type), lines: [] }
    }
  }
}

export function EventItem({ event }: { event: ActivityEvent }) {
  const { i18n } = useTranslation()
  const text = useEventText()(event)
  const when = new Date(event.created_at).toLocaleString(i18n.resolvedLanguage === 'hi' ? 'hi-IN' : 'en-IN', { dateStyle: 'medium', timeStyle: 'short' })
  return (
    <li className="relative rounded-2xl bg-card px-4 py-3 ring-1 ring-rule" data-testid="activity-event" data-type={event.event_type}>
      <span aria-hidden className="absolute top-4 -left-[1.95rem] h-3 w-3 rounded-full bg-jade-500 ring-4 ring-paper" />
      <p className="text-sm font-semibold text-ink">{text.title}</p>
      {text.lines.map((l) => (
        <p key={l} className="text-xs text-muted">
          {l}
        </p>
      ))}
      <time dateTime={event.created_at} className="mt-1 block text-xs text-faint">
        {when}
      </time>
    </li>
  )
}
