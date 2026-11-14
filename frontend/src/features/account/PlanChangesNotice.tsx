import { useTranslation } from 'react-i18next'
import { useLocalized } from '../../lib/useLocalized'
import type { PlanChange } from '../../types/api'
import { useServices } from '../services/api'

/** Explains how a vault/progress change re-evaluated the citizen's saved plans (deterministic). */
export function PlanChangesNotice({ changes }: { changes: PlanChange[] }) {
  const { t } = useTranslation()
  const pick = useLocalized()
  const services = useServices()
  const name = (id: string) => {
    const s = services.data?.find((x) => x.id === id)
    return s ? pick(s.name, s.name_hi) : id
  }
  const label = (status: string | null) =>
    status === null ? t('account.notInPlan') : status === 'completed' ? t('planner.completed') : t(`stepStatus.${status}`, { defaultValue: status })
  if (changes.length === 0) return <p className="text-sm text-muted">{t('account.noPlanChanges')}</p>
  return (
    <div className="space-y-2" data-testid="plan-changes">
      <p className="text-sm font-semibold text-ink">{t('account.plansUpdated', { count: changes.length })}</p>
      <ul className="space-y-2">
        {changes.map((c) => (
          <li key={c.plan_id} className="rounded-2xl bg-card px-4 py-3 text-sm ring-1 ring-rule">
            <p className="font-semibold text-ink">{c.title || t('account.untitledPlan')}</p>
            <ul className="mt-1 space-y-0.5 text-muted">
              {c.steps.map((s) => (
                <li key={s.service_id}>
                  {name(s.service_id)}: {label(s.before)} → <span className="font-semibold text-ink">{label(s.after)}</span>
                </li>
              ))}
              {c.blockers_removed.length > 0 && <li className="text-jade-700">{t('account.blockersResolved', { count: c.blockers_removed.length })}</li>}
              {c.blockers_added.length > 0 && <li className="text-crimson-600">{t('account.blockersAdded', { count: c.blockers_added.length })}</li>}
              {c.steps.length === 0 && c.next_action_changed && <li>{t('account.nextActionChanged')}</li>}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  )
}
