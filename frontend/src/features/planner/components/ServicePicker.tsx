import { useTranslation } from 'react-i18next'
import { Icon } from '../../../components/ui/Icon'
import { LIFE_EVENTS } from '../../../lib/lifeEvents'
import { useLocalized } from '../../../lib/useLocalized'
import type { ServiceSummary } from '../../../types/api'

/** Services grouped by life event. A service listed under two events is one selection. */
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
  const groups = LIFE_EVENTS.map((e) => ({ e, items: services.filter((s) => s.life_events.includes(e)) })).filter(
    (g) => g.items.length > 0,
  )
  return (
    <fieldset>
      <legend className="text-sm font-semibold text-slate-900">{t('planner.step1')}</legend>
      <p className="mb-2 text-xs text-slate-500">{t('planner.step1Hint')}</p>
      <div className="space-y-4">
        {groups.map(({ e, items }) => (
          <div key={e}>
            <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              <Icon name={e} className="h-4 w-4" /> {t(`lifeEvents.${e}.name`)}
            </h3>
            <div className="space-y-2">
              {items.map((s) => {
                const on = selected.includes(s.id)
                return (
                  <label
                    key={`${e}-${s.id}`}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition ${
                      on ? 'border-brand-600 bg-brand-50' : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 accent-brand-600"
                      checked={on}
                      onChange={(ev) => onChange(s.id, ev.target.checked)}
                    />
                    <span className="font-medium text-slate-800">{pick(s.name, s.name_hi)}</span>
                  </label>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </fieldset>
  )
}
