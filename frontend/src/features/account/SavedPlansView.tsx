import { useStateName } from '../../lib/useStateName'
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
import { useDocuments, useServices } from '../services/api'
import { useProfile } from '../auth/api'
import { useAddDocument, useCreatePlan, usePlanAction, useSavedPlan, useSavedPlans, useSetProgress, useUpdatePlan, useVault } from './api'
import { AccountBadge } from './AccountBadge'
import { usePlanName } from './planName'
import { CreatePlanPanel } from './CreatePlanPanel'
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
      {params.get('saved') && (
        <Notice tone="success">{params.get('saved') === 'separate' ? t('myPlans.savedSeparate', { count: Number(params.get('count') ?? 0) }) : t(params.get('saved') === 'repeat_request' ? 'myPlans.savedRepeat' : params.get('saved') === 'updated' ? 'myPlans.updated' : 'myPlans.saved')}</Notice>
      )}
      {/* Creating a plan is always possible, whatever plans exist (none, active, archived). */}
      <CreatePlanPanel compact={active.data.length + archived.data.length > 0} />
      {active.data.length === 0 && !requested ? (
        <div className="space-y-5" data-testid="no-active-plans">
          <p className="rounded-2xl bg-paper-deep/60 px-5 py-4 text-sm text-muted ring-1 ring-rule">
            {t(archived.data.length ? 'myPlans.noActiveOnlyArchived' : 'myPlans.noPlansYet')}
          </p>
          {archived.data.length > 0 && <ArchivedList plans={archived.data} selectedId={selectedId} onSelect={select} />}
        </div>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,23rem)_minmax(0,1fr)] lg:gap-10">
          <aside className="space-y-5 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7.5rem)] lg:self-start lg:overflow-y-auto">
            <PlanList plans={active.data} selectedId={selectedId} onSelect={select} />
            {plan.data && <PlanSettings key={plan.data.id} plan={plan.data} onGone={() => select(null)} />}
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
              <PlanCardBody plan={p} selected={p.id === selectedId} />
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/** Name, kind (combined / single service), services, progress and the next step or blocker. */
function PlanCardBody({ plan: p, selected }: { plan: SavedPlanSummary; selected: boolean }) {
  const { t } = useTranslation()
  const name = useServiceName()
  const { name: planName } = usePlanName()
  const muted = selected ? 'text-paper/70' : 'text-muted'
  const combined = p.target_service_ids.length > 1
  const next = p.next_action
  return (
    <>
      <span className="block text-sm leading-snug font-semibold">{planName(p)}</span>
      <span className={`mt-1 flex flex-wrap gap-1.5 text-[11px] font-bold tracking-wide uppercase ${muted}`}>
        <span>{combined ? t('myPlans.kindCombined', { count: p.target_service_ids.length }) : t('myPlans.kindSingle')}</span>
        {p.status === 'archived' && <span>· {t('myPlans.archived')}</span>}
      </span>
      {combined && <span className={`mt-1 block text-xs ${muted}`}>{p.target_service_ids.map(name).join(', ')}</span>}
      <span className={`mt-1 block text-xs ${muted}`} data-testid="plan-card-progress">
        {t('myPlans.stepsDone', { done: p.completed, total: p.total_services })}
        {p.blocked > 0 && <span className={selected ? '' : 'text-crimson-600'}> · {t('planner.countBlocked', { count: p.blocked })}</span>}
      </span>
      {next && next.type !== 'none' && p.status === 'active' && (
        <span className={`mt-1 block text-xs font-semibold ${selected ? 'text-zest-300' : 'text-jade-700'}`} data-testid="plan-card-next">
          {next.type === 'obtain_document'
            ? t('myPlans.nextGetDocument')
            : next.type === 'follow_up'
              ? t('myPlans.nextFollowUp', { service: name(next.service_id ?? '') })
              : t('myPlans.nextStart', { service: name(next.service_id ?? '') })}
        </span>
      )}
      {next?.type === 'none' && <span className={`mt-1 block text-xs font-semibold ${muted}`}>{t('myPlans.allDone')}</span>}
    </>
  )
}

function ArchivedList({ plans, selectedId, onSelect }: { plans: SavedPlanSummary[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const { t } = useTranslation()
  return (
    <details className="rounded-[2rem] bg-card p-4 ring-1 ring-rule" open={plans.some((p) => p.id === selectedId)} data-testid="archived-plans">
      <summary className="cursor-pointer px-2 text-sm font-semibold text-ink">{t('account.archivedPlans', { count: plans.length })}</summary>
      <ul className="mt-3 space-y-2">
        {plans.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onSelect(p.id)}
              aria-current={p.id === selectedId ? 'true' : undefined}
              className={`w-full rounded-2xl px-3 py-2 text-left text-sm ring-1 ring-rule hover:text-ink ${p.id === selectedId ? 'bg-paper-deep text-ink' : 'text-muted'}`}
            >
              <PlanCardBody plan={p} selected={false} />
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
  const stateName = useStateName()
  const update = useUpdatePlan()
  const action = usePlanAction()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { name: planName, isGenerated } = usePlanName()
  // Only a name the citizen typed is editable text; a generated one is shown as the placeholder.
  const userTitle = isGenerated(plan.title) ? '' : (plan.title ?? '')
  const [title, setTitle] = useState(userTitle)
  const archivedPlan = plan.status === 'archived'
  const titleChanged = title.trim() !== userTitle

  return (
    <div className="space-y-5 rounded-[2rem] bg-paper-deep/60 p-5 ring-1 ring-rule">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (titleChanged) update.mutate({ id: plan.id, title: title.trim() || null })
        }}
      >
        <label className="block min-w-0 flex-1">
          <span className="mb-1.5 block text-xs font-bold tracking-[0.14em] text-muted uppercase">{t('myPlans.name')}</span>
          <input className={INPUT_CLASS} name="plan-title" maxLength={120} value={title} placeholder={planName({ ...plan, title: null })} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <button type="submit" disabled={!titleChanged || update.isPending} className={buttonClass('secondary', 'sm')}>
          {t('myPlans.rename')}
        </button>
      </form>
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
                  {stateName(s)}
                </option>
              ))}
            </select>
          </label>
          {services.data && (
            <ServicePicker
              title={t('myPlans.planServices')}
              hint={t('myPlans.planServicesHint')}
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
      {action.isError && <Notice tone="error">{t('account.saveError')}</Notice>}
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
  const { name: planName } = usePlanName()
  const update = useUpdatePlan()
  const create = useCreatePlan()
  const profile = useProfile()
  const [requestId] = useState(() => crypto.randomUUID())
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
                  {planName(p)}
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
        <button
          type="button"
          className={buttonClass(plans.length ? 'secondary' : 'primary', 'sm')}
          disabled={create.isPending}
          onClick={() =>
            create.mutate(
              { source: 'planner', target_service_ids: [serviceId], state: profile.data?.state ?? null, client_request_id: requestId },
              {
                onSuccess: (p) => {
                  clear(p.id)
                  onSaved(p.id)
                },
              },
            )
          }
        >
          {t('myPlans.newPlanWith')}
        </button>
      </div>
      {(update.isError || create.isError) && <Notice tone="error">{t('account.saveError')}</Notice>}
    </section>
  )
}
