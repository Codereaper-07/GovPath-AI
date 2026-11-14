import type { ReactNode } from 'react'

/** Consistent page heading: optional eyebrow, editorial title, description and actions. */
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
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6">
      <div className="max-w-3xl">
        {eyebrow && <p className="text-xs font-semibold tracking-[0.14em] text-brand-600 uppercase">{eyebrow}</p>}
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-slate-900 sm:text-[2.1rem]">{title}</h1>
        {children && <p className="mt-2 text-base text-slate-600">{children}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  )
}
