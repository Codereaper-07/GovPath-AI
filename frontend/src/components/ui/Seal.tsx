import type { LifeEventId } from '../../types/api'
import { EVENT_TONE } from '../../lib/lifeEvents'
import { Icon } from './Icon'

/** A life event's emblem: an icon inside a stamped, dashed ring in the event's hue. */
export function Seal({ event, size = 'md', muted = false }: { event: LifeEventId; size?: 'sm' | 'md' | 'lg'; muted?: boolean }) {
  const tone = EVENT_TONE[event]
  const box = size === 'lg' ? 'h-16 w-16' : size === 'sm' ? 'h-9 w-9' : 'h-12 w-12'
  const icon = size === 'lg' ? 'h-7 w-7' : size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'
  return (
    <span className={`relative flex shrink-0 items-center justify-center rounded-full ${box} ${muted ? 'bg-paper-deep text-faint' : `${tone.bg} ${tone.text}`}`} aria-hidden>
      <span className="absolute inset-[3px] rounded-full border border-dashed border-current opacity-40" />
      <Icon name={event} className={icon} />
    </span>
  )
}
