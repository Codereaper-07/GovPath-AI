import { Icon } from '../../../components/ui/Icon'

export type NodeKind = 'ready' | 'waiting' | 'blocked' | 'done' | 'next' | 'in_progress'

const NODE: Record<NodeKind, { cls: string; icon: 'arrow' | 'clock' | 'alert' | 'check' }> = {
  ready: { cls: 'bg-ink text-paper', icon: 'arrow' },
  waiting: { cls: 'bg-card text-faint ring-2 ring-inset ring-waiting', icon: 'clock' },
  blocked: { cls: 'bg-crimson-500 text-paper', icon: 'alert' },
  done: { cls: 'bg-jade-600 text-paper', icon: 'check' },
  in_progress: { cls: 'bg-jade-50 text-jade-700 ring-2 ring-inset ring-jade-500', icon: 'clock' },
  next: { cls: 'animate-beacon bg-zest-400 text-ink ring-2 ring-ink', icon: 'arrow' },
}

/** The map symbol for a step's status, shared by the journey, overview and legend. */
export function StatusNode({ kind, size = 'md' }: { kind: NodeKind; size?: 'sm' | 'md' }) {
  const n = NODE[kind]
  return (
    <span aria-hidden className={`flex shrink-0 items-center justify-center rounded-full ${size === 'sm' ? 'h-6 w-6' : 'h-8 w-8'} ${n.cls}`}>
      <Icon name={n.icon} className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} strokeWidth={2.4} />
    </span>
  )
}
