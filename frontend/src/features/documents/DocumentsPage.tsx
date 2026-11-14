import { useTranslation } from 'react-i18next'
import { PageHeader } from '../../components/ui/PageHeader'
import { ErrorState, LoadingState } from '../../components/ui/States'
import { useLocalized } from '../../lib/useLocalized'
import type { DocumentCategory } from '../../types/api'
import { useDocuments, useServices } from '../services/api'

const ORDER: DocumentCategory[] = ['existing_record', 'address_proof', 'vehicle', 'financial', 'identity', 'other']

export function DocumentsPage() {
  const { t } = useTranslation()
  const pick = useLocalized()
  const documents = useDocuments()
  const services = useServices()

  if (documents.isPending || services.isPending) return <LoadingState />
  if (documents.isError || services.isError)
    return <ErrorState message={t('services.loadError')} onRetry={() => void documents.refetch()} />

  const serviceName = (id: string) => {
    const s = services.data.find((x) => x.id === id)
    return s ? pick(s.name, s.name_hi) : id
  }

  return (
    <>
      <PageHeader title={t('documents.title')}>{t('documents.intro')}</PageHeader>
      <div className="space-y-6">
        {ORDER.map((cat) => {
          const docs = documents.data.filter((d) => d.category === cat)
          if (docs.length === 0) return null
          return (
            <section key={cat}>
              <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">
                {t(`documentCategory.${cat}`)}
              </h2>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
                {docs.map((d) => (
                  <li key={d.id} className="p-4 text-sm">
                    <p className="font-medium text-slate-900">{pick(d.name, d.name_hi)}</p>
                    {d.accepted_by_service_ids.length > 0 && (
                      <p className="mt-1 text-slate-600">
                        {t('documents.acceptedBy')}: {d.accepted_by_service_ids.map(serviceName).join(t('common.listSeparator'))}
                      </p>
                    )}
                    {d.issued_by_service_ids.length > 0 && (
                      <p className="mt-0.5 text-slate-600">
                        {t('documents.issuedBy')}: {d.issued_by_service_ids.map(serviceName).join(t('common.listSeparator'))}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </>
  )
}
