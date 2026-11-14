import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import type { PlanResponse } from '../../../types/api'
import { type PlanNames, useReasonText } from '../names'

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
  const tone =
    a.type === 'start_service'
      ? 'border-brand-600 bg-brand-50'
      : a.type === 'obtain_document'
        ? 'border-amber-400 bg-amber-50'
        : 'border-green-500 bg-green-50'

  return (
    <section aria-labelledby="next-action" className={`rounded-xl border-2 p-5 ${tone}`}>
      <p id="next-action" className="text-xs font-semibold tracking-wide text-slate-600 uppercase">
        {t('planner.nextAction')}
      </p>
      <h2 className="mt-1 text-xl font-semibold text-slate-900">
        {a.type === 'start_service' && a.service_id && t('planner.startService', { service: names.service(a.service_id) })}
        {a.type === 'obtain_document' && t('planner.obtainDocument')}
        {a.type === 'none' && t('planner.allDone')}
      </h2>
      <p className="mt-2 text-sm text-slate-700">{reasonText(a, names)}</p>

      {a.type === 'obtain_document' && (
        <div className="mt-3">
          <p className="text-sm font-medium text-slate-700">{t('planner.tickWhenYouHaveIt')}</p>
          <ul className="mt-1 grid gap-1 sm:grid-cols-2">
            {a.document_options.map((d) => (
              <li key={d}>
                <label className="flex cursor-pointer items-start gap-2 rounded-md bg-white px-2 py-1.5 text-sm ring-1 ring-amber-200">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" onChange={() => onOwn(d)} />
                  {names.document(d)}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      {a.type === 'start_service' && a.service_id && (
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          <Link
            to={`/services/${a.service_id}`}
            className="rounded-md bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-700"
          >
            {t('planner.howToApply')}
          </Link>
          <button
            type="button"
            onClick={() => onMarkDone(a.service_id!)}
            className="rounded-md bg-white px-3 py-1.5 font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
          >
            ✓ {t('planner.markDone')}
          </button>
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500">{t('planner.deterministicNote')}</p>
    </section>
  )
}
