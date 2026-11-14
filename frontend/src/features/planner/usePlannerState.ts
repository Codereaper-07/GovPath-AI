import { useCallback, useEffect, useRef, useState } from 'react'
import type { DocumentState } from '../../types/api'
import { diff, newer, type Pending, reconcile, type Stamp } from './selectionSync'

export type ActiveState = 'started' | 'submitted'
export type ProblemState = Exclude<DocumentState, 'available'>

export interface PlannerSelection {
  targets: string[]
  owned: string[]
  /** User-reported completed services (an explicit action; ticking documents never adds here). */
  completed: string[]
  /** Once the user has generated a plan, later changes replan automatically. */
  generated: boolean
  /** Started / submitted processes, as reported by the user. */
  progress: Record<string, ActiveState>
  /** Held documents the user marked expired, invalid or unsure (they do not count). */
  docStates: Record<string, ProblemState>
  /** The user's situation: goals, state/UT, documents they said they do not have. */
  goals: string[]
  state: string | null
  lacking: string[]
}

/**
 * Persistence (browser only).
 * - One localStorage entry. The key keeps its original name so existing saved plans still load;
 *   the schema is versioned inside the value (`version`; entries without it are version 1).
 * - Nothing is written on load. Each user action re-reads the latest stored copy, applies the
 *   change to it and writes it back, so a stale tab never overwrites another tab's newer data.
 *   Other tabs' writes are picked up through the `storage` event; if one raced with this tab's
 *   last change (both read the same old value), the missing part is re-applied (`selectionSync`).
 * - Unknown fields (e.g. written by a newer version) are preserved on every write.
 */
const STORAGE_KEY = 'govpath.planner.v1'
export const SCHEMA_VERSION = 2
const EMPTY: PlannerSelection = {
  targets: [],
  owned: [],
  completed: [],
  generated: false,
  progress: {},
  docStates: {},
  goals: [],
  state: null,
  lacking: [],
}

type Stored = Record<string, unknown>

/** Saved planner selection (read-only use, e.g. by the assistant). */
export function readSavedPlan(): PlannerSelection {
  return parse(readStored())
}

function readStored(): Stored | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const v: unknown = JSON.parse(raw)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Stored) : null
  } catch {
    return null
  }
}

function record<V extends string>(x: unknown, allowed: readonly V[]): Record<string, V> {
  if (!x || typeof x !== 'object') return {}
  return Object.fromEntries(
    Object.entries(x as Record<string, unknown>).filter((e): e is [string, V] => allowed.includes(e[1] as V)),
  )
}

/** Version 1 and 2 share the same fields (v2 only adds `version`), so no data changes shape. */
function parse(v: Stored | null): PlannerSelection {
  if (!v) return EMPTY
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((i): i is string => typeof i === 'string') : [])
  return {
    targets: list(v.targets),
    owned: list(v.owned),
    completed: list(v.completed),
    generated: !!v.generated,
    progress: record(v.progress, ['started', 'submitted'] as const),
    docStates: record(v.docStates, ['expired', 'invalid', 'unsure'] as const),
    goals: list(v.goals),
    state: typeof v.state === 'string' && v.state ? v.state : null,
    lacking: list(v.lacking),
  }
}

const TAB_ID = Math.random().toString(36).slice(2)
const RACE_WINDOW_MS = 5000

function stampOf(v: Stored | null): Stamp {
  return { at: typeof v?.updatedAt === 'number' ? v.updatedAt : 0, writer: typeof v?.writer === 'string' ? v.writer : '' }
}

/** Write the selection over the latest stored value, keeping fields this version does not know. */
function save(sel: PlannerSelection, stamp: Stamp): boolean {
  try {
    const stored = readStored() ?? {}
    const version = typeof stored.version === 'number' && stored.version > SCHEMA_VERSION ? stored.version : SCHEMA_VERSION
    const meta = { updatedAt: stamp.at, writer: stamp.writer }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...stored, ...sel, version, ...meta }))
    return true
  } catch {
    return false // storage unavailable or full: keep working in memory
  }
}

