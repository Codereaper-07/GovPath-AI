import { Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { Icon, type IconName } from '../components/ui/Icon'
import { LogoMark } from '../components/ui/Logo'
import { LoadingState } from '../components/ui/States'
import { AccountLink } from './AccountLink'
import { LanguageSwitcher } from './LanguageSwitcher'

const NAV_ITEMS: { to: string; key: string; icon: IconName; end?: boolean }[] = [
  { to: '/', key: 'nav.dashboard', icon: 'home', end: true },
  { to: '/services', key: 'nav.services', icon: 'search' },
  { to: '/planner', key: 'nav.planner', icon: 'plan' },
  { to: '/documents', key: 'nav.documents', icon: 'doc' },
  { to: '/assistant', key: 'nav.assistant', icon: 'spark' },
]

function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark className="h-9 w-9" />
      <span className={`font-display text-xl leading-none font-semibold tracking-tight ${inverse ? 'text-paper' : 'text-ink'}`}>
        GovPath<span className={`ml-1 align-top text-[11px] font-sans font-extrabold tracking-wider ${inverse ? 'text-zest-400' : 'text-jade-600'}`}>AI</span>
      </span>
    </span>
  )
}

export function DashboardLayout() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const links = (mobile: boolean) =>
    NAV_ITEMS.map((item) => (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.end ?? false}
        onClick={() => setOpen(false)}
        className={({ isActive }) =>
          mobile
            ? `flex items-center gap-3 rounded-2xl px-4 py-3 text-base font-semibold transition ${isActive ? 'bg-ink text-paper' : 'text-ink hover:bg-paper-deep'}`
            : `flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold whitespace-nowrap transition ${
                isActive ? 'bg-ink text-paper shadow-soft' : 'text-muted hover:bg-paper-deep hover:text-ink'
              }`
        }
      >
        {({ isActive }) => (
          <>
            <Icon name={item.icon} className={`h-4 w-4 ${isActive ? 'text-zest-400' : ''}`} />
            {t(item.key)}
          </>
        )}
      </NavLink>
    ))

  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-paper"
      >
        {t('nav.skip')}
      </a>

      <header className="sticky top-0 z-40 border-b border-rule bg-paper/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-10">
          <Link to="/" className="shrink-0 rounded-xl" onClick={() => setOpen(false)} aria-label="GovPath AI">
            <Brand />
          </Link>
          <nav aria-label={t('nav.label')} className="mx-auto hidden items-center gap-1 lg:flex">
            {links(false)}
          </nav>
          <div className="ml-auto flex items-center gap-2 lg:ml-0">
            <LanguageSwitcher />
            <AccountLink onNavigate={() => setOpen(false)} />
            <button
              type="button"
              className="flex h-10 w-10 items-center justify-center rounded-full text-ink transition hover:bg-paper-deep lg:hidden"
              aria-label={t('nav.menu')}
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              <Icon name={open ? 'close' : 'menu'} />
            </button>
          </div>
        </div>
        {open && (
          <nav aria-label={t('nav.label')} className="animate-rise border-t border-rule bg-paper px-4 pt-3 pb-5 lg:hidden">
            <div className="mx-auto grid max-w-7xl gap-1">{links(true)}</div>
          </nav>
        )}
      </header>

      <main id="main" className="flex-1">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-10 lg:py-14">
          <Suspense fallback={<LoadingState />}>
            <Outlet />
          </Suspense>
        </div>
      </main>

      <footer className="ink-panel mt-10">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:px-10">
          <div>
            <Brand inverse />
            <p className="mt-3 text-sm text-paper/60">{t('app.tagline')}</p>
          </div>
          <div className="space-y-3 text-sm leading-relaxed text-paper/70">
            <p className="flex items-start gap-2 text-paper">
              <Icon name="shield" className="mt-0.5 h-4 w-4 shrink-0 text-zest-400" />
              {t('nav.sourcesNote')}
            </p>
            <p>{t('app.disclaimer')}</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
