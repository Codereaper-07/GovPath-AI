import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { buttonClass } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { PageHeader } from '../../components/ui/PageHeader'
import { ErrorState, LoadingState } from '../../components/ui/States'
import { useLocalized } from '../../lib/useLocalized'
import type { DocumentType, PlanChange, VaultDocument, VaultDocumentInput, VaultStatus } from '../../types/api'
import { Notice } from '../auth/AuthLayout'
import { INPUT_CLASS } from '../auth/authUtils'
import { useDocuments } from '../services/api'
import { useAddDocument, useDeleteDocument, useUpdateDocument, useVault } from './api'
import { AccountBadge } from './AccountBadge'
import { PlanChangesNotice } from './PlanChangesNotice'
import { STATUS_TONE, VAULT_STATUSES, writeErrorKey } from './vault'

const LABEL = 'mb-1.5 block text-xs font-bold tracking-[0.14em] text-muted uppercase'

export function VaultPage() {
  const { t } = useTranslation()
  const vault = useVault()
  const catalogue = useDocuments()
  const [lastChanges, setLastChanges] = useState<PlanChange[] | null>(null)
  const [adding, setAdding] = useState(false)

  return (
    <div>
      <PageHeader
        eyebrow={t('profile.eyebrow')}
        title={t('vault.title')}
        actions={
          <>
            <Link to="/activity" className={buttonClass('secondary', 'md')}>
              <Icon name="clock" className="h-4 w-4" /> {t('activity.title')}
            </Link>
            <button type="button" className={buttonClass('primary', 'md')} onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
              <Icon name="plus" className="h-4 w-4" /> {t('vault.add')}
            </button>
          </>
        }
      >
        {t('vault.intro')}
      </PageHeader>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <AccountBadge />
        <p className="text-xs text-muted">{t('vault.noNumbers')}</p>
      </div>

      {lastChanges && (
        <div className="mb-6 rounded-[1.5rem] bg-paper-deep/50 p-5 ring-1 ring-rule" role="status">
          <PlanChangesNotice changes={lastChanges} />
        </div>
      )}

      {adding && catalogue.data && (
        <AddDocumentForm
          catalogue={catalogue.data}
          onDone={(changes) => {
            setLastChanges(changes)
            setAdding(false)
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {(vault.isPending || catalogue.isPending) && <LoadingState />}
      {vault.isError && <ErrorState message={t('vault.loadError')} onRetry={() => void vault.refetch()} />}
      {vault.data && vault.data.length === 0 && !adding && (
        <div className="rounded-[2rem] border border-dashed border-rule-strong p-10 text-center">
          <p className="font-display text-xl font-semibold text-ink">{t('vault.emptyTitle')}</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">{t('vault.empty')}</p>
          <button type="button" className={buttonClass('primary', 'md', 'mt-5')} onClick={() => setAdding(true)}>
            <Icon name="plus" className="h-4 w-4" /> {t('vault.add')}
          </button>
        </div>
      )}
      {vault.data && vault.data.length > 0 && (
        <ul className="grid gap-4 md:grid-cols-2" aria-label={t('vault.title')}>
          {vault.data.map((d) => (
            <DocumentCard key={d.id} doc={d} onChanged={setLastChanges} />
          ))}
        </ul>
      )}
    </div>
  )
}

function DocumentFields({
  value,
  onChange,
  idPrefix,
}: {
  value: VaultDocumentInput
  onChange: (v: VaultDocumentInput) => void
  idPrefix: string
}) {
  const { t } = useTranslation()
  const set = (patch: VaultDocumentInput) => onChange({ ...value, ...patch })
  return (
    <>
      <label className="block">
        <span className={LABEL}>{t('vault.status')}</span>
        <select className={`${INPUT_CLASS} font-semibold`} value={value.status} onChange={(e) => set({ status: e.target.value as VaultStatus })}>
          {VAULT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`vault.statusOption.${s}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className={LABEL}>{t('vault.label')}</span>
        <input
          className={INPUT_CLASS}
          maxLength={80}
          value={value.label ?? ''}
          placeholder={t('vault.labelPlaceholder')}
          onChange={(e) => set({ label: e.target.value })}
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block" htmlFor={`${idPrefix}-issue`}>
          <span className={LABEL}>{t('vault.issueDate')}</span>
          <input id={`${idPrefix}-issue`} type="date" className={INPUT_CLASS} value={value.issue_date ?? ''} onChange={(e) => set({ issue_date: e.target.value || null })} />
        </label>
        <label className="block" htmlFor={`${idPrefix}-expiry`}>
          <span className={LABEL}>{t('vault.expiryDate')}</span>
          <input id={`${idPrefix}-expiry`} type="date" className={INPUT_CLASS} value={value.expiry_date ?? ''} onChange={(e) => set({ expiry_date: e.target.value || null })} />
        </label>
      </div>
      <label className="block">
        <span className={LABEL}>{t('vault.note')}</span>
        <textarea
          className={`${INPUT_CLASS} resize-none`}
          rows={2}
          maxLength={280}
          value={value.note ?? ''}
          placeholder={t('vault.notePlaceholder')}
          onChange={(e) => set({ note: e.target.value })}
        />
      </label>
    </>
  )
}

const blankToNull = (v: VaultDocumentInput): VaultDocumentInput => ({
  ...v,
  label: v.label?.trim() || null,
  note: v.note?.trim() || null,
  issue_date: v.issue_date || null,
  expiry_date: v.expiry_date || null,
})

function AddDocumentForm({
  catalogue,
  onDone,
  onCancel,
}: {
  catalogue: DocumentType[]
  onDone: (changes: PlanChange[]) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const pick = useLocalized()
  const add = useAddDocument()
  const [value, setValue] = useState<VaultDocumentInput>({ document_type: '', status: 'valid' })
  const sorted = [...catalogue].sort((a, b) => pick(a.name, a.name_hi).localeCompare(pick(b.name, b.name_hi)))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    add.mutate(blankToNull(value), { onSuccess: (r) => onDone(r.plan_changes) })
  }
  return (
    <form onSubmit={submit} className="mb-8 space-y-4 rounded-[2rem] border border-rule bg-card p-6 sm:p-7" aria-labelledby="vault-add-title">
      <h2 id="vault-add-title" className="font-display text-xl font-semibold text-ink">
        {t('vault.addTitle')}
      </h2>
      {add.isError && <Notice tone="error">{t(writeErrorKey(add.error))}</Notice>}
      <label className="block">
        <span className={LABEL}>{t('vault.documentType')}</span>
        <select
          className={`${INPUT_CLASS} font-semibold`}
          value={value.document_type}
          onChange={(e) => setValue((v) => ({ ...v, document_type: e.target.value }))}
          required
        >
          <option value="">{t('vault.chooseType')}</option>
          {sorted.map((d) => (
            <option key={d.id} value={d.id}>
              {pick(d.name, d.name_hi)}
            </option>
          ))}
        </select>
      </label>
      <DocumentFields value={value} onChange={setValue} idPrefix="add" />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={!value.document_type || add.isPending} className={buttonClass('primary', 'md')}>
          {add.isPending ? t('vault.saving') : t('vault.save')}
        </button>
        <button type="button" onClick={onCancel} className={buttonClass('ghost', 'md')}>
          {t('vault.cancel')}
        </button>
      </div>
    </form>
  )
}

function DocumentCard({ doc, onChanged }: { doc: VaultDocument; onChanged: (c: PlanChange[]) => void }) {
  const { t } = useTranslation()
  const pick = useLocalized()
  const update = useUpdateDocument()
  const remove = useDeleteDocument()
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [value, setValue] = useState<VaultDocumentInput>({})
  const name = doc.name ? pick(doc.name, doc.name_hi) : doc.document_type

  const startEdit = () => {
    setValue({ status: doc.status, label: doc.label, issue_date: doc.issue_date, expiry_date: doc.expiry_date, note: doc.note })
    setEditing(true)
  }
  const save = (e: FormEvent) => {
    e.preventDefault()
    update.mutate(
      { id: doc.id, ...blankToNull(value) },
      {
        onSuccess: (r) => {
          setEditing(false)
          onChanged(r.plan_changes)
        },
      },
    )
  }

  return (
    <li className="rounded-[1.75rem] bg-card p-5 ring-1 ring-rule" data-testid={`vault-doc-${doc.document_type}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-lg leading-snug font-semibold text-ink">{name}</p>
          {doc.label && <p className="text-sm text-muted">{doc.label}</p>}
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ring-1 ${STATUS_TONE[doc.effective_status]}`}>
          {t(`vault.statusChip.${doc.effective_status}`)}
        </span>
      </div>
      <dl className="mt-3 space-y-1 text-sm text-muted">
        {doc.expiry_passed && doc.status === 'valid' && <p className="font-semibold text-honey-700">{t('vault.expiryPassed')}</p>}
        {doc.expiry_date && (
          <div className="flex gap-2">
            <dt>{t('vault.expiryDate')}:</dt>
            <dd className="font-semibold text-ink">{doc.expiry_date}</dd>
          </div>
        )}
        {doc.issue_date && (
          <div className="flex gap-2">
            <dt>{t('vault.issueDate')}:</dt>
            <dd>{doc.issue_date}</dd>
          </div>
        )}
        {doc.note && <p className="italic">“{doc.note}”</p>}
        <p className="text-xs">{t('vault.usedBy', { count: doc.used_by_plan_ids.length })}</p>
      </dl>

      {editing ? (
        <form onSubmit={save} className="mt-4 space-y-4 border-t border-rule pt-4">
          {update.isError && <Notice tone="error">{t(writeErrorKey(update.error))}</Notice>}
          <DocumentFields value={value} onChange={setValue} idPrefix={doc.id} />
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={update.isPending} className={buttonClass('primary', 'sm')}>
              {update.isPending ? t('vault.saving') : t('vault.save')}
            </button>
            <button type="button" onClick={() => setEditing(false)} className={buttonClass('ghost', 'sm')}>
              {t('vault.cancel')}
            </button>
          </div>
        </form>
      ) : confirming ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-rule pt-4" role="group" aria-label={t('vault.confirmRemove', { document: name })}>
          <p className="w-full text-sm font-semibold text-ink">{t('vault.confirmRemove', { document: name })}</p>
          {remove.isError && <Notice tone="error">{t('vault.errors.generic')}</Notice>}
          <button
            type="button"
            disabled={remove.isPending}
            className={buttonClass('primary', 'sm')}
            onClick={() => remove.mutate(doc.id, { onSuccess: (r) => onChanged(r.plan_changes) })}
          >
            {t('vault.removeYes')}
          </button>
          <button type="button" onClick={() => setConfirming(false)} className={buttonClass('ghost', 'sm')}>
            {t('vault.cancel')}
          </button>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-rule pt-4">
          <button type="button" onClick={startEdit} className={buttonClass('secondary', 'sm')} aria-label={t('vault.editAria', { document: name })}>
            {t('vault.edit')}
          </button>
          <button type="button" onClick={() => setConfirming(true)} className={buttonClass('ghost', 'sm')} aria-label={t('vault.removeAria', { document: name })}>
            {t('vault.remove')}
          </button>
        </div>
      )}
    </li>
  )
}
