import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, Outlet } from 'react-router-dom'
import { LanguageSwitcher } from './LanguageSwitcher'

const NAV_ITEMS = [
  { to: '/', key: 'nav.dashboard', end: true },
  { to: '/services', key: 'nav.services' },
  { to: '/planner', key: 'nav.planner' },
  { to: '/documents', key: 'nav.documents' },
  { to: '/assistant', key: 'nav.assistant' },
] as const

export function DashboardLayout() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <div className="flex h-full bg-slate-100 text-slate-800">
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-60 transform border-r border-slate-200 bg-white transition-transform md:static md:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="text-lg font-bold text-brand-700">{t('app.name')}</div>
          <div className="text-xs text-slate-500">{t('app.tagline')}</div>
        </div>
        <nav className="flex flex-col gap-1 p-3">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={'end' in item ? item.end : false}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `rounded-md px-3 py-2 text-sm font-medium ${
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50'
                }`
              }
            >
              {t(item.key)}
            </NavLink>
          ))}
        </nav>
      </aside>

      {open && (
        <div className="fixed inset-0 z-20 bg-black/30 md:hidden" onClick={() => setOpen(false)} />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <button
            type="button"
            className="rounded-md px-2 py-1 text-slate-600 hover:bg-slate-100 md:hidden"
            aria-label="Menu"
            onClick={() => setOpen((v) => !v)}
          >
            ☰
          </button>
          <div className="flex-1" />
          <LanguageSwitcher />
        </header>
        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
          <div className="mx-auto max-w-5xl">
            <Outlet />
            <footer className="mt-12 border-t border-slate-200 pt-4 text-xs text-slate-500">{t('app.disclaimer')}</footer>
          </div>
        </main>
      </div>
    </div>
  )
}
