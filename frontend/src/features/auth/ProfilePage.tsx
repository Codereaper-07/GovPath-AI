import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { buttonClass } from '../../components/ui/Button'
import { PageHeader } from '../../components/ui/PageHeader'
import { ErrorState, LoadingState } from '../../components/ui/States'
import { SUPPORTED_LANGUAGES } from '../../i18n/config'
import type { Profile } from '../../types/api'
import { useVocabulary } from '../planner/api'
import { Notice } from './AuthLayout'
import { INPUT_CLASS } from './authUtils'
import { useAuth } from './useAuth'
import { useProfile, useUpdateProfile } from './api'

const LABEL = 'mb-1.5 block text-xs font-bold tracking-[0.14em] text-muted uppercase'

export function ProfilePage() {
  const { t } = useTranslation()
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const profile = useProfile()

  return (
    <div>
      <PageHeader
        eyebrow={t('profile.eyebrow')}
        title={t('profile.title')}
        actions={
          <button
            type="button"
            className={buttonClass('secondary', 'md')}
            onClick={() => {
              // Leave the protected page first (committed now, not as a transition that keeps this
              // page mounted while the next one loads); otherwise the route guard sends us to /login.
              void navigate('/', { replace: true, flushSync: true })
              void signOut()
            }}
          >
            {t('auth.signOut')}
          </button>
        }
      >
        {t('profile.intro')}
      </PageHeader>
      {profile.isPending && <LoadingState />}
      {profile.isError && <ErrorState message={t('profile.loadError')} onRetry={() => void profile.refetch()} />}
      {profile.data && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          {/* A different account gets a fresh form; saving keeps it (and its "saved" notice). */}
          <ProfileForm key={profile.data.user_id} profile={profile.data} />
          <AccountLinks />
        </div>
      )}
    </div>
  )
}

function ProfileForm({ profile }: { profile: Profile }) {
  const { t, i18n } = useTranslation()
  const vocabulary = useVocabulary()
  const update = useUpdateProfile()
  const [fullName, setFullName] = useState(profile.full_name ?? '')
  const [state, setState] = useState(profile.state ?? '')
  const [city, setCity] = useState(profile.city ?? '')
  const [language, setLanguage] = useState(profile.preferred_language)
  const [saved, setSaved] = useState(false)
  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    setSaved(false)
    set(v)
  }

  const states = vocabulary.data?.states ?? []
  const stateOptions = profile.state && !states.includes(profile.state) ? [profile.state, ...states] : states
  const dirty =
    fullName.trim() !== (profile.full_name ?? '') ||
    state !== (profile.state ?? '') ||
    city.trim() !== (profile.city ?? '') ||
    language !== profile.preferred_language

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setSaved(false)
    update.mutate(
      { full_name: fullName.trim() || null, state: state || null, city: city.trim() || null, preferred_language: language },
      {
        onSuccess: (p) => {
          setFullName(p.full_name ?? '')
          setState(p.state ?? '')
          setCity(p.city ?? '')
          setLanguage(p.preferred_language)
          setSaved(true)
          if (p.preferred_language !== i18n.resolvedLanguage) void i18n.changeLanguage(p.preferred_language)
        },
      },
    )
  }

  return (
    <form onSubmit={submit} className="space-y-5 rounded-[2rem] border border-rule bg-card p-6 sm:p-8" aria-labelledby="profile-details">
      <h2 id="profile-details" className="font-display text-xl font-semibold text-ink">
        {t('profile.details')}
      </h2>
      {saved && !update.isPending && <Notice tone="success">{t('profile.saved')}</Notice>}
      {update.isError && <Notice tone="error">{t('profile.saveError')}</Notice>}
      <div>
        <span className={LABEL}>{t('auth.email')}</span>
        <p className="rounded-2xl bg-paper-deep/60 px-3.5 py-2.5 text-sm font-semibold break-all text-ink">{profile.email ?? '—'}</p>
      </div>
      <label className="block">
        <span className={LABEL}>{t('profile.fullName')}</span>
        <input className={INPUT_CLASS} name="name" autoComplete="name" maxLength={120} value={fullName} onChange={(e) => edit(setFullName)(e.target.value)} />
      </label>
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block">
          <span className={LABEL}>{t('profile.state')}</span>
          <select className={`${INPUT_CLASS} font-semibold`} value={state} onChange={(e) => edit(setState)(e.target.value)}>
            <option value="">{t('profile.notSet')}</option>
            {stateOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={LABEL}>{t('profile.city')}</span>
          <input className={INPUT_CLASS} name="city" autoComplete="address-level2" maxLength={120} value={city} onChange={(e) => edit(setCity)(e.target.value)} />
        </label>
      </div>
      <label className="block max-w-xs">
        <span className={LABEL}>{t('profile.language')}</span>
        <select className={`${INPUT_CLASS} font-semibold`} value={language} onChange={(e) => edit(setLanguage)(e.target.value as Profile['preferred_language'])}>
          {SUPPORTED_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs leading-relaxed text-faint">{t('profile.stateNote')}</p>
      <button type="submit" disabled={!dirty || update.isPending} className={buttonClass('primary', 'md')}>
        {update.isPending ? t('profile.saving') : t('profile.save')}
      </button>
    </form>
  )
}

/** Links to the citizen's account data. */
function AccountLinks() {
  const { t } = useTranslation()
  return (
    <aside className="h-fit rounded-[2rem] border border-rule bg-paper-deep/40 p-6">
      <nav aria-label={t('profile.accountData')} className="flex flex-wrap gap-2">
        <Link to="/planner" className={buttonClass('secondary', 'sm')}>
          {t('account.savedTab')}
        </Link>
        <Link to="/vault" className={buttonClass('secondary', 'sm')}>
          {t('vault.title')}
        </Link>
        <Link to="/activity" className={buttonClass('secondary', 'sm')}>
          {t('activity.title')}
        </Link>
      </nav>
    </aside>
  )
}
