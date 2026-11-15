import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AIBadge } from '../../components/ui/Badge'
import { buttonClass } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { ErrorState, LoadingState } from '../../components/ui/States'
import { ApiError } from '../../lib/apiClient'
import type {
  AccountProposal,
  AccountProposeRequest,
  ApiErrorDetail,
  HeldDocument,
  PlanRequest,
  ProblemState,
  ProcessState,
  ProposalResponse,
  ProposeRequest,
  SituationInterpretation,
  VaultDocument,
  VaultStatus,
} from '../../types/api'
import {
  useAccountInterpret,
  useAccountProgress,
  useAccountProposal,
  useCreatePlan,
  useSavedPlans,
  useSetProgress,
  useUpdatePlan,
  useVault,
} from '../account/api'
import { useProfile } from '../auth/api'
import { useAuth } from '../auth/useAuth'
import { useInterpretSituation, useProposal, useVocabulary } from '../planner/api'
import { IssuesPanel } from '../planner/components/IssuesPanel'
import { NextActionCard } from '../planner/components/NextActionCard'
import { GOAL_ORDER } from '../planner/goals'
import { Timeline } from '../planner/components/Timeline'
import { type PlanNames, usePlanNames } from '../planner/names'
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
  /** Services the citizen explicitly asked for (they drive the proposal). */
  requested: string[]
  /** Services the citizen says (in this description) they already completed. */
  reportedDone: string[]
  /** When moving: the state they are leaving (explanation only). */
  origin: string | null
}

const NO_EXTRAS = { requested: [] as string[], reportedDone: [] as string[], origin: null as string | null }

const uniq = (xs: string[]) => [...new Set(xs)]
const sorted = (xs: string[]) => [...xs].sort()
const sortObj = <V,>(r: Record<string, V>) => Object.fromEntries(Object.entries(r).sort(([a], [b]) => a.localeCompare(b)))

function emptyDraft(): Draft {
  return { goals: [], lifeEvents: [], state: null, held: [], lacking: [], docStates: {}, fromAI: false, unknowns: [], dropped: 0, ...NO_EXTRAS }
}

/** A guest's proposal kept across sign-in (sessionStorage: this tab only, never a saved plan). */
const PENDING_KEY = 'govpath.pendingProposal'
interface PendingProposal {
  draft: Draft
  targets: string[] | null
}
function keepPending(p: PendingProposal) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(p))
  } catch {
    /* storage unavailable: the guest re-describes after signing in */
  }
}
function peekPending(): PendingProposal | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY)
    const v = raw ? (JSON.parse(raw) as PendingProposal) : null
    return v && v.draft && Array.isArray(v.draft.goals) ? { draft: { ...emptyDraft(), ...v.draft }, targets: v.targets ?? null } : null
  } catch {
    return null
  }
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
  return { goals, lifeEvents: [], state, held: [...byType.keys()], lacking: [], docStates, fromAI: false, unknowns: [], dropped: 0, ...NO_EXTRAS }
}

/** Progress facts for a proposal: the account's when signed in (guests have none saved). */
function useProgressFacts() {
  const { status } = useAuth()
  const account = useAccountProgress()
  if (status !== 'signedIn') return { completed: [] as string[], progress: {} as Record<string, ProcessState> }
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
    requested: uniq([...d.requested, ...(r.requested_service_ids ?? [])]),
    reportedDone: uniq([...d.reportedDone, ...r.completed_service_ids]),
    origin: r.origin_state ?? d.origin,
  }
}

/** A correction: the model returns the complete corrected facts, which replace the draft's
 * (documents the account already holds stay held: the vault is the source of truth). */
function withCorrection(d: Draft, r: SituationInterpretation, keepHeld: string[]): Draft {
  const held = uniq([...keepHeld, ...r.held_document_ids]).filter((x) => keepHeld.includes(x) || !r.lacking_document_ids.includes(x))
  const states = { ...d.docStates, ...(r.document_states ?? {}) }
  return {
    goals: r.goals,
    lifeEvents: r.life_events,
    state: r.state ?? d.state,
    held,
    lacking: r.lacking_document_ids.filter((x) => !held.includes(x)),
    docStates: Object.fromEntries(Object.entries(states).filter(([k]) => held.includes(k))),
    fromAI: true,
    unknowns: r.unknowns,
    dropped: r.dropped.length,
    requested: r.requested_service_ids ?? [],
    reportedDone: r.completed_service_ids,
    origin: r.origin_state ?? null,
  }
}

