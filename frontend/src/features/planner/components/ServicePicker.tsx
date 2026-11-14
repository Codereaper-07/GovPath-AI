import { useTranslation } from 'react-i18next'
import { useLocalized } from '../../../lib/useLocalized'
import type { ServiceSummary } from '../../../types/api'

export function ServicePicker({
  services,
  selected,
  onChange,
}: {
  services: ServiceSummary[]
  selected: string[]
  onChange: (id: string, on: boolean) => void
}) {
  const { t } = useTranslation()
  const pick = useLocalized()
  return (
    <fieldset>
      <legend className="text-sm font-semibold text-slate-900">{t('planner.step1')}</legend>
      <p className="mb-2 text-xs text-slate-500">{t('planner.step1Hint')}</p>
      <div className="space-y-2">
        {services.map((s) => {
          const on = selected.includes(s.id)
          return (
            <label
              key={s.id}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${
                on ? 'border-brand-600 bg-brand-50' : 'border-slate-200 bg-white hover:bg-slate-50'
              }`}
            >
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-brand-600"
                checked={on}
                onChange={(e) => onChange(s.id, e.target.checked)}
              />
              <span className="font-medium text-slate-800">{pick(s.name, s.name_hi)}</span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
