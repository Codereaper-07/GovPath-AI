import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { AIBadge } from '../../components/ui/Badge'
import { buttonClass } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { ErrorState, LoadingState } from '../../components/ui/States'
import { ApiError } from '../../lib/apiClient'
import type {
  ApiErrorDetail,
  HeldDocument,
  PlanRequest,
  ProcessState,
  ProposalResponse,
  ProposeRequest,
  SituationInterpretation,
  VaultDocument,
  VaultStatus,
} from '../../types/api'
import { useAccountProgress, useCreatePlan, useSavedPlans, useUpdatePlan, useVault } from '../account/api'
import { useProfile } from '../auth/api'
import { useAuth } from '../auth/useAuth'
import { useInterpretSituation, useProposal, useVocabulary } from '../planner/api'
import { IssuesPanel } from '../planner/components/IssuesPanel'
import { NextActionCard } from '../planner/components/NextActionCard'
import { GOAL_ORDER } from '../planner/goals'
import { Timeline } from '../planner/components/Timeline'
import { type PlanNames, usePlanNames } from '../planner/names'
import { type ProblemState, readSavedPlan, usePlannerState } from '../planner/usePlannerState'
import { useDocuments, useServices } from '../services/api'

/**
 * Describe → understand → discover → plan → review → accept.
 * AI only extracts facts (reviewed and editable here). Services come from deterministic discovery
 * over the curated knowledge base, and the workflow from the existing planner (`/propose`).
 * Nothing is saved until the citizen accepts. Guests: acceptance merges into, or replaces, the
 * plan in this browser. Signed in: the vault and account progress are the starting facts, and
 * acceptance saves a new account plan (or adds to one); reviewed documents missing from the vault
 * are added to it.
 */

type Phase = 'describe' | 'review' | 'proposal'

interface Draft {
  goals: string[]
  lifeEvents: string[]
  state: string | null
  held: string[]
  lacking: string[]
  docStates: Record<string, ProblemState>
  fromAI: boolean
  unknowns: string[]
  dropped: number
}

const uniq = (xs: string[]) => [...new Set(xs)]
const sorted = (xs: string[]) => [...xs].sort()
const sortObj = <V,>(r: Record<string, V>) => Object.fromEntries(Object.entries(r).sort(([a], [b]) => a.localeCompare(b)))

/** Start from what the citizen already told the planner (existing context is respected). */
function draftFromSaved(): Draft {
  const s = readSavedPlan()
  return { goals: s.goals, lifeEvents: [], state: s.state, held: s.owned, lacking: s.lacking, docStates: s.docStates, fromAI: false, unknowns: [], dropped: 0 }
}

/** Signed in: the vault is the source of truth for documents (same rule as the backend: a type
 * is usable if any copy is valid; otherwise its most hopeful problem state is shown). */
function draftFromAccount(vault: VaultDocument[], state: string | null, goals: string[]): Draft {
  const byType = new Map<string, Set<VaultStatus>>()
  for (const d of vault) byType.set(d.document_type, (byType.get(d.document_type) ?? new Set()).add(d.effective_status))
  const docStates: Record<string, ProblemState> = {}
  for (const [type, statuses] of byType) {
    if (statuses.has('valid')) continue
    docStates[type] = statuses.has('unsure') ? 'unsure' : statuses.has('expired') ? 'expired' : 'invalid'
  }
  return { goals, lifeEvents: [], state, held: [...byType.keys()], lacking: [], docStates, fromAI: false, unknowns: [], dropped: 0 }
}

/** Progress facts for a proposal: the account's when signed in, else this browser's. */
function useProgressFacts() {
  const { status } = useAuth()
  const account = useAccountProgress()
  const saved = readSavedPlan()
  if (status !== 'signedIn') return { completed: saved.completed, progress: saved.progress as Record<string, ProcessState> }
  const entries = Object.entries(account.data ?? {})
  return {
    completed: entries.filter(([, p]) => p === 'completed').map(([s]) => s),
    progress: Object.fromEntries(entries.filter(([, p]) => p !== 'completed')) as Record<string, ProcessState>,
  }
}

