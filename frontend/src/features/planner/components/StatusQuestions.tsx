import { useTranslation } from 'react-i18next'
import { buttonClass } from '../../../components/ui/Button'
import type { PlanResponse } from '../../../types/api'
import type { PlanNames } from '../names'

/**
 * Questions the planner asks instead of assuming (clarification `document_status_required`): a
 * document the citizen may already have (e.g. a mobile number registered with their Aadhaar)
 * whose only source updates that same record. "Yes" marks it as held; "No" brings in the
 * service that provides it. Nothing is assumed either way.
 */
export function StatusQuestions({
  plan,
  names,
  onHave,
  onLack,
}: {
  plan: PlanResponse
  names: PlanNames
  onHave: (documentId: string) => void
  onLack?: (documentId: string, serviceIds: string[]) => void
}) {
  const { t } = useTranslation()
  const questions = (plan.clarifications ?? []).filter((c) => c.code === 'document_status_required' && c.document_id)
  if (questions.length === 0) return null
  return (
    <div className="space-y-3" data-testid="status-questions">
      {questions.map((q) => {
        const doc = q.document_id!
        const routes = q.route_service_ids ?? []
        return (
          <section key={`${q.service_id}-${doc}`} className="rounded-2xl bg-zest-100 p-5 ring-1 ring-zest-300" data-testid={`status-question-${doc}`}>
            <p className="font-semibold text-ink">{t('planner.statusQuestion', { document: names.document(doc) })}</p>
            <p className="mt-1 text-sm text-ink/80">{t('planner.statusWhy', { service: names.service(q.service_id), services: names.services(routes) })}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => onHave(doc)} className={buttonClass('secondary', 'sm')}>
                {t('planner.statusYes')}
              </button>
              {onLack && routes.length > 0 && (
                <button type="button" onClick={() => onLack(doc, routes)} className={buttonClass('secondary', 'sm')}>
                  {t('planner.statusNo', { services: names.services(routes) })}
                </button>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
