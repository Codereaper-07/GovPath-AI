import { useTranslation } from 'react-i18next'
import { Card } from '../../components/ui/Card'
import { useApiHealth, useDbHealth } from './api'

type Tone = 'ok' | 'warn' | 'error' | 'pending'

const DOT: Record<Tone, string> = {
  ok: 'bg-green-500',
  warn: 'bg-amber-400',
  error: 'bg-red-500',
  pending: 'bg-slate-300',
}

function Row({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  return (
    <div className="flex items-center justify-between py-2 text-sm">
      <span className="text-slate-600">{label}</span>
      <span className="flex items-center gap-2 font-medium">
        <span className={`h-2 w-2 rounded-full ${DOT[tone]}`} />
        {value}
      </span>
    </div>
  )
}

export function SystemStatus() {
  const { t } = useTranslation()
  const api = useApiHealth()
  const db = useDbHealth()

  const apiRow: [string, Tone] = api.isPending
    ? [t('status.loading'), 'pending']
    : api.isError
      ? [t('status.unreachable'), 'error']
      : [t('status.ok'), 'ok']

  const dbTone: Record<string, Tone> = { ok: 'ok', unconfigured: 'warn', error: 'error' }
  const dbRow: [string, Tone] = db.isPending
    ? [t('status.loading'), 'pending']
    : db.isError
      ? [t('status.unreachable'), 'error']
      : [t(`status.${db.data.status}`), dbTone[db.data.status]]

  const vecRow: [string, Tone] =
    db.data?.pgvector === true
      ? [t('status.ok'), 'ok']
      : db.data?.pgvector === false
        ? [t('status.error'), 'error']
        : ['—', 'pending']

  return (
    <Card title={t('status.title')}>
      <div className="divide-y divide-slate-100">
        <Row label={t('status.api')} value={apiRow[0]} tone={apiRow[1]} />
        <Row label={t('status.database')} value={dbRow[0]} tone={dbRow[1]} />
        <Row label={t('status.pgvector')} value={vecRow[0]} tone={vecRow[1]} />
      </div>
    </Card>
  )
}
