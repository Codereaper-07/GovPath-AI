import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AIBadge } from '../../../components/ui/Badge'
import { buttonClass } from '../../../components/ui/Button'
import { Icon } from '../../../components/ui/Icon'
import { ApiError } from '../../../lib/apiClient'
import { useLocalized } from '../../../lib/useLocalized'
import type { ApiErrorDetail, CitizenContext, DiscoverResponse, SituationInterpretation } from '../../../types/api'
import { useDiscovery, useInterpretSituation, useVocabulary } from '../api'
import { GOAL_ORDER } from '../goals'
import type { PlannerSelection } from '../usePlannerState'


/**
 * The citizen's situation: goals, state/UT, optional free-text interpretation by AI (reviewed
 * before use), then deterministic service discovery with its clarification questions.
 * Discovery never orders services or decides readiness; it only proposes which apply.
 */
export function SituationPanel({
  sel,
  docName,
  onGoal,
  onState,
  onTarget,
  onAddTargets,
  onHave,
  onLack,
  onApply,
}: {
  sel: PlannerSelection
  docName: (id: string) => string
  onGoal: (goal: string, on: boolean) => void
  onState: (state: string | null) => void
  onTarget: (id: string, on: boolean) => void
  onAddTargets: (ids: string[]) => void
  onHave: (doc: string) => void
  onLack: (doc: string) => void
  onApply: (ctx: { goals: string[]; state: string | null; held: string[]; lacking: string[] }) => void
}) {
  const { t } = useTranslation()
  const vocabulary = useVocabulary()
  const context: CitizenContext = {
    goals: [...sel.goals].sort(),
    life_events: [],
    state: sel.state,
    held_document_ids: [...sel.owned].sort(),
    lacking_document_ids: [...sel.lacking].sort(),
    completed_service_ids: [...sel.completed].sort(),
  }
  const discovery = useDiscovery(context)

  return (
    <section aria-labelledby="situation-title" className="space-y-5">
      <div>
        <h2 id="situation-title" className="font-display text-xl font-semibold text-ink">
          {t('situation.title')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('situation.hint')}</p>
      </div>

      <Interpreter docName={docName} onApply={onApply} />

      <fieldset>
        <legend className="mb-2 text-xs font-bold tracking-[0.14em] text-muted uppercase">{t('situation.goalsLabel')}</legend>
        <div className="space-y-1.5">
          {GOAL_ORDER.map((g) => {
            const on = sel.goals.includes(g)
            return (
              <label
                key={g}
                className={`flex cursor-pointer items-center gap-3 rounded-2xl px-3.5 py-2.5 text-sm transition ${
                  on ? 'bg-jade-50 text-ink ring-2 ring-jade-500' : 'bg-card text-ink ring-1 ring-rule hover:ring-ink/40'
                }`}
              >
                <input type="checkbox" checked={on} onChange={(e) => onGoal(g, e.target.checked)} className="h-4 w-4" />
                <span className="font-semibold">{t(`goals.${g}`)}</span>
              </label>
            )
          })}
        </div>
      </fieldset>

      <label className="block">
        <span className="mb-1.5 block text-xs font-bold tracking-[0.14em] text-muted uppercase">{t('situation.stateLabel')}</span>
        <select
          value={sel.state ?? ''}
          onChange={(e) => onState(e.target.value || null)}
          className="w-full rounded-2xl border border-rule-strong bg-card px-3.5 py-2.5 text-sm font-semibold text-ink focus:border-ink"
        >
          <option value="">{t('situation.stateUnknown')}</option>
          {(vocabulary.data?.states ?? []).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      {sel.goals.length > 0 && discovery.data && (
        <Suggestions
          data={discovery.data}
          targets={sel.targets}
          stateKnown={!!sel.state}
          onTarget={onTarget}
          onAddTargets={onAddTargets}
          onHave={onHave}
          onLack={onLack}
        />
      )}
      {sel.goals.length > 0 && discovery.isError && <p className="text-sm text-crimson-600">{t('situation.discoveryError')}</p>}
    </section>
  )
}

function Interpreter({
  docName,
  onApply,
}: {
  docName: (id: string) => string
  onApply: (ctx: { goals: string[]; state: string | null; held: string[]; lacking: string[] }) => void
}) {
  const { t, i18n } = useTranslation()
  const interpret = useInterpretSituation()
  const [text, setText] = useState('')
  const result = interpret.data
  const code = interpret.error instanceof ApiError ? (interpret.error.detail as ApiErrorDetail | undefined)?.code : undefined

  return (
    <div className="rounded-2xl bg-card p-3.5 ring-1 ring-rule">
      <label htmlFor="situation-text" className="text-sm font-bold text-ink">
        {t('situation.describeLabel')}
      </label>
      <textarea
        id="situation-text"
        rows={3}
        maxLength={2000}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('situation.describePlaceholder')}
        className="mt-2 w-full resize-none rounded-xl border border-rule bg-paper p-2.5 text-sm text-ink placeholder:text-faint focus:border-ink focus:outline-none"
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-muted">{t('situation.aiNote')}</span>
        <button
          type="button"
          disabled={text.trim().length < 3 || interpret.isPending}
          onClick={() => interpret.mutate({ text: text.trim(), language: i18n.resolvedLanguage === 'hi' ? 'hi' : 'en' })}
          className={buttonClass('secondary', 'sm')}
        >
          <Icon name="spark" className="h-4 w-4 text-lilac-700" />
          {interpret.isPending ? t('situation.reading') : t('situation.read')}
        </button>
      </div>
      {interpret.isError && (
        <p role="alert" className="mt-3 rounded-xl bg-honey-50 px-3 py-2 text-xs font-semibold text-honey-700">
          {t(code === 'quota_exhausted' || code === 'rate_limited' ? 'situation.aiBusy' : 'situation.aiUnavailable')}
        </p>
      )}
      {result && (
        <Review
          result={result}
          docName={docName}
          onUse={() => {
            onApply({ goals: result.goals, state: result.state, held: result.held_document_ids, lacking: result.lacking_document_ids })
            interpret.reset()
          }}
          onDiscard={() => interpret.reset()}
        />
      )}
    </div>
  )
}

