import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { EvidenceList } from '../../../components/knowledge/EvidenceList'
import { Pill, type Tone } from '../../../components/ui/Badge'
import type { PlanResponse, PlanStep, RequirementStatus, StepStatus } from '../../../types/api'
import type { PlanNames } from '../names'

const STATUS: Record<StepStatus, { tone: Tone; dot: string; card: string }> = {
  ready: { tone: 'blue', dot: 'bg-brand-700 ring-brand-100', card: 'border-line border-l-brand-700' },
  waiting: { tone: 'slate', dot: 'bg-slate-300 ring-slate-100', card: 'border-line border-l-slate-300' },
  blocked: { tone: 'red', dot: 'bg-red-500 ring-red-100', card: 'border-red-200 border-l-red-500' },
}

/**
 * Vertical timeline grouped by the planner's parallel groups (stages). Steps in the same
 * group are independent; a step only waits for the steps listed in its own `depends_on`.
 */
export function Timeline({
  plan,
  names,
  onMarkDone,
  onUndoDone,
  onOwn,
}: {
  plan: PlanResponse
  names: PlanNames
  onMarkDone: (serviceId: string) => void
  onUndoDone: (serviceId: string) => void
  onOwn: (documentId: string) => void
}) {
  const { t } = useTranslation()
  const byStage = new Map<number, PlanStep[]>()
  for (const s of plan.steps) byStage.set(s.stage, [...(byStage.get(s.stage) ?? []), s])

  return (
    <section aria-labelledby="timeline-title">
      <h2 id="timeline-title" className="text-lg font-semibold text-slate-900">
        {t('planner.timeline')}
      </h2>
      <ol className="mt-3 space-y-6">
        {[...byStage.entries()].map(([stage, steps]) => (
          <li key={stage} className="relative ml-3.5 border-l-2 border-line pb-2 pl-8">
            <span aria-hidden className="absolute -top-0.5 -left-[15px] flex h-7 w-7 items-center justify-center rounded-full bg-surface font-display text-sm font-semibold text-brand-800 ring-2 ring-brand-200">{stage}</span>
            <p className="pt-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              {t('planner.stage', { n: stage })}
              {steps.length > 1 && (
                <span className="ml-2 font-normal tracking-normal normal-case">
                  · {t('planner.parallelHint', { count: steps.length })}
                </span>
              )}
            </p>
            <div className={`mt-2 grid gap-3 ${steps.length > 1 ? 'xl:grid-cols-2' : ''}`}>
              {steps.map((s) => (
                <StepCard key={s.service_id} step={s} plan={plan} names={names} onMarkDone={onMarkDone} onOwn={onOwn} />
              ))}
            </div>
          </li>
        ))}
        {plan.completed_service_ids.length > 0 && (
          <li className="relative ml-3.5 border-l-2 border-green-200 pl-8">
            <span aria-hidden className="absolute -top-0.5 -left-[15px] flex h-7 w-7 items-center justify-center rounded-full bg-verified text-white ring-2 ring-green-100">✓</span>
            <p className="text-xs font-semibold tracking-wide text-green-700 uppercase">{t('planner.completed')}</p>
            <ul className="mt-2 space-y-2">
              {plan.completed_service_ids.map((id) => (
                <li
                  key={id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-green-200 bg-green-50/70 px-4 py-3 text-sm"
                >
                  <span className="font-medium text-green-900">✓ {names.service(id)}</span>
                  <button type="button" onClick={() => onUndoDone(id)} className="text-xs text-green-800 underline">
                    {t('planner.undo')}
                  </button>
                </li>
              ))}
            </ul>
          </li>
        )}
      </ol>
    </section>
  )
}

function StepCard({
  step,
  plan,
  names,
  onMarkDone,
  onOwn,
}: {
  step: PlanStep
  plan: PlanResponse
  names: PlanNames
  onMarkDone: (serviceId: string) => void
  onOwn: (documentId: string) => void
}) {
  const { t } = useTranslation()
  const style = STATUS[step.status]
  const routes = plan.acquisition_routes.filter((r) => r.service_id === step.service_id)
  const evidence = plan.evidence.filter((e) => step.evidence_ids.includes(e.id))
  const mandatory = step.requirements.filter((r) => r.kind === 'mandatory')
  const other = step.requirements.filter((r) => r.kind !== 'mandatory')

  return (
    <article
      data-testid={`step-${step.service_id}`}
      data-status={step.status}
      className={`rounded-xl border border-l-4 bg-surface p-5 shadow-card transition hover:shadow-raised ${style.card}`}
    >
      <div className="flex items-start gap-3">
        <span className={`mt-1 h-3 w-3 shrink-0 rounded-full ring-4 ${style.dot}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={style.tone}>{t(`stepStatus.${step.status}`)}</Pill>
            <Pill tone={step.role === 'target' ? 'slate' : 'violet'}>{t(`stepRole.${step.role}`)}</Pill>
          </div>
          <h3 className="mt-2 font-display text-lg font-semibold text-slate-900">
            <Link to={`/services/${step.service_id}`} className="hover:underline">
              {names.service(step.service_id)}
            </Link>
          </h3>

          <p className="mt-1 text-sm text-slate-600">
            {step.role === 'target' && t('planner.why.target')}
            {step.role === 'prerequisite' && t('planner.why.prerequisite', { services: names.services(step.unblocks) })}
            {step.role === 'acquisition' &&
              // One sentence per obtained document (several services may accept the same one).
              [...new Set(routes.map((r) => r.document_id))]
                .map((docId) =>
                  t('planner.why.acquisition', {
                    document: names.document(docId),
                    service: names.services([...new Set(routes.filter((r) => r.document_id === docId).map((r) => r.for_service_id))]),
                  }),
                )
                .join(' ')}
          </p>

          <p className="mt-1 text-sm text-slate-600">
            {step.depends_on.length === 0
              ? t('planner.noDependencies')
              : step.depends_on
                  .map((d) =>
                    d.reason === 'acquisition' && d.document_id
                      ? t('planner.waitsForDocument', { service: names.service(d.service_id), document: names.document(d.document_id) })
                      : t('planner.waitsFor', { service: names.service(d.service_id) }),
                  )
                  .join(' ')}
          </p>

          <ul className="mt-3 space-y-1.5">
            {mandatory.map((r) => (
              <RequirementLine key={r.requirement_id} r={r} names={names} onOwn={onOwn} />
            ))}
          </ul>
          {other.length > 0 && (
            <ul className="mt-2 space-y-1.5 border-t border-dashed border-slate-200 pt-2">
              {other.map((r) => (
                <RequirementLine key={r.requirement_id} r={r} names={names} onOwn={onOwn} />
              ))}
            </ul>
          )}

          {step.status === 'ready' && (
            <button
              type="button"
              onClick={() => onMarkDone(step.service_id)}
              className="mt-3 rounded-md bg-white px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
            >
              ✓ {t('planner.markDone')}
            </button>
          )}
          <EvidenceList items={evidence} compact />
        </div>
      </div>
    </article>
  )
}

function RequirementLine({ r, names, onOwn }: { r: RequirementStatus; names: PlanNames; onOwn: (id: string) => void }) {
  const { t } = useTranslation()
  const label = names.requirement(r.requirement_id, r.name)
  const optional = r.kind !== 'mandatory'

  let icon = '○'
  let detail: ReactNode = null
  let color = 'text-slate-600'
  if (r.state === 'satisfied') {
    icon = '✓'
    color = 'text-green-700'
    detail = t('req.satisfiedBy', { document: names.document(r.satisfied_by_document_id!) })
  } else if (r.state === 'pending_acquisition') {
    icon = '⏳'
    color = 'text-slate-700'
    detail = t('req.pending', { service: names.service(r.acquired_via_service_id!), document: names.document(r.acquired_document_id!) })
  } else if (r.state === 'missing') {
    icon = '✗'
    color = 'text-red-700'
  } else {
    detail = r.kind === 'conditional' ? <span lang="en">{r.condition}</span> : t('req.optionalHint')
  }

  return (
    <li className={`text-sm ${optional ? 'text-slate-500' : ''}`}>
      <span className={`mr-1.5 font-semibold ${color}`} aria-hidden>
        {icon}
      </span>
      <span className={optional ? '' : 'font-medium text-slate-800'}>{label}</span>
      {optional && <Pill>{t(`requirementType.${r.kind}`)}</Pill>}
      {detail && <span className="block pl-5 text-xs text-slate-500">{detail}</span>}
      {r.state === 'missing' && (
        <div className="mt-1 pl-5">
          <p className="text-xs text-red-700">{t('req.missing')}</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {r.document_options.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => onOwn(d)}
                className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
              >
                + {t('req.iHave', { document: names.document(d) })}
              </button>
            ))}
          </div>
        </div>
      )}
    </li>
  )
}
