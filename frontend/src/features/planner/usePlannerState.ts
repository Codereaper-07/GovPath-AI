import { useCallback, useEffect, useState } from 'react'

export interface PlannerSelection {
  targets: string[]
  owned: string[]
  completed: string[]
  /** Once the user has generated a plan, later changes replan automatically. */
  generated: boolean
}

const STORAGE_KEY = 'govpath.planner.v1'
const EMPTY: PlannerSelection = { targets: [], owned: [], completed: [], generated: false }

/** Saved planner selection (read-only use, e.g. by the assistant). */
export function readSavedPlan(): PlannerSelection {
  return load()
}

function load(): PlannerSelection {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY
    const v = JSON.parse(raw) as Partial<PlannerSelection>
    const list = (x: unknown) => (Array.isArray(x) ? x.filter((i): i is string => typeof i === 'string') : [])
    return { targets: list(v.targets), owned: list(v.owned), completed: list(v.completed), generated: !!v.generated }
  } catch {
    return EMPTY
  }
}

const toggle = (list: string[], id: string, on: boolean) =>
  on ? (list.includes(id) ? list : [...list, id]) : list.filter((x) => x !== id)

export function usePlannerState() {
  const [sel, setSel] = useState<PlannerSelection>(load)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sel))
    } catch {
      /* storage unavailable */
    }
  }, [sel])

  return {
    selection: sel,
    setTarget: useCallback((id: string, on: boolean) => setSel((s) => ({ ...s, targets: toggle(s.targets, id, on) })), []),
    setOwned: useCallback((id: string, on: boolean) => setSel((s) => ({ ...s, owned: toggle(s.owned, id, on) })), []),
    setCompleted: useCallback(
      (id: string, on: boolean) => setSel((s) => ({ ...s, completed: toggle(s.completed, id, on) })),
      [],
    ),
    generate: useCallback(() => setSel((s) => ({ ...s, generated: true })), []),
    /** Drop ids the backend no longer knows (e.g. stale saved selections). */
    keepOnly: useCallback((services: Set<string>, documents: Set<string>) => {
      setSel((s) => {
        const next = {
          ...s,
          targets: s.targets.filter((x) => services.has(x)),
          completed: s.completed.filter((x) => services.has(x)),
          owned: s.owned.filter((x) => documents.has(x)),
        }
        const same =
          next.targets.length === s.targets.length &&
          next.completed.length === s.completed.length &&
          next.owned.length === s.owned.length
        return same ? s : next
      })
    }, []),
    reset: useCallback(() => setSel(EMPTY), []),
  }
}
