import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useLocation } from 'react-router-dom'
import { LoadingState } from '../../components/ui/States'
import { useAuth } from './useAuth'

/** Protected route: signed-out visitors go to /login and come back here afterwards. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  const location = useLocation()
  const { t } = useTranslation()
  if (status === 'loading') return <LoadingState />
  if (status === 'unconfigured') {
    return (
      <div role="status" className="mx-auto max-w-xl rounded-[2rem] border border-rule bg-card p-8 text-center">
        <h1 className="font-display text-2xl font-semibold text-ink">{t('auth.unconfiguredTitle')}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">{t('auth.unconfigured')}</p>
      </div>
    )
  }
  if (status === 'signedOut') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  return <>{children}</>
}
