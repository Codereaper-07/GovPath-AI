import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { buttonClass } from '../../components/ui/Button'
import { LoadingState } from '../../components/ui/States'
import { AuthCard, Field, Notice } from './AuthLayout'
import { authErrorKey, MIN_PASSWORD, returnPath } from './authUtils'
import { useAuth } from './useAuth'

export function SignupPage() {
  const { t } = useTranslation()
  const { status, signUp } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [confirmSent, setConfirmSent] = useState(false)
  const target = returnPath(location.state)

  if (status === 'loading') return <LoadingState />
  if (status === 'signedIn' && !pending) return <Navigate to={target} replace />

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (password.length < MIN_PASSWORD) return
    setPending(true)
    setError(null)
    const result = await signUp(email.trim(), password, fullName.trim())
    setPending(false)
    if (!result.ok) setError(result.error ?? 'unknown')
    else if (result.needsConfirmation) setConfirmSent(true)
    else navigate(target, { replace: true })
  }

  if (confirmSent) {
    return (
      <AuthCard title={t('auth.checkEmailTitle')} intro={t('auth.checkEmail', { email: email.trim() })}>
        <Link to="/login" className={buttonClass('secondary', 'md')}>
          {t('auth.backToSignIn')}
        </Link>
      </AuthCard>
    )
  }

  return (
    <AuthCard title={t('auth.signupTitle')} intro={t('auth.signupIntro')}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {status === 'unconfigured' && <Notice tone="info">{t('auth.unconfigured')}</Notice>}
        {error && <Notice tone="error">{t(authErrorKey(error))}</Notice>}
        <Field label={t('profile.fullName')} name="name" autoComplete="name" maxLength={120} value={fullName} onChange={(e) => setFullName(e.target.value)} />
        <Field label={t('auth.email')} type="email" name="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field
          label={t('auth.password')}
          hint={tooShort ? t('auth.passwordTooShort', { min: MIN_PASSWORD }) : t('auth.passwordHint', { min: MIN_PASSWORD })}
          type="password"
          name="new-password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button
          type="submit"
          disabled={pending || status === 'unconfigured' || !email.trim() || password.length < MIN_PASSWORD}
          className={buttonClass('primary', 'lg', 'w-full')}
        >
          {pending ? t('auth.creatingAccount') : t('auth.createAccount')}
        </button>
        <p className="text-xs leading-relaxed text-faint">{t('auth.privacyNote')}</p>
        <p className="text-center text-sm text-muted">
          {t('auth.haveAccount')}{' '}
          <Link to="/login" state={location.state} className="font-semibold text-jade-700 underline-offset-4 hover:underline">
            {t('auth.signIn')}
          </Link>
        </p>
      </form>
    </AuthCard>
  )
}
