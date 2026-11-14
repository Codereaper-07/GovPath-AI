import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router-dom'
import { Icon } from '../components/ui/Icon'
import { useAuth } from '../features/auth/useAuth'

/** Header entry for accounts: "Sign in" when signed out, "Account" when signed in. */
export function AccountLink({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation()
  const { status } = useAuth()
  if (status === 'unconfigured' || status === 'loading') return null
  const signedIn = status === 'signedIn'
  const label = signedIn ? t('nav.account') : t('auth.signIn')
  return (
    <NavLink
      to={signedIn ? '/profile' : '/login'}
      onClick={onNavigate}
      aria-label={label}
      className={({ isActive }) =>
        `flex h-10 items-center gap-2 rounded-full px-3 text-sm font-semibold whitespace-nowrap transition ${
          isActive ? 'bg-ink text-paper' : signedIn ? 'text-ink hover:bg-paper-deep' : 'text-ink ring-1 ring-rule-strong ring-inset hover:bg-paper-deep'
        }`
      }
    >
      <Icon name="user" className="h-4 w-4" />
      <span className="hidden sm:inline">{label}</span>
    </NavLink>
  )
}
