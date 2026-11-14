import type { LifeEventId } from '../../types/api'

/** 24px stroke icons drawn for GovPath (no icon dependency). Multiple sub-paths split by "|". */
const PATHS = {
  'relocation-identity': 'M4 11.5 12 5l8 6.5V20H4z|M9.5 20v-5h5v5|M15.5 3.5h4v4',
  'marriage-family': 'M9 9.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z|M15 9.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z|M10.5 4.5 12 3l1.5 1.5L12 6z',
  'birth-parenthood': 'M12 3.5a3 3 0 1 1 0 6 3 3 0 0 1 0-6z|M6.5 20.5c0-4 2.5-7 5.5-7s5.5 3 5.5 7|M9.5 17h5',
  'employment-career': 'M3.5 8.5h17v11h-17z|M9 8.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v2.5|M3.5 13.5h17|M11 13.5h2v2h-2z',
  'starting-business': 'M4 10v10h16V10|M3 10l1.8-5.5h14.4L21 10z|M3 10c0 1.4 1.3 2.5 3 2.5s3-1.1 3-2.5c0 1.4 1.3 2.5 3 2.5s3-1.1 3-2.5c0 1.4 1.3 2.5 3 2.5s3-1.1 3-2.5|M10 20v-4.5h4V20',
  home: 'M4 11 12 4.5 20 11v9H4z|M10 20v-5h4v5',
  plan: 'M6 4.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z|M18 15.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z|M8 6.5h6.5a3.5 3.5 0 0 1 0 7h-5a3.5 3.5 0 0 0 0 7H16',
  search: 'M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13z|M20 20l-4.6-4.6',
  doc: 'M7 3.5h7l4.5 4.5v12.5H7z|M14 3.5V8h4.5|M10 12.5h5.5M10 16h5.5',
  chat: 'M4.5 5.5h15v10h-8l-4.5 4v-4h-2.5z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  arrow: 'M5 12h14|M13.5 6.5 19 12l-5.5 5.5',
  'arrow-left': 'M19 12H5|M10.5 6.5 5 12l5.5 5.5',
  external: 'M14 4.5h5.5V10|M19.5 4.5 11 13|M17 14v5.5H4.5V7H10',
  menu: 'M4 7h16M4 12h16M4 17h10',
  close: 'M6 6l12 12M18 6 6 18',
  shield: 'M12 3.5l7 2.8v5.4c0 4.4-3 7.6-7 8.8-4-1.2-7-4.4-7-8.8V6.3z|M9 12l2 2 4-4',
  spark: 'M12 3.5c.6 4.3 2.2 5.9 6.5 6.5-4.3.6-5.9 2.2-6.5 6.5-.6-4.3-2.2-5.9-6.5-6.5 4.3-.6 5.9-2.2 6.5-6.5z|M18.5 15.5c.3 1.7.8 2.2 2.5 2.5-1.7.3-2.2.8-2.5 2.5-.3-1.7-.8-2.2-2.5-2.5 1.7-.3 2.2-.8 2.5-2.5z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1|M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  clock: 'M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17z|M12 7.5V12l3 2',
  alert: 'M12 9v4.5|M12 17h.01|M10.3 4.2 2.6 17.8A2 2 0 0 0 4.3 21h15.4a2 2 0 0 0 1.7-3.2L13.7 4.2a2 2 0 0 0-3.4 0z',
  send: 'M5 12 19.5 4.5 15 20l-3.2-6.3z|M11.8 13.7 19.5 4.5',
  quote: 'M5 17c0-4 1.5-7 4.5-8.5|M5 12.5h4v4.5H5z|M13.5 17c0-4 1.5-7 4.5-8.5|M13.5 12.5h4v4.5h-4z',
  plus: 'M12 5v14M5 12h14',
  stamp: 'M12 3.5a3.5 3.5 0 0 0-2 6.4V13H6.5a2 2 0 0 0-2 2v2h15v-2a2 2 0 0 0-2-2H14V9.9a3.5 3.5 0 0 0-2-6.4z|M4.5 20.5h15',
  layers: 'M12 4 3.5 8.5 12 13l8.5-4.5z|M3.5 12.5 12 17l8.5-4.5|M3.5 16.5 12 21l8.5-4.5',
} as const

export type IconName = LifeEventId | keyof typeof PATHS

export function Icon({ name, className = 'h-5 w-5', strokeWidth = 1.7 }: { name: IconName; className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {PATHS[name].split('|').map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  )
}