function Review({
  result,
  docName,
  onUse,
  onDiscard,
}: {
  result: SituationInterpretation
  docName: (id: string) => string
  onUse: () => void
  onDiscard: () => void
}) {
  const { t } = useTranslation()
  const rows: [string, string][] = [
    [t('situation.foundGoals'), result.goals.map((g) => t(`goals.${g}`)).join(t('common.listSeparator')) || '—'],
    [t('situation.foundState'), result.state ?? t('situation.notStated')],
    [t('situation.foundHeld'), result.held_document_ids.map(docName).join(t('common.listSeparator')) || '—'],
    [t('situation.foundLacking'), result.lacking_document_ids.map(docName).join(t('common.listSeparator')) || '—'],
  ]
  return (
    <div className="mt-3 rounded-xl bg-lilac-50 p-3 ring-1 ring-lilac-100" data-testid="situation-review">
      <div className="flex flex-wrap items-center gap-2">
        <AIBadge />
        <span className="text-xs font-semibold text-lilac-700">{t('situation.reviewNote')}</span>
      </div>
      <dl className="mt-2 space-y-1 text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
            <dt className="font-semibold text-muted">{k}</dt>
            <dd className="text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      {result.dropped.length > 0 && <p className="mt-2 text-[11px] text-muted">{t('situation.dropped', { count: result.dropped.length })}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={onUse} className={buttonClass('primary', 'sm')}>
          {t('situation.useDetails')}
        </button>
        <button type="button" onClick={onDiscard} className={buttonClass('ghost', 'sm')}>
          {t('situation.discard')}
        </button>
      </div>
    </div>
  )
}

