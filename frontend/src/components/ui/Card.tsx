import type { ReactNode } from 'react'

export function Card({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
      {title && <h2 className="mb-3 font-display text-lg font-semibold text-slate-900">{title}</h2>}
      {children}
    </section>
  )
}
