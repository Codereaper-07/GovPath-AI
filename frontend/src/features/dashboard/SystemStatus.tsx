import { useTranslation } from 'react-i18next'
import { useApiHealth, useDbHealth } from './api'

type Tone = 'ok' | 'warn' | 'error' | 'pending'

const DOT: Record<Tone, string> = {
  ok: 'bg-jade-500',
  warn: 'bg-honey-500',
  error: 'bg-crimson-500',
  pending: 'bg-waiting',
}

function Item({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  return (
    <li className="flex items-center gap-2">
      <span className={`h-2 w-2 rounded-full ${DOT[tone]}`} aria-hidden />
      <span className="text-muted">{label}</span>
      <span className="font-semibold text-ink">{value}</span>
    </li>
  )
}

/** Live connection status, as a quiet status line. */
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
    <section aria-labelledby="system-status" className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-2xl border border-rule px-5 py-4 text-sm">
      <h2 id="system-status" className="text-xs font-bold tracking-[0.18em] text-muted uppercase">
        {t('status.title')}
      </h2>
      <ul className="flex flex-wrap gap-x-6 gap-y-2">
        <Item label={t('status.api')} value={apiRow[0]} tone={apiRow[1]} />
        <Item label={t('status.database')} value={dbRow[0]} tone={dbRow[1]} />
        <Item label={t('status.pgvector')} value={vecRow[0]} tone={vecRow[1]} />
      </ul>
    </section>
  )
}
