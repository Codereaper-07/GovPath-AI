import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Icon } from '../../components/ui/Icon'

/** The two ways to create a plan. Always shown in My Plans, whatever plans already exist. */
export function CreatePlanPanel({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  return (
    <section aria-labelledby="create-plan" className={`ink-panel relative overflow-hidden rounded-[2rem] ${compact ? 'p-5' : 'p-7 sm:p-9'}`} data-testid="create-plan">
      <span aria-hidden className="absolute -top-16 -right-16 h-48 w-48 rounded-full border-[24px] border-zest-400/10" />
      <h2 id="create-plan" className={`relative font-display font-semibold text-paper ${compact ? 'text-xl' : 'text-2xl'}`}>
        {t('myPlans.createTitle')}
      </h2>
      {!compact && <p className="relative mt-2 max-w-xl text-paper/70">{t('myPlans.createIntro')}</p>}
      <div className="relative mt-4 grid gap-3 sm:grid-cols-2">
        <Link to="/planner?create=situation" className="rounded-2xl bg-paper/10 p-4 ring-1 ring-paper/20 transition hover:bg-paper/15">
          <span className="flex items-center gap-2 font-semibold text-paper">
            <Icon name="spark" className="h-4 w-4 text-zest-400" /> {t('myPlans.createSituation')}
          </span>
          <span className="mt-1 block text-xs text-paper/70">{t('myPlans.createSituationHint')}</span>
        </Link>
        <Link to="/planner?create=services" className="rounded-2xl bg-paper/10 p-4 ring-1 ring-paper/20 transition hover:bg-paper/15">
          <span className="flex items-center gap-2 font-semibold text-paper">
            <Icon name="plan" className="h-4 w-4 text-zest-400" /> {t('myPlans.createServices')}
          </span>
          <span className="mt-1 block text-xs text-paper/70">{t('myPlans.createServicesHint')}</span>
        </Link>
      </div>
    </section>
  )
}