function Suggestions({
  data,
  targets,
  stateKnown,
  onTarget,
  onAddTargets,
  onHave,
  onLack,
}: {
  data: DiscoverResponse
  targets: string[]
  stateKnown: boolean
  onTarget: (id: string, on: boolean) => void
  onAddTargets: (ids: string[]) => void
  onHave: (doc: string) => void
  onLack: (doc: string) => void
}) {
  const { t } = useTranslation()
  const pick = useLocalized()
  const service = (id: string) => (data.services[id] ? pick(data.services[id].name, data.services[id].name_hi) : id)
  const doc = (id: string) => (data.documents[id] ? pick(data.documents[id].name, data.documents[id].name_hi) : id)
  const missing = data.recommended_target_ids.filter((id) => !targets.includes(id))

  return (
    <div className="space-y-3" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-bold tracking-[0.14em] text-muted uppercase">{t('situation.suggested')}</h3>
        {missing.length > 0 && (
          <button type="button" onClick={() => onAddTargets(missing)} className={buttonClass('primary', 'sm')}>
            <Icon name="plus" className="h-3.5 w-3.5" />
            {t('situation.addSuggested', { count: missing.length })}
          </button>
        )}
      </div>

      {data.clarifications.map((q) =>
        q.code === 'record_held' ? (
          <div key={q.document_ids.join()} className="rounded-2xl bg-zest-100 p-3 text-sm ring-1 ring-zest-300">
            <p className="font-semibold text-ink">{t('situation.askRecord', { documents: q.document_ids.map(doc).join(t('situation.or')) })}</p>
            <p className="mt-0.5 text-xs text-muted">{t('situation.askRecordWhy', { services: q.service_ids.map(service).join(t('common.listSeparator')) })}</p>
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={() => onHave(q.document_ids[0])} className={buttonClass('primary', 'sm')}>
                {t('situation.yesHave')}
              </button>
              <button type="button" onClick={() => q.document_ids.forEach(onLack)} className={buttonClass('secondary', 'sm')}>
                {t('situation.noHave')}
              </button>
            </div>
          </div>
        ) : q.code === 'state_required' && !stateKnown ? (
          <p key="state" className="rounded-2xl bg-zest-100 p-3 text-sm font-semibold text-ink ring-1 ring-zest-300">
            {t('situation.askState', { services: q.service_ids.map(service).join(t('common.listSeparator')) })}
          </p>
        ) : null,
      )}

      <ul className="divide-y divide-rule overflow-hidden rounded-2xl bg-card ring-1 ring-rule">
        {data.candidates.map((c) => (
          <li key={c.service_id} className={`px-3.5 py-3 text-sm ${c.status === 'excluded' ? 'bg-paper/60' : ''}`}>
            {c.status === 'included' ? (
              <label className="flex cursor-pointer items-start gap-3">
                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={targets.includes(c.service_id)} onChange={(e) => onTarget(c.service_id, e.target.checked)} />
                <span>
                  <span className="font-semibold text-ink">{service(c.service_id)}</span>
                  <span className="block text-xs text-muted">{t('situation.why', { goals: c.matched_goals.map((g) => t(`goals.${g}`)).join(t('common.listSeparator')) })}</span>
                </span>
              </label>
            ) : (
              <div>
                <span className={`font-semibold ${c.status === 'excluded' ? 'text-muted line-through decoration-rule-strong' : 'text-ink'}`}>{service(c.service_id)}</span>
                <span className="block text-xs text-muted">
                  {c.status === 'completed' && t('situation.statusCompleted')}
                  {c.status === 'needs_clarification' && t('situation.statusClarify')}
                  {c.exclusion === 'outside_verified_jurisdiction' && t('situation.excludedRegion', { region: c.region ?? '' })}
                  {c.exclusion === 'lacks_required_record' &&
                    t('situation.excludedRecord', { documents: c.record_document_ids.map(doc).join(t('common.listSeparator')) })}
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-muted">{t('situation.discoveryNote')}</p>
    </div>
  )
}