function withInterpretation(d: Draft, r: SituationInterpretation): Draft {
  const held = uniq([...d.held, ...r.held_document_ids]).filter((x) => !r.lacking_document_ids.includes(x))
  const states = { ...d.docStates, ...(r.document_states ?? {}) }
  return {
    goals: uniq([...d.goals, ...r.goals]),
    lifeEvents: uniq([...d.lifeEvents, ...r.life_events]),
    state: r.state ?? d.state,
    held,
    lacking: uniq([...d.lacking.filter((x) => !r.held_document_ids.includes(x)), ...r.lacking_document_ids]),
    docStates: Object.fromEntries(Object.entries(states).filter(([k]) => held.includes(k))),
    fromAI: true,
    unknowns: r.unknowns,
    dropped: r.dropped.length,
  }
}

export function SituationJourney({ onExplain }: { onExplain?: (workflow: PlanRequest) => void }) {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<Phase>('describe')
  const [draft, setDraft] = useState<Draft>(draftFromSaved)
  const [targets, setTargets] = useState<string[] | null>(null) // null = discovery's recommendation

  // Signed in: start from the vault (once, before the citizen has changed anything).
  const { status } = useAuth()
  const vault = useVault()
  const profile = useProfile()
  const seeded = useRef(false)
  const profileSettled = !profile.isPending || profile.fetchStatus === 'idle'
  useEffect(() => {
    if (status !== 'signedIn' || seeded.current || !vault.data || !profileSettled || phase !== 'describe') return
    seeded.current = true
    setDraft(draftFromAccount(vault.data, profile.data?.state ?? null, []))
  }, [status, vault.data, profile.data, profileSettled, phase])

  const saved = useProgressFacts()
  // Saved ids the knowledge base no longer has would make the whole request fail (422): drop
  // them, but only against successful, non-empty catalogues (never prune on a failed load).
  const services = useServices()
  const documents = useDocuments()
  const knownSvc = services.data?.length ? new Set(services.data.map((x) => x.id)) : null
  const knownDoc = documents.data?.length ? new Set(documents.data.map((x) => x.id)) : null
  const svcOk = (id: string) => !knownSvc || knownSvc.has(id)
  const docOk = (id: string) => !knownDoc || knownDoc.has(id)
  const keep = <V,>(r: Record<string, V>, ok: (id: string) => boolean) => Object.fromEntries(Object.entries(r).filter(([k]) => ok(k)))
  const request: ProposeRequest | null =
    phase === 'proposal'
      ? {
          context: {
            goals: sorted(draft.goals),
            life_events: sorted(draft.lifeEvents),
            state: draft.state,
            held_document_ids: sorted(draft.held.filter(docOk)),
            lacking_document_ids: sorted(draft.lacking.filter(docOk)),
            completed_service_ids: sorted(saved.completed.filter(svcOk)),
          },
          document_states: sortObj(keep(draft.docStates, docOk)),
          progress: sortObj(keep(saved.progress, svcOk)),
          target_service_ids: targets && targets.filter(svcOk),
        }
      : null

  const query = useProposalBridge(request)
  const hold = (doc: string) =>
    setDraft((d) => ({ ...d, held: uniq([...d.held, doc]), lacking: d.lacking.filter((x) => x !== doc) }))
  const lack = (doc: string) =>
    setDraft((d) => {
      const docStates = { ...d.docStates }
      delete docStates[doc]
      return { ...d, lacking: uniq([...d.lacking, doc]), held: d.held.filter((x) => x !== doc), docStates }
    })

  return (
    <section aria-labelledby="journey-title" className="rounded-[2rem] bg-card p-5 shadow-soft ring-1 ring-rule sm:p-7" data-testid="journey">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="journey-title" className="font-display text-2xl font-semibold tracking-tight text-ink">
          {t('journey.title')}
        </h2>
        <ol className="flex flex-wrap gap-1.5 text-[11px] font-bold tracking-wide uppercase" aria-label={t('journey.stepsLabel')}>
          {(['describe', 'review', 'proposal'] as const).map((p, i) => (
            <li key={p} aria-current={phase === p ? 'step' : undefined} className={`rounded-full px-2.5 py-1 ${phase === p ? 'bg-ink text-paper' : 'bg-paper text-muted ring-1 ring-rule'}`}>
              {i + 1}. {t(`journey.phase.${p}`)}
            </li>
          ))}
        </ol>
      </div>
      <p className="mt-1 text-sm text-muted">{t('journey.intro')}</p>

      {phase === 'describe' && (
        <Describe
          onUnderstood={(r) => {
            setDraft((d) => withInterpretation(d, r))
            setPhase('review')
          }}
          onManual={() => setPhase('review')}
        />
      )}
      {phase === 'review' && (
        <ReviewDraft
          draft={draft}
          setDraft={setDraft}
          onBack={() => setPhase('describe')}
          onContinue={() => {
            setTargets(null)
            setPhase('proposal')
          }}
        />
      )}
      {phase === 'proposal' && (
        <Proposal
          query={query}
          draft={draft}
          setState={(state) => setDraft((d) => ({ ...d, state }))}
          hold={hold}
          lack={lack}
          setTargets={setTargets}
          onEdit={() => setPhase('review')}
          onExplain={onExplain}
        />
      )}
    </section>
  )
}

