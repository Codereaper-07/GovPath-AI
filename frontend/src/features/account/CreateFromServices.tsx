import { useStateName } from '../../lib/useStateName'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { buttonClass } from '../../components/ui/Button'
import { ErrorState, LoadingState } from '../../components/ui/States'
import { useLocalized } from '../../lib/useLocalized'
import { useProfile } from '../auth/api'
import { Notice } from '../auth/AuthLayout'
import { INPUT_CLASS } from '../auth/authUtils'
import { useAuth } from '../auth/useAuth'
import { useVocabulary } from '../planner/api'
import { ServicePicker } from '../planner/components/ServicePicker'
import { useServices } from '../services/api'
import { useCreatePlan } from './api'

type Grouping = 'combined' | 'separate'
interface Selection {
  selected: string[]
  state: string | null
  grouping: Grouping | null
  name: string
}

/** A guest's selection kept across sign-in (this tab only; never a saved plan). */
const PENDING_KEY = 'govpath.pendingSelection'
function peekPending(): Selection | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY)
    const v = raw ? (JSON.parse(raw) as Selection) : null
    return v && Array.isArray(v.selected) ? v : null
  } catch {
    return null
  }
}

/**
 * Entry point A: the citizen picks the services. One service -> one plan. Several -> the citizen
 * explicitly chooses one combined plan (one planner run over all of them) or one plan per service
 * (independent planner runs). Plans are saved through the same API and planner as every plan.
 */
