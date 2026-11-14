/** GovPath mark: a route with a lime "you are here" stop on an ink tile. */
export function LogoMark({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <svg viewBox="0 0 36 36" className={className} aria-hidden>
      <rect width="36" height="36" rx="11" fill="#17211c" />
      <path d="M9 25.5h6.5a4.5 4.5 0 0 0 0-9h-1a4.5 4.5 0 0 1 0-9H27" fill="none" stroke="#f4f0e8" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="9" cy="25.5" r="3.2" fill="#c8e650" />
      <circle cx="27" cy="7.5" r="2.4" fill="none" stroke="#f4f0e8" strokeWidth="2" />
    </svg>
  )
}
