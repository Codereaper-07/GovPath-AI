import { useTranslation } from 'react-i18next'
import { Icon } from '../../components/ui/Icon'

/** Marks data stored in the signed-in citizen's account (vs. guest data kept in this browser). */
export function AccountBadge({ device = false }: { device?: boolean }) {
  const { t } = useTranslation()
  return device ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-honey-50 px-3 py-1 text-xs font-bold text-honey-700 ring-1 ring-honey-100">
      <Icon name="doc" className="h-3.5 w-3.5" /> {t('account.deviceBadge')}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-jade-50 px-3 py-1 text-xs font-bold text-jade-800 ring-1 ring-jade-100">
      <Icon name="user" className="h-3.5 w-3.5" /> {t('account.savedBadge')}
    </span>
  )
}
