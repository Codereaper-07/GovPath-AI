import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocalized } from '../../../lib/useLocalized'
import type { DocumentCategory, DocumentType } from '../../../types/api'

const CATEGORY_ORDER: DocumentCategory[] = [
  'existing_record',
  'address_proof',
  'vehicle',
  'financial',
  'identity',
  'other',
]

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
}: {
  documents: DocumentType[]
  relevantServiceIds: string[]
  owned: string[]
  highlight: Set<string>
  onChange: (id: string, on: boolean) => void
}) {
  const { t } = useTranslation()
  const pick = useLocalized()
  const [showAll, setShowAll] = useState(false)

  const relevant = new Set(relevantServiceIds)
  const visible = documents.filter(
    (d) => showAll || owned.includes(d.id) || d.accepted_by_service_ids.some((s) => relevant.has(s)),
  )
  const hidden = documents.length - visible.length

  return (
    <fieldset>
      <legend className="text-sm font-semibold text-slate-900">{t('planner.step2')}</legend>
      <p className="mb-2 text-xs text-slate-500">
        {t('planner.step2Hint')} <span className="font-medium">{t('planner.ownedCount', { count: owned.length })}</span>
      </p>
      {visible.length === 0 ? (
        <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">{t('planner.selectServiceFirst')}</p>
      ) : (
        <div className="space-y-4">
          {CATEGORY_ORDER.map((cat) => {
            const docs = visible.filter((d) => d.category === cat)
            if (docs.length === 0) return null
            return (
              <div key={cat}>
                <h3 className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  {t(`documentCategory.${cat}`)}
                </h3>
                <ul className="space-y-1">
                  {docs.map((d) => {
                    const on = owned.includes(d.id)
                    const helps = !on && highlight.has(d.id)
                    return (
                      <li key={d.id}>
                        <label
                          className={`flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50 ${
                            helps ? 'bg-amber-50' : ''
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5 h-4 w-4 accent-brand-600"
                            checked={on}
                            onChange={(e) => onChange(d.id, e.target.checked)}
                          />
                          <span className={on ? 'text-slate-900' : 'text-slate-700'}>
                            {pick(d.name, d.name_hi)}
                            {helps && (
                              <span className="ml-1.5 text-xs font-medium text-amber-700">
                                · {t('planner.wouldHelp')}
                              </span>
                            )}
                          </span>
                        </label>
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
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-3 text-sm font-medium text-brand-700 hover:underline"
        >
          {showAll ? t('planner.showRelevant') : t('planner.showAll', { count: hidden })}
        </button>
      )}
    </fieldset>
  )
}
