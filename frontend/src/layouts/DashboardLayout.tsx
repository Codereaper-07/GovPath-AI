import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, Outlet } from 'react-router-dom'
import { Icon } from '../components/ui/Icon'
import { LogoMark } from '../components/ui/Logo'
import { LanguageSwitcher } from './LanguageSwitcher'

const NAV_ITEMS = [
  { to: '/', key: 'nav.dashboard', icon: 'relocation-identity', end: true },
  { to: '/services', key: 'nav.services', icon: 'search' },
  { to: '/planner', key: 'nav.planner', icon: 'plan' },
  { to: '/documents', key: 'nav.documents', icon: 'doc' },
  { to: '/assistant', key: 'nav.assistant', icon: 'chat' },
] as const

function Brand() {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-3">
      <LogoMark />
      <div className="leading-tight">
        <div className="font-display text-lg font-semibold text-slate-900">
          GovPath <span className="text-accent-600">AI</span>
        </div>
        <div className="text-[11px] text-slate-500">{t('app.tagline')}</div>
      </div>
    </div>
  )
}

export function DashboardLayout() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <div className="flex h-full bg-canvas text-slate-800">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        {t('nav.skip')}
      </a>
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 transform flex-col border-r border-line bg-surface transition-transform duration-200 md:static md:translate-x-0 ${
          open ? 'translate-x-0 shadow-raised' : '-translate-x-full'
        }`}
      >
        <div className="px-5 pt-6 pb-5">
          <Brand />
        </div>
        <nav aria-label={t('nav.label')} className="flex flex-1 flex-col gap-0.5 px-3">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={'end' in item ? item.end : false}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive ? 'bg-brand-50 text-brand-800' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    aria-hidden
                    className={`absolute top-2 bottom-2 left-0 w-[3px] rounded-r bg-brand-700 transition-opacity ${isActive ? 'opacity-100' : 'opacity-0'}`}
                  />
                  <Icon name={item.icon} className={`h-[18px] w-[18px] ${isActive ? 'text-brand-700' : 'text-slate-400 group-hover:text-slate-600'}`} />
                  {t(item.key)}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-3 border-t border-line px-5 py-4">
          <LanguageSwitcher />
          <p className="flex items-start gap-2 text-xs leading-relaxed text-slate-500">
            <Icon name="check" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-verified" />
            {t('nav.sourcesNote')}
          </p>
        </div>
      </aside>

      {open && <div className="fixed inset-0 z-30 bg-slate-900/30 md:hidden" onClick={() => setOpen(false)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3 md:hidden">
          <button
            type="button"
            className="rounded-md p-2 text-slate-600 hover:bg-slate-100"
            aria-label={t('nav.menu')}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <Icon name="menu" />
          </button>
          <Brand />
          <span className="w-9" />
        </header>
        <main id="main" className="flex-1 overflow-y-auto px-4 py-8 sm:px-8 lg:px-12">
          <div className="mx-auto max-w-6xl">
            <Outlet />
            <footer className="mt-16 border-t border-line pt-5 text-xs leading-relaxed text-slate-500">{t('app.disclaimer')}</footer>
          </div>
        </main>
      </div>
    </div>
  )
}
