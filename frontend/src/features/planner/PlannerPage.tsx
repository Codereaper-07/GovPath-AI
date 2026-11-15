import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router-dom'
import { buttonClass } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { PageHeader } from '../../components/ui/PageHeader'
import { LoadingState } from '../../components/ui/States'
import { SavedPlansView } from '../account/SavedPlansView'
import { useAuth } from '../auth/useAuth'

/**
 * My Plans: the only place plans are managed. Plans belong to the signed-in citizen's account
 * (PostgreSQL); there is no separate browser/device plan. Guests can still explore their
 * situation and see a proposed workflow on the assistant page, and sign in to save it.
 */
export function PlannerPage() {
  const { t } = useTranslation()
  const { status } = useAuth()
  if (status === 'loading') return <LoadingState />
  return (
    <>
      <PageHeader eyebrow={t('planner.eyebrow')} title={t('myPlans.title')}>
        {t('myPlans.intro')}
      </PageHeader>
      {status === 'signedIn' ? <SavedPlansView /> : <SignInToManage unconfigured={status === 'unconfigured'} />}
    </>
  )
}

function SignInToManage({ unconfigured }: { unconfigured: boolean }) {
  const { t } = useTranslation()
  const location = useLocation()
  return (
    <section className="ink-panel relative overflow-hidden rounded-[2rem] p-7 sm:p-10" data-testid="plans-sign-in">
      <span aria-hidden className="absolute -right-24 -bottom-24 h-80 w-80 rounded-full border-[36px] border-zest-400/10" />
      <h2 className="relative max-w-xl font-display text-3xl leading-tight font-semibold text-paper">{t('myPlans.signInTitle')}</h2>
      <p className="relative mt-3 max-w-xl text-paper/70">{t(unconfigured ? 'myPlans.unconfigured' : 'myPlans.signInBody')}</p>
      <div className="relative mt-6 flex flex-wrap gap-3">
        {!unconfigured && (
          <Link to="/login" state={{ from: location.pathname + location.search }} className={buttonClass('zest', 'md')}>
            {t('auth.signIn')}
          </Link>
        )}
        <Link to="/assistant" className={buttonClass('inverse', 'md')}>
          <Icon name="spark" className="h-4 w-4" /> {t('myPlans.explore')}
        </Link>
      </div>
    </section>
  )
}
