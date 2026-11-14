import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { buttonClass } from '../../components/ui/Button'
import { useLocalized } from '../../lib/useLocalized'
import type { HeldDocument, VaultStatus } from '../../types/api'
import { Notice } from '../auth/AuthLayout'
import { readSavedPlan } from '../planner/usePlannerState'
import { useDocuments, useServices } from '../services/api'
import { useAccountProgress, useCreatePlan, useVault } from './api'

/**
 * Explicit, previewed import of the plan saved in THIS browser into the signed-in account.
 * Never automatic (devices can be shared). The device copy is left untouched; documents already
 * in the vault and progress already in the account are kept as they are.
 */
export function ImportLocalPlan({ onImported }: { onImported?: (planId: string) => void }) {
  const { t } = useTranslation()
  const pick = useLocalized()
  const navigate = useNavigate()
  const services = useServices()
  const documents = useDocuments()
  const vault = useVault()
  const accountProgress = useAccountProgress()
  const create = useCreatePlan()
  const [open, setOpen] = useState(false)
  const local = readSavedPlan()
  if (local.targets.length === 0) return null

  const knownSvc = new Set((services.data ?? []).map((s) => s.id))
  const knownDoc = new Set((documents.data ?? []).map((d) => d.id))
  const svcName = (id: string) => {
    const s = services.data?.find((x) => x.id === id)
    return s ? pick(s.name, s.name_hi) : id
  }
  const docName = (id: string) => {
    const d = documents.data?.find((x) => x.id === id)
    return d ? pick(d.name, d.name_hi) : id
  }
  const inVault = new Set((vault.data ?? []).map((d) => d.document_type))
  const targets = local.targets.filter((s) => knownSvc.has(s))
  const held: HeldDocument[] = local.owned
    .filter((d) => knownDoc.has(d))
    .map((d) => ({ document_type: d, status: (local.docStates[d] ?? 'valid') as VaultStatus }))
  const newDocs = held.filter((h) => !inVault.has(h.document_type))
  const keptDocs = held.filter((h) => inVault.has(h.document_type))
  const localProgress: Record<string, 'started' | 'submitted' | 'completed'> = { ...local.progress }
  for (const s of local.completed) localProgress[s] = 'completed'
  const progress = Object.fromEntries(Object.entries(localProgress).filter(([s]) => knownSvc.has(s)))
  const newProgress = Object.entries(progress).filter(([s]) => !(s in (accountProgress.data ?? {})))
  const ready = vault.data && accountProgress.data && services.data && documents.data

  return (
    <section className="rounded-[2rem] border border-honey-100 bg-honey-50/60 p-5 sm:p-6" aria-labelledby="import-title">
      <h2 id="import-title" className="font-display text-lg font-semibold text-ink">
        {t('import.title')}
      </h2>
      <p className="mt-1 text-sm text-muted">{t('import.intro')}</p>
      {!open ? (
        <button type="button" className={buttonClass('secondary', 'sm', 'mt-4')} onClick={() => setOpen(true)} disabled={!ready}>
          {t('import.preview')}
        </button>
      ) : (
        <div className="mt-4 space-y-3 text-sm" data-testid="import-preview">
          <PreviewList title={t('import.services', { count: targets.length })} items={targets.map(svcName)} />
          <PreviewList
            title={t('import.newDocs', { count: newDocs.length })}
            items={newDocs.map((h) => `${docName(h.document_type)} (${t(`vault.statusOption.${h.status}`)})`)}
          />
          {keptDocs.length > 0 && <PreviewList title={t('import.keptDocs', { count: keptDocs.length })} items={keptDocs.map((h) => docName(h.document_type))} />}
          <PreviewList
            title={t('import.progress', { count: newProgress.length })}
            items={newProgress.map(([s, p]) => `${svcName(s)}: ${t(`processState.${p}`)}`)}
          />
          <p className="text-xs text-muted">{t('import.deviceKept')}</p>
          {create.isError && <Notice tone="error">{t('account.saveError')}</Notice>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonClass('primary', 'sm')}
              disabled={create.isPending || targets.length === 0}
              onClick={() =>
                create.mutate(
                  {
                    source: 'import',
                    title: t('import.planTitle'),
                    target_service_ids: targets,
                    goals: local.goals,
                    state: local.state,
                    held_documents: held,
                    progress,
                  },
                  {
                    onSuccess: (p) => {
                      setOpen(false)
                      if (onImported) onImported(p.id)
                      else navigate(`/planner?plan=${p.id}`)
                    },
                  },
                )
              }
            >
              {create.isPending ? t('vault.saving') : t('import.confirm')}
            </button>
            <button type="button" className={buttonClass('ghost', 'sm')} onClick={() => setOpen(false)}>
              {t('vault.cancel')}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function PreviewList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="font-semibold text-ink">{title}</p>
      {items.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-muted">
          {items.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
