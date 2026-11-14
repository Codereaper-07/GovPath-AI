import type { ReactNode } from 'react'

export function Card({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-rule bg-card p-5">
      {title && <h2 className="mb-3 font-display text-lg font-semibold text-ink">{title}</h2>}
      {children}
    </section>
  )
}