// The request is null outside the proposal phase, so no call is made then.
function useProposalBridge(request: ProposeRequest | null) {
  return { request, ...useProposal(request) }
}

/* ------------------------------------------------------------------ describe */

function Describe({ onUnderstood, onManual }: { onUnderstood: (r: SituationInterpretation) => void; onManual: () => void }) {
  const { t, i18n } = useTranslation()
  const interpret = useInterpretSituation()
  const [text, setText] = useState('')
  const code = interpret.error instanceof ApiError ? (interpret.error.detail as ApiErrorDetail | undefined)?.code : undefined

  return (
    <div className="mt-5">
      <label htmlFor="journey-text" className="text-sm font-bold text-ink">
        {t('journey.describeLabel')}
      </label>
      <textarea
        id="journey-text"
        rows={4}
        maxLength={2000}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('journey.describePlaceholder')}
        className="mt-2 w-full resize-none rounded-2xl border border-rule bg-paper p-3 text-sm text-ink placeholder:text-faint focus:border-ink focus:outline-none"
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={text.trim().length < 3 || interpret.isPending}
          onClick={() =>
            interpret.mutate({ text: text.trim(), language: i18n.resolvedLanguage === 'hi' ? 'hi' : 'en' }, { onSuccess: onUnderstood })
          }
          className={buttonClass('primary', 'md')}
        >
          <Icon name="spark" className="h-4 w-4 text-lilac-200" />
          {interpret.isPending ? t('situation.reading') : t('journey.understand')}
        </button>
        <button type="button" onClick={onManual} className={buttonClass('ghost', 'md')}>
          {t('journey.manual')}
        </button>
      </div>
      <p className="mt-2 text-[11px] text-muted">{t('journey.aiNote')}</p>
      {interpret.isError && (
        <p role="alert" className="mt-3 rounded-2xl bg-honey-50 px-4 py-3 text-sm font-semibold text-honey-700">
          {t(code === 'quota_exhausted' || code === 'rate_limited' ? 'journey.aiBusy' : 'journey.aiUnavailable')}
        </p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ review */

function ReviewDraft({
  draft,
  setDraft,
  onBack,
  onContinue,
}: {
  draft: Draft
  setDraft: (f: (d: Draft) => Draft) => void
  onBack: () => void
  onContinue: () => void
}) {
  const { t } = useTranslation()
  const vocabulary = useVocabulary()
  const documents = useDocuments()
  const names = usePlanNames(undefined, [], documents.data ?? [])
  const toggle = (list: string[], id: string, on: boolean) => (on ? uniq([...list, id]) : list.filter((x) => x !== id))
  const addable = (documents.data ?? []).filter((d) => !draft.held.includes(d.id))

  return (
    <div className="mt-5 space-y-5" data-testid="journey-review">
      <div className="flex flex-wrap items-center gap-2">
        {draft.fromAI && <AIBadge />}
        <p className="text-sm font-semibold text-ink">{t(draft.fromAI ? 'journey.reviewAI' : 'journey.reviewManual')}</p>
      </div>
      {draft.dropped > 0 && <p className="text-xs text-muted">{t('situation.dropped', { count: draft.dropped })}</p>}

      <fieldset>
        <legend className="mb-2 text-xs font-bold tracking-[0.14em] text-muted uppercase">{t('situation.goalsLabel')}</legend>
        {draft.unknowns.includes('goal') && draft.goals.length === 0 && (
          <p className="mb-2 text-xs font-semibold text-honey-700">{t('journey.goalUnclear')}</p>
        )}
        <div className="grid gap-1.5 sm:grid-cols-2">
          {GOAL_ORDER.map((g) => (
            <label key={g} className="flex cursor-pointer items-center gap-2.5 rounded-xl bg-paper px-3 py-2 text-sm ring-1 ring-rule">
              <input type="checkbox" className="h-4 w-4" checked={draft.goals.includes(g)} onChange={(e) => setDraft((d) => ({ ...d, goals: toggle(d.goals, g, e.target.checked) }))} />
              <span className="font-semibold text-ink">{t(`goals.${g}`)}</span>
            </label>
          ))}
        </div>
        {draft.lifeEvents.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-semibold text-muted">{t('journey.lifeEventsLabel')}</p>
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {draft.lifeEvents.map((e) => (
                <li key={e} className="flex items-center gap-1.5 rounded-full bg-paper py-1 pr-1.5 pl-3 text-xs font-semibold text-ink ring-1 ring-rule">
                  {t(`lifeEvents.${e}.name`)}
                  <button
                    type="button"
                    aria-label={t('journey.removeEvent', { event: t(`lifeEvents.${e}.name`) })}
                    onClick={() => setDraft((d) => ({ ...d, lifeEvents: d.lifeEvents.filter((x) => x !== e) }))}
                    className="text-muted hover:text-ink"
                  >
                    <Icon name="close" className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </fieldset>

      <label className="block max-w-sm">
        <span className="mb-1.5 block text-xs font-bold tracking-[0.14em] text-muted uppercase">{t('situation.stateLabel')}</span>
        <select
          value={draft.state ?? ''}
          onChange={(e) => setDraft((d) => ({ ...d, state: e.target.value || null }))}
          className="w-full rounded-2xl border border-rule-strong bg-paper px-3.5 py-2.5 text-sm font-semibold text-ink focus:border-ink"
        >
          <option value="">{t('situation.stateUnknown')}</option>
          {(vocabulary.data?.states ?? []).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {!draft.state && <span className="mt-1 block text-xs text-honey-700">{t('journey.stateHint')}</span>}
      </label>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-bold tracking-[0.14em] text-muted uppercase">{t('situation.foundHeld')}</p>
          <ul className="space-y-1.5">
            {draft.held.map((d) => (
              <li key={d} className="flex flex-wrap items-center gap-2 rounded-xl bg-paper px-3 py-2 text-sm ring-1 ring-rule">
                <span className="min-w-0 flex-1 font-semibold text-ink">{names.document(d)}</span>
                <select
                  aria-label={t('planner.docCondition', { document: names.document(d) })}
                  value={draft.docStates[d] ?? 'available'}
                  onChange={(e) =>
                    setDraft((x) => {
                      const docStates = { ...x.docStates }
                      if (e.target.value === 'available') delete docStates[d]
                      else docStates[d] = e.target.value as ProblemState
                      return { ...x, docStates }
                    })
                  }
                  className="rounded-full border border-rule-strong bg-card px-2 py-0.5 text-xs font-semibold"
                >
                  {(['available', 'expired', 'invalid', 'unsure'] as const).map((s) => (
                    <option key={s} value={s}>
                      {t(`documentState.${s}`)}
                    </option>
                  ))}
                </select>
                <button type="button" aria-label={t('journey.removeDoc', { document: names.document(d) })} onClick={() => setDraft((x) => ({ ...x, held: x.held.filter((y) => y !== d) }))} className="text-muted hover:text-ink">
                  <Icon name="close" className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
          <select
            aria-label={t('journey.addDoc')}
            value=""
            onChange={(e) => e.target.value && setDraft((x) => ({ ...x, held: uniq([...x.held, e.target.value]), lacking: x.lacking.filter((y) => y !== e.target.value) }))}
            className="mt-2 w-full rounded-2xl border border-dashed border-rule-strong bg-card px-3 py-2 text-sm text-muted"
          >
            <option value="">{t('journey.addDoc')}</option>
            {addable.map((d) => (
              <option key={d.id} value={d.id}>
                {names.document(d.id)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <p className="mb-2 text-xs font-bold tracking-[0.14em] text-muted uppercase">{t('situation.foundLacking')}</p>
          {draft.lacking.length === 0 && <p className="text-sm text-muted">—</p>}
          <ul className="space-y-1.5">
            {draft.lacking.map((d) => (
              <li key={d} className="flex items-center gap-2 rounded-xl bg-paper px-3 py-2 text-sm ring-1 ring-rule">
                <span className="min-w-0 flex-1 text-ink">{names.document(d)}</span>
                <button type="button" aria-label={t('journey.removeDoc', { document: names.document(d) })} onClick={() => setDraft((x) => ({ ...x, lacking: x.lacking.filter((y) => y !== d) }))} className="text-muted hover:text-ink">
                  <Icon name="close" className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-rule pt-4">
        <button type="button" onClick={onContinue} className={buttonClass('primary', 'md')}>
          <Icon name="plan" className="h-4 w-4" />
          {t('journey.buildPlan')}
        </button>
        <button type="button" onClick={onBack} className={buttonClass('ghost', 'md')}>
          {t('journey.back')}
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ proposal */

function Proposal({
  query,
  draft,
  setState,
  hold,
  lack,
  setTargets,
  onEdit,
  onExplain,
}: {
  query: ReturnType<typeof useProposalBridge>
  draft: Draft
  setState: (state: string | null) => void
  hold: (doc: string) => void
  lack: (doc: string) => void
  setTargets: (targets: string[] | null) => void
  onEdit: () => void
  onExplain?: (workflow: PlanRequest) => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const planner = usePlannerState()
  const { status } = useAuth()
  const signedIn = status === 'signedIn'
  const accountPlans = useSavedPlans('active')
  const createPlan = useCreatePlan()
  const updatePlan = useUpdatePlan()
  const facts = useProgressFacts()
  const services = useServices()
  const documents = useDocuments()
  const vocabulary = useVocabulary()
  const data = query.data
  const names = usePlanNames(data?.plan ?? undefined, services.data ?? [], documents.data ?? [])
  const [accepted, setAccepted] = useState(false)

  if (query.isError) {
    return (
      <div className="mt-5">
        <ErrorState message={t('journey.proposeError')} onRetry={() => void query.refetch()} />
      </div>
    )
  }
  if (!data) return <LoadingState label={t('journey.building')} />

  const stale = query.isPlaceholderData || query.isFetching
  const saved = readSavedPlan()
  const latestPlan = accountPlans.data?.[0] ?? null
  const hasPlan = signedIn ? latestPlan !== null : saved.targets.length > 0
  const name = names.service
  const candidate = (id: string) => data.discovery.candidates.find((c) => c.service_id === id)
  const supportIds = new Set(data.supporting.map((s) => s.service_id))
  const outcomes = data.target_service_ids
  const addable = (services.data ?? []).filter((s) => !outcomes.includes(s.id) && !supportIds.has(s.id))
  const askState = !draft.state && (data.discovery.clarifications.some((q) => q.code === 'state_required') || (data.plan?.clarifications?.length ?? 0) > 0)

  const accept = (mode: 'merge' | 'replace') => {
    planner.acceptProposal(
      { targets: outcomes, held: draft.held, lacking: draft.lacking, docStates: draft.docStates, goals: draft.goals, state: draft.state },
      mode,
    )
    setAccepted(true)
    navigate('/planner')
  }
  const held: HeldDocument[] = draft.held.map((d) => ({ document_type: d, status: (draft.docStates[d] ?? 'valid') as VaultStatus }))
  /** Signed in: save to the account (explicit action). The browser's plan is not touched. */
  const acceptToAccount = (mode: 'new' | 'add') => {
    const done = { onSuccess: (p: { id: string }) => navigate(`/planner?plan=${p.id}`) }
    if (mode === 'add' && latestPlan) {
      updatePlan.mutate(
        { id: latestPlan.id, target_service_ids: [...new Set([...latestPlan.target_service_ids, ...outcomes])], held_documents: held },
        done,
      )
    } else {
      createPlan.mutate({ source: 'proposal', target_service_ids: outcomes, goals: draft.goals, state: draft.state, held_documents: held }, done)
    }
  }
  const saving = createPlan.isPending || updatePlan.isPending
  const workflow = (): PlanRequest => ({
    target_service_ids: sorted(outcomes),
    owned_document_ids: sorted(draft.held),
    completed_service_ids: sorted(facts.completed),
    progress: sortObj(facts.progress),
    document_states: sortObj(draft.docStates),
    state: draft.state,
  })

  return (
    <div className={`mt-5 space-y-6 transition-opacity ${stale ? 'opacity-60' : ''}`} data-testid="journey-proposal" data-status={data.status}>
      <Understood draft={draft} names={names} onEdit={onEdit} />

      <StatusBanner data={data} />

      {/* Questions: answering one regenerates the proposal. */}
      {data.discovery.clarifications
        // Same rule as the backend status: a question about a service already in the plan is moot.
        .filter((q) => q.service_ids.length === 0 || q.service_ids.some((id) => !outcomes.includes(id)))
        .map((q) =>
        q.code === 'record_held' ? (
          <div key={q.document_ids.join()} className="rounded-2xl bg-zest-100 p-4 text-sm ring-1 ring-zest-300">
            <p className="font-semibold text-ink">{t('situation.askRecord', { documents: q.document_ids.map(names.document).join(t('situation.or')) })}</p>
            <p className="mt-0.5 text-xs text-muted">{t('situation.askRecordWhy', { services: q.service_ids.map(name).join(t('common.listSeparator')) })}</p>
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={() => hold(q.document_ids[0])} className={buttonClass('primary', 'sm')}>
                {t('situation.yesHave')}
              </button>
              <button type="button" onClick={() => q.document_ids.forEach(lack)} className={buttonClass('secondary', 'sm')}>
                {t('situation.noHave')}
              </button>
            </div>
          </div>
        ) : q.code === 'goal_required' ? (
          <div key="goal" className="rounded-2xl bg-zest-100 p-4 text-sm ring-1 ring-zest-300">
            <p className="font-semibold text-ink">{t('journey.askGoal')}</p>
            <button type="button" onClick={onEdit} className={`${buttonClass('secondary', 'sm')} mt-2`}>
              {t('journey.editDetails')}
            </button>
          </div>
        ) : null,
      )}
      {askState && (
        <label className="block rounded-2xl bg-zest-100 p-4 text-sm ring-1 ring-zest-300">
          <span className="font-semibold text-ink">{t('journey.askState')}</span>
          <select
            aria-label={t('situation.stateLabel')}
            value=""
            onChange={(e) => setState(e.target.value || null)}
            className="mt-2 block w-full max-w-sm rounded-2xl border border-rule-strong bg-card px-3 py-2 text-sm font-semibold text-ink"
          >
            <option value="">{t('situation.stateUnknown')}</option>
            {(vocabulary.data?.states ?? []).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* Services: outcomes (editable), supporting services added by the planner, the rest. */}
      <section aria-labelledby="journey-services" className="space-y-3">
        <h3 id="journey-services" className="font-display text-xl font-semibold text-ink">
          {t('journey.services')}
        </h3>
        <ul className="divide-y divide-rule overflow-hidden rounded-2xl bg-paper ring-1 ring-rule">
          {outcomes.map((id) => {
            const c = candidate(id)
            const why = c?.matched_goals.length
              ? t('situation.why', { goals: c.matched_goals.map((g) => t(`goals.${g}`)).join(t('common.listSeparator')) })
              : c?.matched_life_events.length
                ? t('journey.whyEvent', { events: c.matched_life_events.map((e) => t(`lifeEvents.${e}.name`)).join(t('common.listSeparator')) })
                : t('journey.addedByYou')
            return (
              <li key={id} className="flex items-start gap-3 px-4 py-3 text-sm" data-testid={`outcome-${id}`}>
                <span className="mt-0.5 rounded-full bg-ink px-2 py-0.5 text-[10px] font-bold tracking-wide text-paper uppercase">{t('journey.outcome')}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-semibold text-ink">{name(id)}</span>
                  <span className="block text-xs text-muted">{why}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setTargets(outcomes.filter((x) => x !== id))}
                  aria-label={t('journey.remove', { service: name(id) })}
                  className="text-xs font-bold text-muted underline hover:text-ink"
                >
                  {t('journey.removeShort')}
                </button>
              </li>
            )
          })}
          {data.supporting.map((s) => (
            <li key={s.service_id} className="flex items-start gap-3 px-4 py-3 text-sm" data-testid={`supporting-${s.service_id}`}>
              <span className="mt-0.5 rounded-full bg-zest-200 px-2 py-0.5 text-[10px] font-bold tracking-wide text-ink uppercase">{t('journey.supporting')}</span>
              <span className="min-w-0 flex-1">
                <span className="font-semibold text-ink">{name(s.service_id)}</span>
                <span className="block text-xs text-muted">
                  {s.role === 'acquisition'
                    ? t('journey.whySupporting', {
                        documents: s.document_ids.map(names.document).join(t('common.listSeparator')),
                        services: s.for_service_ids.map(name).join(t('common.listSeparator')),
                      })
                    : t('planner.why.prerequisite', { services: s.for_service_ids.map(name).join(t('common.listSeparator')) })}
                </span>
              </span>
            </li>
          ))}
          {outcomes.length === 0 && <li className="px-4 py-3 text-sm text-muted">{t('journey.noOutcomes')}</li>}
        </ul>
        {data.discovery.candidates.filter((c) => !outcomes.includes(c.service_id) && c.status !== 'included').length > 0 && (
          <ul className="space-y-1 text-xs text-muted">
            {data.discovery.candidates
              .filter((c) => !outcomes.includes(c.service_id) && c.status !== 'included')
              .map((c) => (
                <li key={c.service_id}>
                  <span className="font-semibold text-ink/70">{name(c.service_id)}</span>
                  {' — '}
                  {c.status === 'completed' && t('situation.statusCompleted')}
                  {c.status === 'needs_clarification' && t('situation.statusClarify')}
                  {c.exclusion === 'outside_verified_jurisdiction' && t('situation.excludedRegion', { region: c.region ?? '' })}
                  {c.exclusion === 'lacks_required_record' && t('situation.excludedRecord', { documents: c.record_document_ids.map(names.document).join(t('common.listSeparator')) })}
                </li>
              ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={t('journey.addService')}
            value=""
            onChange={(e) => e.target.value && setTargets([...outcomes, e.target.value])}
            className="w-full max-w-sm rounded-2xl border border-dashed border-rule-strong bg-card px-3 py-2 text-sm text-muted"
          >
            <option value="">{t('journey.addService')}</option>
            {addable.map((s) => (
              <option key={s.id} value={s.id}>
                {names.service(s.id)}
              </option>
            ))}
          </select>
        </div>
        <p className="text-[11px] text-muted">{t('journey.coverageNote', { count: services.data?.length ?? 0 })}</p>
      </section>

      {data.plan && (
        <div className="space-y-6">
          <NextActionCard plan={data.plan} names={names} onOwn={hold} />
          <IssuesPanel plan={data.plan} names={names} />
          <Timeline plan={data.plan} names={names} preview onOwn={hold} onMarkDone={() => {}} onUndoDone={() => {}} onProcess={() => {}} />
        </div>
      )}

      <div className="sticky bottom-0 -mx-2 space-y-2 rounded-2xl bg-ink p-4 text-paper shadow-lift">
        <p className="text-sm font-semibold">{t(hasPlan ? 'journey.acceptExisting' : 'journey.acceptNew')}</p>
        <p className="text-xs text-paper/70">{t(signedIn ? 'journey.acceptAccountNote' : 'journey.acceptNote')}</p>
        {(createPlan.isError || updatePlan.isError) && <p className="text-xs font-semibold text-zest-300">{t('account.saveError')}</p>}
        <div className="flex flex-wrap gap-2">
          {signedIn ? (
            <>
              <button type="button" disabled={!data.plan || stale || saving} onClick={() => acceptToAccount('new')} className={buttonClass('zest', 'md')}>
                {t('journey.acceptSaveNew')}
              </button>
              {latestPlan && (
                <button type="button" disabled={!data.plan || stale || saving} onClick={() => acceptToAccount('add')} className={buttonClass('inverse', 'md')}>
                  {t('journey.acceptAddTo', { plan: latestPlan.title || latestPlan.target_service_ids.map(name).join(', ') })}
                </button>
              )}
            </>
          ) : hasPlan ? (
            <>
              <button type="button" disabled={!data.plan || stale || accepted} onClick={() => accept('merge')} className={buttonClass('zest', 'md')}>
                {t('journey.acceptMerge')}
              </button>
              <button type="button" disabled={!data.plan || stale || accepted} onClick={() => accept('replace')} className={buttonClass('inverse', 'md')}>
                {t('journey.acceptReplace')}
              </button>
            </>
          ) : (
            <button type="button" disabled={!data.plan || stale || accepted} onClick={() => accept('replace')} className={buttonClass('zest', 'md')}>
              {t('journey.acceptUse')}
            </button>
          )}
          {onExplain && data.plan && (
            <button type="button" disabled={stale} onClick={() => onExplain(workflow())} className={buttonClass('inverse', 'md')}>
              <Icon name="spark" className="h-4 w-4" />
              {t('journey.explain')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Understood({ draft, names, onEdit }: { draft: Draft; names: PlanNames; onEdit: () => void }) {
  const { t } = useTranslation()
  const rows: [string, string][] = [
    [t('situation.foundGoals'), draft.goals.map((g) => t(`goals.${g}`)).join(t('common.listSeparator')) || '—'],
    [t('situation.foundState'), draft.state ?? t('situation.notStated')],
    [t('situation.foundHeld'), draft.held.map((d) => names.document(d) + (draft.docStates[d] ? ` (${t(`documentState.${draft.docStates[d]}`)})` : '')).join(t('common.listSeparator')) || '—'],
    [t('situation.foundLacking'), draft.lacking.map(names.document).join(t('common.listSeparator')) || '—'],
  ]
  return (
    <section aria-labelledby="journey-understood" className="rounded-2xl bg-paper p-4 ring-1 ring-rule">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="journey-understood" className="text-xs font-bold tracking-[0.14em] text-muted uppercase">
          {t('journey.understood')}
        </h3>
        <button type="button" onClick={onEdit} className="text-xs font-bold text-ink underline">
          {t('journey.editDetails')}
        </button>
      </div>
      <dl className="mt-2 space-y-1 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="grid gap-x-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
            <dt className="font-semibold text-muted">{k}</dt>
            <dd className="text-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function StatusBanner({ data }: { data: ProposalResponse }) {
  const { t } = useTranslation()
  const tone =
    data.status === 'ready' ? 'bg-jade-50 text-jade-800 ring-jade-100' : data.status === 'needs_clarification' ? 'bg-zest-100 text-ink ring-zest-300' : 'bg-honey-50 text-honey-700 ring-honey-100'
  return (
    <div role="status" className={`rounded-2xl px-4 py-3 text-sm font-semibold ring-1 ${tone}`}>
      <p>{t(`journey.status.${data.status}`)}</p>
      {data.uncovered_goals.length > 0 && (
        <p className="mt-1 text-xs font-normal">{t('journey.uncoveredGoals', { goals: data.uncovered_goals.map((g) => t(`goals.${g}`)).join(t('common.listSeparator')) })}</p>
      )}
      {data.uncovered_life_events.length > 0 && (
        <p className="mt-1 text-xs font-normal">
          {t('journey.uncoveredEvents', { events: data.uncovered_life_events.map((e) => t(`lifeEvents.${e}.name`)).join(t('common.listSeparator')) })}
        </p>
      )}
    </div>
  )
}
