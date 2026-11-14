import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { buttonClass } from '../../components/ui/Button'
import { LoadingState } from '../../components/ui/States'
import { AuthCard, Field, Notice } from './AuthLayout'
import { authErrorKey, returnPath } from './authUtils'
import { useAuth } from './useAuth'

export function LoginPage() {
  const { t } = useTranslation()
  const { status, expired, signIn } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const target = returnPath(location.state)

  if (status === 'loading') return <LoadingState />
  if (status === 'signedIn' && !pending) return <Navigate to={target} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setPending(true)
    setError(null)
    const result = await signIn(email.trim(), password)
    setPending(false)
    if (result.ok) navigate(target, { replace: true })
    else setError(result.error ?? 'unknown')
  }

  return (
    <AuthCard title={t('auth.loginTitle')} intro={t('auth.loginIntro')}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {status === 'unconfigured' && <Notice tone="info">{t('auth.unconfigured')}</Notice>}
        {expired && !error && <Notice tone="info">{t('auth.sessionExpired')}</Notice>}
        {error && <Notice tone="error">{t(authErrorKey(error))}</Notice>}
        <Field label={t('auth.email')} type="email" name="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field
          label={t('auth.password')}
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button
          type="submit"
          disabled={pending || status === 'unconfigured' || !email.trim() || !password}
          className={buttonClass('primary', 'lg', 'w-full')}
        >
          {pending ? t('auth.signingIn') : t('auth.signIn')}
        </button>
        <p className="text-center text-sm text-muted">
          {t('auth.noAccount')}{' '}
          <Link to="/signup" state={location.state} className="font-semibold text-jade-700 underline-offset-4 hover:underline">
            {t('auth.createAccount')}
          </Link>
        </p>
      </form>
    </AuthCard>
  )
}
