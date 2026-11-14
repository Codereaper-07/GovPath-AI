import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { buttonClass } from '../../../components/ui/Button'
import { Icon } from '../../../components/ui/Icon'
import type { PlanResponse } from '../../../types/api'
import { type PlanNames, useReasonText } from '../names'

/** The planner's single recommended next action, as the boldest element on the page. */
export function NextActionCard({
  plan,
  names,
  onMarkDone,
  onOwn,
}: {
  plan: PlanResponse
  names: PlanNames
  onMarkDone: (serviceId: string) => void
  onOwn: (documentId: string) => void
}) {
  const { t } = useTranslation()
  const reasonText = useReasonText()
  const a = plan.next_action

  return (
    <section aria-labelledby="next-action" className="ink-panel relative overflow-hidden rounded-[2rem] p-7 shadow-lift sm:p-9">
      <span aria-hidden className="absolute -top-20 -right-20 h-64 w-64 rounded-full border-[30px] border-zest-400/10" />
      <p id="next-action" className="relative flex items-center gap-2.5 text-xs font-bold tracking-[0.18em] text-zest-400 uppercase">
        <span className={`h-2.5 w-2.5 rounded-full ${a.type === 'none' ? 'bg-jade-300' : 'animate-beacon bg-zest-400'}`} aria-hidden />
        {t('planner.nextAction')}
      </p>
      <h2 className="relative mt-3 max-w-2xl font-display text-3xl leading-tight font-semibold tracking-tight text-paper sm:text-4xl">
        {a.type === 'start_service' && a.service_id && t('planner.startService', { service: names.service(a.service_id) })}
        {a.type === 'obtain_document' && t('planner.obtainDocument')}
        {a.type === 'follow_up' && a.service_id && t('planner.followUp', { service: names.service(a.service_id) })}
        {a.type === 'none' && t('planner.allDone')}
      </h2>
      <p className="relative mt-3 max-w-2xl leading-relaxed text-paper/75">{reasonText(a, names, plan)}</p>

      {a.type === 'obtain_document' && (
        <div className="relative mt-5">
          <p className="text-sm font-semibold text-paper">{t('planner.tickWhenYouHaveIt')}</p>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {a.document_options.map((d) => (
              <li key={d}>
                <label className="flex cursor-pointer items-start gap-2.5 rounded-2xl bg-paper/10 px-3.5 py-2.5 text-sm text-paper ring-1 ring-paper/15 transition hover:bg-paper/15">
                  <input type="checkbox" className="mt-0.5 h-4 w-4" onChange={() => onOwn(d)} />
                  {names.document(d)}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      {a.type === 'start_service' && a.service_id && (
        <div className="relative mt-6 flex flex-wrap gap-3">
          <Link to={`/services/${a.service_id}`} className={buttonClass('zest', 'md')}>
            {t('planner.howToApply')} <Icon name="arrow" className="h-4 w-4" />
          </Link>
          <button type="button" onClick={() => onMarkDone(a.service_id!)} className={buttonClass('inverse', 'md')}>
            ✓ {t('planner.markDone')}
          </button>
        </div>
      )}
      {a.type === 'follow_up' && a.service_id && (
        <div className="relative mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={() => onMarkDone(a.service_id!)} className={buttonClass('zest', 'md')}>
            ✓ {t('planner.markDone')}
          </button>
        </div>
      )}
      <p className="relative mt-6 flex items-center gap-2 text-xs text-paper/50">
        <Icon name="plan" className="h-3.5 w-3.5" /> {t('planner.deterministicNote')}
      </p>
    </section>
  )
}
