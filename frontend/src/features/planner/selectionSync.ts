/**
 * Cross-tab reconciliation for the saved planner selection (pure, no storage access).
 *
 * Browsers give each tab its own cached view of localStorage, synchronised asynchronously, so two
 * tabs that edit within a few milliseconds can both read the old value and the later write drops the
 * earlier tab's change. Each tab therefore remembers its last change as a list of fine-grained
 * operations (one list item, one record key or one scalar) and, when another tab's write arrives,
 * re-applies any of its operations that are missing. On the same item, the later edit wins
 * (`Stamp` order); different items always both survive.
 */
import type { PlannerSelection } from './usePlannerState'

const LISTS = ['targets', 'owned', 'completed', 'goals', 'lacking'] as const
const RECORDS = ['progress', 'docStates'] as const
const SCALARS = ['generated', 'state'] as const

type Value = string | boolean | null
export interface Op {
  field: string
  key: string // list element or record key; '' for scalars
  value: Value // lists: true = present, false = absent; records: value or null (absent)
}
export interface Stamp {
  at: number
  writer: string
}
export interface Pending {
  base: PlannerSelection
  ops: Op[]
  stamp: Stamp
}

export const newer = (a: Stamp, b: Stamp) => a.at > b.at || (a.at === b.at && a.writer > b.writer)

function get(sel: PlannerSelection, op: Pick<Op, 'field' | 'key'>): Value {
  const f = op.field as keyof PlannerSelection
  if ((LISTS as readonly string[]).includes(f)) return (sel[f] as string[]).includes(op.key)
  if ((RECORDS as readonly string[]).includes(f)) return (sel[f] as Record<string, string>)[op.key] ?? null
  return sel[f] as Value
}

function set(sel: PlannerSelection, op: Op): PlannerSelection {
  const f = op.field as keyof PlannerSelection
  if ((LISTS as readonly string[]).includes(f)) {
    const list = (sel[f] as string[]).filter((x) => x !== op.key)
    return { ...sel, [f]: op.value ? [...list, op.key] : list }
  }
  if ((RECORDS as readonly string[]).includes(f)) {
    const rec = { ...(sel[f] as Record<string, string>) }
    if (op.value === null) delete rec[op.key]
    else rec[op.key] = op.value as string
    return { ...sel, [f]: rec }
  }
  return { ...sel, [f]: op.value }
}

/** The fine-grained operations that turn `base` into `next`. */
export function diff(base: PlannerSelection, next: PlannerSelection): Op[] {
  const ops: Op[] = []
  for (const field of LISTS) {
    for (const key of new Set([...base[field], ...next[field]])) {
      const value = next[field].includes(key)
      if (base[field].includes(key) !== value) ops.push({ field, key, value })
    }
  }
  for (const field of RECORDS) {
    for (const key of new Set([...Object.keys(base[field]), ...Object.keys(next[field])])) {
      const value = (next[field] as Record<string, string>)[key] ?? null
      if (((base[field] as Record<string, string>)[key] ?? null) !== value) ops.push({ field, key, value })
    }
  }
  for (const field of SCALARS) if (base[field] !== next[field]) ops.push({ field, key: '', value: next[field] })
  return ops
}

/**
 * Merge this tab's pending change into a selection written by another tab. Returns `incoming`
 * unchanged when nothing needs re-applying.
 */
export function reconcile(incoming: PlannerSelection, incomingStamp: Stamp, mine: Pending): PlannerSelection {
  const missing = mine.ops.filter((op) => get(incoming, op) !== op.value)
  // Where the other tab changed the same item, keep its value if its edit is the later one.
  const keep = newer(incomingStamp, mine.stamp) ? missing.filter((op) => get(incoming, op) === get(mine.base, op)) : missing
  return keep.length ? keep.reduce(set, incoming) : incoming
}