const toggle = (list: string[], id: string, on: boolean) =>
  on ? (list.includes(id) ? list : [...list, id]) : list.filter((x) => x !== id)

const without = <V,>(rec: Record<string, V>, id: string) => {
  if (!(id in rec)) return rec
  const next = { ...rec }
  delete next[id]
  return next
}

const pick = <V,>(rec: Record<string, V>, keep: (k: string) => boolean) =>
  Object.fromEntries(Object.entries(rec).filter(([k]) => keep(k)))

export function usePlannerState() {
  const [sel, setSel] = useState<PlannerSelection>(load)
  // In-memory copy, used when storage is unavailable or the last write failed.
  const memory = useRef(sel)
  const storageOk = useRef(true)
  // This tab's last change, kept briefly so a racing write from another tab cannot drop it.
  const pending = useRef<Pending | null>(null)

  // Another tab changed the saved plan: adopt it, re-applying this tab's change if it raced.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY && e.key !== null) return
      let raw: Stored | null = null
      try {
        const v: unknown = e.newValue ? JSON.parse(e.newValue) : null
        raw = v && typeof v === 'object' && !Array.isArray(v) ? (v as Stored) : null
      } catch {
        raw = null
      }
      const incoming = parse(raw)
      let next = incoming
      const mine = pending.current
      if (mine && Date.now() - mine.stamp.at < RACE_WINDOW_MS) {
        next = reconcile(incoming, stampOf(raw), mine)
        if (next !== incoming) {
          const theirs = stampOf(raw)
          storageOk.current = save(next, newer(theirs, mine.stamp) ? theirs : mine.stamp)
        }
      }
      memory.current = next
      setSel(next)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  /** Apply a change to the latest saved selection (not this tab's possibly stale copy). */
  const update = useCallback((change: (s: PlannerSelection) => PlannerSelection) => {
    const stored = storageOk.current ? readStored() : null
    const base = stored ? parse(stored) : memory.current
    const next = change(base)
    if (next !== base) {
      const stamp = { at: Date.now(), writer: TAB_ID }
      storageOk.current = save(next, stamp)
      pending.current = { base, ops: diff(base, next), stamp }
    }
    memory.current = next
    setSel(next)
  }, [])

  return {
    selection: sel,
    setTarget: useCallback((id: string, on: boolean) => update((s) => ({ ...s, targets: toggle(s.targets, id, on) })), [update]),
    addTargets: useCallback((ids: string[]) => update((s) => ({ ...s, targets: [...new Set([...s.targets, ...ids])] })), [update]),
    setOwned: useCallback(
      (id: string, on: boolean) =>
        update((s) => ({
          ...s,
          owned: toggle(s.owned, id, on),
          lacking: on ? s.lacking.filter((x) => x !== id) : s.lacking,
          docStates: on ? s.docStates : without(s.docStates, id),
        })),
      [update],
    ),
    /** "I do not have this document" (used by discovery). Also forgets its condition. */
    setLacking: useCallback(
      (id: string, on: boolean) =>
        update((s) => ({
          ...s,
          lacking: toggle(s.lacking, id, on),
          owned: on ? s.owned.filter((x) => x !== id) : s.owned,
          docStates: on ? without(s.docStates, id) : s.docStates,
        })),
      [update],
    ),
    setDocState: useCallback(
      (id: string, state: DocumentState) =>
        update((s) => ({ ...s, docStates: state === 'available' ? without(s.docStates, id) : { ...s.docStates, [id]: state } })),
      [update],
    ),
    /**
     * Report process progress. Only "completed" adds to the completed list.
     * Progress is a fact about the citizen, not about the plan: removing a service from the plan,
     * or changing state, keeps it (the planner reports it as `progress_outside_plan` and the
     * citizen can clear it), and re-adding the service resumes from it.
     */
    setProcess: useCallback(
      (id: string, state: 'not_started' | ActiveState | 'completed') =>
        update((s) => ({
          ...s,
          completed: toggle(s.completed, id, state === 'completed'),
          progress: state === 'started' || state === 'submitted' ? { ...s.progress, [id]: state } : without(s.progress, id),
        })),
      [update],
    ),
    setCompleted: useCallback(
      (id: string, on: boolean) => update((s) => ({ ...s, completed: toggle(s.completed, id, on), progress: without(s.progress, id) })),
      [update],
    ),
    setGoal: useCallback((goal: string, on: boolean) => update((s) => ({ ...s, goals: toggle(s.goals, goal, on) })), [update]),
    setCitizenState: useCallback((state: string | null) => update((s) => ({ ...s, state })), [update]),
    /** Apply reviewed facts (e.g. from the AI interpretation). */
    applyContext: useCallback(
      (ctx: { goals: string[]; state: string | null; held: string[]; lacking: string[] }) =>
        update((s) => ({
          ...s,
          goals: [...new Set([...s.goals, ...ctx.goals])],
          state: ctx.state ?? s.state,
          // Reviewed "I do not have it" is the newest statement: the document is no longer held.
          owned: [...new Set([...s.owned, ...ctx.held])].filter((d) => ctx.held.includes(d) || !ctx.lacking.includes(d)),
          lacking: [...new Set([...s.lacking, ...ctx.lacking])].filter((d) => !ctx.held.includes(d)),
          docStates: ctx.lacking.reduce((r, d) => (ctx.held.includes(d) ? r : without(r, d)), s.docStates),
        })),
      [update],
    ),
    generate: useCallback(() => update((s) => ({ ...s, generated: true })), [update]),
    /**
     * Drop ids the backend no longer knows (e.g. stale saved selections). A category is pruned
     * only against a non-empty known list: an empty or missing response never erases data.
     */
    keepOnly: useCallback(
      (known: { services?: Set<string>; documents?: Set<string>; goals?: Set<string> }) =>
        update((s) => {
          const usable = (set?: Set<string>) => (set && set.size > 0 ? set : null)
          const svc = usable(known.services)
          const docs = usable(known.documents)
          const goals = usable(known.goals)
          const next = {
            ...s,
            targets: svc ? s.targets.filter((x) => svc.has(x)) : s.targets,
            completed: svc ? s.completed.filter((x) => svc.has(x)) : s.completed,
            progress: svc ? pick(s.progress, (k) => svc.has(k)) : s.progress,
            owned: docs ? s.owned.filter((x) => docs.has(x)) : s.owned,
            lacking: docs ? s.lacking.filter((x) => docs.has(x)) : s.lacking,
            docStates: docs ? pick(s.docStates, (k) => docs.has(k)) : s.docStates,
            goals: goals ? s.goals.filter((x) => goals.has(x)) : s.goals,
          }
          const same =
            next.targets.length === s.targets.length &&
            next.completed.length === s.completed.length &&
            next.owned.length === s.owned.length &&
            next.lacking.length === s.lacking.length &&
            next.goals.length === s.goals.length &&
            Object.keys(next.progress).length === Object.keys(s.progress).length &&
            Object.keys(next.docStates).length === Object.keys(s.docStates).length
          return same ? s : next
        }),
      [update],
    ),
    reset: useCallback(() => update(() => EMPTY), [update]),
  }
}

function load(): PlannerSelection {
  return parse(readStored())
}

/** The planner request for a selection (the backend decides everything else). */
export function planRequestOf(sel: PlannerSelection) {
  const sortObj = <V,>(r: Record<string, V>) => Object.fromEntries(Object.entries(r).sort(([a], [b]) => a.localeCompare(b)))
  return {
    target_service_ids: [...sel.targets].sort(),
    owned_document_ids: [...sel.owned].sort(),
    completed_service_ids: [...sel.completed].sort(),
    progress: sortObj(sel.progress),
    document_states: sortObj(sel.docStates),
    state: sel.state,
  }
}