/** The facts so far, as context for the model when the citizen corrects them. */
function summarise(d: Draft): string {
  return JSON.stringify({
    goals: d.goals,
    life_events: d.lifeEvents,
    state: d.state,
    origin_state: d.origin,
    held_document_ids: d.held,
    lacking_document_ids: d.lacking,
    requested_service_ids: d.requested,
    completed_service_ids: d.reportedDone,
  })
}

/** Guest: the public reader. Signed in: the reader that also sees the account's known facts. */
function useReader() {
  const { status } = useAuth()
  const guest = useInterpretSituation()
  const account = useAccountInterpret()
  return status === 'signedIn' ? account : guest
}

export function SituationJourney({ onExplain }: { onExplain?: (workflow: PlanRequest) => void }) {
  const { t } = useTranslation()
  const { status } = useAuth()
  const [phase, setPhase] = useState<Phase>('describe')
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [targets, setTargets] = useState<string[] | null>(null) // null = discovery's recommendation
  // Back from signing in to save a guest proposal: continue where the guest left off. Checked
  // (during render, once) when the session is first known to be signed in: the page can open a
  // moment before the new session is registered.
  const [resumeChecked, setResumeChecked] = useState(false)
  const [resumed, setResumed] = useState(false)
  if (status === 'signedIn' && !resumeChecked) {
    setResumeChecked(true)
    const pending = peekPending()
    if (pending) {
      setResumed(true)
      setDraft(pending.draft)
      setTargets(pending.targets)
      setPhase('proposal')
    }
  }
  useEffect(() => {
    if (resumed) sessionStorage.removeItem(PENDING_KEY) // used once
  }, [resumed])

  // Signed in: start from the vault (once, before the citizen has changed anything).
  const vault = useVault()
  const profile = useProfile()
  const seeded = useRef(false)
  const profileSettled = !profile.isPending || profile.fetchStatus === 'idle'
  useEffect(() => {
    if (status !== 'signedIn' || seeded.current || resumed || !vault.data || !profileSettled || phase !== 'describe') return
    seeded.current = true
    setDraft(draftFromAccount(vault.data, profile.data?.state ?? null, []))
  }, [status, vault.data, profile.data, profileSettled, phase, resumed])

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
  const signedIn = status === 'signedIn'
  const vaultTypes = new Set((vault.data ?? []).map((d) => d.document_type))
  const accountRequest: AccountProposeRequest | null =
    phase === 'proposal' && signedIn
      ? {
          goals: sorted(draft.goals),
          life_events: sorted(draft.lifeEvents),
          state: draft.state,
          // The vault is added on the server; send only documents it does not hold.
          held_document_ids: sorted(draft.held.filter((d) => docOk(d) && !vaultTypes.has(d))),
          document_states: sortObj(keep(draft.docStates, (d) => docOk(d) && !vaultTypes.has(d))) as AccountProposeRequest['document_states'],
          lacking_document_ids: sorted(draft.lacking.filter((d) => docOk(d) && !vaultTypes.has(d))),
          reported_completed_service_ids: sorted(draft.reportedDone.filter(svcOk)),
          requested_service_ids: draft.requested.filter(svcOk),
          target_service_ids: targets && targets.filter(svcOk),
        }
      : null
  const request: ProposeRequest | null =
    phase === 'proposal' && !signedIn
      ? {
          context: {
            goals: sorted(draft.goals),
            life_events: sorted(draft.lifeEvents),
            state: draft.state,
            held_document_ids: sorted(draft.held.filter(docOk)),
            lacking_document_ids: sorted(draft.lacking.filter(docOk)),
            completed_service_ids: sorted(uniq([...saved.completed, ...draft.reportedDone]).filter(svcOk)),
          },
          document_states: sortObj(keep(draft.docStates, docOk)),
          progress: sortObj(keep(saved.progress, svcOk)),
          target_service_ids: targets && targets.filter(svcOk),
          requested_service_ids: draft.requested.filter(svcOk),
        }
      : null

  const query = useProposalBridge(request, accountRequest)
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
            setTargets(null)
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
          onCorrected={(r) => setDraft((d) => withCorrection(d, r, signedIn ? [...vaultTypes] : []))}
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
          targets={targets}
          onCorrected={(r) => {
            setTargets(null)
            setDraft((d) => withCorrection(d, r, signedIn ? [...vaultTypes] : []))
          }}
        />
      )}
    </section>
  )
}

