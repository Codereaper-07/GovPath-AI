/** GovPath mark: a route with two waypoints inside a navy tile. */
export function LogoMark({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <svg viewBox="0 0 36 36" className={className} aria-hidden>
      <rect width="36" height="36" rx="9" fill="#17336f" />
      <path d="M10 26c0-6 5-7 8-9s8-3 8-9" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="10" cy="26" r="3" fill="#e57d13" />
      <circle cx="26" cy="8" r="3" fill="#fff" />
    </svg>
  )
}
