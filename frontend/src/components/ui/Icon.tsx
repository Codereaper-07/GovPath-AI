import type { LifeEventId } from '../../types/api'

const PATHS: Record<string, string> = {
  // simple 24px outline icons (stroke-based, no external dependency)
  'relocation-identity': 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  'marriage-family': 'M9 14a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm6 0a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  'birth-parenthood': 'M12 4a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM6 21v-2a6 6 0 0 1 12 0v2',
  'employment-career': 'M4 8h16v11H4zM9 8V5h6v3M4 13h16',
  'starting-business': 'M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6',
  plan: 'M5 4h14v16H5zM8 9h8M8 13h8M8 17h5',
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm9 16-4.3-4.3',
  doc: 'M7 3h7l5 5v13H7zM14 3v5h5',
  chat: 'M4 5h16v11H9l-5 4z',
  check: 'M5 12l5 5L20 7',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  menu: 'M4 7h16M4 12h16M4 17h16',
  shield: 'M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z',
  spark: 'M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  clock: 'M12 7v5l3 2M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z',
  alert: 'M12 9v4m0 4h.01M10.3 4.2 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z',
  send: 'M4 12l16-8-6 16-2-6z',
}

export function Icon({ name, className = 'h-5 w-5' }: { name: LifeEventId | keyof typeof PATHS; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  )
}
