import { useTranslation } from 'react-i18next'
import { Card } from '../../components/ui/Card'
import { PageHeader } from '../../components/ui/PageHeader'
import { SystemStatus } from './SystemStatus'

const SCOPE_KEYS = ['aadhaar', 'voter', 'dl', 'rc', 'passport'] as const

export function DashboardPage() {
  const { t } = useTranslation()
  return (
    <>
      <PageHeader title={t('dashboard.title')}>{t('dashboard.intro')}</PageHeader>
      <div className="grid gap-6 md:grid-cols-2">
        <Card title={t('dashboard.servicesInScope')}>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
            {SCOPE_KEYS.map((k) => (
              <li key={k}>{t(`scope.${k}`)}</li>
            ))}
          </ul>
        </Card>
        <SystemStatus />
      </div>
    </>
  )
}
