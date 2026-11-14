import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { buttonClass } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { PageHeader } from '../../components/ui/PageHeader'
import { ErrorState, LoadingState } from '../../components/ui/States'
import { ApiError } from '../../lib/apiClient'
import type { ApiErrorDetail, PlanRequest, PlanResponse } from '../../types/api'
import { useDocuments, useServices } from '../services/api'
import { usePlan } from './api'
import { DocumentChecklist } from './components/DocumentChecklist'
import { IssuesPanel } from './components/IssuesPanel'
import { NextActionCard } from './components/NextActionCard'
import { ServicePicker } from './components/ServicePicker'
import { type NodeKind, StatusNode } from './components/StatusNode'
import { Timeline } from './components/Timeline'
import { type PlanNames, usePlanNames } from './names'
import { usePlannerState } from './usePlannerState'

export function PlannerPage() {
  const { t } = useTranslation()
  const services = useServices()
  const documents = useDocuments()
  const state = usePlannerState()
  const { selection: sel, setTarget, keepOnly } = state
  const [params, setParams] = useSearchParams()

  // "Plan this service" links from service detail pages: /planner?service=<id>
  const preselect = params.get('service')
  useEffect(() => {
    if (preselect) {
      setTarget(preselect, true)
      setParams({}, { replace: true })
    }
  }, [preselect, setTarget, setParams])

  // Drop saved selections that the backend no longer knows about.
  useEffect(() => {
    if (services.data && documents.data) {
      keepOnly(new Set(services.data.map((s) => s.id)), new Set(documents.data.map((d) => d.id)))
    }
  }, [services.data, documents.data, keepOnly])

  const request: PlanRequest | null = useMemo(
    () =>
      sel.generated && sel.targets.length > 0
        ? {
            target_service_ids: [...sel.targets].sort(),
            owned_document_ids: [...sel.owned].sort(),
            completed_service_ids: [...sel.completed].sort(),
          }
        : null,
    [sel],
  )
  const plan = usePlan(request)
  const names = usePlanNames(plan.data, services.data ?? [], documents.data ?? [])

  if (services.isPending || documents.isPending) return <LoadingState />
  if (services.isError || documents.isError) {
    return (
      <ErrorState
        message={t('services.loadError')}
        onRetry={() => {
          void services.refetch()
          void documents.refetch()
        }}
      />
    )
  }

  const relevant = [...new Set([...sel.targets, ...(plan.data?.steps.map((s) => s.service_id) ?? [])])]
  const highlight = new Set(
    (plan.data?.steps ?? []).flatMap((s) =>
      s.requirements.filter((r) => r.state === 'missing').flatMap((r) => r.document_options),
    ),
  )

  return (
    <>
      <PageHeader eyebrow={t('planner.eyebrow')} title={t('planner.title')}>{t('planner.intro')}</PageHeader>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,23rem)_minmax(0,1fr)] lg:gap-10">
        <aside
          aria-label={t('planner.setupLabel')}
          className={`lg:sticky lg:top-24 lg:order-1 lg:max-h-[calc(100vh-7.5rem)] lg:self-start lg:overflow-y-auto ${sel.generated ? 'order-2' : ''}`}
        >
          <div className="space-y-8 rounded-[2rem] bg-paper-deep/60 p-5 ring-1 ring-rule sm:p-6">
            <ServicePicker services={services.data} selected={sel.targets} onChange={setTarget} />
            <DocumentChecklist
              documents={documents.data}
              relevantServiceIds={relevant}
              owned={sel.owned}
              highlight={highlight}
              onChange={state.setOwned}
            />
          </div>
          <div className="sticky bottom-0 bg-gradient-to-t from-paper via-paper to-paper/0 pt-4 pb-1">
            {!sel.generated ? (
              <button type="button" disabled={sel.targets.length === 0} onClick={state.generate} className={buttonClass('primary', 'lg', 'w-full')}>
                <Icon name="plan" className="h-5 w-5" />
                {t('planner.generate')}
              </button>
            ) : (
              <div className="flex items-center justify-between gap-3 rounded-2xl bg-card px-4 py-3 text-xs text-muted ring-1 ring-rule">
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-jade-500" aria-hidden />
                  {t('planner.autoUpdate')}
                </span>
                <button type="button" onClick={state.reset} className="shrink-0 font-bold text-ink underline">
                  {t('planner.startOver')}
                </button>
              </div>
            )}
          </div>
        </aside>

        {/* On small screens, show the plan above the checklist once it exists. */}
        <div className={`min-w-0 space-y-6 lg:order-2 ${sel.generated ? 'order-1' : ''}`} aria-live="polite">
          <Results
            generated={sel.generated}
            hasTargets={sel.targets.length > 0}
            plan={plan.data}
            isFetching={plan.isFetching}
            error={plan.error}
            names={names}
            onRetry={() => void plan.refetch()}
            onRemoveUnknown={(d) => {
              const s = new Set(d.unknown_service_ids ?? [])
              const docs = new Set(d.unknown_document_ids ?? [])
              keepOnly(
                new Set(services.data.map((x) => x.id).filter((x) => !s.has(x))),
                new Set(documents.data.map((x) => x.id).filter((x) => !docs.has(x))),
              )
            }}
            onMarkDone={(id) => state.setCompleted(id, true)}
            onUndoDone={(id) => state.setCompleted(id, false)}
            onOwn={(id) => state.setOwned(id, true)}
          />
        </div>
      </div>
    </>
  )
}

function Results(props: {
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

  const counts = { ready: 0, waiting: 0, blocked: 0 }
  for (const s of plan.steps) counts[s.status] += 1
  const total = plan.steps.length + plan.completed_service_ids.length
  const nextId = plan.next_action.type === 'start_service' ? plan.next_action.service_id : null
  const stops = [
    ...plan.completed_service_ids.map((id) => ({ id, kind: 'done' as NodeKind })),
    ...plan.steps.map((s) => ({ id: s.service_id, kind: (s.service_id === nextId ? 'next' : s.status) as NodeKind })),
  ]

  return (
    <div className={`space-y-6 transition-opacity duration-300 ${props.isFetching ? 'opacity-60' : ''}`}>
      <section aria-label={t('planner.overview')} className="rounded-[2rem] bg-card p-6 ring-1 ring-rule sm:p-7">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-display text-2xl font-semibold tracking-tight text-ink">
            {t('home.progressValue', { done: plan.completed_service_ids.length, total })}
          </p>
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
          <li className="flex items-center gap-1.5 text-jade-700"><span className="h-2 w-2 rounded-full bg-jade-600" aria-hidden />{t('planner.countCompleted', { count: plan.completed_service_ids.length })}</li>
        </ul>
      </section>
      <NextActionCard plan={plan} names={names} onMarkDone={props.onMarkDone} onOwn={props.onOwn} />
      <IssuesPanel plan={plan} names={names} />
      <Timeline plan={plan} names={names} onMarkDone={props.onMarkDone} onUndoDone={props.onUndoDone} onOwn={props.onOwn} />
    </div>
  )
}