export function CreateFromServices() {
  const { t } = useTranslation()
  const pick = useLocalized()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const { status } = useAuth()
  const signedIn = status === 'signedIn'
  const services = useServices()
  const vocabulary = useVocabulary()
  const stateName = useStateName()
  const profile = useProfile()
  const create = useCreatePlan()
  const preselected = params.get('service')
  const [selected, setSelected] = useState<string[]>(preselected ? [preselected] : [])
  const [state, setState] = useState<string | null | undefined>(undefined) // undefined = profile's
  const [grouping, setGrouping] = useState<Grouping | null>(null)
  const [name, setName] = useState('')
  // Back from signing in to save: restore the guest's selection, once the session is known
  // (this page can open a moment before the new session is registered).
  const [restoreChecked, setRestoreChecked] = useState(false)
  const [restored, setRestored] = useState(false)
  if (signedIn && !restoreChecked) {
    setRestoreChecked(true)
    const p = peekPending()
    if (p) {
      setRestored(true)
      setSelected(p.selected)
      setState(p.state)
      setGrouping(p.grouping)
      setName(p.name)
    }
  }
  useEffect(() => {
    if (restored) sessionStorage.removeItem(PENDING_KEY) // used once
  }, [restored])
  const submitting = useRef(false)
  const effectiveState = state === undefined ? (profile.data?.state ?? null) : state
  // One request id per selection: double-clicks/retries return the plans already created.
  const selectionKey = JSON.stringify([selected, effectiveState, grouping])
  const requestId = useMemo(() => `sel-${selectionKey.length}-${crypto.randomUUID()}`, [selectionKey])

  if (services.isPending) return <LoadingState />
  if (services.isError) return <ErrorState message={t('services.loadError')} onRetry={() => void services.refetch()} />

  const name_ = (id: string) => {
    const s = services.data.find((x) => x.id === id)
    return s ? pick(s.name, s.name_hi) : id
  }
  const canonical = (id: string) => services.data.find((x) => x.id === id)?.name ?? id
  const multiple = selected.length > 1
  const needsChoice = multiple && grouping === null
  const canSave = selected.length > 0 && !needsChoice && !create.isPending

  const save = async () => {
    if (submitting.current || !canSave) return
    submitting.current = true
    try {
      if (multiple && grouping === 'separate') {
        const ids: string[] = []
        for (const sid of selected) {
          const p = await create.mutateAsync({
            source: 'planner',
            // Only a typed prefix is stored, with the canonical service name; the display
            // name is localized (planName.ts). No generated text is stored.
            title: name.trim() ? `${name.trim()} — ${canonical(sid)}`.slice(0, 120) : null,
            target_service_ids: [sid],
            state: effectiveState,
            client_request_id: `${requestId}:${sid}`.slice(0, 64),
          })
          ids.push(p.id)
        }
        navigate(`/planner?plan=${ids[0]}&saved=separate&count=${ids.length}`)
      } else {
        const p = await create.mutateAsync({
          source: 'planner',
          title: name.trim() ? name.trim().slice(0, 120) : null, // no name -> shown from the services
          target_service_ids: selected,
          state: effectiveState,
          client_request_id: requestId,
        })
        navigate(`/planner?plan=${p.id}&saved=${p.deduplicated ?? 'new'}`)
      }
    } catch (err) {
      submitting.current = false // allow a retry only after a failure
      throw err
    }
    // On success the guard stays set: this page is navigating away, and a second click that lands
    // before the navigation renders must not save again.
  }
  const signInToSave = () => {
    try {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({ selected, state: effectiveState, grouping, name } satisfies Selection))
    } catch {
      /* storage unavailable */
    }
    navigate('/login', { state: { from: location.pathname + location.search, reason: 'save_plan' } })
  }

  return (
    <section className="space-y-6" data-testid="create-from-services">
      <p className="max-w-2xl text-muted">{t('myPlans.servicesIntro')}</p>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="rounded-[2rem] bg-paper-deep/60 p-5 ring-1 ring-rule sm:p-6">
          <ServicePicker
            title={t('myPlans.pickTitle')}
            hint={t('myPlans.pickHint')}
            services={services.data}
            selected={selected}
            onChange={(id, on) => setSelected((s) => (on ? [...new Set([...s, id])] : s.filter((x) => x !== id)))} />
        </div>
        <aside className="h-fit space-y-4 rounded-[2rem] bg-ink p-5 text-paper shadow-lift lg:sticky lg:top-24" aria-label={t('myPlans.yourSelection')}>
          <p className="text-sm font-semibold">{t('myPlans.selectedCount', { count: selected.length })}</p>
          {selected.length > 0 && <p className="text-xs text-paper/70">{selected.map(name_).join(', ')}</p>}
          <label className="block text-xs text-paper/80">
            {t('situation.stateLabel')}
            <select
              value={effectiveState ?? ''}
              onChange={(e) => setState(e.target.value || null)}
              className="mt-1 block w-full rounded-xl bg-paper/10 px-3 py-2 text-sm font-semibold text-paper ring-1 ring-paper/25"
            >
              <option value="" className="text-ink">
                {t('situation.stateUnknown')}
              </option>
              {(vocabulary.data?.states ?? []).map((s) => (
                <option key={s} value={s} className="text-ink">
                  {stateName(s)}
                </option>
              ))}
            </select>
          </label>
          {multiple && (
            <fieldset className="space-y-2" data-testid="services-grouping">
              <legend className="text-xs font-bold text-paper/90">{t('journey.groupingTitle', { count: selected.length })}</legend>
              {(['combined', 'separate'] as const).map((g) => (
                <label key={g} className={`flex cursor-pointer items-start gap-2.5 rounded-xl p-3 text-xs ring-1 ${grouping === g ? 'bg-paper/15 ring-zest-400' : 'bg-paper/5 ring-paper/20'}`}>
                  <input type="radio" name="services-grouping" className="mt-0.5 h-4 w-4" checked={grouping === g} onChange={() => setGrouping(g)} />
                  <span>
                    <span className="block text-sm font-semibold text-paper">{t(g === 'combined' ? 'journey.groupingCombined' : 'journey.groupingSeparate', { count: selected.length })}</span>
                    <span className="block text-paper/70">{t(g === 'combined' ? 'journey.groupingCombinedHint' : 'journey.groupingSeparateHint')}</span>
                  </span>
                </label>
              ))}
              {needsChoice && <p className="text-xs text-zest-300">{t('journey.groupingRequired')}</p>}
            </fieldset>
          )}
          {selected.length > 0 && (
            <label className="block text-xs text-paper/80">
              {multiple && grouping === 'separate' ? t('journey.separateNamePrefix') : t('myPlans.name')}
              <input
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
                placeholder={multiple && grouping === 'separate' ? '' : selected.map(name_).join(', ')}
                className={`${INPUT_CLASS} mt-1 bg-paper/10 text-paper ring-1 ring-paper/25 placeholder:text-paper/50`}
              />
            </label>
          )}
          {create.isError && <Notice tone="error">{t('account.saveError')}</Notice>}
          {signedIn ? (
            <button type="button" disabled={!canSave} onClick={() => void save()} className={buttonClass('zest', 'md', 'w-full')}>
              {create.isPending
                ? t('vault.saving')
                : multiple && grouping === 'separate'
                  ? t('journey.saveSeparate', { count: selected.length })
                  : t('myPlans.savePlan')}
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-paper/80">{t('myPlans.guestSaveNote')}</p>
              <button type="button" disabled={selected.length === 0 || needsChoice} onClick={signInToSave} className={buttonClass('zest', 'md', 'w-full')}>
                {t('myPlans.signInToSave')}
              </button>
            </div>
          )}
          <p className="text-[11px] text-paper/60">{t('myPlans.plannerNote')}</p>
        </aside>
      </div>
    </section>
  )
}
