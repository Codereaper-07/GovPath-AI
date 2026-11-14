import type { LifeEventId, ServiceSummary } from '../types/api'

/** The five life-event categories, in display order. Labels live in i18n (lifeEvents.<id>.*). */
export const LIFE_EVENTS: LifeEventId[] = [
  'relocation-identity',
  'marriage-family',
  'birth-parenthood',
  'employment-career',
  'starting-business',
]

export function isLifeEvent(value: string | null): value is LifeEventId {
  return value !== null && (LIFE_EVENTS as string[]).includes(value)
}

/** Number of verified services per life event (a service may belong to several). */
export function countByLifeEvent(services: ServiceSummary[]): Record<LifeEventId, number> {
  const counts = Object.fromEntries(LIFE_EVENTS.map((e) => [e, 0])) as Record<LifeEventId, number>
  for (const s of services) for (const e of s.life_events) if (e in counts) counts[e] += 1
  return counts
}
