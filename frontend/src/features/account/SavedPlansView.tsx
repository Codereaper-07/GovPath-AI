import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { buttonClass } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { ErrorState, LoadingState } from '../../components/ui/States'
import { ApiError } from '../../lib/apiClient'
import { useLocalized } from '../../lib/useLocalized'
import type { PlanChange, ProcessState, SavedPlan, SavedPlanSummary } from '../../types/api'
import { Notice } from '../auth/AuthLayout'
import { INPUT_CLASS } from '../auth/authUtils'
import { useVocabulary } from '../planner/api'
import { PlanResults } from '../planner/components/PlanResults'
import { ServicePicker } from '../planner/components/ServicePicker'
import { usePlanNames } from '../planner/names'
import { readSavedPlan } from '../planner/usePlannerState'
import { useDocuments, useServices } from '../services/api'
import { useAddDocument, usePlanAction, useSavedPlan, useSavedPlans, useSetProgress, useUpdatePlan, useVault } from './api'
import { AccountBadge } from './AccountBadge'
import { ImportLocalPlan } from './ImportLocalPlan'
import { PlanChangesNotice } from './PlanChangesNotice'

/** Saved plans for the signed-in citizen. Every change goes to the backend, which re-runs the
 * deterministic planner; this view only renders the stored result. */
export function SavedPlansView() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const active = useSavedPlans('active')
  const archived = useSavedPlans('archived')
  const services = useServices()
  const documents = useDocuments()
  const requested = params.get('plan')
  const all = [...(active.data ?? []), ...(archived.data ?? [])]
  const selectedId = requested && all.some((p) => p.id === requested) ? requested : (active.data?.[0]?.id ?? null)
  const plan = useSavedPlan(selectedId)
  const select = (id: string | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set('plan', id)
    else next.delete('plan')
    setParams(next, { replace: true })
  }

  if (active.isPending || archived.isPending || services.isPending || documents.isPending) return <LoadingState />
  if (active.isError || archived.isError) return <ErrorState message={t('account.plansLoadError')} onRetry={() => void active.refetch()} />
  if (services.isError || documents.isError) return <ErrorState message={t('services.loadError')} onRetry={() => void services.refetch()} />

  const hasLocal = readSavedPlan().targets.length > 0
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <AccountBadge />
        <Link to="/vault" className="text-sm font-semibold text-jade-700 underline-offset-4 hover:underline">
          {t('vault.title')}
        </Link>
        <Link to="/activity" className="text-sm font-semibold text-jade-700 underline-offset-4 hover:underline">
          {t('activity.title')}
        </Link>
      </div>
      <AddServiceFromLink plans={active.data} onSaved={select} />
      {active.data.length === 0 && !requested ? (
        <div className="space-y-5">
          <section className="ink-panel relative overflow-hidden rounded-[2rem] p-7 sm:p-9">
            <p className="font-display text-2xl font-semibold text-paper">{t('account.noPlansTitle')}</p>
            <p className="mt-2 max-w-xl text-paper/70">{t('account.noPlans')}</p>
            <Link to="/assistant" className={buttonClass('zest', 'md', 'mt-5')}>
              <Icon name="spark" className="h-4 w-4" /> {t('account.startFromSituation')}
            </Link>
          </section>
          {hasLocal && <ImportLocalPlan onImported={select} />}
          {archived.data.length > 0 && <ArchivedList plans={archived.data} selectedId={selectedId} onSelect={select} />}
        </div>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,23rem)_minmax(0,1fr)] lg:gap-10">
          <aside className="space-y-5 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7.5rem)] lg:self-start lg:overflow-y-auto">
            <PlanList plans={active.data} selectedId={selectedId} onSelect={select} />
            {plan.data && <PlanSettings plan={plan.data} onGone={() => select(null)} />}
            {archived.data.length > 0 && <ArchivedList plans={archived.data} selectedId={selectedId} onSelect={select} />}
          </aside>
          <div className="min-w-0" aria-live="polite">
            {plan.isError && <ErrorState message={t('account.planLoadError')} onRetry={() => void plan.refetch()} />}
            {plan.isPending && selectedId && <LoadingState />}
            {/* keyed: notices from one plan never show on another */}
            {plan.data && <SavedPlanBody key={plan.data.id} plan={plan.data} fetching={plan.isFetching} />}
          </div>
        </div>
      )}
    </div>
  )
}

function planTitle(p: SavedPlanSummary, name: (id: string) => string, untitled: string) {
  return p.title || p.target_service_ids.map(name).join(', ') || untitled
}

function useServiceName() {
  const pick = useLocalized()
  const services = useServices()
  return (id: string) => {
    const s = services.data?.find((x) => x.id === id)
    return s ? pick(s.name, s.name_hi) : id
  }
}

