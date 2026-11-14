import type { ReactNode } from 'react'

/** Editorial page opening: small eyebrow, large serif title, standfirst and optional actions. */
export function PageHeader({
  title,
  eyebrow,
  actions,
  children,
}: {
  title: string
  eyebrow?: string
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <header className="mb-10 flex animate-rise flex-wrap items-end justify-between gap-6">
      <div className="max-w-3xl">
        {eyebrow && (
          <p className="flex items-center gap-2 text-xs font-bold tracking-[0.18em] text-jade-700 uppercase">
            <span className="h-px w-6 bg-jade-500" aria-hidden />
            {eyebrow}
          </p>
        )}
        <h1 className="mt-3 font-display text-4xl leading-[1.05] font-semibold tracking-tight text-ink sm:text-5xl">{title}</h1>
        {children && <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">{children}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  )
}
