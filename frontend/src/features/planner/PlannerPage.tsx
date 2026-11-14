import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { buttonClass } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { PageHeader } from '../../components/ui/PageHeader'
import { ErrorState, LoadingState } from '../../components/ui/States'
import type { PlanRequest } from '../../types/api'
import { AccountBadge } from '../account/AccountBadge'
import { ImportLocalPlan } from '../account/ImportLocalPlan'
import { SavedPlansView } from '../account/SavedPlansView'
import { useAuth } from '../auth/useAuth'
import { useDocuments, useServices } from '../services/api'
import { usePlan, useVocabulary } from './api'
import { DocumentChecklist } from './components/DocumentChecklist'
import { PlanResults } from './components/PlanResults'
import { ServicePicker } from './components/ServicePicker'
import { SituationPanel } from './components/SituationPanel'
import { usePlanNames } from './names'
import { planRequestOf, usePlannerState } from './usePlannerState'

/**
 * Signed in: saved account plans (PostgreSQL) by default, with the device planner one tab away.
 * Signed out (or sign-in not configured): the device planner, exactly as before.
 */
export function PlannerPage() {
  const { t } = useTranslation()
  const { status } = useAuth()
  const [params, setParams] = useSearchParams()
  const signedIn = status === 'signedIn'
  // Wait for the stored session before choosing account vs device mode (no flash of the wrong one).
  if (status === 'loading') return <LoadingState />
  const mode = signedIn && params.get('mode') !== 'device' ? 'account' : 'device'
  const tab = (m: 'account' | 'device') => {
    const next = new URLSearchParams(params)
    if (m === 'device') next.set('mode', 'device')
    else next.delete('mode')
    setParams(next, { replace: true })
  }
  return (
    <>
      <PageHeader eyebrow={t('planner.eyebrow')} title={t('planner.title')}>{t('planner.intro')}</PageHeader>
      {signedIn && (
        <div role="tablist" aria-label={t('account.planTabs')} className="mb-8 inline-flex flex-wrap gap-1 rounded-full bg-paper-deep/70 p-1 ring-1 ring-rule">
          {(['account', 'device'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => tab(m)}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${mode === m ? 'bg-ink text-paper shadow-soft' : 'text-muted hover:text-ink'}`}
            >
              {t(m === 'account' ? 'account.savedTab' : 'account.deviceTab')}
            </button>
          ))}
        </div>
      )}
      {mode === 'account' ? <SavedPlansView /> : <DevicePlanner signedIn={signedIn} />}
    </>
  )
}

/** The browser-only planner (guest mode; localStorage `govpath.planner.v1`). Unchanged logic. */
function DevicePlanner({ signedIn }: { signedIn: boolean }) {
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
      setParams(signedIn ? { mode: 'device' } : {}, { replace: true })
    }
  }, [preselect, setTarget, setParams, signedIn])

  // Drop saved selections that the backend no longer knows about (only against successful,
  // non-empty lists: loading, errors or an empty response never erase saved data).
  const vocabulary = useVocabulary()
  useEffect(() => {
    if (services.data && documents.data) {
      keepOnly({ services: new Set(services.data.map((s) => s.id)), documents: new Set(documents.data.map((d) => d.id)) })
    }
  }, [services.data, documents.data, keepOnly])
  useEffect(() => {
    if (vocabulary.data) keepOnly({ goals: new Set(vocabulary.data.goals) })
  }, [vocabulary.data, keepOnly])

  const request: PlanRequest | null = useMemo(
    () => (sel.generated && sel.targets.length > 0 ? planRequestOf(sel) : null),
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
      {signedIn && (
        <div className="mb-6 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <AccountBadge device />
            <p className="text-xs text-muted">{t('account.deviceNote')}</p>
          </div>
          {sel.targets.length > 0 && <ImportLocalPlan />}
        </div>
      )}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,23rem)_minmax(0,1fr)] lg:gap-10">
        <aside
          aria-label={t('planner.setupLabel')}
          className={`lg:sticky lg:top-24 lg:order-1 lg:max-h-[calc(100vh-7.5rem)] lg:self-start lg:overflow-y-auto ${sel.generated ? 'order-2' : ''}`}
        >
          <div className="space-y-8 rounded-[2rem] bg-paper-deep/60 p-5 ring-1 ring-rule sm:p-6">
            <SituationPanel
              sel={sel}
              docName={names.document}
              onGoal={state.setGoal}
              onState={state.setCitizenState}
              onTarget={setTarget}
              onAddTargets={state.addTargets}
              onHave={(d) => state.setOwned(d, true)}
              onLack={(d) => state.setLacking(d, true)}
              onApply={state.applyContext}
            />
            <ServicePicker services={services.data} selected={sel.targets} onChange={setTarget} />
            <DocumentChecklist
              documents={documents.data}
              relevantServiceIds={relevant}
              owned={sel.owned}
              highlight={highlight}
              onChange={state.setOwned}
              docStates={sel.docStates}
              onDocState={state.setDocState}
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
          <PlanResults
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
              keepOnly({
                services: new Set(services.data.map((x) => x.id).filter((x) => !s.has(x))),
                documents: new Set(documents.data.map((x) => x.id).filter((x) => !docs.has(x))),
              })
            }}
            onMarkDone={(id) => state.setCompleted(id, true)}
            onUndoDone={(id) => state.setCompleted(id, false)}
            onOwn={(id) => state.setOwned(id, true)}
            onProcess={(id, p) => state.setProcess(id, p)}
          />
        </div>
      </div>
    </>
  )
}
