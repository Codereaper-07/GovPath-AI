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
}

export function Icon({ name, className = 'h-5 w-5' }: { name: LifeEventId | keyof typeof PATHS; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  )
}
