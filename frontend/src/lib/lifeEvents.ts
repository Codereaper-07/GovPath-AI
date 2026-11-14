import type { LifeEventId, ServiceSummary } from '../types/api'

/** The five life-event categories, in display order. Labels live in i18n (lifeEvents.<id>.*). */
export const LIFE_EVENTS: LifeEventId[] = [
  'relocation-identity',
  'marriage-family',
  'birth-parenthood',
  'employment-career',
  'starting-business',
]

/** Each life event owns a muted hue (literal class names so Tailwind can see them). */
export const EVENT_TONE: Record<LifeEventId, { text: string; bg: string; solid: string; border: string }> = {
  'relocation-identity': { text: 'text-jade-700', bg: 'bg-jade-50', solid: 'bg-jade-600', border: 'border-jade-600' },
  'marriage-family': { text: 'text-petal-700', bg: 'bg-petal-50', solid: 'bg-petal-500', border: 'border-petal-500' },
  'birth-parenthood': { text: 'text-lagoon-700', bg: 'bg-lagoon-50', solid: 'bg-lagoon-500', border: 'border-lagoon-500' },
  'employment-career': { text: 'text-honey-700', bg: 'bg-honey-50', solid: 'bg-honey-500', border: 'border-honey-500' },
  'starting-business': { text: 'text-clay-700', bg: 'bg-clay-50', solid: 'bg-clay-500', border: 'border-clay-500' },
}

export function isLifeEvent(value: string | null): value is LifeEventId {
  return value !== null && (LIFE_EVENTS as string[]).includes(value)
}

/** Number of verified services per life event (a service may belong to several). */
export function countByLifeEvent(services: ServiceSummary[]): Record<LifeEventId, number> {
  const counts = Object.fromEntries(LIFE_EVENTS.map((e) => [e, 0])) as Record<LifeEventId, number>
  for (const s of services) for (const e of s.life_events) if (e in counts) counts[e] += 1
  return counts
}
