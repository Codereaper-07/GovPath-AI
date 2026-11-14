import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { EvidenceList } from '../../../components/knowledge/EvidenceList'
import { Icon } from '../../../components/ui/Icon'
import type { PlanResponse, PlanStep, RequirementStatus, StepStatus } from '../../../types/api'
import type { PlanNames } from '../names'
import { StatusNode } from './StatusNode'

const STATUS: Record<StepStatus, { label: string; card: string }> = {
  ready: { label: 'text-ink', card: 'bg-card ring-1 ring-ink/15' },
  waiting: { label: 'text-muted', card: 'bg-card/80 ring-1 ring-rule' },
  blocked: { label: 'text-crimson-600', card: 'bg-crimson-50/70 ring-2 ring-crimson-200' },
}

/**
 * The plan drawn as a route: completed stops, then the planner's parallel groups (stages) as
 * numbered stops on one line. Steps in the same group are independent; a step only waits for
 * the steps listed in its own `depends_on`. Order and status come from the backend.
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
  const stages = [...byStage.entries()]
  const nextId = plan.next_action.type === 'start_service' ? plan.next_action.service_id : null

  return (
    <section aria-labelledby="timeline-title" className="map-paper rounded-[2rem] border border-rule bg-paper p-5 sm:p-8">
      <h2 id="timeline-title" className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
        {t('planner.timeline')}
      </h2>
      <p className="mt-1 text-sm text-muted">{t('planner.journeyHint')}</p>

      <ol className="relative mt-8">
        {plan.completed_service_ids.length > 0 && (
          <li className="relative pb-10 pl-12 sm:pl-14">
            <span aria-hidden className="absolute top-10 bottom-0 left-[18px] w-1 rounded bg-jade-600" />
            <span aria-hidden className="absolute top-0 left-0 flex h-10 w-10 items-center justify-center rounded-full bg-jade-600 text-paper">
              <Icon name="check" className="h-5 w-5" strokeWidth={2.6} />
            </span>
            <p className="pt-2.5 text-xs font-bold tracking-[0.16em] text-jade-700 uppercase">{t('planner.completed')}</p>
            <ul className="mt-3 space-y-2">
              {plan.completed_service_ids.map((id) => (
                <li key={id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-jade-50 px-4 py-3 text-sm ring-1 ring-jade-100">
                  <span className="font-bold text-jade-800">✓ {names.service(id)}</span>
                  <button type="button" onClick={() => onUndoDone(id)} className="text-xs font-semibold text-jade-700 underline">
                    {t('planner.undo')}
                  </button>
                </li>
              ))}
            </ul>
          </li>
        )}
        {stages.map(([stage, steps], i) => (
          <li key={stage} className="relative pb-10 pl-12 last:pb-0 sm:pl-14">
            {i < stages.length - 1 && <span aria-hidden className="absolute top-10 bottom-0 left-[18px] w-1 rounded bg-ink/15" />}
            <span
              aria-hidden
              className="absolute top-0 left-0 flex h-10 w-10 items-center justify-center rounded-full bg-paper font-display text-lg font-semibold text-ink ring-[3px] ring-ink"
            >
              {stage}
            </span>
            <p className="pt-2.5 text-xs font-bold tracking-[0.16em] text-ink uppercase">
              {t('planner.stage', { n: stage })}
              {steps.length > 1 && (
                <span className="ml-2 font-semibold tracking-normal text-muted normal-case">· {t('planner.parallelHint', { count: steps.length })}</span>
              )}
            </p>
            <div className={`mt-4 grid gap-4 ${steps.length > 1 ? '2xl:grid-cols-2' : ''}`}>
              {steps.map((s) => (
                <StepCard key={s.service_id} step={s} plan={plan} names={names} isNext={s.service_id === nextId} onMarkDone={onMarkDone} onOwn={onOwn} />
              ))}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

function StepCard({
  step,
  plan,
  names,
  isNext,
  onMarkDone,
  onOwn,
}: {
  step: PlanStep
  plan: PlanResponse
  names: PlanNames
  isNext: boolean
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
      className={`relative rounded-3xl p-5 transition duration-200 hover:shadow-lift sm:p-6 ${style.card} ${isNext ? 'shadow-lift ring-2 ring-ink' : ''}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className={`flex items-center gap-2 text-xs font-bold ${style.label}`}>
          <StatusNode kind={isNext ? 'next' : step.status} size="sm" />
          <span>{t(`stepStatus.${step.status}`)}</span>
        </span>
        <span className="text-xs font-semibold text-muted">{t(`stepRole.${step.role}`)}</span>
        {isNext && <span className="ml-auto rounded-full bg-zest-400 px-2.5 py-0.5 text-xs font-bold text-ink">{t('planner.youAreHere')}</span>}
      </div>
      <h3 className="mt-3 font-display text-xl leading-snug font-semibold tracking-tight text-ink sm:text-2xl">
        <Link to={`/services/${step.service_id}`} className="decoration-jade-500 decoration-2 underline-offset-4 hover:underline">
          {names.service(step.service_id)}
        </Link>
      </h3>

      <p className="mt-2 text-sm text-ink/80">
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

      <p className={`mt-1.5 flex items-start gap-2 text-sm ${step.depends_on.length ? 'font-semibold text-ink' : 'text-muted'}`}>
        <Icon name={step.depends_on.length ? 'clock' : 'check'} className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
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

      {step.unblocks.length > 0 && (
        <p className="mt-3 inline-flex items-start gap-2 rounded-2xl bg-zest-100 px-3 py-2 text-xs font-bold text-zest-800">
          <Icon name="link" className="h-4 w-4 shrink-0" />
          {t('planner.unlocks', { services: names.services(step.unblocks) })}
        </p>
      )}

      <ul className="mt-4 space-y-2.5 border-t border-rule pt-4">
        {mandatory.map((r) => (
          <RequirementLine key={r.requirement_id} r={r} names={names} onOwn={onOwn} />
        ))}
      </ul>
      {other.length > 0 && (
        <ul className="mt-3 space-y-2.5 border-t border-dashed border-rule pt-3">
          {other.map((r) => (
            <RequirementLine key={r.requirement_id} r={r} names={names} onOwn={onOwn} />
          ))}
        </ul>
      )}

      {step.status === 'ready' && (
        <button type="button" onClick={() => onMarkDone(step.service_id)} className="mt-4 rounded-full bg-card px-4 py-1.5 text-sm font-bold text-ink ring-1 ring-rule-strong transition hover:bg-jade-50 hover:ring-jade-500">
          ✓ {t('planner.markDone')}
        </button>
      )}
      <EvidenceList items={evidence} compact />
    </article>
  )
}

function RequirementLine({ r, names, onOwn }: { r: RequirementStatus; names: PlanNames; onOwn: (id: string) => void }) {
  const { t } = useTranslation()
  const label = names.requirement(r.requirement_id, r.name)
  const optional = r.kind !== 'mandatory'

  let mark: ReactNode = <span className="h-4 w-4 rounded-full border-2 border-dashed border-rule-strong" />
  let detail: ReactNode = null
  if (r.state === 'satisfied') {
    mark = <Icon name="check" className="h-4 w-4 text-jade-600" strokeWidth={2.6} />
    detail = t('req.satisfiedBy', { document: names.document(r.satisfied_by_document_id!) })
  } else if (r.state === 'pending_acquisition') {
    mark = <Icon name="clock" className="h-4 w-4 text-muted" strokeWidth={2.2} />
    detail = t('req.pending', { service: names.service(r.acquired_via_service_id!), document: names.document(r.acquired_document_id!) })
  } else if (r.state === 'missing') {
    mark = <Icon name="close" className="h-4 w-4 text-crimson-600" strokeWidth={2.6} />
  } else {
    detail = r.kind === 'conditional' ? <span lang="en">{r.condition}</span> : t('req.optionalHint')
  }

  return (
    <li className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-2.5 text-sm">
      <span className="mt-0.5 flex h-4 w-4 items-center justify-center" aria-hidden>
        {mark}
      </span>
      <div>
        <span className={optional ? 'text-muted' : 'font-semibold text-ink'}>{label}</span>
        {optional && <span className="ml-2 text-xs font-semibold text-faint italic">{t(`requirementType.${r.kind}`)}</span>}
        {detail && <span className="block text-xs text-muted">{detail}</span>}
        {r.state === 'missing' && (
          <div className="mt-1.5">
            <p className="text-xs font-semibold text-crimson-600">{t('req.missing')}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {r.document_options.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => onOwn(d)}
                  className="rounded-full bg-card px-3 py-1 text-xs font-semibold text-ink ring-1 ring-rule-strong transition hover:bg-zest-100 hover:ring-ink"
                >
                  + {t('req.iHave', { document: names.document(d) })}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </li>
  )
}
