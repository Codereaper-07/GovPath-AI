import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
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
      <PageHeader title={t('planner.title')}>{t('planner.intro')}</PageHeader>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <aside
          className={`space-y-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:sticky lg:top-0 lg:order-1 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto ${
            sel.generated ? 'order-2' : ''
          }`}
        >
          <ServicePicker services={services.data} selected={sel.targets} onChange={setTarget} />
          <DocumentChecklist
            documents={documents.data}
            relevantServiceIds={relevant}
            owned={sel.owned}
            highlight={highlight}
            onChange={state.setOwned}
          />
          {!sel.generated ? (
            <button
              type="button"
              disabled={sel.targets.length === 0}
              onClick={state.generate}
              className="w-full rounded-lg bg-brand-600 px-4 py-2.5 font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {t('planner.generate')}
            </button>
          ) : (
            <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
              <span>{t('planner.autoUpdate')}</span>
              <button type="button" onClick={state.reset} className="text-brand-700 underline">
                {t('planner.startOver')}
              </button>
            </div>
          )}
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
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-600">
        <p className="font-medium text-slate-800">{props.hasTargets ? t('planner.readyToGenerate') : t('planner.emptyTitle')}</p>
        <p className="mt-1 text-sm">{t('planner.emptyHint')}</p>
      </div>
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

  return (
    <div className={`space-y-6 transition-opacity ${props.isFetching ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {props.isFetching && (
          <span role="status" className="text-slate-500">
            {t('planner.updating')}
          </span>
        )}
        <span className="rounded-full bg-brand-50 px-2.5 py-1 text-brand-700">{t('planner.countReady', { count: counts.ready })}</span>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">{t('planner.countWaiting', { count: counts.waiting })}</span>
        <span className="rounded-full bg-red-50 px-2.5 py-1 text-red-700">{t('planner.countBlocked', { count: counts.blocked })}</span>
        <span className="rounded-full bg-green-50 px-2.5 py-1 text-green-700">
          {t('planner.countCompleted', { count: plan.completed_service_ids.length })}
        </span>
      </div>
      <NextActionCard plan={plan} names={names} onMarkDone={props.onMarkDone} onOwn={props.onOwn} />
      <IssuesPanel plan={plan} names={names} />
      <Timeline plan={plan} names={names} onMarkDone={props.onMarkDone} onUndoDone={props.onUndoDone} onOwn={props.onOwn} />
    </div>
  )
}
