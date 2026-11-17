import { useStateName } from '../../../lib/useStateName'
import { useTranslation } from 'react-i18next'
import { Icon } from '../../../components/ui/Icon'
import type { PlanResponse } from '../../../types/api'
import type { PlanNames } from '../names'

/**
 * Blockers reported by the backend planner. Requirements that another plan step will satisfy
 * are not repeated here (the journey shows them); only genuine dead ends are listed.
 */
export function IssuesPanel({ plan, names }: { plan: PlanResponse; names: PlanNames }) {
  const { t } = useTranslation()
  const stateName = useStateName()
  const missing = plan.blockers.filter((b) => b.code !== 'dependency_blocked')
  const waiting = plan.blockers.filter((b) => b.code === 'dependency_blocked')
  if (plan.blockers.length === 0) return null
  // Each blocker is ONE mandatory requirement (all are needed); its document_options are that
  // requirement's OR group (any one satisfies it). Only state "obtain it yourself" for the whole
  // list when no listed requirement has a producing service at all.
  // Truly "obtain it yourself" only when no service can ever provide it (not even after another
  // record is obtained, e.g. the Aadhaar mobile update once there is an Aadhaar number).
  const ownOnly = (b: (typeof missing)[number]) => b.code === 'missing_document_no_route' && !(b.route_service_ids?.length ?? 0)
  const allNoRoute = missing.length > 0 && missing.every(ownOnly)

  return (
    <section className="rounded-3xl border-2 border-crimson-200 bg-crimson-50 p-6">
      <div className="flex items-start gap-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-crimson-500 text-paper">
          <Icon name="alert" className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl font-semibold text-crimson-700">{t('planner.blockersTitle', { count: missing.length })}</h2>
          {missing.length > 0 && (
            <p className="mt-1 text-sm text-crimson-700/90" data-testid="blockers-intro">
              {t('planner.blockersNeedAll', { count: missing.length })}
              {allNoRoute && <> {t('planner.blockersObtainYourself', { count: missing.length })}</>}
            </p>
          )}
          <ul className="mt-4 space-y-2 text-sm">
            {missing.map((b) => (
              <li key={`${b.service_id}-${b.requirement_id}`} className="rounded-2xl bg-card px-4 py-3 ring-1 ring-crimson-100">
                <span className="font-bold text-ink">{names.service(b.service_id)}</span>
                {b.requirement_id && <span className="text-muted"> · {names.requirement(b.requirement_id, b.requirement_id)}</span>}
                <span className="mt-0.5 block text-ink/80">{names.options(b.document_options, 3)}</span>
                {b.code === 'missing_document_status_unknown' && (
                  <span className="mt-1.5 block text-xs font-semibold text-crimson-700">
                    {t('planner.statusUnknownNote', { services: names.services(b.route_service_ids ?? []) })}
                  </span>
                )}
                {b.code === 'missing_document_no_route' && (b.route_service_ids?.length ?? 0) > 0 && (
                  <span className="mt-1.5 block text-xs font-semibold text-crimson-700">
                    {t('planner.providedOnceYouHave', {
                      services: names.services(b.route_service_ids ?? []),
                      documents: (b.route_needs_document_ids ?? []).map(names.document).join(t('common.listSeparator')),
                    })}
                  </span>
                )}
                {!allNoRoute && ownOnly(b) && (
                  <span className="mt-1.5 block text-xs font-semibold text-crimson-700">{t('planner.obtainThisYourself')}</span>
                )}
                {b.code === 'missing_document_route_outside_jurisdiction' && (
                  <span className="mt-1.5 block text-xs font-semibold text-crimson-700">
                    {t('planner.routeOutside', {
                      services: names.services(b.route_service_ids ?? []),
                      state: stateName(plan.citizen_state),
                    })}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {waiting.length > 0 && (
            <p className="mt-3 text-sm text-crimson-700">{t('planner.alsoWaiting', { services: names.services(waiting.map((b) => b.service_id)) })}</p>
          )}
        </div>
      </div>
    </section>
  )
}
