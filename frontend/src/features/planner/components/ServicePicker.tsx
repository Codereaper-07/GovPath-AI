import { useTranslation } from 'react-i18next'
import { Icon } from '../../../components/ui/Icon'
import { Seal } from '../../../components/ui/Seal'
import { LIFE_EVENTS } from '../../../lib/lifeEvents'
import { useLocalized } from '../../../lib/useLocalized'
import type { ServiceSummary } from '../../../types/api'

/** Services grouped by life event. A service listed under two events is one selection. */
export function ServicePicker({
  services,
  selected,
  onChange,
  title,
  hint,
}: {
  services: ServiceSummary[]
  selected: string[]
  onChange: (id: string, on: boolean) => void
  title?: string
  hint?: string
}) {
  const { t } = useTranslation()
  const pick = useLocalized()
  const groups = LIFE_EVENTS.map((e) => ({ e, items: services.filter((s) => s.life_events.includes(e)) })).filter(
    (g) => g.items.length > 0,
  )
  return (
    <fieldset>
      <legend className="font-display text-xl font-semibold text-ink">{title ?? t('planner.step1')}</legend>
      <p className="mt-1 mb-4 text-sm text-muted">{hint ?? t('planner.step1Hint')}</p>
      <div className="space-y-5">
        {groups.map(({ e, items }) => (
          <div key={e}>
            <h3 className="mb-2 flex items-center gap-2 text-xs font-bold tracking-[0.14em] text-muted uppercase">
              <Seal event={e} size="sm" /> {t(`lifeEvents.${e}.name`)}
            </h3>
            <div className="space-y-1.5">
              {items.map((s) => {
                const on = selected.includes(s.id)
                return (
                  <label
                    key={`${e}-${s.id}`}
                    className={`group flex cursor-pointer items-center gap-3 rounded-2xl px-3.5 py-3 text-sm transition ${
                      on ? 'bg-ink text-paper shadow-soft' : 'bg-card text-ink ring-1 ring-rule hover:ring-ink/40'
                    }`}
                  >
                    <input type="checkbox" className="peer sr-only" checked={on} onChange={(ev) => onChange(s.id, ev.target.checked)} />
                    <span
                      aria-hidden
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition peer-focus-visible:ring-2 peer-focus-visible:ring-zest-400 peer-focus-visible:ring-offset-2 ${
                        on ? 'bg-zest-400 text-ink' : 'border-2 border-rule-strong bg-card'
                      }`}
                    >
                      {on && <Icon name="check" className="h-3.5 w-3.5" strokeWidth={3} />}
                    </span>
                    <span className="font-semibold">{pick(s.name, s.name_hi)}</span>
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