function PlanList({ plans, selectedId, onSelect }: { plans: SavedPlanSummary[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const { t } = useTranslation()
  const name = useServiceName()
  return (
    <nav aria-label={t('account.yourPlans')} className="rounded-[2rem] bg-paper-deep/60 p-4 ring-1 ring-rule">
      <p className="px-2 pb-2 text-xs font-bold tracking-[0.14em] text-muted uppercase">{t('account.yourPlans')}</p>
      <ul className="space-y-2">
        {plans.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onSelect(p.id)}
              aria-current={p.id === selectedId ? 'true' : undefined}
              className={`w-full rounded-2xl px-4 py-3 text-left transition ${p.id === selectedId ? 'bg-ink text-paper shadow-soft' : 'bg-card text-ink ring-1 ring-rule hover:ring-ink'}`}
            >
              <span className="block text-sm leading-snug font-semibold">{planTitle(p, name, t('account.untitledPlan'))}</span>
              <span className={`mt-1 block text-xs ${p.id === selectedId ? 'text-paper/70' : 'text-muted'}`}>
                {t('planner.servicesDone', { done: p.completed, total: p.total_services })}
                {p.blocked > 0 && ` · ${t('planner.countBlocked', { count: p.blocked })}`}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function ArchivedList({ plans, selectedId, onSelect }: { plans: SavedPlanSummary[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const { t } = useTranslation()
  const name = useServiceName()
  return (
    <details className="rounded-[2rem] bg-card p-4 ring-1 ring-rule" open={plans.some((p) => p.id === selectedId)}>
      <summary className="cursor-pointer px-2 text-sm font-semibold text-ink">{t('account.archivedPlans', { count: plans.length })}</summary>
      <ul className="mt-3 space-y-2">
        {plans.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => onSelect(p.id)} className="w-full rounded-2xl px-3 py-2 text-left text-sm text-muted ring-1 ring-rule hover:text-ink">
              {planTitle(p, name, t('account.untitledPlan'))}
            </button>
          </li>
        ))}
      </ul>
    </details>
  )
}

function PlanSettings({ plan, onGone }: { plan: SavedPlan; onGone: () => void }) {
  const { t } = useTranslation()
  const services = useServices()
  const vocabulary = useVocabulary()
  const update = useUpdatePlan()
  const action = usePlanAction()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const archivedPlan = plan.status === 'archived'

  return (
    <div className="space-y-5 rounded-[2rem] bg-paper-deep/60 p-5 ring-1 ring-rule">
      {archivedPlan ? (
        <Notice tone="info">{t('account.archivedNote')}</Notice>
      ) : (
        <>
          <label className="block">
            <span className="mb-1.5 block text-xs font-bold tracking-[0.14em] text-muted uppercase">{t('situation.stateLabel')}</span>
            <select
              className={`${INPUT_CLASS} font-semibold`}
              value={plan.citizen_state ?? ''}
              disabled={update.isPending}
              onChange={(e) => update.mutate({ id: plan.id, state: e.target.value || null })}
            >
              <option value="">{t('situation.stateUnknown')}</option>
              {(vocabulary.data?.states ?? []).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          {services.data && (
            <ServicePicker
              services={services.data}
              selected={plan.target_service_ids}
              onChange={(id, on) => {
                const next = on ? [...plan.target_service_ids, id] : plan.target_service_ids.filter((x) => x !== id)
                if (next.length > 0) update.mutate({ id: plan.id, target_service_ids: next })
              }}
            />
          )}
          {plan.target_service_ids.length === 1 && <p className="text-xs text-muted">{t('account.lastService')}</p>}
        </>
      )}
      {update.isError && <Notice tone="error">{t('account.saveError')}</Notice>}
      <div className="flex flex-wrap gap-2 border-t border-rule pt-4">
        {archivedPlan ? (
          <>
            <button type="button" className={buttonClass('primary', 'sm')} disabled={action.isPending} onClick={() => action.mutate({ id: plan.id, action: 'restore' })}>
              {t('account.restore')}
            </button>
            {confirmDelete ? (
              <>
                <button
                  type="button"
                  className={buttonClass('secondary', 'sm')}
                  disabled={action.isPending}
                  onClick={() => action.mutate({ id: plan.id, action: 'delete' }, { onSuccess: onGone })}
                >
                  {t('account.deleteYes')}
                </button>
                <button type="button" className={buttonClass('ghost', 'sm')} onClick={() => setConfirmDelete(false)}>
                  {t('vault.cancel')}
                </button>
              </>
            ) : (
              <button type="button" className={buttonClass('ghost', 'sm')} onClick={() => setConfirmDelete(true)}>
                {t('account.delete')}
              </button>
            )}
          </>
        ) : (
          <button type="button" className={buttonClass('secondary', 'sm')} disabled={action.isPending} onClick={() => action.mutate({ id: plan.id, action: 'archive' }, { onSuccess: onGone })}>
            {t('account.archive')}
          </button>
        )}
      </div>
    </div>
  )
}

function SavedPlanBody({ plan, fetching }: { plan: SavedPlan; fetching: boolean }) {
  const { t } = useTranslation()
  const services = useServices()
  const documents = useDocuments()
  const vault = useVault()
  const setProgress = useSetProgress()
  const addDoc = useAddDocument()
  const action = usePlanAction()
  const [changes, setChanges] = useState<PlanChange[] | null>(null)
  const [docError, setDocError] = useState<string | null>(null)
  const names = usePlanNames(plan.plan ?? undefined, services.data ?? [], documents.data ?? [])

  const progress = (serviceId: string, state: ProcessState) =>
    setProgress.mutate({ serviceId, state }, { onSuccess: (r) => setChanges(r.plan_changes) })
  const own = (documentType: string) => {
    setDocError(null)
    addDoc.mutate(
      { document_type: documentType, status: 'valid' },
      {
        onSuccess: (r) => setChanges(r.plan_changes),
        onError: (e) => setDocError(e instanceof ApiError && e.status === 409 ? 'account.alreadyInVault' : 'account.saveError'),
      },
    )
  }
  const frozen = plan.status === 'archived'
  const vaultCount = new Set(plan.document_refs.flatMap((r) => r.vault_document_ids)).size

  return (
    <div className="space-y-5">
      {plan.evaluation_error && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-honey-50 px-5 py-4 text-sm text-honey-700 ring-1 ring-honey-100">
          <p className="min-w-0 flex-1">{t('account.staleSnapshot')}</p>
          <button type="button" className={buttonClass('secondary', 'sm')} disabled={action.isPending} onClick={() => action.mutate({ id: plan.id, action: 'recalculate' })}>
            {t('account.recalculate')}
          </button>
        </div>
      )}
      {changes && changes.length > 0 && (
        <div className="rounded-[1.5rem] bg-paper-deep/50 p-5 ring-1 ring-rule" role="status">
          <PlanChangesNotice changes={changes} />
        </div>
      )}
      {docError && <Notice tone="error">{t(docError)}</Notice>}
      <p className="flex flex-wrap items-center gap-2 rounded-2xl bg-card px-4 py-3 text-xs text-muted ring-1 ring-rule">
        <Icon name="doc" className="h-3.5 w-3.5 text-jade-600" />
        {t('account.usesVault', { count: vaultCount, total: vault.data?.length ?? 0 })}
        <Link to="/vault" className="font-semibold text-jade-700 underline-offset-4 hover:underline">
          {t('account.manageVault')}
        </Link>
      </p>
      {plan.plan ? (
        <PlanResults
          generated
          hasTargets
          plan={plan.plan}
          isFetching={fetching || setProgress.isPending || addDoc.isPending}
          error={null}
          names={names}
          onRetry={() => undefined}
          onRemoveUnknown={() => undefined}
          onMarkDone={(id) => !frozen && progress(id, 'completed')}
          onUndoDone={(id) => !frozen && progress(id, 'not_started')}
          onOwn={(id) => !frozen && own(id)}
          onProcess={(id, p) => !frozen && progress(id, p)}
        />
      ) : (
        <ErrorState message={t('account.planLoadError')} />
      )}
    </div>
  )
}

/** "Plan this service" links (/planner?service=<id>) for signed-in citizens: add to a saved plan. */
function AddServiceFromLink({ plans, onSaved }: { plans: SavedPlanSummary[]; onSaved: (id: string) => void }) {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const serviceId = params.get('service')
  const name = useServiceName()
  const update = useUpdatePlan()
  const [target, setTarget] = useState('')
  if (!serviceId) return null
  const clear = (planId?: string) => {
    const next = new URLSearchParams(params)
    next.delete('service')
    if (planId) next.set('plan', planId)
    setParams(next, { replace: true })
  }
  const chosen = target || plans[0]?.id || ''
  return (
    <section className="rounded-[2rem] bg-zest-100 p-5 ring-1 ring-zest-300" aria-label={t('account.addServiceTitle', { service: name(serviceId) })}>
      <p className="font-semibold text-ink">{t('account.addServiceTitle', { service: name(serviceId) })}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {plans.length > 0 && (
          <>
            <select className={`${INPUT_CLASS} max-w-xs font-semibold`} value={chosen} onChange={(e) => setTarget(e.target.value)} aria-label={t('account.yourPlans')}>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {planTitle(p, name, t('account.untitledPlan'))}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={buttonClass('primary', 'sm')}
              disabled={update.isPending || !chosen}
              onClick={() => {
                const p = plans.find((x) => x.id === chosen)
                if (!p) return
                update.mutate(
                  { id: p.id, target_service_ids: [...new Set([...p.target_service_ids, serviceId])] },
                  {
                    onSuccess: () => {
                      clear(p.id)
                      onSaved(p.id)
                    },
                  },
                )
              }}
            >
              {t('account.addToPlan')}
            </button>
          </>
        )}
        <button type="button" className={buttonClass('ghost', 'sm')} onClick={() => clear()}>
          {t('vault.cancel')}
        </button>
        <Link to={`/planner?mode=device&service=${encodeURIComponent(serviceId)}`} className="text-sm font-semibold text-jade-700 underline-offset-4 hover:underline">
          {t('account.useDeviceInstead')}
        </Link>
      </div>
      {update.isError && <Notice tone="error">{t('account.saveError')}</Notice>}
    </section>
  )
}
