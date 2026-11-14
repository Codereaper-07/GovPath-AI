import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { EvidenceList } from '../../components/knowledge/EvidenceList'
import { VerificationBadge, VerifiedBadge } from '../../components/ui/Badge'
import { buttonClass } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { Seal } from '../../components/ui/Seal'
import { ErrorState, LoadingState } from '../../components/ui/States'
import { ApiError } from '../../lib/apiClient'
import { EVENT_TONE } from '../../lib/lifeEvents'
import { useFormatDate, useLocalized } from '../../lib/useLocalized'
import type { Requirement, RequirementType, ServiceDetail } from '../../types/api'
import { useService } from './api'

const GROUPS: RequirementType[] = ['mandatory', 'conditional', 'optional']

export function ServiceDetailPage() {
  const { serviceId = '' } = useParams()
  const { t } = useTranslation()
  const service = useService(serviceId)

  if (service.isPending) return <LoadingState />
  if (service.isError) {
    const notFound = service.error instanceof ApiError && service.error.status === 404
    return (
      <div className="space-y-6">
        <BackLink />
        <ErrorState
          message={notFound ? t('serviceDetail.notFound') : t('services.loadError')}
          onRetry={notFound ? undefined : () => void service.refetch()}
        />
      </div>
    )
  }
  return <ServiceDetailView service={service.data} />
}

function BackLink() {
  const { t } = useTranslation()
  return (
    <Link to="/services" className="inline-flex items-center gap-1.5 rounded-full py-1 pr-3 text-sm font-semibold text-muted transition hover:text-ink">
      <Icon name="arrow-left" className="h-4 w-4" /> {t('serviceDetail.back')}
    </Link>
  )
}

