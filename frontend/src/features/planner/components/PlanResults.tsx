import { useTranslation } from 'react-i18next'
import { buttonClass } from '../../../components/ui/Button'
import { Icon } from '../../../components/ui/Icon'
import { ErrorState, LoadingState } from '../../../components/ui/States'
import { ApiError } from '../../../lib/apiClient'
import type { ApiErrorDetail, PlanResponse, ProcessState } from '../../../types/api'
import type { PlanNames } from '../names'
import { IssuesPanel } from './IssuesPanel'
import { NextActionCard } from './NextActionCard'
import { type NodeKind, StatusNode } from './StatusNode'
import { Timeline } from './Timeline'

/** The plan view (overview, notices, next action, issues, timeline). Shared by the device
 * planner and saved account plans; every decision shown comes from the backend planner. */
export function PlanResults(props: {
  generated: boolean
  hasTargets: boolean
  plan: PlanResponse | undefined
  isFetching: boolean
  error: Error | null
  names: PlanNames
  onRetry: () => void
  onRemoveUnknown: (d: ApiErrorDetail) => void
  onMarkDone: (id: string) => void
  onUndoDone: (id: string) => void
  onOwn: (id: string) => void
  onProcess: (id: string, state: ProcessState) => void
}) {
  const { t } = useTranslation()
  const { plan, names } = props

  if (!props.hasTargets || !props.generated) {
    return (
      <section className="ink-panel relative overflow-hidden rounded-[2rem] p-7 shadow-lift sm:p-10">
        <span aria-hidden className="absolute -right-24 -bottom-24 h-80 w-80 rounded-full border-[36px] border-zest-400/10" />
        <p className="relative text-xs font-bold tracking-[0.18em] text-zest-400 uppercase">{t('planner.previewEyebrow')}</p>
        <p className="relative mt-3 max-w-xl font-display text-3xl leading-tight font-semibold tracking-tight text-paper sm:text-4xl">
          {props.hasTargets ? t('planner.readyToGenerate') : t('planner.emptyTitle')}
        </p>
        <p className="relative mt-3 max-w-lg text-paper/70">{t('planner.emptyHint')}</p>
        <ol className="relative mt-10 grid gap-8 md:grid-cols-3 md:gap-6">
          <span aria-hidden className="absolute top-4 right-8 left-4 hidden h-0.5 bg-paper/15 md:block" />
          {(['1', '2', '3'] as const).map((n, i) => (
            <li key={n} className="relative animate-rise" style={{ animationDelay: `${0.1 + i * 0.12}s` }}>
              <span
                className={`relative flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
                  n === '3' ? 'animate-beacon bg-zest-400 text-ink' : 'bg-ink-soft text-paper ring-2 ring-paper/25'
                }`}
              >
                {n}
              </span>
              <p className="mt-4 font-display text-lg font-semibold text-paper">{t(`planner.preview.${n}Title`)}</p>
              <p className="mt-1 text-sm leading-relaxed text-paper/65">{t(`planner.preview.${n}Text`)}</p>
            </li>
          ))}
        </ol>
        <div className="relative mt-10 rounded-2xl bg-paper p-5 text-ink">
          <p className="text-xs font-bold tracking-[0.16em] text-muted uppercase">{t('planner.legend')}</p>
          <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-3 text-sm font-semibold">
            {(
              [
                ['next', 'planner.youAreHere'],
                ['ready', 'stepStatus.ready'],
                ['waiting', 'stepStatus.waiting'],
                ['blocked', 'stepStatus.blocked'],
                ['done', 'planner.completed'],
              ] as const
            ).map(([kind, key]) => (
              <li key={key} className="flex items-center gap-2">
                <StatusNode kind={kind} size="sm" />
                {t(key)}
              </li>
            ))}
          </ul>
        </div>
      </section>
    )
  }

  if (props.error) {
    const detail = props.error instanceof ApiError ? (props.error.detail as ApiErrorDetail | undefined) : undefined
    if (detail?.code === 'unknown_ids') {
      return (
        <ErrorState message={t('planner.unknownIds')} onRetry={() => props.onRemoveUnknown(detail)} />
      )
    }
    const status = props.error instanceof ApiError ? props.error.status : 0
    return (
      <ErrorState
        message={status === 0 ? t('common.networkError') : status === 503 ? t('common.dbUnavailable') : t('planner.planError')}
        onRetry={props.onRetry}
      />
    )
  }

  if (!plan) return <LoadingState label={t('planner.generating')} />

  const counts = { ready: 0, waiting: 0, blocked: 0, in_progress: 0 }
  for (const s of plan.steps) counts[s.status] += 1
  // Process progress only (documents never count). Completions are reported by the user.
  const completedIds = plan.completed ? plan.completed.map((c) => c.service_id) : plan.completed_service_ids
  const total = plan.progress?.total_services ?? plan.steps.length + completedIds.length
  const nextId = plan.next_action.type === 'start_service' ? plan.next_action.service_id : null
  const docs = plan.document_summary
  const stops = [
    ...completedIds.map((id) => ({ id, kind: 'done' as NodeKind })),
    ...plan.steps.map((s) => ({ id: s.service_id, kind: (s.service_id === nextId ? 'next' : s.status) as NodeKind })),
  ]

  return (
    <div className={`space-y-6 transition-opacity duration-300 ${props.isFetching ? 'opacity-60' : ''}`}>
      <section aria-label={t('planner.overview')} className="rounded-[2rem] bg-card p-6 ring-1 ring-rule sm:p-7">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="font-display text-2xl font-semibold tracking-tight text-ink">{t('planner.servicesDone', { done: completedIds.length, total })}</p>
            <p className="text-xs text-muted">{t('planner.progressSource')}</p>
          </div>
          {props.isFetching && (
            <span role="status" className="flex items-center gap-2 text-sm text-muted">
              <span className="h-2 w-2 animate-dots rounded-full bg-jade-500" aria-hidden />
              {t('planner.updating')}
            </span>
          )}
        </div>
        <ol className="-mx-2 mt-5 flex overflow-x-auto px-2 pb-1" aria-hidden>
          {stops.map((s, i) => (
            <li key={s.id} className="flex min-w-[6.5rem] flex-1 flex-col">
              <div className="flex items-center">
                <StatusNode kind={s.kind} size="sm" />
                {i < stops.length - 1 && <span className={`mx-1 h-1 flex-1 rounded ${s.kind === 'done' ? 'bg-jade-600' : 'bg-rule-strong'}`} />}
              </div>
              <span className={`mt-2 line-clamp-2 pr-3 text-xs leading-snug ${s.kind === 'next' ? 'font-bold text-ink' : 'text-muted'}`}>{names.service(s.id)}</span>
            </li>
          ))}
        </ol>
        <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-1.5 border-t border-rule pt-4 text-xs font-semibold text-muted">
          <li className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-ink" aria-hidden />{t('planner.countReady', { count: counts.ready })}</li>
          <li className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full border-2 border-waiting" aria-hidden />{t('planner.countWaiting', { count: counts.waiting })}</li>
          <li className="flex items-center gap-1.5 text-crimson-600"><span className="h-2 w-2 rounded-full bg-crimson-500" aria-hidden />{t('planner.countBlocked', { count: counts.blocked })}</li>
          {counts.in_progress > 0 && (
            <li className="flex items-center gap-1.5 text-jade-700"><span className="h-2 w-2 rounded-full ring-2 ring-jade-500" aria-hidden />{t('planner.countInProgress', { count: counts.in_progress })}</li>
          )}
          <li className="flex items-center gap-1.5 text-jade-700"><span className="h-2 w-2 rounded-full bg-jade-600" aria-hidden />{t('planner.countCompleted', { count: completedIds.length })}</li>
        </ul>
        {docs && (
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-2xl bg-paper px-4 py-3 text-xs ring-1 ring-rule">
            <span className="flex items-center gap-1.5 font-bold text-ink"><Icon name="doc" className="h-3.5 w-3.5 text-jade-600" />{t('planner.docReadiness')}</span>
            <span className="text-muted">{t('planner.docsMet', { done: docs.satisfied, total: docs.mandatory_requirements })}</span>
            {docs.will_be_produced > 0 && <span className="text-muted">{t('planner.docsProduced', { count: docs.will_be_produced })}</span>}
            {docs.missing > 0 && <span className="font-semibold text-crimson-600">{t('planner.docsMissing', { count: docs.missing })}</span>}
            {docs.unusable.length > 0 && <span className="font-semibold text-honey-700">{t('planner.docsUnusable', { count: docs.unusable.length })}</span>}
          </div>
        )}
      </section>
      {(plan.clarifications?.length ?? 0) > 0 && (
        <p className="rounded-2xl bg-zest-100 px-5 py-4 text-sm font-semibold text-ink ring-1 ring-zest-300">
          {t('planner.stateNeeded', {
            services: names.services(plan.clarifications!.map((c) => c.service_id)),
            regions: [...new Set(plan.clarifications!.map((c) => c.region ?? ''))].join(t('common.listSeparator')),
          })}
        </p>
      )}
      {(plan.notices ?? []).map((n) =>
        n.code === 'progress_outside_plan' ? (
          <div
            key={`${n.code}-${n.service_id}`}
            data-testid={`notice-progress-${n.service_id}`}
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-honey-50 px-5 py-4 text-sm text-honey-700 ring-1 ring-honey-100"
          >
            <p className="min-w-0 flex-1">{t('planner.noticeProgressOutside', { service: names.service(n.service_id) })}</p>
            <button type="button" onClick={() => props.onProcess(n.service_id, 'not_started')} className={buttonClass('secondary', 'sm')}>
              {t('planner.clearProgress')}
            </button>
          </div>
        ) : (
          <p key={`${n.code}-${n.service_id}`} className="rounded-2xl bg-honey-50 px-5 py-4 text-sm text-honey-700 ring-1 ring-honey-100">
            {n.code === 'started_before_dependencies'
              ? t('planner.noticeEarlyStart', { service: names.service(n.service_id), services: names.services(n.related_service_ids) })
              : t('planner.noticeOutside', { service: names.service(n.service_id), state: plan.citizen_state ?? '' })}
          </p>
        ),
      )}
      <NextActionCard plan={plan} names={names} onMarkDone={props.onMarkDone} onOwn={props.onOwn} />
      <IssuesPanel plan={plan} names={names} />
      <Timeline
        plan={plan}
        names={names}
        onMarkDone={props.onMarkDone}
        onUndoDone={props.onUndoDone}
        onOwn={props.onOwn}
        onProcess={props.onProcess}
      />
    </div>
  )
}
