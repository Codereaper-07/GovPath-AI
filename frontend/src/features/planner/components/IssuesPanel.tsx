import { useTranslation } from 'react-i18next'
import type { PlanResponse } from '../../../types/api'
import type { PlanNames } from '../names'

/**
 * Blockers reported by the backend planner. Requirements that another plan step will satisfy
 * are not repeated here (the timeline shows them); only genuine dead ends are listed.
 */
export function IssuesPanel({ plan, names }: { plan: PlanResponse; names: PlanNames }) {
  const { t } = useTranslation()
  const missing = plan.blockers.filter((b) => b.code === 'missing_document_no_route')
  const waiting = plan.blockers.filter((b) => b.code === 'dependency_blocked')
  if (plan.blockers.length === 0) return null

  return (
    <section className="rounded-xl border border-red-200 bg-red-50 p-4">
      <h2 className="font-semibold text-red-900">{t('planner.blockersTitle', { count: missing.length })}</h2>
      <p className="mt-0.5 text-sm text-red-800">{t('planner.missingNoRoute')}</p>
      <ul className="mt-3 space-y-2 text-sm">
        {missing.map((b) => (
          <li key={`${b.service_id}-${b.requirement_id}`} className="rounded-lg bg-white px-3 py-2 ring-1 ring-red-100">
            <span className="font-medium text-slate-900">{names.service(b.service_id)}</span>
            {b.requirement_id && (
              <span className="text-slate-600"> · {names.requirement(b.requirement_id, b.requirement_id)}</span>
            )}
            <span className="block text-slate-700">{names.options(b.document_options, 3)}</span>
          </li>
        ))}
      </ul>
      {waiting.length > 0 && (
        <p className="mt-3 text-sm text-red-800">
          {t('planner.alsoWaiting', { services: names.services(waiting.map((b) => b.service_id)) })}
        </p>
      )}
    </section>
  )
}