// Requests are null outside the proposal phase, so no call is made then. Guests use the public
// proposal; signed-in citizens the account proposal (same proposal shape, plus account context).
function useProposalBridge(request: ProposeRequest | null, accountRequest: AccountProposeRequest | null) {
  const guest = useProposal(request)
  const account = useAccountProposal(accountRequest)
  if (accountRequest) {
    return {
      data: account.data?.proposal,
      account: account.data as AccountProposal | undefined,
      isError: account.isError,
      isPlaceholderData: account.isPlaceholderData,
      isFetching: account.isFetching,
      refetch: account.refetch,
    }
  }
  return {
    data: guest.data,
    account: undefined as AccountProposal | undefined,
    isError: guest.isError,
    isPlaceholderData: guest.isPlaceholderData,
    isFetching: guest.isFetching,
    refetch: guest.refetch,
  }
}

/* ------------------------------------------------------------------ describe */

function Describe({ onUnderstood, onManual }: { onUnderstood: (r: SituationInterpretation) => void; onManual: () => void }) {
  const { t, i18n } = useTranslation()
  const interpret = useReader()
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

/** "Add or correct details": the AI re-reads the situation with the facts reviewed so far. */
function CorrectionBox({ draft, onCorrected }: { draft: Draft; onCorrected: (r: SituationInterpretation) => void }) {
  const { t, i18n } = useTranslation()
  const interpret = useReader()
  const [text, setText] = useState('')
  const code = interpret.error instanceof ApiError ? (interpret.error.detail as ApiErrorDetail | undefined)?.code : undefined
  return (
    <div className="rounded-2xl bg-lilac-50/60 p-4 ring-1 ring-lilac-100" data-testid="journey-correct">
      <label htmlFor="journey-correction" className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Icon name="spark" className="h-4 w-4 text-lilac-500" />
        {t('journey.correctLabel')}
      </label>
      <textarea
        id="journey-correction"
        rows={2}
        maxLength={2000}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('journey.correctPlaceholder')}
        className="mt-2 w-full resize-none rounded-2xl border border-rule bg-card p-3 text-sm text-ink placeholder:text-faint focus:border-ink focus:outline-none"
      />
      <button
        type="button"
        disabled={text.trim().length < 3 || interpret.isPending}
        onClick={() =>
          interpret.mutate(
            { text: text.trim(), language: i18n.resolvedLanguage === 'hi' ? 'hi' : 'en', previous: summarise(draft) },
            {
              onSuccess: (r) => {
                setText('')
                onCorrected(r)
              },
            },
          )
        }
        className={buttonClass('secondary', 'sm', 'mt-2')}
      >
        {interpret.isPending ? t('situation.reading') : t('journey.correctButton')}
      </button>
      {interpret.isError && (
        <p role="alert" className="mt-2 text-xs font-semibold text-honey-700">
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
  onCorrected,
}: {
  draft: Draft
  setDraft: (f: (d: Draft) => Draft) => void
  onBack: () => void
  onContinue: () => void
  onCorrected: (r: SituationInterpretation) => void
}) {
  const { t } = useTranslation()
  const vocabulary = useVocabulary()
  const documents = useDocuments()
  const services = useServices()
  const vault = useVault()
  const { status } = useAuth()
  const names = usePlanNames(undefined, services.data ?? [], documents.data ?? [])
  const vaultTypes = new Set((vault.data ?? []).map((d) => d.document_type))
  const chips = (ids: string[], label: string, field: 'requested' | 'reportedDone', testid: string) =>
    ids.length > 0 && (
      <div data-testid={testid}>
        <p className="text-xs font-semibold text-muted">{label}</p>
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {ids.map((id) => (
            <li key={id} className="flex items-center gap-1.5 rounded-full bg-paper py-1 pr-1.5 pl-3 text-xs font-semibold text-ink ring-1 ring-rule">
              {names.service(id)}
              <button
                type="button"
                aria-label={t('journey.remove', { service: names.service(id) })}
                onClick={() => setDraft((d) => ({ ...d, [field]: d[field].filter((x) => x !== id) }))}
                className="text-muted hover:text-ink"
              >
                <Icon name="close" className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    )
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
        <div className="mt-3 space-y-3">
          {chips(draft.requested, t('journey.requestedLabel'), 'requested', 'journey-requested')}
          {chips(draft.reportedDone, t('journey.reportedDoneLabel'), 'reportedDone', 'journey-reported-done')}
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
        {draft.origin && draft.state && draft.origin !== draft.state && (
          <span className="mt-1 block text-xs text-muted">{t('journey.moving', { from: draft.origin, to: draft.state })}</span>
        )}
      </label>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-bold tracking-[0.14em] text-muted uppercase">{t('situation.foundHeld')}</p>
          <ul className="space-y-1.5">
            {draft.held.map((d) => (
              <li key={d} className="flex flex-wrap items-center gap-2 rounded-xl bg-paper px-3 py-2 text-sm ring-1 ring-rule">
                <span className="min-w-0 flex-1 font-semibold text-ink">
                  {names.document(d)}
                  {status === 'signedIn' && vaultTypes.has(d) && <span className="ml-1.5 text-[11px] font-semibold text-jade-700">{t('journey.fromVault')}</span>}
                </span>
                {status === 'signedIn' && vaultTypes.has(d) ? (
                  <Link to="/vault" className="text-xs font-semibold text-jade-700 underline-offset-2 hover:underline">
                    {t(`documentState.${draft.docStates[d] ?? 'available'}`)}
                  </Link>
                ) : (
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
                )}
                {!(status === 'signedIn' && vaultTypes.has(d)) && (
                  <button type="button" aria-label={t('journey.removeDoc', { document: names.document(d) })} onClick={() => setDraft((x) => ({ ...x, held: x.held.filter((y) => y !== d) }))} className="text-muted hover:text-ink">
                    <Icon name="close" className="h-4 w-4" />
                  </button>
                )}
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

      <CorrectionBox draft={draft} onCorrected={onCorrected} />

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
  onCorrected,
  targets,
}: {
  query: ReturnType<typeof useProposalBridge>
  draft: Draft
  setState: (state: string | null) => void
  hold: (doc: string) => void
  lack: (doc: string) => void
  setTargets: (targets: string[] | null) => void
  onEdit: () => void
  onExplain?: (workflow: PlanRequest) => void
  onCorrected: (r: SituationInterpretation) => void
  targets: string[] | null
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const setProgress = useSetProgress()
  const [chosenPlan, setChosenPlan] = useState<string | null>(null)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [recordDone, setRecordDone] = useState(true)
  const submitting = useRef(false)
  // One request id per proposal: repeated clicks/retries of the same proposal reuse it (the
  // backend returns the plan already created); a changed proposal gets a new id.
  const proposalKey = JSON.stringify([query.data?.target_service_ids ?? [], draft.goals, draft.state])
  const requestId = useMemo(() => `${proposalKey.length}-${crypto.randomUUID()}`, [proposalKey])
  const location = useLocation()
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
  const [planName, setPlanName] = useState('')

  if (query.isError) {
    return (
      <div className="mt-5">
        <ErrorState message={t('journey.proposeError')} onRetry={() => void query.refetch()} />
      </div>
    )
  }
  if (!data) return <LoadingState label={t('journey.building')} />

  const stale = query.isPlaceholderData || query.isFetching
  const account = query.account
  const activePlans = accountPlans.data ?? []
  const targetPlanId = chosenPlan ?? account?.recommended_plan_id ?? activePlans[0]?.id ?? null
  const latestPlan = activePlans.find((p) => p.id === targetPlanId) ?? null
  const hasPlan = signedIn && latestPlan !== null
  const name = names.service
  const candidate = (id: string) => data.discovery.candidates.find((c) => c.service_id === id)
  const supportIds = new Set(data.supporting.map((s) => s.service_id))
  const outcomes = data.target_service_ids
  const addable = (services.data ?? []).filter((s) => !outcomes.includes(s.id) && !supportIds.has(s.id))
  const askState = !draft.state && (data.discovery.clarifications.some((q) => q.code === 'state_required') || (data.plan?.clarifications?.length ?? 0) > 0)

  /** Guests must sign in to save: keep this proposal for after sign-in (nothing is saved). */
  const signInToSave = () => {
    keepPending({ draft, targets })
    navigate('/login', { state: { from: location.pathname, reason: 'save_plan' } })
  }
  const held: HeldDocument[] = draft.held.map((d) => ({ document_type: d, status: (draft.docStates[d] ?? 'valid') as VaultStatus }))
  // Services the citizen said they already completed, not yet recorded in the account.
  const toRecord = draft.reportedDone.filter((s) => !(account?.account_context.completed_service_ids ?? []).includes(s))
  /** Signed in: save to the account (explicit action). The browser's plan is not touched. */
  const acceptToAccount = async (mode: 'new' | 'add' | 'replace') => {
    if (submitting.current) return // one save per click, even on a double-click
    submitting.current = true
    if (recordDone) {
      for (const serviceId of toRecord) await setProgress.mutateAsync({ serviceId, state: 'completed' })
    }
    const done = {
      onSuccess: (p: { id: string; deduplicated?: string | null }) =>
        navigate(`/planner?plan=${p.id}&saved=${mode === 'new' ? (p.deduplicated ?? 'new') : 'updated'}`),
      onSettled: () => {
        submitting.current = false
      },
    }
    // The state the proposal actually used (the description's, else the profile's).
    const planState = account?.account_context.state ?? draft.state
    if ((mode === 'add' || mode === 'replace') && latestPlan) {
      const target_service_ids = mode === 'add' ? [...new Set([...latestPlan.target_service_ids, ...outcomes])] : outcomes
      updatePlan.mutate({ id: latestPlan.id, target_service_ids, held_documents: held, ...(mode === 'replace' ? { goals: draft.goals } : {}) }, done)
    } else {
      createPlan.mutate(
        {
          source: 'proposal',
          title: planName.trim() || suggestedName || null,
          target_service_ids: outcomes,
          goals: draft.goals,
          state: planState,
          held_documents: held,
          client_request_id: requestId,
        },
        done,
      )
    }
  }
  const saving = createPlan.isPending || updatePlan.isPending || setProgress.isPending
  // A suggested name for the new plan: the citizen's goals, else the services.
  const suggestedName = (draft.goals.length ? draft.goals.map((g) => t(`goals.${g}`)) : outcomes.map(name)).join(', ').slice(0, 120)
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
      {account && <AccountContextCard account={account} names={names} />}

      <StatusBanner data={data} />
      <RequestedNotes data={data} names={names} />

      {/* Questions: answering one regenerates the proposal. */}
      {data.discovery.clarifications
        // Same rule as the backend status: a question about a service already in the plan is moot.
        .filter((q) => q.service_ids.length === 0 || q.service_ids.some((id) => !outcomes.includes(id)))
        // Questions only about suggestions (services the citizen did not ask for) are not asked.
        .filter((q) => !(q.service_ids.length > 0 && q.service_ids.every((id) => (data.suggested_service_ids ?? []).includes(id))))
        // Naming the services answers "what do you want to do?".
        .filter((q) => !(q.code === 'goal_required' && outcomes.length > 0))
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="journey-services" className="font-display text-xl font-semibold text-ink">
            {t('journey.services')}
          </h3>
          {data.grounding && <GroundingBadge g={data.grounding} />}
        </div>
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
        {(data.suggested_service_ids ?? []).filter((id) => !outcomes.includes(id)).length > 0 && (
          <div className="rounded-2xl bg-paper p-4 ring-1 ring-rule" data-testid="journey-suggested">
            <p className="text-sm font-semibold text-ink">{t('journey.suggestedTitle')}</p>
            <p className="text-xs text-muted">{t('journey.suggestedHint')}</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {(data.suggested_service_ids ?? [])
                .filter((id) => !outcomes.includes(id))
                .map((id) => (
                  <li key={id}>
                    <button type="button" onClick={() => setTargets([...outcomes, id])} className={buttonClass('secondary', 'sm')}>
                      <Icon name="plus" className="h-3.5 w-3.5" /> {name(id)}
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        )}
        {data.discovery.candidates.filter((c) => !outcomes.includes(c.service_id) && c.status !== 'included' && !(data.suggested_service_ids ?? []).includes(c.service_id)).length > 0 && (
          <ul className="space-y-1 text-xs text-muted">
            {data.discovery.candidates
              .filter((c) => !outcomes.includes(c.service_id) && c.status !== 'included' && !(data.suggested_service_ids ?? []).includes(c.service_id))
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

      <CorrectionBox draft={draft} onCorrected={onCorrected} />
      {account && account.existing_plans.length > 0 && <OverlapCard account={account} names={names} />}

      <div className="sticky bottom-0 -mx-2 space-y-2 rounded-2xl bg-ink p-4 text-paper shadow-lift">
        <p className="text-sm font-semibold">{t(hasPlan ? 'journey.acceptExisting' : 'journey.acceptNew')}</p>
        <p className="text-xs text-paper/70">{t(signedIn ? 'journey.acceptAccountNote' : 'myPlans.guestNote')}</p>
        {(createPlan.isError || updatePlan.isError) && <p className="text-xs font-semibold text-zest-300">{t('account.saveError')}</p>}
        <div className="flex flex-wrap gap-2">
          {signedIn ? (
            <div className="w-full space-y-3">
              <label className="block max-w-md text-xs text-paper/80">
                {t('myPlans.name')}
                <input
                  value={planName}
                  maxLength={120}
                  placeholder={suggestedName}
                  onChange={(e) => setPlanName(e.target.value)}
                  className="mt-1 block w-full rounded-xl bg-paper/10 px-3 py-2 text-sm font-semibold text-paper ring-1 ring-paper/25 placeholder:text-paper/50"
                />
              </label>
              {toRecord.length > 0 && (
                <label className="flex items-start gap-2 text-xs text-paper/80">
                  <input type="checkbox" className="mt-0.5 h-4 w-4" checked={recordDone} onChange={(e) => setRecordDone(e.target.checked)} />
                  {t('journey.recordDone', { services: toRecord.map(name).join(t('common.listSeparator')) })}
                </label>
              )}
              {activePlans.length > 1 && (
                <label className="flex flex-wrap items-center gap-2 text-xs text-paper/80">
                  {t('journey.existingPlanLabel')}
                  <select
                    value={targetPlanId ?? ''}
                    onChange={(e) => {
                      setChosenPlan(e.target.value)
                      setConfirmReplace(false)
                    }}
                    className="rounded-full bg-paper/10 px-3 py-1 text-xs font-semibold text-paper ring-1 ring-paper/25"
                  >
                    {activePlans.map((p) => (
                      <option key={p.id} value={p.id} className="text-ink">
                        {p.title || p.target_service_ids.map(name).join(', ')}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {confirmReplace && latestPlan ? (
                <div className="space-y-2 rounded-xl bg-paper/10 p-3" role="group" aria-label={t('journey.replaceConfirm', { plan: latestPlan.title || latestPlan.target_service_ids.map(name).join(', ') })}>
                  <p className="text-sm font-semibold">{t('journey.replaceConfirm', { plan: latestPlan.title || latestPlan.target_service_ids.map(name).join(', ') })}</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={saving} onClick={() => void acceptToAccount('replace')} className={buttonClass('zest', 'sm')}>
                      {t('journey.replaceYes')}
                    </button>
                    <button type="button" onClick={() => setConfirmReplace(false)} className={buttonClass('inverse', 'sm')}>
                      {t('vault.cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={!data.plan || stale || saving} onClick={() => void acceptToAccount('new')} className={buttonClass('zest', 'md')}>
                    {t('journey.acceptSaveNew')}
                  </button>
                  {latestPlan && (
                    <>
                      <button type="button" disabled={!data.plan || stale || saving} onClick={() => void acceptToAccount('add')} className={buttonClass('inverse', 'md')}>
                        {t('journey.acceptAddTo', { plan: latestPlan.title || latestPlan.target_service_ids.map(name).join(', ') })}
                      </button>
                      <button type="button" disabled={!data.plan || stale || saving} onClick={() => setConfirmReplace(true)} className={buttonClass('inverse', 'md')}>
                        {t('journey.acceptReplaceIn')}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="w-full space-y-2" data-testid="journey-sign-in-to-save">
              <p className="text-xs text-paper/80">{t('myPlans.guestSaveNote')}</p>
              <button type="button" disabled={!data.plan || stale} onClick={signInToSave} className={buttonClass('zest', 'md')}>
                {t('myPlans.signInToSave')}
              </button>
            </div>
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

function AccountContextCard({ account, names }: { account: AccountProposal; names: PlanNames }) {
  const { t } = useTranslation()
  const c = account.account_context
  const vaultDocs = Object.entries(c.vault)
  return (
    <section aria-labelledby="journey-account" className="rounded-2xl bg-jade-50/60 p-4 text-sm ring-1 ring-jade-100" data-testid="journey-account">
      <h3 id="journey-account" className="text-xs font-bold tracking-[0.14em] text-jade-800 uppercase">
        {t('journey.accountTitle')}
      </h3>
      <ul className="mt-2 space-y-1 text-ink">
        <li>
          {c.state_source === 'description'
            ? t('journey.stateFromDescription', { state: c.state ?? '' })
            : c.state_source === 'profile'
              ? t('journey.stateFromProfile', { state: c.state ?? '' })
              : t('journey.stateNone')}
          {c.state_source === 'description' && c.profile_state && c.profile_state !== c.state && (
            <span className="text-muted"> {t('journey.profileSays', { state: c.profile_state })}</span>
          )}
        </li>
        <li>
          {vaultDocs.length > 0
            ? t('journey.vaultUsed', {
                documents: vaultDocs.map(([d, st]) => (st === 'valid' ? names.document(d) : `${names.document(d)} (${t(`vault.statusOption.${st}`)})`)).join(t('common.listSeparator')),
              })
            : t('journey.vaultEmpty')}
        </li>
        {c.completed_service_ids.length > 0 && <li>{t('journey.alreadyDone', { services: c.completed_service_ids.map(names.service).join(t('common.listSeparator')) })}</li>}
        {Object.keys(c.in_progress).length > 0 && (
          <li>{t('journey.inProgress', { services: Object.keys(c.in_progress).map(names.service).join(t('common.listSeparator')) })}</li>
        )}
      </ul>
    </section>
  )
}

function RequestedNotes({ data, names }: { data: ProposalResponse; names: PlanNames }) {
  const { t } = useTranslation()
  const notes = (data.requested ?? []).filter((r) => r.outcome !== 'target')
  if (notes.length === 0) return null
  return (
    <ul className="space-y-1 rounded-2xl bg-honey-50 px-4 py-3 text-sm text-honey-700 ring-1 ring-honey-100" data-testid="journey-requested-notes">
      {notes.map((r) => (
        <li key={r.service_id}>{t(`journey.requestedOutcome.${r.outcome}`, { service: names.service(r.service_id) })}</li>
      ))}
    </ul>
  )
}

function GroundingBadge({ g }: { g: NonNullable<ProposalResponse['grounding']> }) {
  const { t } = useTranslation()
  const complete = g.ungrounded.length === 0
  return (
    <span
      data-testid="journey-grounding"
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ring-1 ${complete ? 'bg-jade-50 text-jade-800 ring-jade-100' : 'bg-honey-50 text-honey-700 ring-honey-100'}`}
    >
      <Icon name="shield" className="h-3.5 w-3.5" />
      {complete
        ? t('journey.grounded', { requirements: g.requirements, dependencies: g.dependencies })
        : t('journey.partlyGrounded', { count: g.ungrounded.length })}
    </span>
  )
}

function OverlapCard({ account, names }: { account: AccountProposal; names: PlanNames }) {
  const { t } = useTranslation()
  const top = account.existing_plans[0]
  const title = top.title || top.target_service_ids.map(names.service).join(', ')
  return (
    <section className="rounded-2xl bg-zest-100 p-4 text-sm ring-1 ring-zest-300" data-testid="journey-overlap" data-recommendation={account.recommendation}>
      <p className="font-semibold text-ink">
        {account.recommendation === 'covered' ? t('journey.overlapCovered', { plan: title }) : t('journey.overlapExtend', { plan: title })}
      </p>
      <p className="mt-0.5 text-xs text-muted">
        {t('journey.overlapServices', { services: top.overlapping_service_ids.map(names.service).join(t('common.listSeparator')) })}
      </p>
    </section>
  )
}

function Understood({ draft, names, onEdit }: { draft: Draft; names: PlanNames; onEdit: () => void }) {
  const { t } = useTranslation()
  const rows: [string, string][] = [
    [t('situation.foundGoals'), draft.goals.map((g) => t(`goals.${g}`)).join(t('common.listSeparator')) || '—'],
    [t('situation.foundState'), (draft.state ?? t('situation.notStated')) + (draft.origin && draft.origin !== draft.state ? ` (${t('journey.movingFrom', { from: draft.origin })})` : '')],
    ...(draft.requested.length ? [[t('journey.requestedLabel'), draft.requested.map(names.service).join(t('common.listSeparator'))] as [string, string]] : []),
    ...(draft.reportedDone.length ? [[t('journey.reportedDoneLabel'), draft.reportedDone.map(names.service).join(t('common.listSeparator'))] as [string, string]] : []),
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
