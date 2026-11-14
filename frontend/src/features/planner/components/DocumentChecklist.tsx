import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from '../../../components/ui/Icon'
import { useLocalized } from '../../../lib/useLocalized'
import type { DocumentCategory, DocumentState, DocumentType } from '../../../types/api'

const CATEGORY_ORDER: DocumentCategory[] = ['existing_record', 'address_proof', 'vehicle', 'financial', 'identity', 'other']

/**
 * Documents the user holds. By default lists documents accepted by the services in play;
 * "show all" reveals the rest. `highlight` marks documents that would resolve a missing
 * requirement (as reported by the backend planner).
 */
export function DocumentChecklist({
  documents,
  relevantServiceIds,
  owned,
  highlight,
  onChange,
  docStates = {},
  onDocState,
}: {
  documents: DocumentType[]
  relevantServiceIds: string[]
  owned: string[]
  highlight: Set<string>
  onChange: (id: string, on: boolean) => void
  docStates?: Record<string, DocumentState>
  onDocState?: (id: string, state: DocumentState) => void
}) {
  const { t } = useTranslation()
  const pick = useLocalized()
  const [showAll, setShowAll] = useState(false)

  const relevant = new Set(relevantServiceIds)
  const visible = documents.filter((d) => showAll || owned.includes(d.id) || d.accepted_by_service_ids.some((s) => relevant.has(s)))
  const hidden = documents.length - visible.length

  return (
    <fieldset>
      <legend className="font-display text-xl font-semibold text-ink">{t('planner.step2')}</legend>
      <p className="mt-1 mb-4 text-sm text-muted">
        {t('planner.step2Hint')} <span className="font-bold text-ink">{t('planner.ownedCount', { count: owned.length })}</span>
      </p>
      {visible.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-rule-strong p-4 text-sm text-muted">{t('planner.selectServiceFirst')}</p>
      ) : (
        <div className="space-y-4">
          {CATEGORY_ORDER.map((cat) => {
            const docs = visible.filter((d) => d.category === cat)
            if (docs.length === 0) return null
            return (
              <div key={cat}>
                <h3 className="mb-1.5 text-xs font-bold tracking-[0.14em] text-muted uppercase">{t(`documentCategory.${cat}`)}</h3>
                <ul className="divide-y divide-rule overflow-hidden rounded-2xl bg-card ring-1 ring-rule">
                  {docs.map((d) => {
                    const on = owned.includes(d.id)
                    const helps = !on && highlight.has(d.id)
                    const condition = docStates[d.id] ?? 'available'
                    return (
                      <li key={d.id} className={on && condition !== 'available' ? 'bg-honey-50' : ''}>
                        <label className={`flex cursor-pointer items-start gap-3 px-3.5 py-2.5 text-sm transition hover:bg-paper ${helps ? 'bg-zest-100' : ''}`}>
                          <input type="checkbox" className="peer sr-only" checked={on} onChange={(e) => onChange(d.id, e.target.checked)} />
                          <span
                            aria-hidden
                            className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] transition peer-focus-visible:ring-2 peer-focus-visible:ring-jade-500 peer-focus-visible:ring-offset-1 ${
                              on ? 'bg-jade-600 text-paper' : 'border-2 border-rule-strong bg-card'
                            }`}
                          >
                            {on && <Icon name="check" className="h-3 w-3" strokeWidth={3.2} />}
                          </span>
                          <span className={on ? 'font-semibold text-ink' : 'text-ink/80'}>
                            {pick(d.name, d.name_hi)}
                            {helps && <span className="ml-1.5 text-xs font-bold text-zest-800">· {t('planner.wouldHelp')}</span>}
                          </span>
                        </label>
                        {on && onDocState && (
                          <div className="flex items-center gap-2 px-3.5 pb-2.5 pl-11 text-xs text-muted">
                            <select
                              aria-label={t('planner.docCondition', { document: pick(d.name, d.name_hi) })}
                              value={condition}
                              onChange={(e) => onDocState(d.id, e.target.value as DocumentState)}
                              className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${condition === 'available' ? 'border-rule bg-card text-muted' : 'border-honey-500 bg-honey-50 text-honey-700'}`}
                            >
                              {(['available', 'expired', 'invalid', 'unsure'] as const).map((c) => (
                                <option key={c} value={c}>
                                  {t(`documentState.${c}`)}
                                </option>
                              ))}
                            </select>
                            {condition !== 'available' && <span>{t('planner.docNotCounted')}</span>}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </div>
      )}
      {(hidden > 0 || showAll) && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-3 text-sm font-bold text-jade-700 hover:underline">
          {showAll ? t('planner.showRelevant') : t('planner.showAll', { count: hidden })}
        </button>
      )}
    </fieldset>
  )
}
