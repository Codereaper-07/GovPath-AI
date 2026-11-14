import { useTranslation } from 'react-i18next'
import { useLocalized } from '../../lib/useLocalized'
import type { DisplayName, DocumentType, NextAction, PlanResponse, ServiceSummary } from '../../types/api'

/** Localised display names for ids in a plan, falling back to the catalogue lists. */
export function usePlanNames(plan: PlanResponse | undefined, services: ServiceSummary[], documents: DocumentType[]) {
  const pick = useLocalized()
  const { t } = useTranslation()
  const fallback = (map: Record<string, DisplayName> | undefined, id: string, list: { id: string; name: string; name_hi: string | null }[]) => {
    const n = map?.[id] ?? list.find((x) => x.id === id)
    return n ? pick(n.name, n.name_hi) : id
  }
  const service = (id: string) => fallback(plan?.services, id, services)
  const document = (id: string) => fallback(plan?.documents, id, documents)
  const requirement = (id: string, english: string) => {
    const n = plan?.requirements[id]
    return n ? pick(n.name, n.name_hi) : english
  }
  const list = (names: string[]) => names.join(t('common.listSeparator'))
  const services_ = (ids: string[]) => list(ids.map(service))
  /** "any one of: A, B, C" — with `limit`, longer lists end in "+N more". */
  const options = (ids: string[], limit?: number) => {
    if (ids.length === 1) return document(ids[0])
    const shown = limit && ids.length > limit + 1 ? ids.slice(0, limit) : ids
    let text = list(shown.map(document))
    if (shown.length < ids.length) text += ' ' + t('planner.andMore', { count: ids.length - shown.length })
    return t('planner.anyOneOf', { documents: text })
  }
  return { service, document, requirement, services: services_, options }
}

export type PlanNames = ReturnType<typeof usePlanNames>

/** Localised sentence for the planner's structured next-action reason. */
export function useReasonText() {
  const { t } = useTranslation()
  return (action: NextAction, names: PlanNames, plan?: PlanResponse): string => {
    const r = action.reason
    const service = action.service_id ? names.service(action.service_id) : ''
    let text: string
    switch (r.code) {
      case 'unblocks_downstream':
        text = t('reason.unblocksDownstream', { service, count: r.unblocks.length, services: names.services(r.unblocks) })
        break
      case 'ready_independent':
        text = t('reason.readyIndependent', { service })
        break
      case 'await_in_progress': {
        const step = plan?.steps.find((s) => s.service_id === action.service_id)
        const docs = (step?.completion_document_ids ?? []).map(names.document).join(t('common.listSeparator'))
        text = t('reason.awaitInProgress', { service, documents: docs || '—' })
        if (r.unblocks.length) text += ' ' + t('reason.awaitUnblocks', { services: names.services(r.unblocks) })
        break
      }
      case 'resolve_blocker':
        text = t('reason.resolveBlocker', { documents: names.options(r.document_options), service })
        if (r.unblocks.length) text += ' ' + t('reason.alsoBlocked', { services: names.services(r.unblocks) })
        break
      default:
        text = t('reason.allComplete')
    }
    if (r.parallel_with.length) text += ' ' + t('reason.parallel', { services: names.services(r.parallel_with) })
    return text
  }
}
