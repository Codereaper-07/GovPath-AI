import { useTranslation } from 'react-i18next'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { buttonClass } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { PageHeader } from '../../components/ui/PageHeader'
import { LoadingState } from '../../components/ui/States'
import { CreateFromServices } from '../account/CreateFromServices'
import { CreatePlanPanel } from '../account/CreatePlanPanel'
import { SavedPlansView } from '../account/SavedPlansView'
import { useAuth } from '../auth/useAuth'
import { SituationJourney } from '../journey/SituationJourney'

/**
 * My Plans: the hub for every saved plan (signed-in account only; no device plans) and the
 * starting point for both ways of creating one:
 *  - ?create=situation  describe a situation -> discovered services -> one reviewed workflow;
 *  - ?create=services   pick services -> one plan, one combined plan, or one plan per service.
 * Both save through the same API and the same deterministic planner. Guests can use both flows
 * and sign in to save (the proposal/selection is kept across sign-in).
 */
export function PlannerPage() {
  const { t } = useTranslation()
  const { status } = useAuth()
  const [params] = useSearchParams()
  const create = params.get('create')
  if (status === 'loading') return <LoadingState />
  if (create === 'services' || create === 'situation') {
    return (
      <>
        <Link to="/planner" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-jade-700 underline-offset-4 hover:underline">
          <Icon name="arrow" className="h-4 w-4 rotate-180" /> {t('myPlans.back')}
        </Link>
        <PageHeader eyebrow={t('myPlans.title')} title={t(create === 'services' ? 'myPlans.createServices' : 'myPlans.createSituation')} />
        {create === 'services' ? <CreateFromServices /> : <SituationJourney />}
      </>
    )
  }
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
    <div className="space-y-6">
      <section className="rounded-[2rem] bg-card p-6 ring-1 ring-rule sm:p-8" data-testid="plans-sign-in">
        <h2 className="font-display text-2xl font-semibold text-ink">{t('myPlans.signInTitle')}</h2>
        <p className="mt-2 max-w-xl text-muted">{t(unconfigured ? 'myPlans.unconfigured' : 'myPlans.signInBody')}</p>
        {!unconfigured && (
          <Link to="/login" state={{ from: location.pathname + location.search }} className={buttonClass('primary', 'md', 'mt-5')}>
            {t('auth.signIn')}
          </Link>
        )}
      </section>
      <CreatePlanPanel />
    </div>
  )
}