function ServiceDetailView({ service: s }: { service: ServiceDetail }) {
  const { t } = useTranslation()
  const pick = useLocalized()
  const formatDate = useFormatDate()
  const primary = s.life_events[0]
  const tone = primary ? EVENT_TONE[primary] : null
  const quotes = new Set(
    [...s.evidence, ...s.requirements.flatMap((r) => [...r.evidence, ...r.options.flatMap((o) => (o.evidence ? [o.evidence] : []))])].map((e) => e.id),
  ).size
  const glance = [
    ['mandatory', s.requirements.filter((r) => r.requirement_type === 'mandatory').length],
    ['conditional', s.requirements.filter((r) => r.requirement_type === 'conditional').length],
    ['optional', s.requirements.filter((r) => r.requirement_type === 'optional').length],
    ['outputs', s.outputs.length],
    ['quotes', quotes],
  ] as const

  return (
    <div className="space-y-10">
      <BackLink />

      <header className={`relative animate-rise overflow-hidden rounded-[2rem] p-7 sm:p-10 ${tone ? tone.bg : 'bg-paper-deep'}`}>
        <span className={`absolute -top-16 -right-16 h-64 w-64 rounded-full border-[28px] border-current opacity-[0.06] ${tone?.text ?? ''}`} aria-hidden />
        <div className="relative flex flex-wrap items-center gap-x-4 gap-y-2">
          {s.life_events.map((e) => (
            <Link key={e} to={`/services?event=${e}`} className={`inline-flex items-center gap-2 text-sm font-bold ${EVENT_TONE[e].text} hover:underline`}>
              <Seal event={e} size="sm" /> {t(`lifeEvents.${e}.name`)}
            </Link>
          ))}
        </div>
        <h1 className="relative mt-6 max-w-3xl font-display text-4xl leading-[1.05] font-semibold tracking-tight text-ink sm:text-5xl">{pick(s.name, s.name_hi)}</h1>
        <p className="relative mt-4 max-w-2xl text-lg leading-relaxed text-ink/70">{pick(s.description, s.description_hi)}</p>
        <dl className="relative mt-7 flex flex-wrap gap-x-10 gap-y-4 text-sm">
          <div>
            <dt className="text-xs font-bold tracking-wide text-muted uppercase">{t('services.authority')}</dt>
            <dd lang="en" className="mt-1 font-semibold text-ink">{s.authority}</dd>
          </div>
          <div>
            <dt className="text-xs font-bold tracking-wide text-muted uppercase">{t('serviceDetail.coverage')}</dt>
            <dd className="mt-1 font-semibold text-ink">
              {t(`jurisdiction.${s.jurisdiction}`)}
              {s.state ? ` · ${s.state}` : ''}
              {s.application_form ? ` · ${s.application_form}` : ''}
            </dd>
          </div>
          {s.last_verified_at && (
            <div>
              <dt className="text-xs font-bold tracking-wide text-muted uppercase">{t('serviceDetail.lastVerified')}</dt>
              <dd className="mt-1 flex items-center gap-1.5 font-semibold text-ink">
                <Icon name="shield" className="h-4 w-4 text-jade-600" />
                {formatDate(s.last_verified_at)}
              </dd>
            </div>
          )}
        </dl>
        <div className="relative mt-8 flex flex-wrap gap-3">
          {s.application_url && (
            <a href={s.application_url} target="_blank" rel="noreferrer" className={buttonClass('primary', 'lg')}>
              {t('serviceDetail.apply')} ↗
            </a>
          )}
          <Link to={`/planner?service=${s.id}`} className={buttonClass('secondary', 'lg')}>
            <Icon name="plan" className="h-4 w-4" /> {t('serviceDetail.planThis')}
          </Link>
          <a href={s.official_info_url} target="_blank" rel="noreferrer" className={buttonClass('ghost', 'lg')}>
            {t('services.officialSite')} ↗
          </a>
        </div>
      </header>

      <dl className="flex animate-rise flex-wrap gap-y-4 divide-x divide-rule border-y border-rule py-5">
        {glance.map(([key, value]) => (
          <div key={key} className="flex min-w-[8rem] flex-1 flex-col-reverse px-5 first:pl-0">
            <dt className="text-xs font-semibold text-muted">{t(`serviceDetail.glance.${key}`)}</dt>
            <dd className={`font-display text-3xl font-semibold ${value === 0 ? 'text-faint' : 'text-ink'}`}>{value}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_21rem] lg:gap-14">
        <div className="min-w-0 space-y-14">
          {GROUPS.map((group) => {
            const reqs = s.requirements.filter((r) => r.requirement_type === group)
            if (reqs.length === 0) return null
            return (
              <section key={group} aria-labelledby={`group-${group}`}>
                <div className="flex items-baseline gap-3 border-b-2 border-ink pb-3">
                  <h2 id={`group-${group}`} className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
                    {t(`serviceDetail.group.${group}`)}
                  </h2>
                  <span className="text-sm font-semibold text-muted">{reqs.length}</span>
                </div>
                <p className="mt-3 text-sm text-muted">{t(`serviceDetail.groupHint.${group}`)}</p>
                <ol className="mt-6 space-y-5">
                  {reqs.map((r, i) => (
                    <li key={r.id}>
                      <RequirementCard requirement={r} index={i} />
                    </li>
                  ))}
                </ol>
              </section>
            )
          })}
        </div>

        <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <section className="rounded-3xl bg-ink p-6 text-paper">
            <h2 className="flex items-center gap-2 text-xs font-bold tracking-[0.18em] text-zest-400 uppercase">
              <Icon name="check" className="h-4 w-4" /> {t('serviceDetail.outputs')}
            </h2>
            <ul className="mt-4 space-y-3">
              {s.outputs.map((o) => (
                <li key={o.document_id} className="flex gap-3 font-display text-lg leading-snug">
                  <Icon name="doc" className="mt-1 h-5 w-5 shrink-0 text-zest-400" />
                  {pick(o.document_name, o.document_name_hi)}
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-3xl border border-rule bg-card p-6">
            <h2 className="text-xs font-bold tracking-[0.18em] text-muted uppercase">{t('serviceDetail.prerequisites')}</h2>
            {s.prerequisites.length === 0 ? (
              <p className="mt-3 text-sm leading-relaxed text-ink/80">{t('serviceDetail.noPrerequisites')}</p>
            ) : (
              <ul className="mt-3 space-y-3 text-sm">
                {s.prerequisites.map((p) => (
                  <li key={p.service_id}>
                    <Link to={`/services/${p.service_id}`} className="font-semibold text-jade-700 underline">
                      {pick(p.service_name, p.service_name_hi)}
                    </Link>{' '}
                    <VerificationBadge status={p.verification_status} />
                    <EvidenceList items={[{ ...p.evidence }]} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {(s.verification_notes || s.evidence.length > 0) && (
            <section className="rounded-3xl border border-dashed border-rule-strong p-6 text-sm">
              <h2 className="text-xs font-bold tracking-[0.18em] text-muted uppercase">{t('serviceDetail.aboutData')}</h2>
              {s.verification_notes && (
                <p lang="en" className="mt-3 leading-relaxed text-ink/80">
                  {s.verification_notes}
                </p>
              )}
              <EvidenceList items={s.evidence} />
            </section>
          )}
        </aside>
      </div>
    </div>
  )
}

/** One requirement. Kind is shown by its marker: numbered (must), "if" (conditional), open ring (optional). */
function RequirementCard({ requirement: r, index }: { requirement: Requirement; index: number }) {
  const { t } = useTranslation()
  const pick = useLocalized()
  const verified = r.verification_status === 'verified'
  const evidence = [...r.evidence, ...r.options.flatMap((o) => (o.evidence ? [o.evidence] : []))]
  const unique = [...new Map(evidence.map((e) => [e.id, e])).values()]
  const kind = r.requirement_type

  const marker =
    kind === 'mandatory' ? (
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-ink font-display text-lg font-semibold text-paper">{index + 1}</span>
    ) : kind === 'conditional' ? (
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-honey-100 font-display text-base font-semibold text-honey-700 italic">if</span>
    ) : (
      <span className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-dashed border-rule-strong text-faint">
        <Icon name="plus" className="h-4 w-4" />
      </span>
    )

  return (
    <article
      className={`grid grid-cols-[auto_minmax(0,1fr)] gap-4 rounded-3xl p-5 sm:gap-5 sm:p-6 ${
        !verified ? 'border-2 border-dashed border-honey-500/60 bg-honey-50/50' : kind === 'optional' ? 'border border-dashed border-rule-strong' : 'bg-card ring-1 ring-rule'
      }`}
    >
      <div aria-hidden>{marker}</div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <h3 className={`text-lg leading-snug font-bold ${kind === 'optional' ? 'text-ink/75' : 'text-ink'}`}>{pick(r.name, r.name_hi)}</h3>
          {verified ? <VerifiedBadge /> : <VerificationBadge status={r.verification_status} />}
        </div>
        {!verified && <p className="mt-1 text-xs font-medium text-honey-700">{t('serviceDetail.unverifiedWarning')}</p>}
        {r.condition && (
          <p className="mt-3 rounded-2xl bg-honey-50 px-4 py-2.5 text-sm text-ink/80">
            <span className="font-bold text-honey-700">{t('serviceDetail.onlyIf')}:</span> <span lang="en">{r.condition}</span>
          </p>
        )}
        {r.is_alternative_group && <p className="mt-3 text-sm font-semibold text-ink/80">{t('serviceDetail.anyOne')}</p>}
        <ul className={`mt-3 flex flex-wrap items-center gap-2 text-sm`}>
          {r.options.map((o, i) => (
            <li key={o.document_id} className="flex items-center gap-2">
              {i > 0 && r.is_alternative_group && (
                <span className="text-[11px] font-bold tracking-wider text-faint uppercase" aria-hidden>
                  {t('serviceDetail.or')}
                </span>
              )}
              <span className="inline-flex items-start gap-2 rounded-2xl bg-paper px-3 py-2 ring-1 ring-rule">
                <Icon name="doc" className="mt-0.5 h-4 w-4 shrink-0 text-jade-600" />
                <span>
                  <span className="text-ink">{pick(o.document_name, o.document_name_hi)}</span>
                  {o.notes && (
                    <span lang="en" className="block text-xs text-muted">
                      {o.notes}
                    </span>
                  )}
                </span>
              </span>
            </li>
          ))}
        </ul>
        {r.notes && (
          <p lang="en" className="mt-3 text-xs leading-relaxed text-muted">
            {r.notes}
          </p>
        )}
        <EvidenceList items={unique} />
      </div>
    </article>
  )
}
